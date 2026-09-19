import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { graphemeBoundaries } from '../core/captionText'
import type { CaptionWord } from '../core/model'
import { CaptionView } from './CaptionPreview'
import {
  captionFrame, defaultCaptionInputs, layoutCaption, layoutCaptionWords, wordMotionAvailability,
  summarizeWordMotion, SPOTLIGHT_DIM, type CaptionFont, type LayoutInputs, type MeasureRange, type MeasureText, type MotionCue,
} from './renderer'
import { wordDisplayCue } from './wordDisplay'

// Synthetic metrics only; real DOM shaping is covered by smoke:captions.
const graphemesOf = (text: string) => Array.from(new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text), (p) => p.segment)
const measure: MeasureText = (text, font) => ({ width: graphemesOf(text).length * font.size * .5, height: font.size * font.lineHeight })
const measureRange: MeasureRange = (text, start, end, font) => {
  const before = measure(text.slice(0, start), font).width
  const after = measure(text.slice(0, end), font).width
  return [{ x: before, y: 0, width: after - before, height: font.size * font.lineHeight }]
}
const inputs = (): LayoutInputs => {
  const value = defaultCaptionInputs({ width: 1080, height: 1920 })
  return { ...value, font: { ...value.font, readiness: 'ready' } }
}

// Mixed Malayalam/English text; a fixed 5-token word list with model timing and small gaps between words.
const TEXT = 'മലയാളം subtitles ഉപയോഗിച്ച് React API'
const TOKENS = [
  { text: 'മലയാളം', textStart: 0, textEnd: 6 },
  { text: 'subtitles', textStart: 7, textEnd: 16 },
  { text: 'ഉപയോഗിച്ച്', textStart: 17, textEnd: 27 },
  { text: 'React', textStart: 28, textEnd: 33 },
  { text: 'API', textStart: 34, textEnd: 37 },
]
const START_US = 3_600_000_000
const WORD_DURATION = 200_000
const GAP = 50_000
const words: CaptionWord[] = TOKENS.map((token, index) => {
  const startUs = START_US + index * (WORD_DURATION + GAP)
  return { id: `w${index}`, text: token.text, textStart: token.textStart, textEnd: token.textEnd,
    startUs, endUs: startUs + WORD_DURATION, timingSource: 'model', needsReview: false }
})
const END_US = words.at(-1)!.endUs
// The cue leads in 100ms before the first word starts, so "before any word" is a real, visible moment.
const LEAD_IN = 100_000
const CUE_START = START_US - LEAD_IN
const CUE: MotionCue = { text: TEXT, startUs: CUE_START, endUs: END_US, words }

function layoutFor() {
  const layout = layoutCaption(TEXT, inputs(), measure)
  return layoutCaptionWords(layout, CUE, measureRange)
}
function frameAt(timestampUs: number, motion: Parameters<typeof captionFrame>[3]) {
  return captionFrame(layoutFor(), CUE, timestampUs, motion)
}
function layoutWithAppearance(overrides: Partial<LayoutInputs['appearance']>, emphasisFont?: CaptionFont) {
  const value: LayoutInputs = { ...inputs(), appearance: { ...inputs().appearance, ...overrides }, emphasisFont }
  const layout = layoutCaption(TEXT, value, measure)
  return layoutCaptionWords(layout, CUE, measureRange)
}

