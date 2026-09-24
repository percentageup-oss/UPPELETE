import type { CaptionProjectV6 } from './model'

/**
 * Schema 6 → 7 (docs/EDITING.md "Zoom regions"): projects gain a zoom lane. Schema 6 had no zoom
 * concept at all, so migration is exactly an empty `zoomRegions` list — lossless by construction,
 * unlike `migrateV4` this produces no `MigrationNote`s (the same shape as `migrateV5`).
 */
export function migrateV6(project: CaptionProjectV6): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 7, zoomRegions: [] } }
}
