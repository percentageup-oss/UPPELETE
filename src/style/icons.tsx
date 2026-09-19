import type { SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>
}

export const ChevronRightIcon = (props: IconProps) => <Icon {...props}><path d="m6 3 5 5-5 5" /></Icon>
export const ChevronUpIcon = (props: IconProps) => <Icon {...props}><path d="m4 10 4-4 4 4" /></Icon>
export const ChevronDownIcon = (props: IconProps) => <Icon {...props}><path d="m4 6 4 4 4-4" /></Icon>
export const ResetIcon = (props: IconProps) => <Icon {...props}><path d="M3 8a5 5 0 1 1 1.6 3.67" /><path d="M3 4.5V8h3.5" /></Icon>
export const AlignLeftIcon = (props: IconProps) => <Icon {...props}><path d="M3 4h10M3 7.5h6M3 11h10" /></Icon>
export const AlignCenterIcon = (props: IconProps) => <Icon {...props}><path d="M3 4h10M5 7.5h6M3 11h10" /></Icon>
export const AlignRightIcon = (props: IconProps) => <Icon {...props}><path d="M3 4h10M7 7.5h6M3 11h10" /></Icon>
/** Solid fill swatch (Color → Fill: Solid). */
export const DropIcon = (props: IconProps) => <Icon {...props}><path d="M8 2.5c2.2 2.6 3.5 4.6 3.5 6.3a3.5 3.5 0 1 1-7 0c0-1.7 1.3-3.7 3.5-6.3Z" /></Icon>
/** Gradient fill (Color → Fill: Gradient). */
export const PaletteIcon = (props: IconProps) => <Icon {...props}><path d="M8 2.5a5.5 5.5 0 1 0 0 11c.9 0 1.5-.6 1.5-1.4 0-.4-.2-.7-.4-1-.2-.2-.4-.5-.4-.9 0-.7.6-1.2 1.3-1.2H11a3 3 0 0 0 3-3c0-2.2-2.7-3.5-6-3.5Z" /><circle cx="5.6" cy="7" r=".7" fill="currentColor" stroke="none" /><circle cx="8.3" cy="5.3" r=".7" fill="currentColor" stroke="none" /><circle cx="10.8" cy="7" r=".7" fill="currentColor" stroke="none" /></Icon>
export const UnderlineIcon = (props: IconProps) => <Icon {...props}><path d="M4.5 3v4.5a3.5 3.5 0 0 0 7 0V3M3.5 13h9" /></Icon>
