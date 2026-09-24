import type { CaptionProjectV12 } from './model'

/** Schema 12 → 13 adds the generated `color` clip kind (solid/gradient backgrounds). It is additive,
 * so every prior field carries through unchanged and only the version moves. */
export function migrateV12(project: CaptionProjectV12): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 13 } }
}