describe('word motion availability', () => {
  it('reports ok and enables word motion for complete, valid, non-stale model timing', () => {
    const availability = wordMotionAvailability(CUE)
    expect(availability).toEqual({ enabled: true, estimated: false, reason: 'ok', explanation: 'Word timing: model.' })
  })

  it('disables word motion and explains when a cue has no words at all', () => {
    const availability = wordMotionAvailability({ ...CUE, words: [] })
    expect(availability.enabled).toBe(false)
    expect(availability.reason).toBe('no-words')
    expect(availability.explanation).toContain('unavailable')
  })

  it('disables word motion for a partial word list that does not cover every token', () => {
    const availability = wordMotionAvailability({ ...CUE, words: words.slice(0, 3) })
    expect(availability.enabled).toBe(false)
    expect(availability.reason).toBe('incomplete')
  })

  it('disables word motion for out-of-order/overlapping word timing', () => {
    const overlapping = words.map((word, index) => index === 1 ? { ...word, startUs: words[0].startUs } : word)
    const availability = wordMotionAvailability({ ...CUE, words: overlapping })
    expect(availability.enabled).toBe(false)
    expect(availability.reason).toBe('invalid')
  })

  it('disables word motion when non-estimated timing needs review, without silently trusting stale alignment', () => {
    const stale = words.map((word, index) => index === 2 ? { ...word, needsReview: true } : word)
    const availability = wordMotionAvailability({ ...CUE, words: stale })
    expect(availability.enabled).toBe(false)
    expect(availability.reason).toBe('needs-review')
    expect(availability.explanation).toContain('needs review')
  })

  it('enables word motion for estimated timing but always labels it as estimated, never as aligned', () => {
    const estimated = words.map((word) => ({ ...word, timingSource: 'estimated' as const }))
    const availability = wordMotionAvailability({ ...CUE, words: estimated })
    expect(availability.enabled).toBe(true)
    expect(availability.reason).toBe('estimated')
    expect(availability.explanation).toContain('Estimated')
    expect(availability.explanation).toContain('not aligned')
  })

  it('summarizes availability across a project’s cues for the style panel', () => {
    const estimatedCue = { ...CUE, words: words.map((word) => ({ ...word, timingSource: 'estimated' as const })) }
    const noWordsCue = { ...CUE, words: [] }
    expect(summarizeWordMotion([CUE, estimatedCue, noWordsCue])).toEqual({ complete: 1, estimated: 1, unavailable: 1, total: 3 })
  })
})

describe('static clean', () => {
  it('is fully opaque while visible with no per-word state, and never disguises absence of motion', () => {
    const frame = frameAt(START_US + 10_000, 'static-clean')
    expect(frame.visible).toBe(true)
    expect(frame.opacity).toBe(1)
    expect(frame.motion).toBeUndefined()
    expect(frame.words).toBeUndefined()
  })
})

describe('phrase fade', () => {
  const ramp = Math.min(200_000, (END_US - CUE_START) / 2)

  it('ramps from 0 to 1 in and back to 0 out, from absolute source time alone', () => {
    expect(frameAt(CUE_START, 'phrase-fade').opacity).toBe(0)
    expect(frameAt(CUE_START + ramp, 'phrase-fade').opacity).toBe(1)
    expect(frameAt(CUE_START + (END_US - CUE_START) / 2, 'phrase-fade').opacity).toBe(1)
    expect(frameAt(END_US - ramp / 4, 'phrase-fade').opacity).toBeCloseTo(.25, 5)
    expect(frameAt(END_US - 1, 'phrase-fade').visible).toBe(true)
  })

  it('carries no word state', () => {
    expect(frameAt(CUE_START + ramp, 'phrase-fade').words).toBeUndefined()
    expect(frameAt(CUE_START + ramp, 'phrase-fade').motion).toBe('phrase-fade')
  })

  it('gives identical results regardless of seek order', () => {
    const timestamps = [CUE_START, CUE_START + ramp, END_US - 1, CUE_START + 400_000]
    const forward = timestamps.map((t) => frameAt(t, 'phrase-fade'))
    const shuffled = [...timestamps].reverse().map((t) => frameAt(t, 'phrase-fade'))
    expect(shuffled.reverse()).toEqual(forward)
  })
})

describe('motion speed', () => {
  it('shortens only fade/pop ramps while preserving the source-time cue window', () => {
    const normal = frameAt(CUE_START + 100_000, 'phrase-fade')
    const fast = captionFrame(layoutFor(), CUE, CUE_START + 100_000, 'phrase-fade', 2)
    expect(normal.visible).toBe(true)
    expect(fast.visible).toBe(true)
    expect(normal.opacity).toBeCloseTo(.5, 5)
    expect(fast.opacity).toBe(1)
    const word = words[1]
    const normalPop = frameAt(word.startUs + 50_000, 'word-pop').words![1].scale
    const fastPop = captionFrame(layoutFor(), CUE, word.startUs + 50_000, 'word-pop', 2).words![1].scale
    expect(fastPop).toBeGreaterThan(normalPop)
  })
})

