import { TemplatesPanel } from './TemplatesPanel'

/** The left-rail Titles tab: today's caption-motion template picker, moved out of the
 * inspector's Templates tab (InspectorTabs is now Edit/Style only). Same component, new home. */
export function TitlesPanel(props: Parameters<typeof TemplatesPanel>[0]) {
  return <TemplatesPanel {...props} />
}
