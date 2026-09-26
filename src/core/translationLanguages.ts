import type { TranslationTarget } from './transcription'

/**
 * Curated translation targets offered in the Transcribe dialog and the translate dialog. Plain codes are ISO 639-1
 * spoken languages (they satisfy `languageCodeSchema` and, where declared, `EXPECTED_SCRIPT`). `hi-latn` and
 * `ml-latn` are transliteration targets: the same language written in Latin letters with English words kept.
 */
export const TRANSLATION_TARGETS: { code: TranslationTarget; label: string; hint?: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'ml-latn', label: 'Manglish (Latin script)', hint: 'Malayalam in English letters, English words kept' },
  { code: 'hi', label: 'Hindi' },
  { code: 'hi-latn', label: 'Hinglish (Latin script)', hint: 'Hindi in English letters, English words kept' },
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

export function isRomanizedTarget(code: string): code is 'hi-latn' | 'ml-latn' {
  return code === 'hi-latn' || code === 'ml-latn'
}

export function romanizedBase(code: 'hi-latn' | 'ml-latn'): 'hi' | 'ml' {
  return code === 'hi-latn' ? 'hi' : 'ml'
}
