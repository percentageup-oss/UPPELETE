import { describe, expect, it } from 'vitest'
import { JobFailure, type JobStructuredError } from './jobs'
import {
  checkAudioSampleRate,
  checkTranscriptionOptions,
  languageCodeSchema,
  toAudioRelativeSegments,
  transcriptionCapabilitiesSchema,
  validateAlignmentOutput,
  validateTranscriptionOutput,
  type AlignmentRequestSegment,
  type TranscriptionCapabilities,
  type TranscriptionOptions,
} from './transcription'

const capabilities: TranscriptionCapabilities = {
  contractVersion: 1,
  engine: { id: 'whisper-cpp', version: '1.7.0' },
  model: { id: 'ggml-medium-q5' },
  transcription: {
    languages: ['ml', 'en'],
    autoDetectLanguage: true,
    devices: ['cpu', 'metal'],
    inputSampleRates: [16000],
    wordTiming: 'model',
    confidence: { segment: true, word: true },
  },
  alignment: { languages: ['en'], granularity: 'word' },
}

const options: TranscriptionOptions = { language: 'ml', device: 'cpu', wordTimestamps: true }

function expectCode(fn: () => unknown, code: JobStructuredError['code']) {
  try {
    fn()
    throw new Error('expected a JobFailure to be thrown')
  } catch (error) {
    expect(error).toBeInstanceOf(JobFailure)
    expect((error as JobFailure).detail.code).toBe(code)
  }
}

describe('transcription capabilities', () => {
  it('rejects empty, duplicate or wildcard-shaped language declarations', () => {
    expect(transcriptionCapabilitiesSchema.safeParse({ ...capabilities, transcription: { ...capabilities.transcription, languages: [] } }).success).toBe(false)
    expect(transcriptionCapabilitiesSchema.safeParse({ ...capabilities, transcription: { ...capabilities.transcription, languages: ['ml', 'ml'] } }).success).toBe(false)
    expect(languageCodeSchema.safeParse('*').success).toBe(false)
    expect(languageCodeSchema.safeParse('en-US').success).toBe(false)
  })
  it('requires a declared CPU fallback and unique devices', () => {
    expect(transcriptionCapabilitiesSchema.safeParse({ ...capabilities, transcription: { ...capabilities.transcription, devices: ['metal'] } }).success).toBe(false)
    expect(transcriptionCapabilitiesSchema.safeParse({ ...capabilities, transcription: { ...capabilities.transcription, devices: ['cpu', 'cpu'] } }).success).toBe(false)
  })
  it('keeps alignment languages independent of transcription languages, including null alignment', () => {
    const noAligner = { ...capabilities, alignment: null }
    expect(transcriptionCapabilitiesSchema.parse(noAligner)).toEqual(noAligner)
    const differentAligner = { ...capabilities, alignment: { languages: ['fr'], granularity: 'word' as const } }
    expect(transcriptionCapabilitiesSchema.parse(differentAligner).alignment?.languages).toEqual(['fr'])
  })
})

describe('checkTranscriptionOptions / checkAudioSampleRate', () => {
  it('passes supported options through without throwing', () => {
    expect(() => checkTranscriptionOptions(capabilities, options)).not.toThrow()
    expect(() => checkAudioSampleRate(capabilities, 16000)).not.toThrow()
  })
  it('rejects an undeclared language before any adapter call', () => {
    expectCode(() => checkTranscriptionOptions(capabilities, { ...options, language: 'fr' }), 'UNSUPPORTED_LANGUAGE')
  })
  it('rejects auto-detect when not declared', () => {
    expectCode(() => checkTranscriptionOptions({ ...capabilities, transcription: { ...capabilities.transcription, autoDetectLanguage: false } }, { ...options, language: 'auto' }), 'UNSUPPORTED_OPTION')
  })
  it('rejects an undeclared device', () => {
    expectCode(() => checkTranscriptionOptions(capabilities, { ...options, device: 'cuda' }), 'UNSUPPORTED_OPTION')
  })
  it('rejects word timestamps when the model does not report them', () => {
    expectCode(() => checkTranscriptionOptions({ ...capabilities, transcription: { ...capabilities.transcription, wordTiming: 'none' } }, options), 'UNSUPPORTED_OPTION')
  })
  it('rejects an unsupported sample rate', () => {
    expectCode(() => checkAudioSampleRate(capabilities, 48000), 'INVALID_INPUT')
  })
})

