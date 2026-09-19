import type { SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>
}

export const MediaBinIcon = (props: IconProps) => <Icon {...props}><rect x="2.5" y="3.5" width="13" height="11" rx="1.5" /><path d="M2.5 7h13M6 3.5v3.5" /></Icon>
export const OverlaysIcon = (props: IconProps) => <Icon {...props}><rect x="2.5" y="2.5" width="10" height="10" rx="1.5" /><rect x="5.5" y="5.5" width="10" height="10" rx="1.5" fill="currentColor" fillOpacity=".15" /></Icon>
export const TransitionsIcon = (props: IconProps) => <Icon {...props}><path d="M2.5 9a6.5 6.5 0 0 1 11.5-4.1M15.5 9a6.5 6.5 0 0 1-11.5 4.1" /><path d="M14 2.5v2.5h-2.5M4 15.5V13h2.5" /></Icon>
export const SettingsIcon = (props: IconProps) => <Icon {...props}><circle cx="9" cy="9" r="2.5" /><path d="M9 2.5v2M9 13.5v2M15.5 9h-2M4.5 9h-2M13.4 4.6l-1.4 1.4M6 10.6l-1.4 1.4M13.4 13.4l-1.4-1.4M6 7.4 4.6 6" /></Icon>
