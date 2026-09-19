import { describe, expect, it } from 'vitest'
import { keptRangesFromSilences, summarizeSilenceRemoval } from './silenceRemoval'

describe('keptRangesFromSilences', () => {
  it('keeps the whole media when there is no silence', () => {
    expect(keptRangesFromSilences([], 10_000_000, 100_000)).toEqual([{ startUs: 0, endUs: 10_000_000 }])
  })

  it('cuts out a middle silence, shrunk by padding on both sides', () => {
    const kept = keptRangesFromSilences([{ startUs: 3_000_000, endUs: 6_000_000 }], 10_000_000, 500_000)
    expect(kept).toEqual([{ startUs: 0, endUs: 3_500_000 }, { startUs: 5_500_000, endUs: 10_000_000 }])
  })

  it('drops a silence that padding shrinks to nothing', () => {
    const kept = keptRangesFromSilences([{ startUs: 3_000_000, endUs: 3_500_000 }], 10_000_000, 500_000)
    expect(kept).toEqual([{ startUs: 0, endUs: 10_000_000 }])
  })

  it('handles silence touching the start and end of the media, leaving a padded sliver', () => {
    const kept = keptRangesFromSilences(
      [{ startUs: 0, endUs: 2_000_000 }, { startUs: 8_000_000, endUs: 10_000_000 }],
      10_000_000, 200_000,
    )
    expect(kept).toEqual([
      { startUs: 0, endUs: 200_000 },
      { startUs: 1_800_000, endUs: 8_200_000 },
      { startUs: 9_800_000, endUs: 10_000_000 },
    ])
  })

  it('keeps the whole media (never an empty list) when every silence is padded away', () => {
    const kept = keptRangesFromSilences([{ startUs: 0, endUs: 10_000_000 }], 10_000_000, 0)
    expect(kept).toEqual([{ startUs: 0, endUs: 10_000_000 }])
  })

  it('rejects overlapping or out-of-range silences', () => {
    expect(() => keptRangesFromSilences([{ startUs: 5, endUs: 3 }], 10, 0)).toThrow()
    expect(() => keptRangesFromSilences([{ startUs: 0, endUs: 5 }, { startUs: 3, endUs: 8 }], 10, 0)).toThrow()
    expect(() => keptRangesFromSilences([{ startUs: 0, endUs: 20 }], 10, 0)).toThrow()
  })
})

describe('summarizeSilenceRemoval', () => {
  it('reports no-op for the identity range', () => {
    expect(summarizeSilenceRemoval([{ startUs: 0, endUs: 10_000_000 }], 10_000_000))
      .toEqual({ cutCount: 0, removedUs: 0, sequenceDurationUs: 10_000_000, isNoOp: true })
  })

  it('counts a single interior cut', () => {
    const summary = summarizeSilenceRemoval([{ startUs: 0, endUs: 3_000_000 }, { startUs: 5_000_000, endUs: 10_000_000 }], 10_000_000)
    expect(summary).toEqual({ cutCount: 1, removedUs: 2_000_000, sequenceDurationUs: 8_000_000, isNoOp: false })
  })

  it('counts a leading-silence cut with no preceding kept range', () => {
    const summary = summarizeSilenceRemoval([{ startUs: 2_000_000, endUs: 10_000_000 }], 10_000_000)
    expect(summary).toEqual({ cutCount: 1, removedUs: 2_000_000, sequenceDurationUs: 8_000_000, isNoOp: false })
  })

  it('counts a trailing-silence cut with no following kept range', () => {
    const summary = summarizeSilenceRemoval([{ startUs: 0, endUs: 8_000_000 }], 10_000_000)
    expect(summary).toEqual({ cutCount: 1, removedUs: 2_000_000, sequenceDurationUs: 8_000_000, isNoOp: false })
  })
})
