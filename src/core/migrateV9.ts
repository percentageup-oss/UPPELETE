import type { CaptionProjectV9 } from './model'

/** Schema 9 → 10 adds authored sequence-timed text. No older project had authored text, so the
 * migration carries every prior field through unchanged and supplies an empty list. */
export function migrateV9(project: CaptionProjectV9): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 10, textOverlays: [] } }
}
