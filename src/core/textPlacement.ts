export type StageBounds = { left: number; top: number; width: number; height: number }
export type TextAnchor = { horizontal: number; vertical: number }

/** Converts a preview pointer location to the text style's normalized composition placement. */
export function textAnchorAt(clientX: number, clientY: number, bounds: StageBounds): TextAnchor | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null
  return {
    horizontal: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
    vertical: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)),
  }
}