describe('validateTranscriptionOutput', () => {
  const oneHourUs = 3_600_000_000
  const window = { sourceStartUs: oneHourUs, durationUs: 20_000_000 }

  it('maps offsets exactly and preserves a long silence gap without inventing text', () => {
    const raw = {
      engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml',
      segments: [
        { startUs: 0, endUs: 1_000_000, text: 'ആദ്യ വാചകം' },
        // 15-second silent gap: no segment covers it, and none should be invented.
        { startUs: 16_000_000, endUs: 17_000_000, text: 'Second sentence' },
      ],
    }
    const result = validateTranscriptionOutput(window, capabilities, options, raw)
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toMatchObject({ startUs: oneHourUs, endUs: oneHourUs + 1_000_000, text: 'ആദ്യ വാചകം' })
    expect(result.segments[1]).toMatchObject({ startUs: oneHourUs + 16_000_000, endUs: oneHourUs + 17_000_000, text: 'Second sentence' })
    expect(result.sourceRange).toEqual({ startUs: oneHourUs, endUs: oneHourUs + window.durationUs })
  })

  it('accepts zero segments for genuine silence', () => {
    const raw = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml', segments: [] }
    expect(validateTranscriptionOutput(window, capabilities, options, raw).segments).toEqual([])
  })

  it('preserves mixed Malayalam/English text and combining marks exactly, including words', () => {
    const text = 'ഇത് ഒരു test ആണ്, correct?'
    const raw = {
      engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml',
      segments: [{
        startUs: 0, endUs: 2_000_000, text,
        words: [
          { startUs: 0, endUs: 500_000, text: 'ഇത്' },
          { startUs: 500_000, endUs: 1_000_000, text: 'ഒരു' },
          { startUs: 1_000_000, endUs: 2_000_000, text: 'test' },
        ],
      }],
    }
    const result = validateTranscriptionOutput(window, capabilities, options, raw)
    expect(result.segments[0].text).toBe(text)
    expect(result.segments[0].words.map((w) => w.text)).toEqual(['ഇത്', 'ഒരു', 'test'])
    expect(result.segments[0].words.every((w) => w.timingSource === 'model')).toBe(true)
  })

  it('carries an explicit adapter timing adjustment through source-time mapping', () => {
    const raw = {
      engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml',
      segments: [{ startUs: 0, endUs: 1_000_000, text: 'a', timingAdjustment: 'end-clamped-to-chunk' }, { startUs: 2_000_000, endUs: 3_000_000, text: 'b' }],
    }
    expect(validateTranscriptionOutput(window, capabilities, options, raw).segments.map((segment) => segment.timingAdjustment)).toEqual(['end-clamped-to-chunk', null])
    expectCode(() => validateTranscriptionOutput(window, capabilities, options, { ...raw, segments: [{ ...raw.segments[0], timingAdjustment: 'guessed' }] }), 'MALFORMED_OUTPUT')
  })

  it('allows a null language only for auto-detection that recognized nothing', () => {
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, language: null }
    expect(validateTranscriptionOutput(window, capabilities, { ...options, language: 'auto' }, { ...base, segments: [] }).language).toBeNull()
    expectCode(() => validateTranscriptionOutput(window, capabilities, options, { ...base, segments: [] }), 'MALFORMED_OUTPUT')
    expectCode(() => validateTranscriptionOutput(window, capabilities, { ...options, language: 'auto' }, { ...base, segments: [{ startUs: 0, endUs: 1000, text: 'a' }] }), 'MALFORMED_OUTPUT')
  })

  it('rejects malformed schema shapes', () => {
    expectCode(() => validateTranscriptionOutput(window, capabilities, options, { extra: true }), 'MALFORMED_OUTPUT')
  })
  it('rejects engine/model provenance that does not match capabilities', () => {
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml', segments: [] }
    expectCode(() => validateTranscriptionOutput(window, capabilities, options, { ...base, engine: 'other-engine' }), 'MALFORMED_OUTPUT')
    expectCode(() => validateTranscriptionOutput(window, capabilities, options, { ...base, model: 'other-model' }), 'MALFORMED_OUTPUT')
  })
  it('rejects a reported language that does not match the request', () => {
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, segments: [] }
    expectCode(() => validateTranscriptionOutput(window, capabilities, options, { ...base, language: 'en' }), 'MALFORMED_OUTPUT')
  })
  it('rejects an auto-detected language outside the declared set', () => {
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, segments: [] }
    expectCode(() => validateTranscriptionOutput(window, capabilities, { ...options, language: 'auto' }, { ...base, language: 'fr' }), 'MALFORMED_OUTPUT')
  })
  it('rejects out-of-order or overlapping segments', () => {
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml' }
    expectCode(() => validateTranscriptionOutput(window, capabilities, options, {
      ...base, segments: [{ startUs: 1_000_000, endUs: 2_000_000, text: 'b' }, { startUs: 0, endUs: 500_000, text: 'a' }],
    }), 'MALFORMED_OUTPUT')
    expectCode(() => validateTranscriptionOutput(window, capabilities, options, {
      ...base, segments: [{ startUs: 0, endUs: 1_000_000, text: 'a' }, { startUs: 500_000, endUs: 1_500_000, text: 'b' }],
    }), 'MALFORMED_OUTPUT')
  })
  it('rejects a segment that extends past the audio duration', () => {
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml' }
    expectCode(() => validateTranscriptionOutput(window, capabilities, options, { ...base, segments: [{ startUs: 0, endUs: window.durationUs + 1, text: 'a' }] }), 'MALFORMED_OUTPUT')
  })
  it('rejects empty, whitespace-only, control-character or lone-surrogate text', () => {
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml' }
    for (const text of ['', '   ', 'bell', '\uD800lonehigh']) {
      expectCode(() => validateTranscriptionOutput(window, capabilities, options, { ...base, segments: [{ startUs: 0, endUs: 1000, text }] }), 'MALFORMED_OUTPUT')
    }
  })
  it('rejects words when they were not requested', () => {
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml' }
    expectCode(() => validateTranscriptionOutput(window, capabilities, { ...options, wordTimestamps: false }, {
      ...base, segments: [{ startUs: 0, endUs: 1000, text: 'a', words: [{ startUs: 0, endUs: 500, text: 'a' }] }],
    }), 'MALFORMED_OUTPUT')
  })
  it('rejects out-of-order/overlapping or out-of-bounds words', () => {
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml' }
    expectCode(() => validateTranscriptionOutput(window, capabilities, options, {
      ...base, segments: [{ startUs: 0, endUs: 1000, text: 'a b', words: [{ startUs: 500, endUs: 1000, text: 'b' }, { startUs: 0, endUs: 500, text: 'a' }] }],
    }), 'MALFORMED_OUTPUT')
    expectCode(() => validateTranscriptionOutput(window, capabilities, options, {
      ...base, segments: [{ startUs: 0, endUs: 1000, text: 'a', words: [{ startUs: 0, endUs: 1500, text: 'a' }] }],
    }), 'MALFORMED_OUTPUT')
  })
  it('rejects confidence values the capabilities did not declare', () => {
    const noConfidence = { ...capabilities, transcription: { ...capabilities.transcription, confidence: { segment: false, word: false } } }
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml' }
    expectCode(() => validateTranscriptionOutput(window, noConfidence, options, { ...base, segments: [{ startUs: 0, endUs: 1000, text: 'a', confidence: 0.9 }] }), 'MALFORMED_OUTPUT')
    expectCode(() => validateTranscriptionOutput(window, noConfidence, options, { ...base, segments: [{ startUs: 0, endUs: 1000, text: 'a', words: [{ startUs: 0, endUs: 1000, text: 'a', confidence: 0.9 }] }] }), 'MALFORMED_OUTPUT')
  })
  it('rejects a timestamp that overflows safe-integer range after source-offset mapping', () => {
    const hugeWindow = { sourceStartUs: Number.MAX_SAFE_INTEGER - 5, durationUs: 10 }
    const raw = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml', segments: [{ startUs: 8, endUs: 10, text: 'a' }] }
    expectCode(() => validateTranscriptionOutput(hugeWindow, capabilities, options, raw), 'MALFORMED_OUTPUT')
  })
  it('rejects capabilities that do not themselves validate', () => {
    expectCode(() => validateTranscriptionOutput(window, { ...capabilities, contractVersion: 2 as never }, options, { engine: 'x', model: 'y', language: 'ml', segments: [] }), 'INVALID_CAPABILITIES')
  })
  it('rejects Malayalam-requested output that is actually written in Tamil script', () => {
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml' }
    const tamilText = 'இன்று வானிலை மிகவும் நன்றாக உள்ளது, நான் காலையில் நடக்கச் சென்றேன்.'
    expectCode(() => validateTranscriptionOutput(window, capabilities, options, { ...base, segments: [{ startUs: 0, endUs: 1000, text: tamilText }] }), 'UNEXPECTED_SCRIPT')
  })
  it('suggests a larger model on wrong-script output from a smaller model, but not when large-v3 already produced it', () => {
    const tamilText = 'இன்று வானிலை மிகவும் நன்றாக உள்ளது, நான் காலையில் நடக்கச் சென்றேன்.'
    const raw = (model: string) => ({ engine: capabilities.engine.id, model, language: 'ml', segments: [{ startUs: 0, endUs: 1000, text: tamilText }] })
    const messageFor = (model: string) => {
      const withModel = { ...capabilities, model: { id: model } }
      try {
        validateTranscriptionOutput(window, withModel, options, raw(model))
        throw new Error('expected a JobFailure to be thrown')
      } catch (error) {
        return (error as JobFailure).detail.message
      }
    }
    expect(messageFor('ggml-medium-q5')).toContain('try a larger model (Whisper large-v3)')
    const largeMessage = messageFor('whisper-large-v3')
    expect(largeMessage).not.toContain('try a larger model')
    expect(largeMessage).toContain('a bigger model will not fix it')
  })
})

