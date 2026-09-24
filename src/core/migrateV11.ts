import type { CaptionProjectV11 } from './model'

/** Schema 11 → 12 adds the optional layer `mask` (clips, text, caption tracks, blur, frame-paint
 * effects). It is optional, so every prior field carries through unchanged and only the version moves. */
export function migrateV11(project: CaptionProjectV11): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 12 } }
}
