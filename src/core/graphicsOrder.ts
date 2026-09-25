/**
 * Authored text and shapes share one `layerOrder` space: negative paints below the captions,
 * zero and above paint over them. Preview and the export host both sort with this one comparator,
 * so two graphics never swap places between the two.
 */
export type Layered = { layerOrder: number; startUs: number; id: string }

export function compareLayered(a: Layered, b: Layered): number {
  return a.layerOrder - b.layerOrder || a.startUs - b.startUs || a.id.localeCompare(b.id)
}

/** The item's place relative to the caption plane. */
export const belowCaptions = (item: Pick<Layered, 'layerOrder'>): boolean => item.layerOrder < 0
