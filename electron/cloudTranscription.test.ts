import { describe, expect, it } from 'vitest'

describe('uncoveredRanges', () => {
  it('reports leading, middle and trailing stretches of 10 s or more with no words', async () => {
    const { uncoveredRanges } = await import('./cloudTranscription')
    const s = 1_000_000
    expect(uncoveredRanges([{ startUs: 12 * s, endUs: 14 * s }, { startUs: 15 * s, endUs: 16 * s }, { startUs: 30 * s, endUs: 31 * s }], 60 * s))
      .toEqual([{ startUs: 0, endUs: 12 * s }, { startUs: 16 * s, endUs: 30 * s }, { startUs: 31 * s, endUs: 60 * s }])
    expect(uncoveredRanges([{ startUs: 2 * s, endUs: 58 * s }], 60 * s)).toEqual([])
  })
})
