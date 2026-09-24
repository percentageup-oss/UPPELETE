import type { CaptionProjectV15 } from './model'

/** Schema 15 → 16 adds the `adjustment` clip kind and the `lut` asset kind (docs/EDITING.md "Color:
 * adjustment layers"). Both are additive and no schema-15 project ever contains either, so only the
 * version moves. */
export function migrateV15(project: CaptionProjectV15): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 16 } }
}
