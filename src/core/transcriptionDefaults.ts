import { z } from 'zod'
import { cloudModelIdSchema, FALLBACK_TRANSCRIPTION_DEFAULTS, transcriptionProviderIdSchema, type TranscriptionDefaults } from './transcriptionProviders'

export const TRANSCRIPTION_DEFAULTS_STORAGE_KEY = 'caption-studio.transcription-defaults'
const LEGACY_ENGINE_KEY = 'caption-studio.transcription-engine'

const defaultsSchema = z.object({
  provider: transcriptionProviderIdSchema,
  models: z.partialRecord(transcriptionProviderIdSchema, cloudModelIdSchema).default({}),
})

/** Validated read; anything missing or invalid falls back to local whisper.cpp. The legacy last-used engine seeds the first read. */
export function loadTranscriptionDefaults(): TranscriptionDefaults {
  try {
    const raw = localStorage.getItem(TRANSCRIPTION_DEFAULTS_STORAGE_KEY)
    if (raw) {
      const parsed = defaultsSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
    } else if (localStorage.getItem(LEGACY_ENGINE_KEY) === 'gemini') {
      return { provider: 'gemini', models: {} }
    }
  } catch { /* storage can be unavailable; the fallback is always valid */ }
  return FALLBACK_TRANSCRIPTION_DEFAULTS
}

export function saveTranscriptionDefaults(value: TranscriptionDefaults): void {
  try { localStorage.setItem(TRANSCRIPTION_DEFAULTS_STORAGE_KEY, JSON.stringify(value)) } catch { /* a convenience only */ }
}
