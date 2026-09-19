import type { SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>
}

export const PlusIcon = (props: IconProps) => <Icon {...props}><path d="M8 3v10M3 8h10" /></Icon>
export const MergeIcon = (props: IconProps) => <Icon {...props}><rect x="2" y="3" width="12" height="4" rx="1" /><rect x="2" y="9" width="12" height="4" rx="1" /><path d="M6 8h4" /></Icon>
export const PrevIcon = (props: IconProps) => <Icon {...props}><path d="M10 3 5 8l5 5M3 3v10" /></Icon>
export const NextIcon = (props: IconProps) => <Icon {...props}><path d="m6 3 5 5-5 5M13 3v10" /></Icon>
export const PlayheadIcon = (props: IconProps) => <Icon {...props}><path d="M8 2v12M3 5h10M5 8h6" /></Icon>
export const TrashIcon = (props: IconProps) => <Icon {...props}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5M6.8 7v4M9.2 7v4" /></Icon>
export const ScissorsIcon = (props: IconProps) => <Icon {...props}><circle cx="4.5" cy="4" r="2" /><circle cx="4.5" cy="12" r="2" /><path d="m6.2 5.2 7.3 5.3M6.2 10.8l7.3-5.3" /></Icon>
export const TrimIcon = (props: IconProps) => <Icon {...props}><path d="M5 3H3v10h2M11 3h2v10h-2M8 2v12" /></Icon>
export const MagnetIcon = (props: IconProps) => <Icon {...props}><path d="M4 2v6a4 4 0 0 0 8 0V2M4 2h3v6a1 1 0 0 0 2 0V2h3" /><path d="M4 5h3M9 5h3" /></Icon>
export const ZoomOutIcon = (props: IconProps) => <Icon {...props}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3M5 7h4" /></Icon>
export const ZoomInIcon = (props: IconProps) => <Icon {...props}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3M5 7h4M7 5v4" /></Icon>
export const ExpandIcon = (props: IconProps) => <Icon {...props}><path d="M9 3h4v4M13 3 9 7M7 13H3V9M3 13l4-4" /></Icon>
export const CollapseIcon = (props: IconProps) => <Icon {...props}><path d="M13 7H9V3M9 7l4-4M3 9h4v4M7 9l-4 4" /></Icon>
export const CaptionsIcon = (props: IconProps) => <Icon {...props}><path d="M6 3h6M9 3l-2 10M4 13h6" /></Icon>
export const VideoIcon = (props: IconProps) => <Icon {...props}><rect x="2" y="4" width="8" height="8" rx="1.5" /><path d="m10 7 4-2v6l-4-2" /></Icon>
export const AudioIcon = (props: IconProps) => <Icon {...props}><path d="M2 8h1.5M5 5v6M8 3v10M11 5v6M13.5 8H15" /></Icon>
export const GripIcon = (props: IconProps) => <Icon {...props}><path d="M5 6h.01M8 6h.01M11 6h.01M5 10h.01M8 10h.01M11 10h.01" strokeWidth="2" /></Icon>
