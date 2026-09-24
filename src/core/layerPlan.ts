import { captionFrame, type CaptionLayout, type LayoutInputs, type MotionCue } from '../captions/renderer'
import { captionStyleInputs, DEFAULT_CAPTION_STYLE, resolveCaptionMotion, type CaptionStyle } from '../captions/style'
import { displayCue, type CaptionDisplay } from '../captions/wordDisplay'
import { compositionFor } from './composition'
import { frameEffectsAt } from './frameEffects'

import type { Clip, EffectRegion, TextOverlay, Track } from './edit'
import type { Rational } from './media'
import type { Cue } from './model'
import { decorativeTextCue, textMotionAt, titleMotionAt } from '../captions/textMotion'
import { activeCueAt, type ActiveCue, type TimeRange } from './timelineModel'

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

  const frameAt = (index: number): LayerFrame => {
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
    const active = found?.cue ?? null
    const shown = displayCue(active, display, sourceUs)
    const resolved = resolveCaptionMotion(style, active?.motionOverride)
    const frame = shown
      ? captionFrame(stubLayout({ ...baseInputs, emphasized: shown.emphasized }), shown, sourceUs, resolved.motion, resolved.motionSpeed)
      : null
    // Caption title motion (style.titleMotion) is applied by CaptionPreview to the shown cue, so it must join the signature.
    const captionTitle = shown && baseInputs.titleMotion
      ? titleMotionAt({ startUs: shown.startUs, endUs: shown.endUs, titleMotion: baseInputs.titleMotion }, sourceUs) : null
    const overlayUs = input.timeline ? sequenceUs : sourceUs
    const overlays = (input.overlays ?? [])
      .filter((overlay) => overlayUs >= overlay.startUs && overlayUs < overlay.endUs)
      .map((overlay) => `${overlay.id}@${overlay.opacity}`)
    // Sequence-timed, like `timeline` overlays above — frame-paint effects only ever reach a
    // project through the v3 manifest, never the segment-mapped v2 path.
    const frameEffects = input.effects?.length ? frameEffectsAt(input.effects, sequenceUs, compositionFor(aspect)) : null
    const textActors = (input.textOverlays ?? []).filter((item) => item.startUs <= sequenceUs && sequenceUs < item.endUs)
      .map((item) => {
        const { visible: _visible, ...motion } = textMotionAt(item, sequenceUs)
        let own = textInputs.get(item.id)
        if (!own) { own = { inputs: captionStyleInputs(item.style, compositionFor(aspect)), cue: decorativeTextCue(item) }; textInputs.set(item.id, own) }
        // The title's own word motion and entrance treatment are evaluated by TextOverlayActor at paint time;
        // leaving them out reuses the first (fully hidden) frame for the whole hold.
        const ownFrame = captionFrame(stubLayout(own.inputs), own.cue, sequenceUs, item.style.motion, item.style.motionSpeed)
        return [item.id, item.layerOrder, motion, titleMotionAt(item, sequenceUs), ownFrame.visible, ownFrame.opacity,
          ownFrame.words?.map((word) => [word.wordIndex, word.active, word.revealed, word.scale]) ?? null]
      })
    // `elapsedUs` is excluded on purpose: it advances every frame but changes nothing visible.
    // `active?.id` already discriminates a placement override today (an override lives on the cue
    // itself, so a different cue is already a different signature); `placementOverride` is included
    // explicitly anyway so a future change that lets it vary independently of the cue id can't
    // silently reuse a frame with the wrong geometry.
    const signature = JSON.stringify([
      active?.id ?? null, active?.placementOverride ?? null, shown?.text ?? null, shown?.startUs ?? null, shown?.endUs ?? null,
      frame?.visible ?? false, frame?.opacity ?? 0, frame?.motion ?? null,
      frame?.words?.map((word) => [word.wordIndex, word.active, word.revealed, word.scale]) ?? null, captionTitle,
      overlays, frameEffects, textActors.length ? textActors : null,
    ])
    return { index, sequenceUs, sourceUs, activeCueId: active?.id ?? null, active: found, signature }
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
  }
}

export type LayerPlan = ReturnType<typeof createLayerPlan>
