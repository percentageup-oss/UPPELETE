import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentSettings, GeminiKeySettings, SettingsDialog } from './SettingsDialog'

it('renders only the selected settings tab', () => {
  const html = renderToStaticMarkup(<SettingsDialog tab="shortcuts" onTab={() => {}} onClose={() => {}} geminiKey={null} onGeminiKey={() => {}} onMessage={() => {}} />)
  expect(html).toMatch(/id="settings-tab-shortcuts"[^>]*aria-selected="true"/)
  expect(html).toMatch(/id="settings-tab-models"[^>]*aria-selected="false"/)
  expect(html).toContain('⌘/Ctrl+S')
  expect(html).not.toContain('Gemini API key</h3>')
})

it('lists the AI agents tab alongside the others', () => {
  const html = renderToStaticMarkup(<SettingsDialog tab="agent" onTab={() => {}} onClose={() => {}} geminiKey={null} onGeminiKey={() => {}} onMessage={() => {}} />)
  expect(html).toMatch(/id="settings-tab-agent"[^>]*aria-selected="true"/)
  expect(html).toContain('AI agents')
  expect(html).toContain('Allow agent access')
})

it('AgentSettings shows the disabled state with no window.captionStudio bridge (SSR/no-Electron)', () => {
  const html = renderToStaticMarkup(<AgentSettings onMessage={() => {}} />)
  expect(html).toContain('Allow agent access')
  expect(html).not.toContain('Listening on')
  expect(html).not.toContain('Connect from Claude Code')
})

it('describes both Gemini uses and never offers removal of an environment key', () => {
  const html = renderToStaticMarkup(<GeminiKeySettings status={{ configured: true, source: 'environment' }} onStatus={() => {}} onMessage={() => {}} />)
  expect(html).toContain('Transcribe with Gemini')
  expect(html).toContain('Align audio')
  expect(html).toContain('GEMINI_API_KEY')
  expect(html).not.toContain('Remove key')
})
