import { graphemes } from '../core/captionText'
import { wordMotionAvailability, type MotionCue, type MotionCueWord } from '../captions/renderer'
import type { CaptionMotion, TextTransform } from '../captions/style'
import { usToTimelineFrame, type ResolveFrameLink } from './frames'
import { wordRanges } from './charUnits'
import { TEXT_PLUS_INPUTS, applyTextTransform } from './textPlusInputs'

export type Keyframe = { input: string; points: [frame: number, value: number][] }
export type SupportLevel = 'sent' | 'approximated' | 'not-sent'

export type MotionResult = {
  /** Plain Text+ input overrides on top of the clip's base styling (e.g. the secondary color for a highlighted
   * active word); never touches an input outside `LUA_INPUT_WHITELIST`. */
  inputOverrides: Record<string, number>
  keyframes: Keyframe[]
  /** `null` for `static-clean`, which needs no support-report entry of its own. */
  outcome: { level: SupportLevel; reason: string; estimated?: boolean } | null
}

const RAMP_US = 200_000

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Sorts/merges same-frame points, keeping the last value written for a repeated frame. */
function dedupe(points: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const point of points) {
    const prev = out[out.length - 1]
    if (prev && prev[0] === point[0]) { out[out.length - 1] = point; continue }
    out.push(point)
  }
  return out
}

/** A source-µs duration expressed as a frame count at `fps` (no timeline start offset). */
function durationFrames(us: number, fps: ResolveFrameLink['fps']): number {
  return usToTimelineFrame(Math.max(0, Math.round(us)), { startFrame: 0, fps })
}

/** Absolute source µs -> clip-relative comp frame, clamped inside the clip's own frame range (comp-local frame 0
 * is the clip's first frame, ADR 0008 T8 — `clipStartFrame` is that clip's absolute Resolve record frame). */
function usToClipFrame(us: number, link: ResolveFrameLink, clipStartFrame: number, clipDurationFrames: number): number {
  return clamp(usToTimelineFrame(us, link) - clipStartFrame, 0, Math.max(0, clipDurationFrames - 1))
}

/**
 * `phrase-fade`'s opacity ramp, via the confirmed `Alpha1` fill-alpha input (ADR 0008 confirmed
 * `Red1/Green1/Blue1/Alpha1` set-and-read-back). Ramp length mirrors `captionFrame` in `src/captions/renderer.ts`
 * exactly: `min(200ms / motionSpeed, half the cue's duration)`. The keyframe *mechanism* itself
 * (`tool.Input = comp:BezierSpline()`, then index assignment inside `Lock`/`Unlock`) is only confirmed on the
 * `End` input (ADR 0009, E9) — applying it to `Alpha1` is an extrapolation, not a repeated spike result.
 */
function phraseFadeKeyframes(startUs: number, endUs: number, motionSpeed: number, link: ResolveFrameLink, clipDurationFrames: number, baseAlpha: number): Keyframe {
  const rampUs = Math.min(RAMP_US / motionSpeed, (endUs - startUs) / 2)
  const last = Math.max(0, clipDurationFrames - 1)
  const rampFrames = Math.min(durationFrames(rampUs, link.fps), Math.floor(last / 2))
  const points: [number, number][] = rampFrames <= 0
    ? [[0, baseAlpha], [last, baseAlpha]]
    : [[0, 0], [rampFrames, baseAlpha], [Math.max(rampFrames, last - rampFrames), baseAlpha], [last, 0]]
  return { input: TEXT_PLUS_INPUTS.fillAlpha, points: dedupe(points) }
}

/**
 * `progressive-word-reveal`'s write-on steps: `End` becomes the cumulative fraction of `specText` revealed
 * through each word, right at that word's start frame — held at the previous value up to one frame earlier so the
 * step reads as a snap rather than a 1-frame-plus ramp. `End` keyframing is confirmed (ADR 0009, E9); the
 * *fraction unit* Text+'s own Write On slider counts by is **not** confirmed by the spike. Grapheme count is used
 * here because it can never land inside a Malayalam conjunct or vowel-sign cluster — the one hard constraint
 * (AGENTS.md) — not because it's known to match Text+'s internal accounting.
 */
function progressiveRevealKeyframes(
  words: readonly MotionCueWord[], specText: string, transform: TextTransform,
  link: ResolveFrameLink, clipStartFrame: number, clipDurationFrames: number,
): { keyframe: Keyframe | null; droppedCount: number } {
  const { ranges, dropped } = wordRanges(words, specText, (word) => applyTextTransform(word, transform))
  const totalGraphemes = graphemes(specText).length
  const last = Math.max(0, clipDurationFrames - 1)
  if (!ranges.length || totalGraphemes === 0) return { keyframe: null, droppedCount: dropped.length }
  const fractionThrough = (utf16End: number) => Math.min(1, graphemes(specText.slice(0, utf16End)).length / totalGraphemes)

  const points: [number, number][] = [[0, 0]]
  let previous = 0
  for (const range of ranges) {
    const word = words[range.wordIndex]
    const frame = usToClipFrame(word.startUs, link, clipStartFrame, clipDurationFrames)
    const value = fractionThrough(range.end)
    const lastFrame = points[points.length - 1][0]
    if (frame - 1 > lastFrame) points.push([frame - 1, previous])
    if (frame > points[points.length - 1][0]) points.push([frame, value])
    else points[points.length - 1] = [points[points.length - 1][0], value]
    previous = value
  }
  if (points[points.length - 1][0] < last) points.push([last, 1])
  else points[points.length - 1] = [last, 1]
  return { keyframe: { input: TEXT_PLUS_INPUTS.writeOnEnd, points }, droppedCount: dropped.length }
}