describe('active-word highlight', () => {
  it('activates exactly one word inside its own half-open window and none during gaps', () => {
    for (const [index, word] of words.entries()) {
      const frame = frameAt(word.startUs, 'active-word-highlight')
      expect(frame.words!.filter((w) => w.active)).toEqual([{ wordIndex: index, active: true, revealed: true, scale: 1 }])
      const lastMoment = frameAt(word.endUs - 1, 'active-word-highlight')
      expect(lastMoment.words![index].active).toBe(true)
      const boundary = frameAt(word.endUs, 'active-word-highlight')
      expect(boundary.words![index].active).toBe(false)
    }
    const gapFrame = frameAt(words[0].endUs + GAP / 2, 'active-word-highlight')
    expect(gapFrame.words!.every((w) => !w.active)).toBe(true)
    const leadInFrame = frameAt(CUE_START, 'active-word-highlight')
    expect(leadInFrame.words!.every((w) => !w.active && !w.revealed)).toBe(true)
  })

  it('keeps revealed monotonically non-decreasing as source time advances', () => {
    const timestamps = [CUE_START, words[1].startUs, words[3].startUs, END_US - 1]
    let previousRevealed = -1
    for (const t of timestamps) {
      const revealed = frameAt(t, 'active-word-highlight').words!.filter((w) => w.revealed).length
      expect(revealed).toBeGreaterThanOrEqual(previousRevealed)
      previousRevealed = revealed
    }
  })
})

describe('word pop', () => {
  it('scales only the active word, peaking at the midpoint of its window and resting at 1 elsewhere', () => {
    const word = words[2]
    const atStart = frameAt(word.startUs, 'word-pop').words![2]
    const atMid = frameAt(word.startUs + WORD_DURATION / 2, 'word-pop').words![2]
    const atLastMoment = frameAt(word.endUs - 1, 'word-pop').words![2]
    expect(atStart.scale).toBeCloseTo(1, 5)
    expect(atMid.scale).toBeCloseTo(1.12, 5)
    expect(atMid.scale).toBeGreaterThan(atStart.scale)
    expect(atMid.scale).toBeGreaterThan(atLastMoment.scale)
    expect(atMid.scale).toBeLessThanOrEqual(1.12)
    const inactiveWords = frameAt(word.startUs + WORD_DURATION / 2, 'word-pop').words!.filter((_, i) => i !== 2)
    expect(inactiveWords.every((w) => w.scale === 1)).toBe(true)
  })

  it('produces identical output for repeated evaluation at the same absolute timestamp', () => {
    const t = words[1].startUs + 90_000
    expect(frameAt(t, 'word-pop')).toEqual(frameAt(t, 'word-pop'))
  })

  it('gives identical results regardless of seek order', () => {
    const timestamps = words.flatMap((w) => [w.startUs, w.startUs + WORD_DURATION / 2, w.endUs - 1])
    const forward = timestamps.map((t) => frameAt(t, 'word-pop'))
    const shuffled = [...timestamps].reverse().map((t) => frameAt(t, 'word-pop'))
    expect(shuffled.reverse()).toEqual(forward)
  })
})

describe('progressive word reveal', () => {
  it('reveals nothing before the first word, one word once it starts and everything once the last word has started', () => {
    expect(frameAt(CUE_START, 'progressive-word-reveal').words!.filter((w) => w.revealed)).toHaveLength(0)
    expect(frameAt(START_US, 'progressive-word-reveal').words!.filter((w) => w.revealed)).toHaveLength(1)
    expect(frameAt(words.at(-1)!.startUs, 'progressive-word-reveal').words!.filter((w) => w.revealed)).toHaveLength(5)
  })

  it('keeps the revealed count monotonically non-decreasing across source time', () => {
    const timestamps = [CUE_START, START_US, words[1].startUs - 1, words[1].startUs, words[3].startUs, END_US - 1]
    let previous = -1
    for (const t of timestamps) {
      const revealed = frameAt(t, 'progressive-word-reveal').words!.filter((w) => w.revealed).length
      expect(revealed).toBeGreaterThanOrEqual(previous)
      previous = revealed
    }
  })
})

describe('word-dependent presets fall back honestly when word timing is unusable', () => {
  it('falls back to static clean and surfaces a visible notice instead of estimating in the renderer', () => {
    const cueWithoutWords = { ...CUE, words: [] }
    const layout = layoutCaption(TEXT, inputs(), measure)
    const frame = captionFrame(layout, cueWithoutWords, START_US + 10_000, 'word-pop')
    expect(frame.motion).toBe('static-clean')
    expect(frame.words).toEqual([])
    expect(frame.timingNotice).toContain('unavailable')
  })
})

