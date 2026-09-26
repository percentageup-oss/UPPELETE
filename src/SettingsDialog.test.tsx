import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentSettings, PlaybackProxySettings, ProviderKeySettings, SettingsDialog } from './SettingsDialog'

it('renders only the selected settings tab', () => {
  const html = renderToStaticMarkup(<SettingsDialog tab="shortcuts" onTab={() => {}} onClose={() => {}} providerKeys={null} onProviderKeys={() => {}} transcriptionDefaults={{ provider: 'whisper', models: {} }} onTranscriptionDefaults={() => {}}
    playbackProxyMode="auto" onPlaybackProxyMode={() => {}} onMessage={() => {}} />)
  expect(html).toMatch(/id="settings-tab-shortcuts"[^>]*aria-selected="true"/)
  expect(html).toMatch(/id="settings-tab-models"[^>]*aria-selected="false"/)
  expect(html).toContain('⌘/Ctrl+S')
  expect(html).not.toContain('Gemini API key</h3>')
})

it('lists the AI agents tab alongside the others', () => {
  const html = renderToStaticMarkup(<SettingsDialog tab="agent" onTab={() => {}} onClose={() => {}} providerKeys={null} onProviderKeys={() => {}} transcriptionDefaults={{ provider: 'whisper', models: {} }} onTranscriptionDefaults={() => {}}
    playbackProxyMode="auto" onPlaybackProxyMode={() => {}} onMessage={() => {}} />)
  expect(html).toMatch(/id="settings-tab-agent"[^>]*aria-selected="true"/)
  expect(html).toContain('AI agents')
  expect(html).toContain('Allow agent access')
})

it('lists the Playback tab and marks the current mode selected', () => {
  const html = renderToStaticMarkup(<SettingsDialog tab="playback" onTab={() => {}} onClose={() => {}} providerKeys={null} onProviderKeys={() => {}} transcriptionDefaults={{ provider: 'whisper', models: {} }} onTranscriptionDefaults={() => {}}
    playbackProxyMode="always" onPlaybackProxyMode={() => {}} onMessage={() => {}} />)
  expect(html).toMatch(/id="settings-tab-playback"[^>]*aria-selected="true"/)
  expect(html).toContain('Playback proxies')
})

it('PlaybackProxySettings checks only the radio matching the current mode (Off, Auto, Always in order)', () => {
  const html = renderToStaticMarkup(<PlaybackProxySettings mode="always" onMode={() => {}} />)
  const checkedCount = (html.match(/checked=""/g) ?? []).length
  expect(checkedCount).toBe(1)
  const labels = html.split('<label').slice(1)
  expect(labels.map((label) => label.includes('checked=""'))).toEqual([false, false, true])
  expect(html).toContain('Off')
  expect(html).toContain('Auto (recommended)')
  expect(html).toContain('Always')
})

it('AgentSettings shows the disabled state with no window.captionStudio bridge (SSR/no-Electron)', () => {
  const html = renderToStaticMarkup(<AgentSettings onMessage={() => {}} />)
  expect(html).toContain('Allow agent access')
  expect(html).not.toContain('Listening on')
  expect(html).not.toContain('Connect from Claude Code')
})

it('describes both Gemini uses and never offers removal of an environment key', () => {
  const html = renderToStaticMarkup(<ProviderKeySettings provider="gemini" status={{ configured: true, source: 'environment' }} onStatuses={() => {}} onMessage={() => {}} />)
  expect(html).toContain('Transcribe with Gemini')
  expect(html).toContain('Align audio')
  expect(html).toContain('GEMINI_API_KEY')
  expect(html).not.toContain('Remove key')
})
