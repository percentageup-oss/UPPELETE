import { captionFrame, type CaptionLayout, type LayoutInputs } from '../captions/renderer'
import { captionStyleInputs, DEFAULT_CAPTION_STYLE, resolveCaptionMotion, type CaptionStyle } from '../captions/style'
import { displayCue, type CaptionDisplay } from '../captions/wordDisplay'
import { compositionFor } from './composition'

import type { Clip, Track } from './edit'
import type { Rational } from './media'
import type { Cue } from './model'
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
    const overlayUs = input.timeline ? sequenceUs : sourceUs
    const overlays = (input.overlays ?? [])
      .filter((overlay) => overlayUs >= overlay.startUs && overlayUs < overlay.endUs)
      .map((overlay) => `${overlay.id}@${overlay.opacity}`)
    // `elapsedUs` is excluded on purpose: it advances every frame but changes nothing visible.
    const signature = JSON.stringify([
      active?.id ?? null, shown?.text ?? null, shown?.startUs ?? null, shown?.endUs ?? null,
      frame?.visible ?? false, frame?.opacity ?? 0, frame?.motion ?? null,
      frame?.words?.map((word) => [word.wordIndex, word.active, word.revealed, word.scale]) ?? null,
      overlays,
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