describe('Malayalam grapheme preservation through word effects', () => {
  const boundaries = graphemeBoundaries(TEXT)

  it('keeps every word region aligned to whole grapheme clusters', () => {
    const layout = layoutCaption(TEXT, inputs(), measure)
    const wordLayout = layoutCaptionWords(layout, CUE, measureRange)
    expect(wordLayout.wordRegions!.length).toBeGreaterThan(0)
    for (const region of wordLayout.wordRegions!) {
      expect(boundaries.has(region.textStart)).toBe(true)
      expect(boundaries.has(region.textEnd)).toBe(true)
    }
  })

  for (const motion of ['active-word-highlight', 'word-pop'] as const) {
    it(`paints one unsplit shaping run for the base line and one for the ${motion} overlay, never a per-grapheme span`, () => {
      const wordLayout = layoutFor()
      const region = wordLayout.wordRegions!.find((r) => r.wordIndex === 2)!
      const lineText = wordLayout.lines[region.lineIndex].text
      const frame = captionFrame(wordLayout, CUE, words[2].startUs + 50_000, motion)
      const html = renderToStaticMarkup(<CaptionView frame={frame} />)
      const body = html.replace(/aria-label="[^"]*"/, '') // exclude the whole-cue accessible label from the element-content count below
      expect(html).not.toContain('<span')
      expect((html.match(/data-caption-word-effect/g) ?? []).length).toBe(1)
      // The complete unbroken line — including every word on it — appears twice as element
      // content: once as the base line, once inside the overlay that recreates the whole
      // shaping run to mask/clip it. Neither copy is split into per-grapheme fragments.
      expect(body.split(lineText).length - 1).toBe(2)
      for (const token of TOKENS) expect(html).toContain(token.text)
    })

    it(`paints only the base line, with no overlay, during a gap between words (${motion})`, () => {
      const frame = frameAt(words[0].endUs + GAP / 2, motion)
      const html = renderToStaticMarkup(<CaptionView frame={frame} />)
      expect(html.match(/data-caption-word-effect/g)).toBeNull()
    })
  }

  it('reveals the full unsplit line via clip-path, never fragmenting the shaping run', () => {
    const wordLayout = layoutFor()
    const region = wordLayout.wordRegions!.find((r) => r.wordIndex === 2)!
    const lineText = wordLayout.lines[region.lineIndex].text
    const frame = captionFrame(wordLayout, CUE, words[2].startUs + 10_000, 'progressive-word-reveal')
    const html = renderToStaticMarkup(<CaptionView frame={frame} />)
    const body = html.replace(/aria-label="[^"]*"/, '')
    expect(html).not.toContain('<span')
    expect(body.split(lineText).length - 1).toBe(1)
    expect(html).toContain('clip-path')
    for (const token of TOKENS) expect(html).toContain(token.text)
  })

  it('hides the revealed line entirely before the first word starts, rather than showing untimed text', () => {
    const frame = frameAt(CUE_START, 'progressive-word-reveal')
    const html = renderToStaticMarkup(<CaptionView frame={frame} />)
    expect(html).toContain('opacity:0')
  })
})

