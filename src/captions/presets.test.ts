import { describe, expect, it } from 'vitest'
import { createProject } from '../core/model'
import { applyCaptionPreset, deleteCaptionPreset, saveCaptionPreset, setCaptionStyle } from './presets'
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from './style'

const alt: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, motion: 'word-pop',
  appearance: { ...DEFAULT_CAPTION_STYLE.appearance, primaryColor: '#ff00ff', maxLines: 2 } }

describe('caption preset commands', () => {
  it('saves a named preset without disturbing cues or existing style', () => {
    const project = { ...createProject(), cues: [{ id: 'c1', startUs: 0, endUs: 1000, text: 'hi', timingSource: 'imported' as const, needsReview: false, textSource: 'imported' as const, words: [] }] }
    const saved = saveCaptionPreset(project, ' My preset ', alt, () => 'p1')
    expect(saved.savedCaptionPresets).toEqual([{ id: 'p1', name: 'My preset', style: alt }])
    expect(saved.cues).toBe(project.cues)
    expect(saved.captionStyle).toBeUndefined()
  })

  it('rejects an empty/whitespace-only preset name', () => {
    expect(() => saveCaptionPreset(createProject(), '   ', alt, () => 'p1')).toThrow()
  })

  it('applying a preset restores both motion and appearance', () => {
    let project = createProject()
    project = setCaptionStyle(project, DEFAULT_CAPTION_STYLE)
    project = saveCaptionPreset(project, 'Alt', alt, () => 'p1')
    project = setCaptionStyle(project, { ...alt, motion: 'phrase-fade' })
    const applied = applyCaptionPreset(project, 'p1')
    expect(applied.captionStyle).toEqual(alt)
  })

  it('applying an unknown preset throws rather than silently no-op', () => {
    expect(() => applyCaptionPreset(createProject(), 'missing')).toThrow()
  })

  it('deletes only the selected preset and leaves others intact', () => {
    let project = createProject()
    project = saveCaptionPreset(project, 'One', DEFAULT_CAPTION_STYLE, () => 'p1')
    project = saveCaptionPreset(project, 'Two', alt, () => 'p2')
    const after = deleteCaptionPreset(project, 'p1')
    expect(after.savedCaptionPresets).toEqual([{ id: 'p2', name: 'Two', style: alt }])
  })

  it('deleting an unknown preset throws', () => {
    expect(() => deleteCaptionPreset(createProject(), 'missing')).toThrow()
  })
})
