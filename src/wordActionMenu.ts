export type FloatingRect = {
  top: number
  right: number
  bottom: number
  left: number
}

export type FloatingSize = { width: number; height: number }

const VIEWPORT_MARGIN = 8
const ANCHOR_GAP = 6

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

/** Keep the transcript word menu in the viewport, preferring below its clicked word. */
export function positionWordActionMenu(anchor: FloatingRect, menu: FloatingSize, viewport: FloatingSize) {
  const left = clamp(anchor.left, VIEWPORT_MARGIN, viewport.width - menu.width - VIEWPORT_MARGIN)
  const below = anchor.bottom + ANCHOR_GAP
  const above = anchor.top - ANCHOR_GAP - menu.height
  const top = below + menu.height <= viewport.height - VIEWPORT_MARGIN
    ? below
    : above >= VIEWPORT_MARGIN
      ? above
      : clamp(below, VIEWPORT_MARGIN, viewport.height - menu.height - VIEWPORT_MARGIN)

  return { left, top }
}
