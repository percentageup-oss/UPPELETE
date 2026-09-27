/**
 * Resolve's `timelineFrameRate` setting is a decimal string for NTSC rates. The mapping to an exact
 * rational (docs/plans/resolve-textplus/README.md, "Time mapping") avoids the rounding error a plain
 * `Number(...)` would introduce for 23.976/29.97/47.952/59.94/119.88. Shared by 04's proxy render and
 * 05/06's frame mapping, per the plan (brief 03, step 6).
 */
const RATIONAL_FRAME_RATES: Record<string, { num: number; den: number }> = {
  '23.976': { num: 24000, den: 1001 },
  '29.97': { num: 30000, den: 1001 },
  '47.952': { num: 48000, den: 1001 },
  '59.94': { num: 60000, den: 1001 },
  '119.88': { num: 120000, den: 1001 },
}

export function parseResolveFps(raw: string): { num: number; den: number } {
  const exact = RATIONAL_FRAME_RATES[raw]
  if (exact) return exact
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Unrecognized DaVinci Resolve frame rate: ${raw}`)
  return { num: value, den: 1 }
}

export type ResolveFrameLink = { startFrame: number; fps: { num: number; den: number } }

/**
 * Rounds `n / d` (both non-negative) to the nearest integer without going through a float division,
 * so a large `n` (e.g. `us * fps.num` for a multi-hour timeline) never silently loses precision past
 * 2^53. `floor((2n + d) / (2d))` is the standard integer form of `round(n / d) = floor(n/d + 0.5)`,
 * and bigint division already truncates toward zero, i.e. floors for non-negative operands.
 */
function roundRatio(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d)
}

/**
 * Cue source µs on the proxy asset -> absolute Resolve timeline record frame (docs/plans/resolve-textplus/README.md,
 * "Time mapping"). `us` can be up to `Number.MAX_SAFE_INTEGER` per `cueSchema`/`wordSchema`, and `us * fps.num` can
 * exceed 2^53 for a long timeline at a high frame rate, so the multiply-then-divide happens in `bigint`, not
 * `number`, per the brief's "integer-safe math" requirement. Each boundary (a cue's start, its end, the next cue's
 * start) is computed independently — never by adding a frame count to a previous frame — so rounding never
 * accumulates.
 */
export function usToTimelineFrame(us: number, link: ResolveFrameLink): number {
  if (!Number.isSafeInteger(us) || us < 0) throw new Error(`usToTimelineFrame expects a non-negative safe-integer microsecond timestamp, got ${us}.`)
  const frameOffset = roundRatio(BigInt(us) * BigInt(link.fps.num), BigInt(link.fps.den) * 1_000_000n)
  return link.startFrame + Number(frameOffset)
}

/** The inverse of `usToTimelineFrame`, used by `jumpTo` (06) to seek KathaCut's preview to match a Resolve frame. */
export function timelineFrameToUs(frame: number, link: ResolveFrameLink): number {
  if (!Number.isInteger(frame)) throw new Error(`timelineFrameToUs expects an integer frame, got ${frame}.`)
  const offsetFrames = frame - link.startFrame
  const sign = offsetFrames < 0 ? -1 : 1
  const us = roundRatio(BigInt(Math.abs(offsetFrames)) * BigInt(link.fps.den) * 1_000_000n, BigInt(link.fps.num))
  return sign * Number(us)
}

/**
 * Absolute Resolve record frame -> the timecode string `SetCurrentTimecode` takes (06's "Show in Resolve"). Frame 0
 * is 00:00:00:00, so a timeline starting at 01:00:00:00 at 30 fps starts at frame 108000 (ADR 0008, T3). Drop-frame
 * numbering (`;` separator) applies only to the 30000/1001 and 60000/1001 rates.
 */
export function timelineFrameToTimecode(frame: number, fps: { num: number; den: number }, dropFrame: boolean): string {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new Error(`timelineFrameToTimecode expects a non-negative integer frame, got ${frame}.`)
  const nominal = Math.round(fps.num / fps.den)
  const drop = dropFrame && fps.den === 1001 && (nominal === 30 || nominal === 60) ? nominal / 15 : 0
  let label = frame
  if (drop) {
    const perTenMinutes = nominal * 600 - drop * 9
    const perMinute = nominal * 60 - drop
    const tens = Math.floor(frame / perTenMinutes)
    const rest = frame % perTenMinutes
    label += drop * 9 * tens + (rest > drop ? drop * Math.floor((rest - drop) / perMinute) : 0)
  }
  const ff = label % nominal
  const totalSeconds = Math.floor(label / nominal)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}${drop ? ';' : ':'}${pad(ff)}`
}
