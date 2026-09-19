import { describe, expect, it } from 'vitest'
import { createLayerPlan, sequenceFrameUs } from './layerPlan'
import { frameSourceUs } from '../export/plan'
import { DEFAULT_CAPTION_STYLE } from '../captions/style'
import type { Segment } from './edit'
import type { Cue } from './model'

const NTSC = { numerator: 30000, denominator: 1001 }
const output = { width: 1080, height: 1920 }

const cue = (extra: Partial<Cue> & Pick<Cue, 'id' | 'startUs' | 'endUs'>): Cue => ({
  text: 'one two', timingSource: 'imported', needsReview: false, textSource: 'imported', words: [], ...extra,
})
const timed = cue({
  id: 'c1', startUs: 1_000_000, endUs: 3_000_000, text: 'one two',
  words: [
    { id: 'w1', startUs: 1_000_000, endUs: 2_000_000, text: 'one', timingSource: 'aligned', needsReview: false },
    { id: 'w2', startUs: 2_000_000, endUs: 3_000_000, text: 'two', timingSource: 'aligned', needsReview: false },
  ],
})

describe('sequence frame timestamps', () => {
  it('matches the exact BigInt formula at 30000/1001 for indices 0, 1 and 10000', () => {
    expect(sequenceFrameUs(0, NTSC)).toBe(0)
    expect(sequenceFrameUs(1, NTSC)).toBe(33_366)
    expect(sequenceFrameUs(10000, NTSC)).toBe(333_666_666)
  })

  it('agrees with plan.ts frameSourceUs, so identity export frame times are unchanged', () => {
    const plan = createLayerPlan({ cues: [], frameRate: NTSC, output })
    for (const index of [0, 1, 10000]) {
      expect(plan.frameAt(index).sourceUs).toBe(frameSourceUs(index, 0, NTSC))
    }
  })

  it('offsets by the plan range start for an identity export that does not begin at zero', () => {
    const plan = createLayerPlan({ cues: [], frameRate: NTSC, rangeStartUs: 500_000, output })
    expect(plan.frameAt(0).sourceUs).toBe(500_000)
    expect(plan.frameAt(1).sourceUs).toBe(frameSourceUs(1, 500_000, NTSC))
  })

  it('rejects a fractional or negative frame index', () => {
    expect(() => sequenceFrameUs(-1, NTSC)).toThrow()
    expect(() => sequenceFrameUs(1.5, NTSC)).toThrow()
  })
})

describe('cuts map sequence frames onto kept source time', () => {
  const segments: Segment[] = [
    { id: 's1', startUs: 0, endUs: 1_000_000 },
    { id: 's2', startUs: 3_000_000, endUs: 5_000_000 },
  ]

  it('jumps the removed range at the cut instant', () => {
    const plan = createLayerPlan({ cues: [], frameRate: { numerator: 10, denominator: 1 }, segments, mediaDurationUs: 5_000_000, output })
    expect(plan.frameAt(0).sourceUs).toBe(0)
    expect(plan.frameAt(9).sourceUs).toBe(900_000)
    // Sequence 1.0s is the cut instant, which maps to the start of the following segment.
    expect(plan.frameAt(10).sourceUs).toBe(3_000_000)
    expect(plan.frameAt(11).sourceUs).toBe(3_100_000)
  })
})

describe('frame signatures', () => {
  it('a static cue yields three spans: gap, cue, gap', () => {
    const plan = createLayerPlan({ cues: [timed], style: DEFAULT_CAPTION_STYLE, frameRate: { numerator: 10, denominator: 1 }, output })
    const spans = plan.spans(40)
    expect(spans).toHaveLength(3)
    expect(spans.map((span) => span.startIndex)).toEqual([0, 10, 30])
    expect(spans[0].frame.activeCueId).toBeNull()
    expect(spans[1].frame.activeCueId).toBe('c1')
    expect(spans[2].frame.activeCueId).toBeNull()
    // Both gaps are identical, so the export host paints one transparent frame for all of them.
    expect(spans[0].signature).toBe(spans[2].signature)
  })

  it('word-pop changes the signature only inside its ramps', () => {
    const style = { ...DEFAULT_CAPTION_STYLE, motion: 'word-pop' as const, motionSpeed: 1 }
    // 200ms ramp at 100fps = 20 changing frames per word; the rest of each word holds one signature.
    const plan = createLayerPlan({ cues: [timed], style, frameRate: { numerator: 100, denominator: 1 }, output })
    const signatureAt = (us: number) => plan.frameAt(Math.round(us / 10_000)).signature
    // Inside the first word's 1.000-1.200s ramp every 10ms frame differs.
    expect(signatureAt(1_010_000)).not.toBe(signatureAt(1_020_000))
    expect(signatureAt(1_100_000)).not.toBe(signatureAt(1_110_000))
    // After the ramp, and before the second word begins, the frame is visually static.
    expect(signatureAt(1_300_000)).toBe(signatureAt(1_400_000))
    expect(signatureAt(1_400_000)).toBe(signatureAt(1_900_000))
    // The second word's own ramp starts changing again.
    expect(signatureAt(2_010_000)).not.toBe(signatureAt(2_020_000))
    expect(signatureAt(2_300_000)).toBe(signatureAt(2_900_000))
  })

  it('a static-clean cue holds exactly one signature for its whole duration', () => {
    const plan = createLayerPlan({ cues: [timed], style: DEFAULT_CAPTION_STYLE, frameRate: { numerator: 100, denominator: 1 }, output })
    expect(plan.frameAt(110).signature).toBe(plan.frameAt(290).signature)
  })

  it('starts a new span at an overlay boundary', () => {
    const overlays = [{ id: 'ov-1', startUs: 1_500_000, endUs: 2_500_000, opacity: 1 }]
    const plan = createLayerPlan({ cues: [timed], frameRate: { numerator: 10, denominator: 1 }, overlays, output })
    expect(plan.frameAt(14).signature).not.toBe(plan.frameAt(15).signature)
    expect(plan.frameAt(24).signature).not.toBe(plan.frameAt(25).signature)
  })

  it('changes signature when the WORD display swaps the shown word', () => {
    const plan = createLayerPlan({ cues: [timed], display: 'word', frameRate: { numerator: 10, denominator: 1 }, output })
    expect(plan.frameAt(15).signature).not.toBe(plan.frameAt(25).signature)
    expect(plan.frameAt(15).signature).toBe(plan.frameAt(19).signature)
  })
})
