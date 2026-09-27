import type { CaptionProjectV24 } from './model'

/** Schema 24 -> 25 adds an optional DaVinci Resolve link (`resolveLink`). No prior project ever had
 * one, so this migration only moves the version. */
export function migrateV24(project: CaptionProjectV24): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  return { project: { ...rest, schemaVersion: 25 } }
}
