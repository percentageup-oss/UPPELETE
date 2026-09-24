import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SequenceSettingsDialog } from './SequenceSettingsDialog'

const uhd = { width: 3840, height: 2160, frameRate: { numerator: 30, denominator: 1 } }
const render = (format = uhd as typeof uhd | null) => renderToStaticMarkup(<SequenceSettingsDialog open format={format} onClose={() => {}} onApply={() => {}} />)

it('shows the current sequence frame and offers resolution/frame rate sliders', () => {
  const html = render()
  for (const label of ['Resolution', 'Frame rate']) expect(html).toContain(`aria-label="${label}"`)
  expect(html).toContain('3840 × 2160')
  expect(html).toContain('Currently 3840 × 2160')
  expect(html).toContain('30 fps')
})
it('disables Apply until a stop actually changes the frame', () => {
  expect(render()).toMatch(/class="accent"[^>]*disabled/)
})
it('explains itself even before any video has set a format', () => {
  const html = render(null)
  expect(html).not.toContain('Currently')
  expect(html).toMatch(/class="accent"[^>]*disabled/)
})
