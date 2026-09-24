import type { SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>
}

export const MediaBinIcon = (props: IconProps) => <Icon {...props}><rect x="2.5" y="3.5" width="13" height="11" rx="1.5" /><path d="M2.5 7h13M6 3.5v3.5" /></Icon>
export const OverlaysIcon = (props: IconProps) => <Icon {...props}><rect x="2.5" y="2.5" width="10" height="10" rx="1.5" /><rect x="5.5" y="5.5" width="10" height="10" rx="1.5" fill="currentColor" fillOpacity=".15" /></Icon>
export const TitlesIcon = (props: IconProps) => <Icon {...props}><path d="M3.5 4.5h11M9 4.5v9" /></Icon>
export const EffectsIcon = (props: IconProps) => <Icon {...props}><path d="M9 2.5 10.4 7 15 8.5 10.4 10 9 14.5 7.6 10 3 8.5 7.6 7Z" fill="currentColor" stroke="none" /><path d="M14.5 2.5v2M15.5 3.5h-2" /></Icon>
export const LayersIcon = (props: IconProps) => <Icon {...props}><path d="M9 2.8 15.5 6.4 9 10 2.5 6.4Z" /><path d="M2.5 9.2 9 12.8l6.5-3.6M2.5 12 9 15.6l6.5-3.6" /></Icon>
// A half-toned color wheel: three overlapping circles (like a CMY/RGB swatch), reading as "color" at rail size.
export const ColorIcon = (props: IconProps) => <Icon {...props}><circle cx="7" cy="6.5" r="3.4" /><circle cx="11" cy="6.5" r="3.4" /><circle cx="9" cy="10.5" r="3.4" /></Icon>
// Gear outline (Lucide "settings", ISC license) on a 24-unit grid so it reads as a gear at small sizes.
export const SettingsIcon = (props: IconProps) => <Icon viewBox="0 0 24 24" strokeWidth="1.7" {...props}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></Icon>
