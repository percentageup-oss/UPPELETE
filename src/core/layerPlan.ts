import { captionFrame, type CaptionLayout, type LayoutInputs, type MotionCue } from '../captions/renderer'
import { captionStyleInputs, DEFAULT_CAPTION_STYLE, resolveCaptionMotion, type CaptionStyle } from '../captions/style'
import { displayCue, type CaptionDisplay } from '../captions/wordDisplay'
import { compositionFor } from './composition'
import { frameEffectsAt } from './frameEffects'

import type { Clip, EffectRegion, Shape, TextOverlay, Track } from './edit'
import { shapeFrameAt } from '../captions/shapeMotion'
import type { Rational } from './media'
import type { Cue } from './model'
import { decorativeTextCue, textMotionAt, titleMotionAt } from '../captions/textMotion'
import { activeCueAt, type ActiveCue, type TimeRange } from './timelineModel'
import { graphicsPasses, passOf } from './graphicsPasses'

/**
 * Maps each **sequence** frame of the export to the **source** timestamp its caption layer must be
 * evaluated at, and gives that frame a signature. Consecutive frames whose signature is unchanged
 * look identical, so the export host can re-send the previous PNG bytes: the same frame count goes
 * down the pipe, far fewer frames are painted (docs/EDITING.md).
 *
 * The signature is computed by *reusing* `captionFrame` — never by reimplementing its motion rules.
 * `captionFrame` only reads `layout.status`, `layout.inputs` and (as a text fallback)
 * `layout.lines`, so a stub layout carrying the real style inputs is enough to evaluate motion
 * state in the worker, where no DOM measurement exists. `elapsedUs` is deliberately excluded: it
 * changes every single frame and would defeat reuse without changing a pixel.
 */
export type LayerPlanInput = {
  cues: readonly Cue[]
  style?: CaptionStyle
  display?: CaptionDisplay
  /** v2: kept source ranges of one media. Absent means the identity edit, so sequence time equals source time. */
  segments?: readonly TimeRange[]
  /**
   * v3: the manifest's stacked timeline. When present the shown caption comes from the one shared
   * rule, `activeCueAt` (topmost visible video with a live cue), and overlays are sequence-timed.
   */
  timeline?: { tracks: readonly Track[]; clips: readonly Clip[] }
  /** Source offset of sequence time zero; `planFromMedia` uses 0. */
  rangeStartUs?: number
  frameRate: Rational
  mediaDurationUs?: number | null
  /** Overlays visible at a frame join the signature (source time for v2, sequence time for v3). */
  overlays?: readonly { id: string; startUs: number; endUs: number; opacity: number }[]
  /** Frame-paint effects (docs/EDITING.md "Frame-paint effects"): sequence-timed like `timeline`
   * overlays, since they only ever reach a project through the v3 manifest. */
  effects?: readonly EffectRegion[]
  /** Authored text (schema 10): sequence-timed and animated, so each active item's motion joins the signature. */
  textOverlays?: readonly TextOverlay[]
  /** Vector shapes (schema 17): sequence-timed. `draw`/`sweep` progress joins the signature, or a still-animating shape would reuse a stale frame. */
  shapes?: readonly Shape[]
  /** Output pixel size; only the aspect matters, for the composition the style inputs are built in. */
  output?: { width: number; height: number }
}

export type LayerFrame = {
  index: number
  /** Microseconds from the start of the output timeline. */
  sequenceUs: number
  /** The source timestamp this frame's captions must be evaluated at. */
  sourceUs: number
  activeCueId: string | null
  /** The resolved active cue, so the frame request reuses it instead of resolving it again. */
  active: ActiveCue | null
  signature: string
}

export type LayerSpan = { startIndex: number; endIndex: number; signature: string; frame: LayerFrame }

/** Index arithmetic stays rational until a single floor, matching `plan.ts`'s `frameSourceUs`. */
export function sequenceFrameUs(index: number, rate: Rational): number {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid frame index')
  const value = BigInt(index) * 1_000_000n * BigInt(rate.denominator) / BigInt(rate.numerator)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Sequence timestamp overflow')
  return Number(value)
}

/**
 * Manifest v2's sequence → source rule over kept segments (the retired `sequence.ts`'s
 * `sequenceToSource`): a cut instant maps to the start of the following segment; past the end clamps.
 */
export function segmentSourceUs(sequenceUs: number, segments: readonly TimeRange[], mediaDurationUs: number | null): number {
  const kept = segments.length ? segments : [{ startUs: 0, endUs: mediaDurationUs ?? Number.MAX_SAFE_INTEGER }]
  const at = Math.max(0, Math.round(sequenceUs))
  let elapsed = 0
  for (const segment of kept) {
    const length = segment.endUs - segment.startUs
    if (at < elapsed + length) return segment.startUs + (at - elapsed)
    elapsed += length
  }
  return kept[kept.length - 1].endUs
}

