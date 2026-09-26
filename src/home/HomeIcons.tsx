import type { SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>
}

export const HomeIcon = (props: IconProps) => <Icon {...props}><path d="M2.5 8.2 9 2.8l6.5 5.4" /><path d="M4 7.5v7h3.5v-4h3v4H14v-7" /></Icon>
export const TemplatesIcon = (props: IconProps) => <Icon {...props}><rect x="2.5" y="2.5" width="5.5" height="7" rx="1.2" /><rect x="10" y="2.5" width="5.5" height="4" rx="1.2" /><rect x="10" y="8.5" width="5.5" height="7" rx="1.2" /><rect x="2.5" y="11.5" width="5.5" height="4" rx="1.2" /></Icon>
export const PlusIcon = (props: IconProps) => <Icon strokeWidth="2" {...props}><path d="M9 3.5v11M3.5 9h11" /></Icon>
export const FolderOpenIcon = (props: IconProps) => <Icon {...props}><path d="M2.5 5.5v8.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H9L7.5 4.2H3.5a1 1 0 0 0-1 1.3Z" /></Icon>
export const SearchIcon = (props: IconProps) => <Icon {...props}><circle cx="8" cy="8" r="4.5" /><path d="m11.5 11.5 3.5 3.5" /></Icon>
export const MoreIcon = (props: IconProps) => <Icon {...props}><circle cx="4" cy="9" r="1" fill="currentColor" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="14" cy="9" r="1" fill="currentColor" /></Icon>
export const FilmIcon = (props: IconProps) => <Icon {...props}><rect x="2.5" y="3.5" width="13" height="11" rx="1.5" /><path d="M6 3.5v11M12 3.5v11M2.5 7h3.5M12 7h3.5M2.5 11h3.5M12 11h3.5" /></Icon>
