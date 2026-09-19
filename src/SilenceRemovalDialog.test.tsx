import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SilenceRemovalDialog } from './SilenceRemovalDialog'

const noopDetect = () => Promise.resolve({ durationUs: 0, silences: [] })

it('asks for media before offering the detection controls', () => {
  const html = renderToStaticMarkup(<SilenceRemovalDialog open mediaReady={false} onClose={() => {}}
    onDetect={noopDetect} onCancelDetect={() => {}} onApply={() => {}} hasExistingCuts={false} />)
  expect(html).toContain('Open or relink the video before detecting silence.')
  expect(html).not.toContain('Silence threshold')
})

it('renders the threshold, minimum-silence and padding controls with a disabled Apply before detecting', () => {
  const html = renderToStaticMarkup(<SilenceRemovalDialog open mediaReady onClose={() => {}}
    onDetect={noopDetect} onCancelDetect={() => {}} onApply={() => {}} hasExistingCuts={false} />)
  expect(html).toContain('Silence threshold')
  expect(html).toContain('Minimum silence')
  expect(html).toContain('Padding')
  expect(html).toMatch(/Detect<\/button>/)
  expect(html).toMatch(/<button class="accent" disabled="">Apply<\/button>/)
  expect(html).not.toContain('replaces the project')
})

it('warns that applying replaces existing cuts', () => {
  const html = renderToStaticMarkup(<SilenceRemovalDialog open mediaReady onClose={() => {}}
    onDetect={noopDetect} onCancelDetect={() => {}} onApply={() => {}} hasExistingCuts />)
  expect(html).toContain('replaces the project')
})
