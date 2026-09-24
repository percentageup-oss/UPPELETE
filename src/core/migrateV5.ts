import type { CaptionTrack } from './edit'
import type { CaptionProjectV5 } from './model'

/**
 * Schema 5 → 6 (docs/EDITING.md "Migration 5 → 6"): captions gain tracks. Every schema-5 project had
 * exactly one caption lane in effect — the timeline's single hardcoded captions row — so migration
 * creates one default caption track and assigns every existing cue to it. Lossless by construction:
 * nothing is parked, split or reinterpreted, so unlike `migrateV4` this produces no `MigrationNote`s.
 */
export function migrateV5(project: CaptionProjectV5, newId: () => string): { project: Record<string, unknown> } {
  const { schemaVersion: _version, ...rest } = project
  const captionTrack: CaptionTrack = { id: newId(), name: '', locked: false }
  return {
    project: {
      ...rest,
      schemaVersion: 6,
      captionTracks: [captionTrack],
      cues: rest.cues.map((cue) => ({ ...cue, captionTrackId: captionTrack.id })),
    },
  }
}
