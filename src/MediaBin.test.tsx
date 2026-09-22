import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MediaBin } from './MediaBin'
import type { ProjectAsset } from './core/edit'

const asset = (overrides: Partial<ProjectAsset> & Pick<ProjectAsset, 'id' | 'kind' | 'name'>): ProjectAsset => ({
  reference: { relativePath: null, absolutePath: `/media/${overrides.name}` },
  fingerprint: null, metadata: null,
  ...overrides,
})

const noop = () => {}
const render = (overrides: Partial<Parameters<typeof MediaBin>[0]> = {}) => renderToStaticMarkup(
  <MediaBin assets={[]} assetUrls={new Map()} assetIssues={new Map()} useCountByAsset={new Map()} videoReady={() => true}
    onImportFiles={noop} onDropFiles={noop} onAddVideo={noop} onAddOverlayAtPlayhead={noop} onAddSfxAtPlayhead={noop}
    onRemoveAsset={noop} onRelinkAsset={noop} {...overrides} />)

describe('MediaBin', () => {
  it('shows the empty state when there is no media and no assets', () => {
    expect(render()).toContain('Import media or drop files here.')
  })

  it('renders image and audio asset rows as draggable', () => {
    const assets = [asset({ id: 'img-1', kind: 'image', name: 'logo.png' }), asset({ id: 'aud-1', kind: 'audio', name: 'boop.mp3' })]
    const html = render({ assets })
    expect([...html.matchAll(/draggable="true"/g)]).toHaveLength(2)
    expect(html).toContain('logo.png')
    expect(html).toContain('boop.mp3')
  })

  it('disables Remove and explains why when the asset is in use', () => {
    const assets = [asset({ id: 'img-1', kind: 'image', name: 'logo.png' })]
    const html = render({ assets, useCountByAsset: new Map([['img-1', 2]]) })
    expect(html).toMatch(/disabled=""[^>]*>Remove</)
    expect(html).toContain('In use by 2 clips or captions')
  })

  it('leaves Remove enabled when the asset is unused', () => {
    const assets = [asset({ id: 'img-1', kind: 'image', name: 'logo.png' })]
    const html = render({ assets })
    expect(html).not.toMatch(/disabled=""[^>]*>Remove</)
  })

  it('lists every video: draggable and addable when available, relinkable when offline', () => {
    const assets = [asset({ id: 'v1', kind: 'video', name: 'first.mp4' }), asset({ id: 'v2', kind: 'video', name: 'second.mov' })]
    const html = render({ assets, videoReady: (entry) => entry.id === 'v1' })
    expect(html).toContain('first.mp4')
    expect(html).toContain('second.mov')
    expect(html).toContain('Add this video to the end of V1')
    expect(html).toContain('Offline')
    expect([...html.matchAll(/draggable="true"/g)]).toHaveLength(1)
  })

  it('shows a mismatch/missing badge and a Relink action for a flagged asset', () => {
    const assets = [asset({ id: 'img-1', kind: 'image', name: 'logo.png' })]
    const html = render({ assets, assetIssues: new Map([['img-1', 'mismatch']]) })
    expect(html).toContain('File changed')
    expect(html).toContain('Relink')
  })
})
