import type { CaptionProjectV13 } from './model'

/** Schema 13 → 14 adds the optional `speed` curve on video and audio clips. It is additive, so every
 * prior field carries through unchanged and only the version moves. */
export function migrateV13(project: CaptionProjectV13): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 14 } }
}
