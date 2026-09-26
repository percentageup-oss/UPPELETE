import { z } from 'zod'

/** Transcription provider catalog. Pure data shared by Settings, the Transcribe dialog and the IPC schemas. */

export const cloudProviderIdSchema = z.enum(['gemini', 'openai', 'elevenlabs'])
export type CloudProviderId = z.infer<typeof cloudProviderIdSchema>
export const transcriptionProviderIdSchema = z.enum(['whisper', 'gemini', 'openai', 'elevenlabs'])
export type TranscriptionProviderId = z.infer<typeof transcriptionProviderIdSchema>

/** Spoken languages a cloud provider can be pinned to (ISO 639-1); `auto` (detect) is separate. */
export const CLOUD_LANGUAGE_CODES = ['ml', 'en', 'ta', 'hi'] as const
export type CloudSpokenLanguage = (typeof CLOUD_LANGUAGE_CODES)[number]
export type CloudLanguageChoice = 'auto' | CloudSpokenLanguage

/** Model IDs are sent to the provider verbatim, so they are restricted to a conservative character set. */
export const cloudModelIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/, 'Enter a valid model ID.')

export type CloudModelEntry = { id: string; label: string; note: string }
export type CloudProviderEntry = {
  id: CloudProviderId
  label: string
  envVar: string
  keyHelpUrl: string
  /** What leaves the computer and where it goes. Shown in the Transcribe dialog before any upload. */
  disclosure: string
  /** Every curated model returns word timestamps; a model without them cannot produce honestly timed captions. */
  models: CloudModelEntry[]
  defaultModel: string
}

export const CLOUD_PROVIDERS: readonly CloudProviderEntry[] = [
  {
    id: 'gemini', label: 'Gemini', envVar: 'GEMINI_API_KEY', keyHelpUrl: 'https://aistudio.google.com/apikey',
    disclosure: 'Long silences are detected on this computer and never uploaded; each speech section is uploaded to Google, transcribed with word timestamps and response storage disabled, then deleted (best-effort). Provider charges may apply.',
    models: [{ id: 'gemini-3.5-transcribe', label: 'Gemini 3.5 Transcribe', note: 'Dedicated speech model; detects language and code-switching.' }],
    defaultModel: 'gemini-3.5-transcribe',
  },
  {
    id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', keyHelpUrl: 'https://platform.openai.com/api-keys',
    disclosure: "Long silences are detected on this computer and never uploaded; each speech section is uploaded to OpenAI for transcription with word timestamps. OpenAI's retention policy for API audio applies. Provider charges may apply.",
    models: [{ id: 'whisper-1', label: 'Whisper (whisper-1)', note: 'Returns word timestamps. Malayalam accuracy is limited; expect a review pass.' }],
    defaultModel: 'whisper-1',
  },
  {
    id: 'elevenlabs', label: 'ElevenLabs Scribe', envVar: 'ELEVENLABS_API_KEY', keyHelpUrl: 'https://elevenlabs.io/app/settings/api-keys',
    disclosure: 'Long silences are detected on this computer and never uploaded; each speech section is uploaded to ElevenLabs for transcription with word timestamps. Provider charges may apply.',
    models: [
      { id: 'scribe_v2', label: 'Scribe v2', note: 'Current Scribe model; word timestamps and wide language coverage.' },
      { id: 'scribe_v1', label: 'Scribe v1', note: 'Previous Scribe model; word timestamps.' },
    ],
    defaultModel: 'scribe_v2',
  },
]

export function cloudProvider(id: CloudProviderId): CloudProviderEntry {
  return CLOUD_PROVIDERS.find((entry) => entry.id === id)!
}

export function providerLabel(id: TranscriptionProviderId): string {
  return id === 'whisper' ? 'whisper.cpp (this computer)' : cloudProvider(id).label
}

export type ProviderKeyStatus = { configured: boolean; source: 'environment' | 'keychain' }
export type ProviderKeyStatuses = Record<CloudProviderId, ProviderKeyStatus>

/** The default provider and per-provider model chosen in Settings. First run: local whisper.cpp. */
export type TranscriptionDefaults = { provider: TranscriptionProviderId; models: Partial<Record<TranscriptionProviderId, string>> }
export const FALLBACK_TRANSCRIPTION_DEFAULTS: TranscriptionDefaults = { provider: 'whisper', models: {} }
