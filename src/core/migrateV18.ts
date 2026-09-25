import type { CaptionProjectV18 } from './model'

/** Schema 18 -> 19 adds an optional `blendMode` on shapes (docs/EDITING.md "Layer opacity and blend").
 * Optional, so only the version moves. */
export function migrateV18(project: CaptionProjectV18): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 19 } }
}
