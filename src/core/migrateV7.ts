import type { CaptionProjectV7 } from './model'

/**
 * Schema 7 → 8 (docs/EDITING.md "Zoom regions" — effect bypass): blur and zoom regions gain an
 * `enabled` flag. `blurRegionSchema`/`zoomRegionSchema` default it to `true`, so every region in
 * `project` already has it by the time this runs — `projectSchemaV7.parse` back-fills it while
 * parsing the schema-7 file, before `migrateV7` ever sees the project. Migration is exactly the
 * version bump — lossless by construction, the same shape as `migrateV6`.
 */
export function migrateV7(project: CaptionProjectV7): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 8 } }
}