/** A layout with the real style inputs but no measured geometry — enough for motion evaluation. */
function stubLayout(inputs: LayoutInputs): CaptionLayout {
  return {
    version: 1, inputs, font: inputs.font, lines: [], safeRect: { x: 0, y: 0, width: inputs.viewport.width, height: inputs.viewport.height },
    bounds: { x: 0, y: 0, width: inputs.viewport.width, height: inputs.viewport.height }, fitScale: 1, warnings: [], status: 'ready',
  }
}

export function createLayerPlan(input: LayerPlanInput) {
  const style = input.style ?? DEFAULT_CAPTION_STYLE
  const display = input.display ?? 'line'
  const rangeStartUs = input.rangeStartUs ?? 0
  const mediaDurationUs = input.mediaDurationUs ?? null
  const aspect = input.output ? input.output.width / input.output.height : 16 / 9
  const baseInputs = captionStyleInputs(style, compositionFor(aspect))
  // Per-title layout inputs and decorative cue, built once instead of once per exported frame.
  const textInputs = new Map<string, { inputs: LayoutInputs; cue: MotionCue }>()

  /** Everything a frame's signature (whole-frame or per-pass) is built from, computed once per index. */
  const partsAt = (index: number) => {
    const sequenceUs = sequenceFrameUs(index, input.frameRate)
    let sourceUs: number
    let found: ActiveCue | null
    if (input.timeline) {
      found = activeCueAt(sequenceUs, input.timeline.tracks, input.timeline.clips, input.cues)
      sourceUs = found?.sourceUs ?? sequenceUs
    } else {
      // With no segments this is the identity, so the source timestamp is exactly what X2 uses today.
      sourceUs = input.segments?.length
        ? segmentSourceUs(sequenceUs, input.segments, mediaDurationUs)
        : rangeStartUs + sequenceUs
      // Same first-active-cue/half-open policy as frameRequestAt. Overlaps never rewrite.
      const cue = input.cues.find((candidate) => sourceUs >= candidate.startUs && sourceUs < candidate.endUs)
      found = cue ? { cue, sourceUs, clipId: null } : null
    }
    const activeCue = found?.cue ?? null
    const shown = displayCue(activeCue, display, sourceUs)
    const resolved = resolveCaptionMotion(style, activeCue?.motionOverride)
    const frame = shown
      ? captionFrame(stubLayout({ ...baseInputs, emphasized: shown.emphasized }), shown, sourceUs, resolved.motion, resolved.motionSpeed)
      : null
    // Caption title motion (style.titleMotion) is applied by CaptionPreview to the shown cue, so it must join the signature.
    const captionTitle = shown && baseInputs.titleMotion
      ? titleMotionAt({ startUs: shown.startUs, endUs: shown.endUs, titleMotion: baseInputs.titleMotion }, sourceUs) : null
    const overlayUs = input.timeline ? sequenceUs : sourceUs
    const overlays = (input.overlays ?? [])
      .filter((overlay) => overlayUs >= overlay.startUs && overlayUs < overlay.endUs)
    // Sequence-timed, like `timeline` overlays above — frame-paint effects only ever reach a
    // project through the v3 manifest, never the segment-mapped v2 path.
    const frameEffects = input.effects?.length ? frameEffectsAt(input.effects, sequenceUs, compositionFor(aspect)) : null
    const textParts = (input.textOverlays ?? []).filter((item) => item.startUs <= sequenceUs && sequenceUs < item.endUs)
      .map((item) => {
        const { visible: _visible, ...motion } = textMotionAt(item, sequenceUs)
        let own = textInputs.get(item.id)
        if (!own) { own = { inputs: captionStyleInputs(item.style, compositionFor(aspect)), cue: decorativeTextCue(item) }; textInputs.set(item.id, own) }
        // The title's own word motion and entrance treatment are evaluated by TextOverlayActor at paint time;
        // leaving them out reuses the first (fully hidden) frame for the whole hold.
        const ownFrame = captionFrame(stubLayout(own.inputs), own.cue, sequenceUs, item.style.motion, item.style.motionSpeed)
        const entry = [item.id, item.layerOrder, motion, titleMotionAt(item, sequenceUs), ownFrame.visible, ownFrame.opacity,
          ownFrame.words?.map((word) => [word.wordIndex, word.active, word.revealed, word.scale]) ?? null]
        return { item, entry }
      })
    const shapeParts = (input.shapes ?? []).filter((item) => item.startUs <= sequenceUs && sequenceUs < item.endUs)
      .map((item) => { const { visible: _visible, ...motion } = shapeFrameAt(item, sequenceUs); return { item, entry: [item.id, item.layerOrder, motion] } })
    return { sequenceUs, sourceUs, found, activeCue, shown, frame, captionTitle, overlays, frameEffects, textParts, shapeParts }
  }

  const frameAt = (index: number): LayerFrame => {
    const p = partsAt(index)
    const overlaySignature = p.overlays.map((overlay) => `${overlay.id}@${overlay.opacity}`)
    const textActors = p.textParts.map((part) => part.entry)
    const shapeActors = p.shapeParts.map((part) => part.entry)
    // `elapsedUs` is excluded on purpose: it advances every frame but changes nothing visible.
    // `active?.id` already discriminates a placement override today (an override lives on the cue
    // itself, so a different cue is already a different signature); `placementOverride` is included
    // explicitly anyway so a future change that lets it vary independently of the cue id can't
    // silently reuse a frame with the wrong geometry.
    const signature = JSON.stringify([
      p.activeCue?.id ?? null, p.activeCue?.placementOverride ?? null, p.shown?.text ?? null, p.shown?.startUs ?? null, p.shown?.endUs ?? null,
      p.frame?.visible ?? false, p.frame?.opacity ?? 0, p.frame?.motion ?? null,
      p.frame?.words?.map((word) => [word.wordIndex, word.active, word.revealed, word.scale]) ?? null, p.captionTitle,
      overlaySignature, p.frameEffects, textActors.length ? textActors : null, shapeActors.length ? shapeActors : null,
    ])
    return { index, sequenceUs: p.sequenceUs, sourceUs: p.sourceUs, activeCueId: p.activeCue?.id ?? null, active: p.found, signature }
  }

  return {
    frameAt,
    /** Consecutive frames grouped by identical signature. One span is one distinct painted frame. */
    spans(frameCount: number): LayerSpan[] {
      const spans: LayerSpan[] = []
      for (let index = 0; index < frameCount; index++) {
        const frame = frameAt(index)
        const last = spans[spans.length - 1]
        if (last && last.signature === frame.signature) last.endIndex = index
        else spans.push({ startIndex: index, endIndex: index, signature: frame.signature, frame })
      }
      return spans
    },
    /**
     * One signature (and an `empty` flag) per band of the shape-blend pass model (`graphicsPasses`,
     * docs/plans/shape-blend/02-export-passes.md), aligned with `frameRequestAtSequence(…, pass)`'s
     * own filtering so a pass's cached "previous"/blank buffer is reused exactly when its request
     * would in fact repaint nothing new. With no blending shapes this returns exactly one entry.
     */
    passSignatures(index: number): { signature: string; empty: boolean }[] {
      const passes = graphicsPasses(input.shapes ?? [])
      const p = partsAt(index)
      const captionPass = passOf({ kind: 'caption' }, passes)
      const lastPass = passes.count - 1
      const result: { signature: string; empty: boolean }[] = []
      for (let pass = 0; pass < passes.count; pass++) {
        if (pass % 2 === 1) {
          const { kind, shape } = passes.bands[(pass - 1) / 2]
          const active = shape.startUs <= p.sequenceUs && p.sequenceUs < shape.endUs
          const motion = active ? shapeFrameAt(shape, p.sequenceUs) : null
          // A glass map is a pure function of the shape id and its resolved motion (x, y, scale, opacity), so a
          // static glass shape reuses the previous buffer; a blend band's signature is unchanged.
          result.push({ signature: JSON.stringify([kind === 'glass' ? 'glass' : 'blend', shape.id, motion]), empty: !active })
          continue
        }
        const pinnedOverlays = pass === 0 ? p.overlays.map((overlay) => `${overlay.id}@${overlay.opacity}`) : []
        const pinnedEffects = pass === 0 && p.frameEffects
          ? { vignette: p.frameEffects.vignette, letterbox: p.frameEffects.letterbox, grain: p.frameEffects.grain, vhs: p.frameEffects.vhs, particles: p.frameEffects.particles }
          : null
        const captionVisible = pass === captionPass && (p.frame?.visible ?? false)
        const captionPart = pass === captionPass
          ? [p.activeCue?.id ?? null, p.activeCue?.placementOverride ?? null, p.shown?.text ?? null, p.shown?.startUs ?? null, p.shown?.endUs ?? null,
            p.frame?.visible ?? false, p.frame?.opacity ?? 0, p.frame?.motion ?? null,
            p.frame?.words?.map((word) => [word.wordIndex, word.active, word.revealed, word.scale]) ?? null, p.captionTitle]
          : null
        const graphics = [
          ...p.textParts.filter((part) => passOf({ kind: 'graphic', item: part.item }, passes) === pass).map((part) => part.entry),
          ...p.shapeParts.filter((part) => part.item.blendMode === undefined && passOf({ kind: 'graphic', item: part.item }, passes) === pass).map((part) => part.entry),
        ]
        const fade = pass === lastPass ? (p.frameEffects?.fade ?? null) : null
        const pinnedHasContent = pinnedOverlays.length > 0 || Boolean(pinnedEffects && (pinnedEffects.vignette || pinnedEffects.letterbox || pinnedEffects.grain || pinnedEffects.vhs || pinnedEffects.particles))
        const empty = !pinnedHasContent && !captionVisible && graphics.length === 0 && !fade
        result.push({ signature: JSON.stringify([pinnedOverlays, pinnedEffects, captionPart, graphics.length ? graphics : null, fade]), empty })
      }
      return result
    },
  }
}

export type LayerPlan = ReturnType<typeof createLayerPlan>
