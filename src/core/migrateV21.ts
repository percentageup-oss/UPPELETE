import type { CaptionProjectV21 } from './model'

/** Schema 21 -> 22 adds `groups` (docs/EDITING.md "Groups"). Both `groups` and `groupId` are optional, so only the
 * version moves. */
export function migrateV21(project: CaptionProjectV21): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 22 } }
}