describe('gradient fill, emphasis face and spotlight', () => {
  it('paints a solid layer plus a gradient-clipped layer for a filled base line, still with no per-grapheme span', () => {
    const wordLayout = layoutWithAppearance({ fill: { from: '#ffffff', to: '#000000', angle: 90 } })
    const region = wordLayout.wordRegions!.find((r) => r.wordIndex === 2)!
    const lineText = wordLayout.lines[region.lineIndex].text
    const frame = captionFrame(wordLayout, CUE, words[2].startUs + 50_000, 'active-word-highlight')
    const html = renderToStaticMarkup(<CaptionView frame={frame} />)
    const body = html.replace(/aria-label="[^"]*"/, '')
    expect(html).not.toContain('<span')
    expect(html).toContain('background-clip:text')
    // Base line now renders two copies (solid + gradient); the overlay still renders its own one copy.
    expect(body.split(lineText).length - 1).toBe(3)
  })

  it('crops the active-word overlay in the emphasis face when one is configured, without changing word identity', () => {
    const emphasisFont: CaptionFont = { ...inputs().font, weight: 900, italic: true }
    const wordLayout = layoutWithAppearance({}, emphasisFont)
    const region = wordLayout.wordRegions!.find((r) => r.wordIndex === 2)!
    expect(region.emphasis).toBeDefined()
    const frame = captionFrame(wordLayout, CUE, words[2].startUs + 50_000, 'active-word-highlight')
    const html = renderToStaticMarkup(<CaptionView frame={frame} />)
    expect(html).toContain('font-weight:900')
    expect(html).toContain('font-style:italic')
    for (const token of TOKENS) expect(html).toContain(token.text)
  })

  it('never punches the active word out of a progressive reveal with a distinct emphasis face (no overlay repaints it)', () => {
    const emphasisFont: CaptionFont = { ...inputs().font, weight: 900, italic: true }
    const wordLayout = layoutWithAppearance({}, emphasisFont)
    // The last word stays active until the cue ends, so a mask here would hide it for good.
    const frame = captionFrame(wordLayout, CUE, words.at(-1)!.startUs + 50_000, 'progressive-word-reveal')
    const html = renderToStaticMarkup(<CaptionView frame={frame} />)
    expect(html).not.toContain('mask-image')
    expect(html).not.toContain('data-caption-word-effect')
  })

  it('dims the base line to SPOTLIGHT_DIM while the active-word overlay stays fully visible, in spotlight mode', () => {
    const wordLayout = layoutWithAppearance({ spotlight: true })
    const frame = captionFrame(wordLayout, CUE, words[2].startUs + 50_000, 'active-word-highlight')
    const html = renderToStaticMarkup(<CaptionView frame={frame} />)
    expect(html).toContain(`opacity:${SPOTLIGHT_DIM}`)
    const overlay = html.match(/data-caption-word-effect="2"[^]*?<\/div><\/div>/)?.[0] ?? ''
    expect(overlay).not.toContain(`opacity:${SPOTLIGHT_DIM}`)
  })

  it('does not dim the base line outside a word-dependent preset, even with spotlight configured', () => {
    const wordLayout = layoutWithAppearance({ spotlight: true })
    const frame = captionFrame(wordLayout, CUE, words[2].startUs + 50_000, 'progressive-word-reveal')
    const html = renderToStaticMarkup(<CaptionView frame={frame} />)
    expect(html).not.toContain(`opacity:${SPOTLIGHT_DIM}`)
  })

  it('draws an underline on the base line via text-decoration', () => {
    const layout = layoutCaption(TEXT, { ...inputs(), appearance: { ...inputs().appearance, underline: true } }, measure)
    const frame = captionFrame(layout, { startUs: CUE_START, endUs: END_US }, CUE_START + 10_000, 'static-clean')
    const html = renderToStaticMarkup(<CaptionView frame={frame} />)
    expect(html).toContain('text-decoration:underline')
  })
})

// wordDisplayCue re-bases an interior word's own startUs/endUs to the held window (through its
// trailing gap, up to the next word's start), so every preset below sees one word spanning that
// whole window rather than the word's original narrow duration.
describe('word display: per-word presets apply to the synthetic single-word cue', () => {
  const held = wordDisplayCue(CUE, 2) // an interior word, held through its trailing gap

  it('phrase-fade ramps in and out over the held window, not the whole line', () => {
    const layout = layoutCaption(held.text, inputs(), measure)
    const ramp = Math.min(200_000, (held.endUs - held.startUs) / 2)
    const frameAtHeld = (t: number) => captionFrame(layout, held, t, 'phrase-fade')
    expect(frameAtHeld(held.startUs).opacity).toBe(0)
    expect(frameAtHeld(held.startUs + ramp).opacity).toBe(1)
    expect(frameAtHeld(held.endUs - 1).visible).toBe(true)
  })

  it('word-pop peaks at the held window’s midpoint and active-word-highlight stays active through it', () => {
    const layout = layoutCaptionWords(layoutCaption(held.text, inputs(), measure), held, measureRange)
    expect(captionFrame(layout, held, held.startUs, 'active-word-highlight').words![0].active).toBe(true)
    expect(captionFrame(layout, held, held.endUs - 1, 'active-word-highlight').words![0].active).toBe(true)
    // The pop curve caps its ramp at 200ms (docs/CAPTION_RENDERER.md), so its peak sits at half of
    // that — not necessarily the held window's own midpoint, which can be longer.
    const peakOffset = Math.min(200_000, held.endUs - held.startUs) / 2
    const atStart = captionFrame(layout, held, held.startUs, 'word-pop').words![0].scale
    const atPeak = captionFrame(layout, held, held.startUs + peakOffset, 'word-pop').words![0].scale
    expect(atPeak).toBeGreaterThan(atStart)
    expect(atPeak).toBeCloseTo(1.12, 5)
  })

  it('progressive-word-reveal reveals the single word immediately and keeps it revealed through the held window', () => {
    const layout = layoutCaptionWords(layoutCaption(held.text, inputs(), measure), held, measureRange)
    expect(captionFrame(layout, held, held.startUs, 'progressive-word-reveal').words![0].revealed).toBe(true)
    expect(captionFrame(layout, held, held.endUs - 1, 'progressive-word-reveal').words![0].revealed).toBe(true)
  })
})
