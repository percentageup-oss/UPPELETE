import type { LanguageCode, TranslationTarget } from './transcription'

/**
 * Whisper's `-l` flag only selects a language token; it does not force the model to write in that
 * language's script. Small multilingual models (base/small) were observed writing fluent Tamil
 * script for Malayalam speech while still reporting `"language": "ml"` — plausible-looking but
 * wrong text that must never reach a project silently. Even large-v3 was observed doing this on
 * real, English-code-switched Malayalam speech (writing Gurmukhi for Malayalam). This module is a
 * cheap, deterministic sanity check on the script actually used, run once over a whole transcript
 * before any mutation.
 *
 * Not a language identifier: it only flags text dominated by a *wrong* non-Latin script. Text
 * dominated by Latin letters always passes — real recordings mix Malayalam with English terms,
 * borrowings, acronyms and, for lower-resource languages, Whisper often writes the whole spoken
 * sentence phonetically in English letters rather than the native script. That is a readability
 * trade-off for the user to judge, not a wrong-script mismatch this check exists to catch. It only
 * fails a transcript where a non-Latin script *other than* the one expected for the language
 * dominates. It never runs for languages without a single unambiguous script (declared here).
 */

/** Languages with one unambiguous native script, mapped to the Unicode script name used in `\p{Script=…}`. */
export const EXPECTED_SCRIPT: Partial<Record<LanguageCode, string>> = {
  ml: 'Malayalam',
  ta: 'Tamil',
  kn: 'Kannada',
  te: 'Telugu',
  hi: 'Devanagari',
  mr: 'Devanagari',
  ne: 'Devanagari',
  sa: 'Devanagari',
  bn: 'Bengali',
  as: 'Bengali',
  gu: 'Gujarati',
  pa: 'Gurmukhi',
  si: 'Sinhala',
  my: 'Myanmar',
  km: 'Khmer',
  lo: 'Lao',
  th: 'Thai',
  ka: 'Georgian',
  hy: 'Armenian',
  am: 'Ethiopic',
  ar: 'Arabic',
  fa: 'Arabic',
  ur: 'Arabic',
  ps: 'Arabic',
  he: 'Hebrew',
  yi: 'Hebrew',
  el: 'Greek',
  ru: 'Cyrillic',
  uk: 'Cyrillic',
  bg: 'Cyrillic',
  mn: 'Cyrillic',
  ja: 'Han',
  zh: 'Han',
  yue: 'Han',
  ko: 'Hangul',
}

const NON_LATIN_SCRIPTS = ['Malayalam', 'Tamil', 'Kannada', 'Telugu', 'Devanagari', 'Bengali', 'Gujarati', 'Gurmukhi', 'Sinhala',
  'Myanmar', 'Khmer', 'Lao', 'Thai', 'Georgian', 'Armenian', 'Ethiopic', 'Arabic', 'Hebrew', 'Greek', 'Cyrillic', 'Han', 'Hangul']

/** Below this many letters, a script judgment (Latin-dominant or wrong-script) cannot be distinguished from noise (numerals, punctuation, short clips). */
const MIN_SCRIPT_LETTERS = 20
/** Minimum share of letters that must fall in one script for that script to be treated as decisively dominant. Reused for both the Latin-dominance and the expected-script checks. */
const MIN_DOMINANT_SHARE = 0.8
/** Kept in an error diagnostic to show what was actually recognized, never used for matching. */
const SAMPLE_LENGTH = 200

export type ScriptCheckResult =
  | { ok: true }
  | { ok: false; expectedScript: string; dominantScript: string; dominantShare: number; sample: string }

/** Counts letters by script, `'Latin'` included, ignoring non-letter characters entirely. */
function scriptCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const char of text) {
    if (!/\p{L}/u.test(char)) continue
    if (/\p{Script=Latin}/u.test(char)) { counts.set('Latin', (counts.get('Latin') ?? 0) + 1); continue }
    for (const script of NON_LATIN_SCRIPTS) {
      if (new RegExp(`\\p{Script=${script}}`, 'u').test(char)) { counts.set(script, (counts.get(script) ?? 0) + 1); break }
    }
  }
  return counts
}

/**
 * Transliteration targets expect Latin letters. The failure mode is the model returning the native script
 * unchanged, so fail when the source language's own script dominates.
 */
function checkRomanizedScript(target: 'hi-latn' | 'ml-latn', texts: readonly string[]): ScriptCheckResult {
  const nativeScript = target === 'hi-latn' ? 'Devanagari' : 'Malayalam'
  const joined = texts.join(' ')
  const counts = scriptCounts(joined)
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
  if (total < MIN_SCRIPT_LETTERS) return { ok: true }
  const nativeShare = (counts.get(nativeScript) ?? 0) / total
  if (nativeShare < MIN_DOMINANT_SHARE) return { ok: true }
  return { ok: false, expectedScript: 'Latin', dominantScript: nativeScript, dominantShare: nativeShare, sample: joined.slice(0, SAMPLE_LENGTH) }
}

/**
 * Checks recognized text against the script expected for `language`. Passes languages with no
 * declared script, passes whenever there are too few letters to judge reliably, and passes
 * whenever Latin letters dominate the whole transcript (English terms, or Whisper writing the
 * spoken language phonetically in English). Otherwise, judges the non-Latin remainder: passes if
 * the expected script dominates it, fails if a different non-Latin script does.
 */
export function checkTranscriptScript(language: TranslationTarget, texts: readonly string[]): ScriptCheckResult {
  if (language === 'hi-latn' || language === 'ml-latn') return checkRomanizedScript(language, texts)
  const expectedScript = EXPECTED_SCRIPT[language]
  if (!expectedScript) return { ok: true }

  const joined = texts.join(' ')
  const counts = scriptCounts(joined)
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
  if (total < MIN_SCRIPT_LETTERS) return { ok: true }

  const latinShare = (counts.get('Latin') ?? 0) / total
  if (latinShare >= MIN_DOMINANT_SHARE) return { ok: true }

  const nonLatinTotal = total - (counts.get('Latin') ?? 0)
  if (nonLatinTotal < MIN_SCRIPT_LETTERS) return { ok: true }

  const expectedShare = (counts.get(expectedScript) ?? 0) / nonLatinTotal
  if (expectedShare >= MIN_DOMINANT_SHARE) return { ok: true }

  const [dominantScript, dominantCount] = [...counts.entries()].filter(([script]) => script !== 'Latin')
    .reduce((best, entry) => (entry[1] > best[1] ? entry : best))
  return { ok: false, expectedScript, dominantScript, dominantShare: dominantCount / nonLatinTotal, sample: joined.slice(0, SAMPLE_LENGTH) }
}
