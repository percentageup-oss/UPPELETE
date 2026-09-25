import type { CaptionProjectV16 } from './model'

/** Schema 16 -> 17 adds `shapes` (docs/EDITING.md "Shapes"). No schema-16 project has any, so the
 * list starts empty and only the version moves. */
export function migrateV16(project: CaptionProjectV16): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 17, shapes: [] } }
}
