import type { CaptionProjectV25 } from './model'
import { editSignature } from '../resolve/editSignature'

/** Schema 25 -> 26: every schema-25 `resolveLink` was made by brief 04 (docs/plans/resolve-textplus/04-project-from-timeline.md),
 * always a rendered proxy, so it gets `origin: 'proxy'` and an `editSignature` computed from the project's video
 * clips at migration time — the proxy clip sits at sequence 0 with source = sequence, so an already-synced
 * project's signature matches and Sync stays enabled (docs/plans/resolve-textplus/10-link-sequence-mapping.md). */
export function migrateV25(project: CaptionProjectV25): { project: Record<string, unknown> } {
  const { schemaVersion: _version, resolveLink, ...rest } = project
  if (!resolveLink) return { project: { ...rest, schemaVersion: 26 } }
  return { project: { ...rest, schemaVersion: 26, resolveLink: { ...resolveLink, origin: 'proxy' as const, editSignature: editSignature(project) } } }
}
