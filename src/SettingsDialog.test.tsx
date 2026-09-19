import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GeminiKeySettings, SettingsDialog } from './SettingsDialog'

it('renders only the selected settings tab', () => {
  const html = renderToStaticMarkup(<SettingsDialog tab="shortcuts" onTab={() => {}} onClose={() => {}} geminiKey={null} onGeminiKey={() => {}} onMessage={() => {}} />)
  expect(html).toMatch(/id="settings-tab-shortcuts"[^>]*aria-selected="true"/)
  expect(html).toMatch(/id="settings-tab-models"[^>]*aria-selected="false"/)
  expect(html).toContain('⌘/Ctrl+S')
  expect(html).not.toContain('Gemini API key</h3>')
})

it('describes both Gemini uses and never offers removal of an environment key', () => {
  const html = renderToStaticMarkup(<GeminiKeySettings status={{ configured: true, source: 'environment' }} onStatus={() => {}} onMessage={() => {}} />)
  expect(html).toContain('Transcribe with Gemini')
  expect(html).toContain('Align audio')
  expect(html).toContain('GEMINI_API_KEY')
  expect(html).not.toContain('Remove key')
})
