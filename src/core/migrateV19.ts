import type { CaptionProjectV19 } from './model'

/** Schema 19 -> 20 adds an optional `cornerRadii` on rect shapes (docs/EDITING.md "Shapes").
 * Optional, so only the version moves. */
export function migrateV19(project: CaptionProjectV19): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 20 } }
}
