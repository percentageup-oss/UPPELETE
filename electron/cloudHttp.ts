import { openAsBlob } from 'node:fs'
import path from 'node:path'
import { jobFailure } from '../src/core/jobs'
import type { RecognizedWord } from '../src/core/alignment'
import type { CloudSpokenLanguage } from '../src/core/transcriptionProviders'

/** Shared plumbing for REST speech-to-text providers that return word timestamps in seconds. */

export function secondsToUs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  const result = Math.round(value * 1_000_000)
  return Number.isSafeInteger(result) ? result : null
}

/** Maps a provider language name or code to a language this app can record; anything else is unknown (null). */
export function recordedLanguage(value: unknown): CloudSpokenLanguage | null {
  if (typeof value !== 'string') return null
  const language = value.trim().toLowerCase()
  if (language === 'ml' || language === 'mal' || language === 'malayalam') return 'ml'
  if (language === 'en' || language === 'eng' || language === 'english') return 'en'
  if (language === 'ta' || language === 'tam' || language === 'tamil') return 'ta'
  if (language === 'hi' || language === 'hin' || language === 'hindi') return 'hi'
  return null
}

/** Timed words with an invalid or non-positive span are counted, never silently dropped. Output is sorted by start. */
export function collectWords(entries: readonly { text: unknown; start: unknown; end: unknown }[]): { words: RecognizedWord[]; droppedAnnotations: number } {
  const words: RecognizedWord[] = []
  let droppedAnnotations = 0
  for (const entry of entries) {
    const startUs = secondsToUs(entry.start), endUs = secondsToUs(entry.end)
    if (typeof entry.text === 'string' && entry.text.trim() && startUs !== null && endUs !== null && endUs > startUs) words.push({ text: entry.text, startUs, endUs })
    else droppedAnnotations += 1
  }
  words.sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
  return { words, droppedAnnotations }
}

/** Multipart POST of one WAV. Never puts the key in a message or diagnostic; maps HTTP failures to structured job errors. */
export async function postAudio(options: {
  provider: string
  url: string
  headers: Record<string, string>
  audioPath: string
  fields: Record<string, string>
  signal: AbortSignal
  action?: 'transcribe'
}): Promise<unknown> {
  const { provider, url, headers, audioPath, fields, signal } = options
  try {
    const form = new FormData()
    for (const [name, value] of Object.entries(fields)) form.append(name, value)
    form.append('file', await openAsBlob(audioPath, { type: 'audio/wav' }), path.basename(audioPath))
    const response = await fetch(url, { method: 'POST', headers, body: form, signal })
    const text = await response.text()
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${text.slice(0, 2048)}`), { status: response.status })
    return JSON.parse(text) as unknown
  } catch (error) {
    if (signal.aborted) throw jobFailure('CANCELLED', 'Transcription was cancelled.')
    const status = (error as { status?: number }).status
    const diagnostic = error instanceof Error ? error.message : String(error)
    const message = status === 401 || status === 403 ? `${provider} rejected the API key. Check it in Settings → Transcription, then try again.`
      : status === 413 ? `${provider} rejected the audio as too large.`
        : status === 429 ? `${provider} rate limit or quota reached. Wait and try again, or check your plan.`
          : `${provider} could not transcribe this audio. Check the API key and connection, then try again.`
    throw jobFailure('BACKEND_FAILED', message, { diagnostic: diagnostic.slice(0, 8192), retryable: status === undefined || status === 429 || status >= 500 })
  }
}
