import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TranscriptionPanel } from './TranscriptionPanel'

beforeEach(() => vi.stubGlobal('window', {}))
afterEach(() => vi.unstubAllGlobals())
const render = (geminiKeyConfigured: boolean) => renderToStaticMarkup(<TranscriptionPanel media={null} mediaReady cues={[]} onApply={() => ({ ok: true })} primary providerKeys={{ gemini: { configured: geminiKeyConfigured, source: 'keychain' }, openai: { configured: false, source: 'keychain' }, elevenlabs: { configured: false, source: 'keychain' } }} />)
const stubStorage = (values: Record<string, string>) => vi.stubGlobal('localStorage', { getItem: (key: string) => values[key] ?? null, setItem: () => {} })

it('defaults to local whisper.cpp and states that audio stays on the device', () => {
  const html = render(false)
  expect(html).toContain('Audio never leaves the device')
  expect(html).not.toContain('uploaded to Google')
  expect(html).toMatch(/<button class="accent"/)
})

it('discloses uploads for Gemini, hides local model controls, and asks for a missing key', () => {
  vi.stubGlobal('localStorage', { getItem: () => 'gemini', setItem: () => {} })
  const missing = render(false)
  expect(missing).toContain('uploaded to Google')
  expect(missing).not.toContain('Audio never leaves the device')
  expect(missing).not.toContain('id="transcription-model"')
  expect(missing).toContain('Add Gemini API key')
  expect(missing).toMatch(/<button class="accent" disabled="">Transcribe with Gemini/)
  const ready = render(true)
  expect(ready).not.toContain('Add Gemini API key')
  expect(ready).toContain('Automatic — mixed languages (recommended)')
})

it('offers a Translate to dropdown for the Gemini engine, defaulting to "None"', () => {
  stubStorage({ 'caption-studio.transcription-engine': 'gemini' })
  const html = render(true)
  expect(html).toContain('id="transcription-translate-gemini"')
  expect(html).toContain('None — keep spoken language')
  expect(html).toMatch(/<button class="accent"[^>]*>Transcribe with Gemini/)
})

it('requires the Gemini key for a stored translate target even on the whisper engine, and switches the Start label', () => {
  stubStorage({ 'caption-studio.transcription-engine': 'whisper', 'caption-studio.transcription-translate': 'en' })
  const missing = render(false)
  expect(missing).toContain('Translating captions needs your Gemini API key')
  expect(missing).toMatch(/<button class="accent" disabled="">Transcribe and translate/)
  const ready = render(true)
  expect(ready).not.toContain('Add Gemini API key')
  expect(ready).toMatch(/Transcribe and translate/)
})

it('switches the Start label to "Transcribe and translate" for a stored Gemini-engine target, and discloses text-only translation', () => {
  stubStorage({ 'caption-studio.transcription-engine': 'gemini', 'caption-studio.transcription-translate': 'ml' })
  const html = render(true)
  expect(html).toContain('id="transcription-translate-gemini"')
  expect(html).toContain('sends only the recognized caption text (never audio) to Gemini')
  expect(html).toMatch(/<button class="accent"[^>]*>Transcribe and translate/)
})
