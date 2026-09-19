import { describe, expect, it } from 'vitest'
import { frameRequestSchema, parityState } from './frameRequest'
import { parityFixture } from './parityFixture'
import { captionFrame, layoutCaption } from '../captions/renderer'
import { captionStyleInputs } from '../captions/style'

describe('X1 absolute frame contract', () => {
  it('rejects unsafe timestamps, dimensions, extra privileges and invalid durations', () => {
    expect(frameRequestSchema.parse(parityFixture)).toEqual(parityFixture)
    for (const patch of [{ timestampUs: .5 }, { timestampUs: -1 }, { timestampUs: Number.MAX_SAFE_INTEGER + 1 },
      { composition: { width: 0, height: 1920 } }, { path: '/tmp/video' },
      { cue: { ...parityFixture.cue, endUs: parityFixture.cue.startUs } }]) {
      expect(frameRequestSchema.safeParse({ ...parityFixture, ...patch }).success).toBe(false)
    }
  })
  it('keeps visible geometry, timing and text in parity state, excluding only cache epochs', () => {
    const inputs = captionStyleInputs(parityFixture.style, parityFixture.composition)
    inputs.font.readiness = 'ready'
    const layout = layoutCaption(parityFixture.cue.text, inputs, (text, font) => ({ width: text.length * font.size / 2, height: font.size }))
    const state = captionFrame(layout, parityFixture.cue, parityFixture.timestampUs)
    expect(parityState(state)).toEqual(parityState({ ...state, layout: { ...layout, font: { ...layout.font, revision: 'other' } } }))
    expect(parityState(state).layout.lines.map((line) => line.text + line.separator).join('')).toBe(parityFixture.cue.text)
    expect(parityState(captionFrame(layout, parityFixture.cue, parityFixture.cue.endUs)).visible).toBe(false)
  })
})
