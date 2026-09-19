import { describe, expect, it } from 'vitest'
import { checkTranscriptScript } from './scriptCheck'

const malayalam = [
  'ഇന്ന് കാലാവസ്ഥ വളരെ നല്ലതാണ്.',
  'ഞാൻ രാവിലെ നടക്കാൻ പോയി, അതിനുശേഷം ഭക്ഷണം കഴിച്ചു.',
]
const malayalamWithEnglish = [
  'ഇന്ന് നമ്മൾ ഒരു React component ഉണ്ടാക്കാൻ പോകുന്നു.',
  'ആദ്യം npm install ചെയ്യണം, എന്നിട്ട് code എഴുതാം.',
]
const tamil = [
  'இன்று வானிலை மிகவும் நன்றாக உள்ளது.',
  'நான் காலையில் நடக்கச் சென்றேன், பிறகு உணவு சாப்பிட்டேன்.',
]
// Whisper transliterating Malayalam speech phonetically into English, the way it was observed doing on
// real English-code-switched Malayalam content, with one short wrong-script (Gurmukhi) segment mixed in.
const mostlyLatinWithGurmukhiTail = [
  'Hi, I am Sadiq and this is Tech News Today. Dario Amadei, our Anthropic CEO, has written a big write-up two days ago.',
  'If we say that the main purpose of the write-up is to improve AI, thank you for watching this video today.',
  'ਰੈਟੇ ਪੁਣ੍ਨ ਪ੍ਰਦਾਨ ਉਲ਼ਲਾਡਕਾ ਨੋ ਸ਼ੁਰੂ ਤੁਂ ਨੇਕ੍ਲੀ ਆ ਤੁਨੇ ਆ ਨੇ ਇਨੇ ਇਮ੍ਪ੍ਰੂਵ ਚੀਂਨ ਦੁ',
]
// The same wrong script, but dominating the transcript rather than a minor tail.
const mostlyGurmukhi = ['ਰੈਟੇ ਪੁਣ੍ਨ ਪ੍ਰਦਾਨ ਉਲ਼ਲਾਡਕਾ ਨੋ ਸ਼ੁਰੂ ਤੁਂ ਨੇਕ੍ਲੀ ਆ ਤੁਨੇ ਆ ਨੇ ਇਨੇ ਇਮ੍ਪ੍ਰੂਵ ਚੀਂਨ ਦੁ। Hi, I am Sadiq.']

describe('checkTranscriptScript', () => {
  it('passes pure Malayalam text for language ml', () => {
    expect(checkTranscriptScript('ml', malayalam)).toEqual({ ok: true })
  })

  it('passes Malayalam mixed with English technical terms for language ml', () => {
    expect(checkTranscriptScript('ml', malayalamWithEnglish)).toEqual({ ok: true })
  })

  it('fails Tamil text for language ml and names Tamil as the dominant script', () => {
    const result = checkTranscriptScript('ml', tamil)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.expectedScript).toBe('Malayalam')
      expect(result.dominantScript).toBe('Tamil')
      expect(result.dominantShare).toBeGreaterThan(0.9)
      expect(result.sample.length).toBeGreaterThan(0)
    }
  })

  it('passes when there are too few non-Latin letters to judge', () => {
    expect(checkTranscriptScript('ml', ['ഒ ok two three'])).toEqual({ ok: true })
  })

  it('passes a language with no declared expected script', () => {
    // 'en' has no single native non-Latin script declared, so any output passes this check.
    expect(checkTranscriptScript('en', tamil)).toEqual({ ok: true })
  })

  it('passes English-only output for language ml (no non-Latin letters to judge)', () => {
    expect(checkTranscriptScript('ml', ['This is a fully English sentence with no Malayalam at all.'])).toEqual({ ok: true })
  })

  it('passes a mostly-Latin transcript even with a wrong-script segment mixed in (Latin dominates overall)', () => {
    expect(checkTranscriptScript('ml', mostlyLatinWithGurmukhiTail)).toEqual({ ok: true })
  })

  it('still fails when the wrong script dominates overall, even with some English mixed in', () => {
    const result = checkTranscriptScript('ml', mostlyGurmukhi)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.expectedScript).toBe('Malayalam')
      expect(result.dominantScript).toBe('Gurmukhi')
      expect(result.dominantShare).toBeGreaterThan(0.9)
    }
  })
})
