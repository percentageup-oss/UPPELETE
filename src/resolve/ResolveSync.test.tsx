import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ResolveSyncPreview, ResolveSyncSpec } from '../core/resolveIpc'
import { ResolveSyncDialog, changeSummary } from './ResolveSync'
import { replaceAllPlan } from './syncDiff'

const noop = () => {}
const preview = (overrides: Partial<ResolveSyncPreview> = {}): ResolveSyncPreview => ({
  trackExists: true, insert: 0, update: 0, replace: 0, remove: 0, unchanged: 0, foreign: 0, trackClips: 0, conflicts: [], ...overrides,
})
const spec = (key: string): ResolveSyncSpec => ({ key, startFrame: 0, endFrame: 10, text: key, inputs: {}, keyframes: [], styleRanges: [], hash: key })
const render = (overrides: Partial<ResolveSyncPreview>) => renderToStaticMarkup(<ResolveSyncDialog trackName="KathaCut"
  onJump={noop} onCancel={noop} onSync={noop} pending={{ specs: [spec('a'), spec('b')], synced: [], notSent: [], preview: preview(overrides) }} />)

it('summarises only the kinds of change that happened', () => {
  expect(changeSummary(preview({ insert: 2, update: 1, replace: 1 }), 0)).toBe('2 added, 2 updated')
  expect(changeSummary(preview({ remove: 1 }), 1)).toBe('1 updated, 1 removed')
  expect(changeSummary(preview({ unchanged: 9 }), 0)).toBe('')
})

it('shows one status line and the replace option, with Sync disabled when Resolve is up to date', () => {
  const html = render({ unchanged: 2, foreign: 3, trackClips: 5 })
  expect(html).toContain('Resolve is already up to date.')
  expect(html).toContain('Replace captions')
  expect(html).toContain('Deletes all 5 clips on “KathaCut”, including 3 not made by KathaCut')
  expect(html).toMatch(/<button type="button" class="accent" disabled="">Up to date<\/button>/)
  expect(html).not.toContain('changed in Resolve')
})

it('lists conflicts only when there are some, defaulting each to the Resolve version', () => {
  const html = render({ insert: 3, conflicts: [
    { key: 'a', kind: 'changed-in-resolve', resolveText: 'Hello there', keptText: 'Hello', startFrame: 10 },
    { key: 'b', kind: 'deleted-in-resolve', keptText: 'Bye' },
  ] })
  expect(html).toContain('Ready to send: 3 added.')
  expect(html).toContain('2 captions changed in Resolve')
  expect(html).toContain('Keep all from Resolve')
  expect(html).toContain('clip deleted')
  expect(html.match(/type="radio"[^>]*checked=""/g)).toHaveLength(2)
})

it('replace-all deletes every clip on the track and inserts every caption', () => {
  const synced = [{ key: 'a', clipId: 'c1', hash: 'old', startFrame: 0, endFrame: 10, text: 'a' }]
  const plan = replaceAllPlan([spec('a'), spec('b')], synced, [
    { clipId: 'c1', startFrame: 0, endFrame: 10, key: 'a', text: 'a' },
    { clipId: 'x', startFrame: 20, endFrame: 30, key: null, text: 'someone else’s title' },
  ])
  expect(plan.insert.map((item) => item.key)).toEqual(['a', 'b'])
  expect(plan.remove).toEqual([{ clipId: 'c1', previous: synced[0] }, { clipId: 'x', previous: undefined }])
  expect(plan.update).toEqual([])
  expect(plan.carried).toEqual([])
})
