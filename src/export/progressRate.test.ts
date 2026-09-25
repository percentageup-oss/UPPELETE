import { describe, expect, it } from 'vitest'
import type { JobSnapshot } from '../core/jobs'
import { createProgressRate, describeExport, formatEta } from './progressRate'

describe('createProgressRate', () => {
  it('reports a steady rate and matching ETA once stable', () => {
    const rate = createProgressRate()
    let view = rate.sample(0, 1000, 0)
    for (let t = 1; t <= 5; t++) view = rate.sample(t * 50, 1000, t * 1000)
    expect(view.percent).toBe(25)
    expect(view.framesPerSecond).toBeCloseTo(50)
    expect(view.etaMs).toBeCloseTo(15000)
  })

  it('stays null before 3 s of samples or 2 % progress', () => {
    const early = createProgressRate()
    early.sample(0, 1000, 0)
    expect(early.sample(100, 1000, 2000).etaMs).toBeNull()
    const slow = createProgressRate()
    slow.sample(0, 100000, 0)
    expect(slow.sample(100, 100000, 4000)).toEqual({ percent: 0, etaMs: null, framesPerSecond: null })
  })

  it('ignores non-increasing samples', () => {
    const rate = createProgressRate()
    rate.sample(0, 1000, 0)
    rate.sample(100, 1000, 2000)
    const before = rate.sample(200, 1000, 4000)
    const after = rate.sample(150, 1000, 5000)
    expect(after.framesPerSecond).toBe(before.framesPerSecond)
    expect(rate.sample(200, 1000, 6000).framesPerSecond).toBe(before.framesPerSecond)
  })
})

describe('formatEta', () => {
  it('formats minutes, sub-minute and hours', () => {
    expect(formatEta(72_000)).toBe('about 1:12 left')
    expect(formatEta(30_000)).toBe('less than a minute left')
    expect(formatEta(0)).toBe('less than a minute left')
    expect(formatEta(3_725_000)).toBe('about 1:02:05 left')
    expect(formatEta(-1)).toBe('')
    expect(formatEta(Number.NaN)).toBe('')
  })
})

describe('describeExport', () => {
  const job = (progress: JobSnapshot['progress']) => ({ state: 'running', cancelRequested: false, progress }) as JobSnapshot
  it('says Preparing before measured progress', () => {
    expect(describeExport(null, null).label).toBe('Preparing…')
    expect(describeExport(job({ kind: 'indeterminate', phase: 'rendering' }), null).label).toBe('Preparing…')
  })
  it('shows percent, ETA and fps when measured', () => {
    const measured = job({ kind: 'measured', phase: 'encoding', completed: 420, total: 1000, unit: 'frames' })
    expect(describeExport(measured, { percent: 42, etaMs: 72_000, framesPerSecond: 38 }).label).toBe('Exporting 42% · about 1:12 left · 38 fps')
    expect(describeExport(measured, null).label).toBe('Exporting 42%')
  })
  it('reuses describeJob for cancelling', () => {
    expect(describeExport({ ...job(null), cancelRequested: true }, null).label).toBe('Cancelling and cleaning up…')
  })
})
