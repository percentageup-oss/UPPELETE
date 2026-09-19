import { expect, it } from 'vitest'
import { slicePeaks } from './waveformSlice'

const waveform = { range: { startUs: 0, endUs: 10_000_000 }, peaks: Array.from({ length: 10 }, (_, index) => index / 10) }

it('slices the bucket span a source range overlaps', () => {
  expect(slicePeaks(waveform, { startUs: 2_000_000, endUs: 5_000_000 })).toEqual([0.2, 0.3, 0.4])
})

it('returns the whole array for the full range', () => {
  expect(slicePeaks(waveform, { startUs: 0, endUs: 10_000_000 })).toEqual(waveform.peaks)
})

it('clamps a range that runs past either edge of the extracted waveform', () => {
  expect(slicePeaks(waveform, { startUs: -5_000_000, endUs: 1_000_000 })).toEqual([0])
  expect(slicePeaks(waveform, { startUs: 9_000_000, endUs: 20_000_000 })).toEqual([0.9])
})

it('returns nothing for a range entirely outside the waveform, or an empty/zero-width range', () => {
  expect(slicePeaks(waveform, { startUs: 11_000_000, endUs: 12_000_000 })).toEqual([])
  expect(slicePeaks(waveform, { startUs: 3_000_000, endUs: 3_000_000 })).toEqual([])
  expect(slicePeaks({ range: { startUs: 0, endUs: 0 }, peaks: [] }, { startUs: 0, endUs: 1 })).toEqual([])
})
