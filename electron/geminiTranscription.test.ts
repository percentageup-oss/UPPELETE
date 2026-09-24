import { describe, expect, it } from 'vitest'
import { locateWordSpans } from '../src/core/captionText'
import type { MediaWorkerClient } from '../workers/media/client'
import { runTranscription } from '../workers/transcription/run'
import { geminiLocales, GeminiTranscriptionAdapter, segmentsFromWords } from './geminiTranscription'

/** Deterministic word lists stand in for Gemini responses; they check segmentation and offsets, not recognition quality. */
const w = (text: string, startMs: number, endMs: number) => ({ text, startUs: startMs * 1000, endUs: endMs * 1000 })

describe('segmentsFromWords', () => {
  it('splits at pauses and sentence ends, and every word is locatable in its segment text', () => {
    const { segments } = segmentsFromWords([
      w('ഇന്ന്', 0, 400), w('നമ്മൾ', 450, 900), w('React', 950, 1300), w('പഠിക്കും.', 1350, 1900),
      w('Next', 2000, 2300), w('topic', 2350, 2700), w('after', 3600, 3900), w('pause', 3950, 4300),
    ], 10_000_000)
    expect(segments.map((segment) => segment.text)).toEqual(['ഇന്ന് നമ്മൾ React പഠിക്കും.', 'Next topic', 'after pause'])
    for (const segment of segments) expect(locateWordSpans(segment.text, segment.words!)).not.toBeNull()
    expect(segments[0]).toMatchObject({ startUs: 0, endUs: 1_900_000 })
    expect(segments.every((segment) => !segment.timingAdjustment)).toBe(true)
  })

  it('caps segment length at 30 seconds of continuous speech', () => {
    const words = Array.from({ length: 80 }, (_value, index) => w(`word${index}`, index * 500, index * 500 + 450))
    const { segments } = segmentsFromWords(words, 60_000_000)
    expect(segments.length).toBeGreaterThan(1)
    expect(segments.every((segment) => segment.endUs - segment.startUs <= 30_000_000)).toBe(true)
    expect(segments.flatMap((segment) => segment.words!).length).toBe(80)
  })

  it('attaches punctuation tokens, fixes overlaps and clamps to the chunk explicitly', () => {
    const { segments, droppedWords } = segmentsFromWords([
      w('hello', 0, 500), w(',', 500, 520), w('there', 450, 900), w('same', 900, 900), w('edge', 1000, 2500), w('late', 3000, 3200),
    ], 2_000_000)
    expect(droppedWords).toBe(1)
    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('hello, there same edge')
    expect(segments[0].words).toEqual([w('hello,', 0, 520), w('there same', 520, 900), w('edge', 1000, 2000)])
    expect(segments[0].timingAdjustment).toBe('start-moved-after-overlap')
    expect(locateWordSpans(segments[0].text, segments[0].words!)).not.toBeNull()
  })

  it('maps language choices to Gemini locale hints, sending none for mixed speech', () => {
    expect(geminiLocales('auto')).toEqual([])
    expect(geminiLocales('ml')).toEqual(['ml-IN'])
    expect(geminiLocales('en')).toEqual(['en-IN'])
  })
})

describe('GeminiTranscriptionAdapter', () => {
  it('uploads each speech chunk separately and maps word times through the shared contract', async () => {
    const worker = { start: () => ({ id: 'x', cancel() {}, result: Promise.resolve({
      operation: 'speechChunks', speechGating: 'gating-v1', silences: [{ startUs: 3_000_000, endUs: 8_000_000 }],
      chunks: [{ path: '/tmp/a.wav', startUs: 0, endUs: 3_300_000 }, { path: '/tmp/b.wav', startUs: 7_700_000, endUs: 10_000_000 }],
    }) }) } as unknown as Pick<MediaWorkerClient, 'start'>
    const uploads: { path: string; locales: readonly string[] }[] = []
    const adapter = new GeminiTranscriptionAdapter(worker, async (path, options) => {
      uploads.push({ path, locales: options.locales })
      return path === '/tmp/a.wav'
        ? { words: [w('ആദ്യ', 1000, 1400), w('വാചകം', 1450, 2000)], usage: { inputTokens: 10, outputTokens: 4 }, droppedAnnotations: 1 }
        : { words: [w('after', 500, 900), w('pause', 950, 1400)], usage: { inputTokens: 7, outputTokens: 3 }, droppedAnnotations: 0 }
    }, '/tmp/chunks')
    const transcript = await runTranscription(adapter, {
      audio: { path: '/tmp/audio.wav', sourceStartUs: 5_000_000, durationUs: 10_000_000, sampleRate: 16000, channels: 1, sampleCount: 160_000 },
    }, { language: 'auto', device: 'cpu', wordTimestamps: true })
    expect(uploads).toEqual([{ path: '/tmp/a.wav', locales: [] }, { path: '/tmp/b.wav', locales: [] }])
    expect(transcript.language).toBe('ml')
    expect(transcript.segments.map(({ startUs, endUs, text }) => ({ startUs, endUs, text }))).toEqual([
      { startUs: 6_000_000, endUs: 7_000_000, text: 'ആദ്യ വാചകം' },
      { startUs: 13_200_000, endUs: 14_100_000, text: 'after pause' },
    ])
    expect(transcript.segments[1].words[0]).toMatchObject({ startUs: 13_200_000, endUs: 13_600_000, timingSource: 'model' })
    expect(adapter.lastRun).toMatchObject({ inputTokens: 17, outputTokens: 7, droppedWords: 0, droppedAnnotations: 1 })
  })
})
