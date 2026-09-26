import { expect, it } from 'vitest'
import { geminiTranscriptionRunSchema, transcriptionRunSchema, whisperTranscriptionRunSchema } from './model'
import { transcriptionStartRequestSchema } from './transcriptionIpc'

const fingerprint = { algorithm: 'sha256-sampled-v1', value: 'a'.repeat(64), sizeBytes: 10, sampledBytes: 10 }
const requestId = '6f1c1d9e-8a3b-4c2d-9e7f-1a2b3c4d5e6f'

it('accepts whisper and Gemini start requests and never a key, path or device for Gemini', () => {
  expect(transcriptionStartRequestSchema.parse({ engine: 'whisper', requestId, fingerprint, modelId: 'whisper-base', language: 'auto', device: 'cpu', translateTo: [] }).engine).toBe('whisper')
  expect(transcriptionStartRequestSchema.parse({ engine: 'gemini', requestId, fingerprint, language: 'ml', translateTo: [] }).engine).toBe('gemini')
  expect(transcriptionStartRequestSchema.safeParse({ engine: 'gemini', requestId, fingerprint, language: 'ml', translateTo: [], apiKey: 'x' }).success).toBe(false)
  expect(transcriptionStartRequestSchema.safeParse({ engine: 'gemini', requestId, fingerprint, language: 'ml', translateTo: [], device: 'cpu' }).success).toBe(false)
  expect(transcriptionStartRequestSchema.safeParse({ engine: 'gemini', requestId, fingerprint, language: 'ta', translateTo: [] }).success).toBe(false)
  expect(transcriptionStartRequestSchema.safeParse({ requestId, fingerprint, modelId: 'whisper-base', language: 'auto', device: 'cpu', translateTo: [] }).success).toBe(false)
})

it('requires translateTo and accepts a target language code for either engine, but never a locale tag or "auto"', () => {
  expect(transcriptionStartRequestSchema.safeParse({ engine: 'whisper', requestId, fingerprint, modelId: 'whisper-base', language: 'auto', device: 'cpu' }).success).toBe(false)
  expect(transcriptionStartRequestSchema.safeParse({ engine: 'gemini', requestId, fingerprint, language: 'ml' }).success).toBe(false)
  expect(transcriptionStartRequestSchema.parse({ engine: 'whisper', requestId, fingerprint, modelId: 'whisper-base', language: 'auto', device: 'cpu', translateTo: ['en'] }).translateTo).toEqual(['en'])
  expect(transcriptionStartRequestSchema.parse({ engine: 'gemini', requestId, fingerprint, language: 'ml', translateTo: ['en'] }).translateTo).toEqual(['en'])
  expect(transcriptionStartRequestSchema.safeParse({ engine: 'whisper', requestId, fingerprint, modelId: 'whisper-base', language: 'auto', device: 'cpu', translateTo: ['auto'] }).success).toBe(false)
  expect(transcriptionStartRequestSchema.safeParse({ engine: 'whisper', requestId, fingerprint, modelId: 'whisper-base', language: 'auto', device: 'cpu', translateTo: ['en-US'] }).success).toBe(false)
})

it('keeps existing whisper run records valid and accepts Gemini run records, with or without translation provenance', () => {
  const sourceRange = { startUs: 0, endUs: 1_000_000 }
  const whisper = { id: 'w', createdAt: '2026-09-15', engine: { id: 'whisper.cpp', version: '1.9.4' }, model: { id: 'whisper-base', fileName: 'ggml-base.bin', sha256: 'b'.repeat(64) },
    requestedLanguage: 'auto', language: 'ml', requestedDevice: 'metal', backends: ['MTL0'], sourceRange, audioExtraction: 'v1', speechGating: 'g1',
    chunkCount: 1, silenceCount: 0, segmentCount: 1, adjustedSegmentCount: 0, droppedSegments: { empty: 0, outsideChunk: 0, zeroDuration: 0 } }
  const gemini = { id: 'g', createdAt: '2026-09-17', provider: 'gemini', engine: { id: 'gemini-api', version: 'v1beta' }, model: { id: 'gemini-3.5-transcribe' },
    requestedLanguage: 'auto', language: 'ml', sourceRange, audioExtraction: 'v1', speechGating: 'g1', chunkCount: 1, silenceCount: 0, segmentCount: 1,
    adjustedSegmentCount: 0, wordCount: 3, droppedWordCount: 0, inputTokens: 5 }
  const translation = { provider: 'gemini', model: 'gemini-3.8-flash', targetLanguage: 'en', segmentCount: 1, inputTokens: 8, outputTokens: 4 }
  expect(whisperTranscriptionRunSchema.safeParse(whisper).success).toBe(true)
  expect(transcriptionRunSchema.safeParse(whisper).success).toBe(true)
  expect(geminiTranscriptionRunSchema.safeParse(gemini).success).toBe(true)
  expect(transcriptionRunSchema.safeParse(gemini).success).toBe(true)
  expect(transcriptionRunSchema.safeParse({ ...gemini, apiKey: 'secret' }).success).toBe(false)
  expect(whisperTranscriptionRunSchema.safeParse({ ...whisper, translation }).success).toBe(true)
  expect(geminiTranscriptionRunSchema.safeParse({ ...gemini, translation }).success).toBe(true)
  expect(whisperTranscriptionRunSchema.safeParse({ ...whisper, translation: { ...translation, provider: 'openai' } }).success).toBe(false)
})
