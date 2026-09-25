import type { CaptionProjectV22 } from './model'

/** Schema 22 -> 23 adds the `bubble` shape geometry and `fitTo` / `fitPadding` (docs/EDITING.md "Shapes"). All are
 * additive, so only the version moves. */
export function migrateV22(project: CaptionProjectV22): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 23 } }
}
