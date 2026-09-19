import { describe, expect, it } from 'vitest'
import type { JobProgress } from '../src/core/jobs'
import { sourceTimedTranscriptSchema, type SourceTimedTranscript } from '../src/core/transcription'
import { GEMINI_TRANSLATE_BATCH_SIZE, GEMINI_TRANSLATE_MODEL, translateTranscript, type GeminiTranslator } from './geminiTranslation'
import type { GeminiUsage } from './geminiRecognition'
import { jobFailure } from '../src/core/jobs'

const segment = (startMs: number, endMs: number, text: string) => ({
  startUs: startMs * 1000, endUs: endMs * 1000, text, confidence: null, words: [], timingAdjustment: null,
})

function transcript(texts: string[], language: SourceTimedTranscript['language'] = 'ml'): SourceTimedTranscript {
  return sourceTimedTranscriptSchema.parse({
    contractVersion: 1, engine: 'whisper.cpp', model: 'ggml-base.bin', language,
    sourceRange: { startUs: 0, endUs: (texts.length + 1) * 2000 * 1000 },
    segments: texts.map((text, index) => segment(index * 2000, index * 2000 + 1000, text)),
  })
}

/** A translator that records every call and answers with a fixed mapping (or a per-call override). */
function fakeTranslator(reply: (texts: readonly string[]) => string[], usage: GeminiUsage = {}): { translator: GeminiTranslator; calls: { texts: readonly string[]; target: string; sourceLanguage: string | null }[] } {
  const calls: { texts: readonly string[]; target: string; sourceLanguage: string | null }[] = []
  const translator: GeminiTranslator = async (texts, target, sourceLanguage) => {
    calls.push({ texts, target, sourceLanguage })
    return { texts: reply(texts), usage }
  }
  return { translator, calls }
}

describe('translateTranscript', () => {
  it('translates every segment in one batch, preserving order and reporting measured progress', async () => {
    const { translator, calls } = fakeTranslator((texts) => texts.map((text) => `EN:${text}`), { inputTokens: 10, outputTokens: 6 })
    const source = transcript(['ഒന്ന്', 'രണ്ട്', 'മൂന്ന്'])
    const progress: JobProgress[] = []
    const { translation, usage } = await translateTranscript(translator, source, 'en', new AbortController().signal, (value) => progress.push(value))
    expect(calls).toEqual([{ texts: ['ഒന്ന്', 'രണ്ട്', 'മൂന്ന്'], target: 'en', sourceLanguage: 'ml' }])
    expect(translation).toEqual({ contractVersion: 1, provider: 'gemini', model: GEMINI_TRANSLATE_MODEL, targetLanguage: 'en', segments: [{ text: 'EN:ഒന്ന്' }, { text: 'EN:രണ്ട്' }, { text: 'EN:മൂന്ന്' }] })
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 6 })
    expect(progress).toEqual([
      { kind: 'measured', phase: 'translating', completed: 0, total: 1, unit: 'items' },
      { kind: 'measured', phase: 'translating', completed: 1, total: 1, unit: 'items' },
    ])
  })

  it('splits large transcripts into fixed-size batches, sums usage across them and reports monotonic progress', async () => {
    const texts = Array.from({ length: GEMINI_TRANSLATE_BATCH_SIZE + 5 }, (_value, index) => `line ${index} text`)
    const { translator, calls } = fakeTranslator((batch) => batch.map((text) => `EN ${text}`), { inputTokens: 4, outputTokens: 2 })
    const source = transcript(texts, 'en')
    const progress: JobProgress[] = []
    const { translation, usage } = await translateTranscript(translator, source, 'ml', new AbortController().signal, (value) => progress.push(value))
    expect(calls).toHaveLength(2)
    expect(calls[0].texts).toHaveLength(GEMINI_TRANSLATE_BATCH_SIZE)
    expect(calls[1].texts).toHaveLength(5)
    expect(translation.segments).toHaveLength(texts.length)
    expect(translation.segments[0].text).toBe('EN line 0 text')
    expect(translation.segments.at(-1)?.text).toBe(`EN line ${texts.length - 1} text`)
    expect(usage).toEqual({ inputTokens: 8, outputTokens: 4 })
    expect(progress.map((value) => value.kind === 'measured' ? value.completed : null)).toEqual([0, 1, 2])
    expect(progress.every((value) => value.kind === 'measured' && value.total === 2)).toBe(true)
  })

  it('returns an empty translation without calling the translator when the transcript has no segments', async () => {
    const { translator, calls } = fakeTranslator((texts) => [...texts])
    const source = transcript([])
    const { translation, usage } = await translateTranscript(translator, source, 'en', new AbortController().signal)
    expect(calls).toEqual([])
    expect(translation.segments).toEqual([])
    expect(usage).toEqual({})
  })

  it('rejects a batch reply with a different line count than it was sent as MALFORMED_OUTPUT', async () => {
    const { translator } = fakeTranslator((texts) => texts.slice(1))
    const source = transcript(['one', 'two', 'three'])
    await expect(translateTranscript(translator, source, 'en', new AbortController().signal))
      .rejects.toMatchObject({ detail: { code: 'MALFORMED_OUTPUT' } })
  })

  it('rejects an empty translated line as MALFORMED_OUTPUT', async () => {
    const { translator } = fakeTranslator((texts) => texts.map((_text, index) => index === 1 ? '   ' : 'ok'))
    const source = transcript(['one', 'two', 'three'])
    await expect(translateTranscript(translator, source, 'en', new AbortController().signal))
      .rejects.toMatchObject({ detail: { code: 'MALFORMED_OUTPUT' } })
  })

  it('propagates a cancellation the translator itself reports as CANCELLED', async () => {
    const translator: GeminiTranslator = async () => { throw jobFailure('CANCELLED', 'Translation was cancelled.') }
    const source = transcript(['one', 'two'])
    await expect(translateTranscript(translator, source, 'en', new AbortController().signal))
      .rejects.toMatchObject({ detail: { code: 'CANCELLED' } })
  })

  it('rejects translated text dominated by the wrong script for the target language as UNEXPECTED_SCRIPT', async () => {
    // Tamil script text offered as a Malayalam translation; well above the letter-count floor.
    const { translator } = fakeTranslator(() => [
      'இது ஒரு நீண்ட தமிழ் வாக்கியம் ஆகும்', 'மற்றொரு தமிழ் வாக்கியம் இங்கே உள்ளது',
    ])
    const source = transcript(['one', 'two'], 'en')
    await expect(translateTranscript(translator, source, 'ml', new AbortController().signal))
      .rejects.toMatchObject({ detail: { code: 'UNEXPECTED_SCRIPT' } })
  })

  it('accepts a translation into a language with no single expected script without a script check', async () => {
    const { translator } = fakeTranslator((texts) => texts.map((text) => `es:${text}`))
    const source = transcript(['one', 'two'], 'en')
    const { translation } = await translateTranscript(translator, source, 'es', new AbortController().signal)
    expect(translation.segments.map((entry) => entry.text)).toEqual(['es:one', 'es:two'])
  })
})
