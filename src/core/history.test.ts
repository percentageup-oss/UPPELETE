import { describe, expect, it } from 'vitest'
import { applyCaptionCommand } from './captionCommands'
import { commitHistory, createHistory, redoHistory, undoHistory } from './history'
import type { CaptionProject } from './model'

const original: CaptionProject = {
  schemaVersion: 10,
  tracks: [],
  clips: [],
  assets: [],
  captionTracks: [], blurRegions: [], zoomRegions: [], effects: [], textOverlays: [], markers: [],
  id: 'project',
  title: 'Test',
  cues: [{ id: 'a', startUs: 0, endUs: 1_000_000, text: 'before', timingSource: 'imported', needsReview: false, textSource: 'imported', words: [] }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('editing history', () => {
  it('makes one caption command one undo/redo step', () => {
    const result = applyCaptionCommand(original, { type: 'update-text', cueId: 'a', text: 'after' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const committed = commitHistory(createHistory(original), result.project)
    expect(committed.past).toHaveLength(1)
    const undone = undoHistory(committed)
    expect(undone.present.cues[0].text).toBe('before')
    expect(undone.future).toHaveLength(1)
    const redone = redoHistory(undone)
    expect(redone.present.cues[0]).toMatchObject({ text: 'after', textSource: 'user', needsReview: true })
    expect(redone.past).toHaveLength(1)
  })
})
