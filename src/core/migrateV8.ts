import type { CaptionProjectV8 } from './model'

/**
 * Schema 8 → 9 (docs/EDITING.md "Frame-paint effects"): adds `project.effects` (vignette, letterbox
 * and fade regions). `effects` defaults to `[]` on the schema-9 object, so parsing a schema-8 file
 * through it already back-fills an empty list — migration is exactly the version bump, the same
 * lossless shape as `migrateV7`.
 */
export function migrateV8(project: CaptionProjectV8): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 9 } }
}
