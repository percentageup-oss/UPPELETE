type Interval = { id: string; startUs: number; endUs: number }

/** Greedy interval partitioning in stable start/id order; overlapping titles (or shapes) occupy different rows. */
export function packTextOverlays<T extends Interval>(items: readonly T[]): { rows: T[][]; rowById: Map<string, number> } {
  const rows: T[][] = [], ends: number[] = [], rowById = new Map<string, number>()
  for (const item of [...items].sort((a, b) => a.startUs - b.startUs || a.id.localeCompare(b.id))) {
    let row = ends.findIndex((end) => end <= item.startUs)
    if (row < 0) { row = rows.length; rows.push([]); ends.push(0) }
    rows[row].push(item); ends[row] = item.endUs; rowById.set(item.id, row)
  }
  return { rows, rowById }
}
