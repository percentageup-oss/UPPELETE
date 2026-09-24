import type { ClipSpeed } from './edit'

/**
 * The one source↔sequence time mapping (docs/EDITING.md "Clip speed"). Without a `speed` curve a clip
 * is a pure translation of its source range — the fast path every pre-schema-14 project takes, so
 * nothing changes for them. With a curve, the rate is piecewise-linear in **source** time, and the
 * sequence time to reach source offset `s` is `∫ ds / v(s)`, which has a closed form on each linear
 * piece (a logarithm), so the mapping and its inverse are exact rather than numerically integrated.
 *
 * Everything is integer microseconds at the edges: float math inside, one `Math.round` on the way out.
 */
export type Retime = { timelineStartUs: number; sourceStartUs: number; sourceEndUs: number; speed?: ClipSpeed }

type Piece = {
  /** Source range of this piece. */
  a: number; b: number
  /** Rate at `a` and at `b`. */
  va: number; vb: number
  /** Sequence offset (from the clip start) at `a`, and the piece's own sequence length. */
  t0: number; len: number
}
type Table = { sourceStartUs: number; sourceEndUs: number; pieces: Piece[]; totalUs: number; firstRate: number; lastRate: number }

const cache = new WeakMap<ClipSpeed, Table>()
const NEAR_CONSTANT = 1e-9

/** The curve's rate at source time `sourceUs`: linear between points, held outside them. */
export function speedRateAt(speed: ClipSpeed | undefined, sourceUs: number): number {
  if (!speed) return 1
  const { points } = speed
  if (sourceUs <= points[0].sourceUs) return points[0].rate
  const last = points[points.length - 1]
  if (sourceUs >= last.sourceUs) return last.rate
  for (let index = 1; index < points.length; index++) {
    const next = points[index]
    if (sourceUs > next.sourceUs) continue
    const previous = points[index - 1]
    return previous.rate + (next.rate - previous.rate) * (sourceUs - previous.sourceUs) / (next.sourceUs - previous.sourceUs)
  }
  return last.rate
}

/** Sequence length of a piece with source length `length` whose rate goes linearly `va → vb`. */
function pieceLength(length: number, va: number, vb: number): number {
  if (Math.abs(vb - va) < NEAR_CONSTANT * Math.max(va, vb)) return length / va
  return length / (vb - va) * Math.log(vb / va)
}

function tableOf(clip: Retime & { speed: ClipSpeed }): Table {
  const cached = cache.get(clip.speed)
  if (cached && cached.sourceStartUs === clip.sourceStartUs && cached.sourceEndUs === clip.sourceEndUs) return cached
  const { sourceStartUs, sourceEndUs } = clip
  const cuts = [sourceStartUs, ...clip.speed.points.map((point) => point.sourceUs).filter((us) => us > sourceStartUs && us < sourceEndUs), sourceEndUs]
  const pieces: Piece[] = []
  let t0 = 0
  for (let index = 1; index < cuts.length; index++) {
    const a = cuts[index - 1]
    const b = cuts[index]
    const va = speedRateAt(clip.speed, a)
    const vb = speedRateAt(clip.speed, b)
    const len = pieceLength(b - a, va, vb)
    pieces.push({ a, b, va, vb, t0, len })
    t0 += len
  }
  const table = { sourceStartUs, sourceEndUs, pieces, totalUs: t0, firstRate: pieces[0]?.va ?? 1, lastRate: pieces[pieces.length - 1]?.vb ?? 1 }
  cache.set(clip.speed, table)
  return table
}

/** True when the clip plays at one steady rate (so its audio can be pitch-preserved rather than muted). */
export function isConstantSpeed(clip: { speed?: ClipSpeed }): boolean {
  const points = clip.speed?.points
  return !points || points.every((point) => point.rate === points[0].rate)
}

/** A short badge for the timeline: `2×`, `0.5×` or `Ramp`; null at normal speed. */
export function speedBadge(clip: { speed?: ClipSpeed }): string | null {
  if (!clip.speed) return null
  if (!isConstantSpeed(clip)) return 'Ramp'
  const rate = clip.speed.points[0].rate
  return rate === 1 ? null : `${Number(rate.toFixed(2))}×`
}

/** The steady rate of a constant-speed clip, or 1 with no `speed`. */
export function constantRate(clip: { speed?: ClipSpeed }): number {
  return clip.speed?.points[0].rate ?? 1
}

/** The clip's length on the timeline. */
export function timelineLengthUs(clip: Retime): number {
  if (!clip.speed) return clip.sourceEndUs - clip.sourceStartUs
  return Math.max(1, Math.round(tableOf({ ...clip, speed: clip.speed }).totalUs))
}

/** Sequence offset from the clip's start at which it shows `sourceUs` (extends at the end rates past either edge). */
export function sourceToTimelineOffsetUs(clip: Retime, sourceUs: number): number {
  if (!clip.speed) return Math.round(sourceUs) - clip.sourceStartUs
  const table = tableOf({ ...clip, speed: clip.speed })
  const at = Math.round(sourceUs)
  if (at <= table.sourceStartUs) return Math.round((at - table.sourceStartUs) / table.firstRate)
  if (at >= table.sourceEndUs) return Math.round(table.totalUs + (at - table.sourceEndUs) / table.lastRate)
  const piece = table.pieces.find((candidate) => at <= candidate.b) ?? table.pieces[table.pieces.length - 1]
  const along = at - piece.a
  const length = piece.b - piece.a
  const local = Math.abs(piece.vb - piece.va) < NEAR_CONSTANT * Math.max(piece.va, piece.vb)
    ? along / piece.va
    : length / (piece.vb - piece.va) * Math.log((piece.va + (piece.vb - piece.va) * along / length) / piece.va)
  return Math.round(piece.t0 + local)
}

/** The source time shown `offsetUs` after the clip's start on the timeline (inverse of the above). */
export function timelineToSourceOffsetUs(clip: Retime, offsetUs: number): number {
  if (!clip.speed) return clip.sourceStartUs + Math.round(offsetUs)
  const table = tableOf({ ...clip, speed: clip.speed })
  const t = Math.round(offsetUs)
  if (t <= 0) return Math.round(table.sourceStartUs + t * table.firstRate)
  if (t >= table.totalUs) return Math.round(table.sourceEndUs + (t - table.totalUs) * table.lastRate)
  const piece = table.pieces.find((candidate) => t <= candidate.t0 + candidate.len) ?? table.pieces[table.pieces.length - 1]
  const local = t - piece.t0
  const length = piece.b - piece.a
  const along = Math.abs(piece.vb - piece.va) < NEAR_CONSTANT * Math.max(piece.va, piece.vb)
    ? local * piece.va
    : length * piece.va / (piece.vb - piece.va) * (Math.exp(local * (piece.vb - piece.va) / length) - 1)
  return Math.min(table.sourceEndUs, Math.round(piece.a + along))
}

/** The pieces of a retimed clip as plain numbers, for export graph construction (`setpts` expression). */
export function speedPieces(clip: Retime): { a: number; b: number; va: number; vb: number; t0: number; len: number }[] {
  if (!clip.speed) return [{ a: clip.sourceStartUs, b: clip.sourceEndUs, va: 1, vb: 1, t0: 0, len: clip.sourceEndUs - clip.sourceStartUs }]
  return tableOf({ ...clip, speed: clip.speed }).pieces
}
