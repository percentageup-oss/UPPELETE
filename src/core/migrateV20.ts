import type { CaptionProjectV20 } from './model'

/** Schema 20 -> 21 adds an optional `glass` look on shapes (docs/EDITING.md "Shapes"). Optional, so only the
 * version moves. */
export function migrateV20(project: CaptionProjectV20): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 21 } }
}
