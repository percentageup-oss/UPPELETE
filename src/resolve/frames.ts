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
