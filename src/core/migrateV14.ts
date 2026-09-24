import type { CaptionProjectV14 } from './model'

/** Schema 14 → 15 adds linked audio (`linkId`, `detachedAudio`, `enabled`, track `solo`/`volume`). Every
 * new field is optional and absent means the old behaviour, so only the version moves — an existing
 * video keeps its embedded sound rather than being split into a separate audio clip. */
export function migrateV14(project: CaptionProjectV14): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 15 } }
}
