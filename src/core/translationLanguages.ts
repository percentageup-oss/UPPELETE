import type { LanguageCode } from './transcription'

/**
 * Curated translation targets offered in the Transcribe dialog's "Translate to" dropdown.
 * Every code is a plain ISO 639-1 code (never a locale tag), so it satisfies
 * `languageCodeSchema` and, where the script check declares one, `EXPECTED_SCRIPT`.
 */
export const TRANSLATION_TARGETS: { code: LanguageCode; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'kn', label: 'Kannada' },
  { code: 'te', label: 'Telugu' },
  { code: 'ar', label: 'Arabic' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
]

export function translationTargetLabel(code: string): string {
  return TRANSLATION_TARGETS.find((entry) => entry.code === code)?.label ?? code
}
