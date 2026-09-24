import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExportDialog } from './ExportDialog'

const landscape = { width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 } }
const render = (source = landscape as typeof landscape | null, range: { startUs: number; endUs: number } | null = null) => renderToStaticMarkup(<ExportDialog open source={source} durationUs={60_000_000} range={range} onClose={() => {}} onExport={() => {}} />)

it('offers platform chips and resolution, frame rate and bitrate sliders', () => {
  const html = render()
  for (const label of ['YouTube 1080p', 'YouTube 4K', 'Instagram Reels / Stories', 'Instagram Feed']) expect(html).toContain(label)
  for (const label of ['Resolution', 'Frame rate', 'Bitrate (Mbps)']) expect(html).toContain(`aria-label="${label}"`)
  expect(html).toContain('1920 × 1080')
  expect(html).toContain('30 fps')
  expect(html).toContain('(auto)')
  expect(html).toContain('(estimate)')
})
it('explains when no video has been probed yet', () => {
  expect(render(null)).toContain('decided when the first video is probed')
})
it('offers the In–Out range only when marks are set', () => {
  expect(render()).toContain('mark In and Out with I / O first')
  expect(render()).toMatch(/type="checkbox"[^>]*disabled/)
  const html = render(landscape, { startUs: 4_000_000, endUs: 10_000_000 })
  expect(html).toContain('Only the In–Out range (00:04 – 00:10)')
  expect(html).not.toMatch(/type="checkbox"[^>]*disabled/)
})