describe('alignment', () => {
  const window = { sourceStartUs: 5_000_000, durationUs: 10_000_000 }
  const requestSegments: AlignmentRequestSegment[] = [
    { id: 'cue-1', startUs: 5_000_000, endUs: 8_000_000, text: 'hello there friend' },
    { id: 'cue-2', startUs: 8_000_000, endUs: 12_000_000, text: 'second cue text' },
  ]

  it('converts request segments to audio-relative time and rejects segments outside the window', () => {
    const relative = toAudioRelativeSegments(window, requestSegments)
    expect(relative).toEqual([
      { id: 'cue-1', startUs: 0, endUs: 3_000_000, text: 'hello there friend' },
      { id: 'cue-2', startUs: 3_000_000, endUs: 7_000_000, text: 'second cue text' },
    ])
    expectCode(() => toAudioRelativeSegments(window, [{ id: 'outside', startUs: 0, endUs: 1_000_000, text: 'x' }]), 'INVALID_INPUT')
  })

  it('maps aligned word offsets back to source time on success', () => {
    const relative = toAudioRelativeSegments(window, requestSegments)
    const raw = {
      engine: capabilities.engine.id, model: capabilities.model.id, language: 'en',
      segments: [
        { id: 'cue-1', words: [{ startUs: 0, endUs: 500_000, text: 'hello' }, { startUs: 500_000, endUs: 1_000_000, text: 'there' }, { startUs: 1_000_000, endUs: 1_500_000, text: 'friend' }] },
        { id: 'cue-2', words: [{ startUs: 3_000_000, endUs: 3_500_000, text: 'second' }] },
      ],
    }
    const result = validateAlignmentOutput(window, capabilities, requestSegments, relative, raw)
    expect(result.segments[0].words[0]).toEqual({ startUs: window.sourceStartUs, endUs: window.sourceStartUs + 500_000, text: 'hello', timingSource: 'aligned' })
    expect(result.segments[1].words[0].startUs).toBe(window.sourceStartUs + 3_000_000)
  })

  it('rejects when capabilities declare no aligner', () => {
    const relative = toAudioRelativeSegments(window, requestSegments)
    const raw = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'en', segments: [] }
    expectCode(() => validateAlignmentOutput(window, { ...capabilities, alignment: null }, requestSegments, relative, raw), 'UNSUPPORTED_OPTION')
  })

  it('rejects a missing, duplicate or unknown segment id', () => {
    const relative = toAudioRelativeSegments(window, requestSegments)
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'en' }
    expectCode(() => validateAlignmentOutput(window, capabilities, requestSegments, relative, { ...base, segments: [{ id: 'cue-1', words: [] }] }), 'MALFORMED_OUTPUT')
    expectCode(() => validateAlignmentOutput(window, capabilities, requestSegments, relative, { ...base, segments: [{ id: 'cue-1', words: [] }, { id: 'cue-1', words: [] }, { id: 'cue-2', words: [] }] }), 'MALFORMED_OUTPUT')
    expectCode(() => validateAlignmentOutput(window, capabilities, requestSegments, relative, { ...base, segments: [{ id: 'cue-1', words: [] }, { id: 'cue-2', words: [] }, { id: 'unknown', words: [] }] }), 'MALFORMED_OUTPUT')
  })

  it('rejects a word that is not found, in order, inside the original text', () => {
    const relative = toAudioRelativeSegments(window, requestSegments)
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'en' }
    // "friend" appears in the text, but out of order relative to a search that already
    // consumed past it, so the aligner cannot claim to have "rewound" into earlier text.
    expectCode(() => validateAlignmentOutput(window, capabilities, requestSegments, relative, {
      ...base, segments: [
        { id: 'cue-1', words: [{ startUs: 1_000_000, endUs: 1_500_000, text: 'friend' }, { startUs: 0, endUs: 500_000, text: 'hello' }] },
        { id: 'cue-2', words: [] },
      ],
    }), 'MALFORMED_OUTPUT')
    expectCode(() => validateAlignmentOutput(window, capabilities, requestSegments, relative, {
      ...base, segments: [{ id: 'cue-1', words: [{ startUs: 0, endUs: 500_000, text: 'invented-word' }] }, { id: 'cue-2', words: [] }],
    }), 'MALFORMED_OUTPUT')
  })

  it('rejects a word outside its segment bounds', () => {
    const relative = toAudioRelativeSegments(window, requestSegments)
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'en' }
    expectCode(() => validateAlignmentOutput(window, capabilities, requestSegments, relative, {
      ...base, segments: [{ id: 'cue-1', words: [{ startUs: 0, endUs: 5_000_000, text: 'hello' }] }, { id: 'cue-2', words: [] }],
    }), 'MALFORMED_OUTPUT')
  })

  it('rejects an output language not declared for alignment', () => {
    const relative = toAudioRelativeSegments(window, requestSegments)
    const base = { engine: capabilities.engine.id, model: capabilities.model.id, segments: [{ id: 'cue-1', words: [] }, { id: 'cue-2', words: [] }] }
    expectCode(() => validateAlignmentOutput(window, capabilities, requestSegments, relative, { ...base, language: 'ml' }), 'MALFORMED_OUTPUT')
  })
})

it.each([['React', 'act'], ['കി', 'ക']])('rejects partial-word or partial-grapheme output for %s', (text, wordText) => {
  const window = { sourceStartUs: 0, durationUs: 1_000_000 }
  const word = { text: wordText, startUs: 0, endUs: 100_000 }
  const base = { engine: capabilities.engine.id, model: capabilities.model.id, language: 'en' }
  expectCode(() => validateTranscriptionOutput(window, capabilities, { ...options, language: 'en' }, {
    ...base, segments: [{ text, startUs: 0, endUs: 1_000_000, words: [word] }],
  }), 'MALFORMED_OUTPUT')
  const request = [{ id: 'c', text, startUs: 0, endUs: 1_000_000 }]
  expectCode(() => validateAlignmentOutput(window, capabilities, request, request, {
    ...base, segments: [{ id: 'c', words: [word] }],
  }), 'MALFORMED_OUTPUT')
})
