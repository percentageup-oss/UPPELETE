import type { CaptionProjectV10 } from './model'

/** Schema 10 → 11 adds the optional pan start rect on zoom regions (`fromRect`). It is optional, so
 * every prior field carries through unchanged and only the version number moves. */
export function migrateV10(project: CaptionProjectV10): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 11 } }
}
