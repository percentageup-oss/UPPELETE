import type { SVGProps } from 'react'
import type { ShapePreset } from './core/shapeCommands'
import type { MaskShape } from './core/edit'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>

/** Wide preview drawn in the Shapes tiles: a picture of what the preset adds, in the tile's text colour. */
function Preview({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return <svg viewBox="0 0 96 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>
}

export const SHAPE_PREVIEWS: Record<ShapePreset, () => React.ReactElement> = {
  box: () => <Preview><rect x="22" y="14" width="52" height="36" rx="3" /></Preview>,
  circle: () => <Preview><circle cx="48" cy="32" r="20" /></Preview>,
  arrow: () => <Preview><path d="M18 32h58" /><path d="M64 20 76 32 64 44" /></Preview>,
  'dotted-arrow': () => <Preview><path d="M18 32h44" strokeDasharray="1 7" /><path d="M64 20 76 32 64 44" /></Preview>,
  underline: () => <Preview><path d="M16 44h64" /><path d="M28 22h8m6 0h8m6 0h8" strokeWidth="6" opacity=".35" /></Preview>,
  highlight: () => <Preview><rect x="14" y="22" width="68" height="20" rx="2" fill="currentColor" fillOpacity=".4" stroke="none" /><path d="M24 32h48" strokeWidth="2" opacity=".6" /></Preview>,
}

/** Compact icons for the mask shape buttons (rectangle / ellipse / pen). */
function Small({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>
}

export const MASK_SHAPE_ICONS: Record<MaskShape['kind'], React.ReactElement> = {
  rect: <Small><rect x="2.5" y="4" width="13" height="10" rx="1.5" /></Small>,
  ellipse: <Small><ellipse cx="9" cy="9" rx="6.5" ry="5" /></Small>,
  path: <Small><path d="M3 14c2-9 4-9 6-4s4 1 6-7" /><circle cx="3" cy="14" r="1" fill="currentColor" /><circle cx="15" cy="3" r="1" fill="currentColor" /></Small>,
}

export const DASH_ICONS = {
  solid: <Small viewBox="0 0 18 18"><path d="M2 9h14" /></Small>,
  dashed: <Small><path d="M2 9h3.5M7.3 9h3.5M12.5 9H16" /></Small>,
  dotted: <Small><path d="M2.5 9h.01M6.5 9h.01M10.5 9h.01M14.5 9h.01" strokeWidth="2.4" /></Small>,
} as const

export const CAP_ICONS = {
  round: <Small><path d="M5 9h8" strokeWidth="5" /></Small>,
  butt: <Small><path d="M5 9h8" strokeWidth="5" strokeLinecap="butt" /></Small>,
} as const
