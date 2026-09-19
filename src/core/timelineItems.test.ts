import { describe, expect, it } from 'vitest'
import { cueItem, isSelected, selectedIdOfKind } from './timelineItems'
import type { Cue } from './model'

const cue: Cue = { id: 'cue-a', startUs: 1_000_000, endUs: 3_000_000, text: 'ഇത് React ആണ്', timingSource: 'imported', needsReview: false, textSource: 'imported', words: [] }

describe('items and selection', () => {
  it('describes a cue as a generic timeline item in source time', () => {
    expect(cueItem(cue)).toEqual({ kind: 'cue', id: 'cue-a', startUs: 1_000_000, endUs: 3_000_000, label: 'ഇത് React ആണ്' })
  })

  it('distinguishes items of different kinds that could otherwise be confused by ID alone', () => {
    expect(isSelected({ kind: 'cue', id: 'x' }, 'cue', 'x')).toBe(true)
    expect(isSelected({ kind: 'clip', id: 'x' }, 'cue', 'x')).toBe(false)
    expect(isSelected(null, 'cue', 'x')).toBe(false)
  })

  it('narrows a selection to one kind for read sites that only handle captions', () => {
    expect(selectedIdOfKind({ kind: 'cue', id: 'cue-a' }, 'cue')).toBe('cue-a')
    expect(selectedIdOfKind({ kind: 'blur', id: 'b1' }, 'cue')).toBeNull()
    expect(selectedIdOfKind(null, 'cue')).toBeNull()
  })
})