export type MotionParams = {
  motion: CaptionMotion
  motionSpeed: number
  cue: MotionCue // sequence-time (`cuesInSequence`'s remapped words/timing), as sent to the planner
  /** True only for a genuine word-at-a-time draft (project display is 'word' and this cue's word timing drove
   * the split, per `draftsForCue`) — the whole clip already *is* the single active word. */
  isWordDraft: boolean
  text: string // final spec text: post text-transform, post line-wrap ('\n' inserted)
  transform: TextTransform
  startFrame: number
  endFrame: number
  link: ResolveFrameLink
  fillAlpha: number
  secondaryFill: { r: number; g: number; b: number }
  emphasisScale: number
  baseSize: number
}

/** Maps one draft's requested caption motion onto Text+ input overrides / keyframes, with an honest per-motion
 * support outcome. Pure: no IPC, no Lua, no Resolve calls (`planTextPlus`'s own contract). */
export function computeMotion(p: MotionParams): MotionResult {
  if (p.motion === 'static-clean') return { inputOverrides: {}, keyframes: [], outcome: null }

  const clipDurationFrames = p.endFrame - p.startFrame

  if (p.motion === 'phrase-fade') {
    const keyframe = phraseFadeKeyframes(p.cue.startUs, p.cue.endUs, p.motionSpeed, p.link, clipDurationFrames, p.fillAlpha)
    return {
      inputOverrides: {}, keyframes: [keyframe],
      outcome: { level: 'approximated', reason: 'Ramped via the Alpha1 fill-alpha input, using the keyframe mechanism ADR 0009 (E9) confirmed on a different input (End); the ramp itself was not exercised by the spike.' },
    }
  }

  // The remaining motions are all word-gated (`MOTIONS` in style.ts: active-word-highlight, word-pop,
  // progressive-word-reveal all have `words: true`) — no invented timings (AGENTS.md).
  const availability = wordMotionAvailability(p.cue)
  if (!availability.enabled) {
    return { inputOverrides: {}, keyframes: [], outcome: { level: 'not-sent', reason: 'word timings missing' } }
  }

  if (p.motion === 'progressive-word-reveal') {
    if (p.isWordDraft) {
      return {
        inputOverrides: {}, keyframes: [],
        outcome: { level: 'sent', reason: 'Word-at-a-time display already places one word per clip; no write-on animation is needed.', estimated: availability.estimated },
      }
    }
    const { keyframe, droppedCount } = progressiveRevealKeyframes(p.cue.words!, p.text, p.transform, p.link, p.startFrame, clipDurationFrames)
    if (!keyframe) {
      return { inputOverrides: {}, keyframes: [], outcome: { level: 'not-sent', reason: 'No word could be located in the final Text+ string (line-wrap/text-transform changed it beyond recognition).' } }
    }
    return {
      inputOverrides: {}, keyframes: [keyframe],
      outcome: {
        level: 'approximated',
        reason: `Write-on End keyframes step at each word's start (End keyframing confirmed, ADR 0009 E9); the reveal fraction is each word's cumulative grapheme count over the final text — Text+'s own Write On counting unit is unconfirmed by the spike.${droppedCount ? ' Some words could not be located in the wrapped text and were skipped.' : ''}`,
        estimated: availability.estimated,
      },
    }
  }

  // active-word-highlight, word-pop: colour just the active word. Word-at-a-time display already makes the
  // whole clip the active word (plain input overrides below, no CLS needed). Otherwise (line mode),
  // `draftsForCue` (textPlusPlan.ts) has already split this cue into one clip per word step and added the
  // active word's Character Level Styling range (ADR 0011) to the spec's `styleRanges` — this branch only
  // reports that (keyframing a single clip is still "no data", ADR 0011 "Keyframing").
  if (!p.isWordDraft) {
    return {
      inputOverrides: {}, keyframes: [],
      outcome: {
        level: p.motion === 'word-pop' ? 'approximated' : 'sent',
        reason: p.motion === 'word-pop'
          ? 'Split into one clip per word step, each keeping the full line text so the layout never shifts (ADR 0011 "Keyframing": a single keyframed clip is no data); Character Level Styling colours and statically scales the active word on each step, without the sine pop animation.'
          : 'Split into one clip per word step, each keeping the full line text so the layout never shifts (ADR 0011 "Keyframing": a single keyframed clip is no data); Character Level Styling colours the active word on each step.',
        estimated: availability.estimated,
      },
    }
  }
  const overrides: Record<string, number> = {
    [TEXT_PLUS_INPUTS.fillRed]: p.secondaryFill.r, [TEXT_PLUS_INPUTS.fillGreen]: p.secondaryFill.g, [TEXT_PLUS_INPUTS.fillBlue]: p.secondaryFill.b,
  }
  if (p.motion === 'word-pop') {
    overrides[TEXT_PLUS_INPUTS.size] = p.baseSize * p.emphasisScale
    return {
      inputOverrides: overrides, keyframes: [],
      outcome: {
        level: 'approximated',
        reason: 'Word-at-a-time display makes the whole clip the active word, so it\'s coloured and statically scaled by the emphasis size — without the sine pop animation, and without Character Level Styling (unconfirmed by the spike).',
        estimated: availability.estimated,
      },
    }
  }
  return {
    inputOverrides: overrides, keyframes: [],
    outcome: { level: 'sent', reason: 'Word-at-a-time display makes the whole clip the active word, so the whole clip is coloured in the secondary color — no Character Level Styling needed.', estimated: availability.estimated },
  }
}
