import type { CaptionProjectV17 } from './model'

/** Schema 17 -> 18 adds `blendMode` on picture clips and `opacity` on text overlays and caption tracks
 * (docs/EDITING.md "Layer opacity and blend"). All optional, so only the version moves. */
export function migrateV17(project: CaptionProjectV17): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 18 } }
}
