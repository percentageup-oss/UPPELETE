import { expect, it } from 'vitest'
import { estimateExportMs, formatEstimate, recordExportSpeed, type SpeedStorage } from './exportHistory'

const memory = (initial?: string): SpeedStorage & { value: string | null } => {
  const store = { value: initial ?? null, getItem: () => store.value, setItem: (_key: string, value: string) => { store.value = value } }
  return store
}
const hd = { width: 1920, height: 1080 }

it('has no estimate without history', () => {
  expect(estimateExportMs({ ...hd, frameCount: 1000 }, memory())).toBeNull()
  expect(estimateExportMs({ ...hd, frameCount: 1000 }, null)).toBeNull()
})
it('scales the estimate with the frame count', () => {
  const storage = memory()
  recordExportSpeed({ ...hd, framesPerSecond: 50 }, storage)
  expect(estimateExportMs({ ...hd, frameCount: 500 }, storage)).toBe(10_000)
  expect(estimateExportMs({ ...hd, frameCount: 1000 }, storage)).toBe(20_000)
})
it('smooths repeated recordings', () => {
  const storage = memory()
  recordExportSpeed({ ...hd, framesPerSecond: 100 }, storage)
  recordExportSpeed({ ...hd, framesPerSecond: 50 }, storage)
  expect(estimateExportMs({ ...hd, frameCount: 85 }, storage)).toBeCloseTo(1000)
})
it('keeps resolution buckets separate', () => {
  const storage = memory()
  recordExportSpeed({ ...hd, framesPerSecond: 50 }, storage)
  expect(estimateExportMs({ width: 3840, height: 2160, frameCount: 500 }, storage)).toBeNull()
  expect(estimateExportMs({ width: 1280, height: 720, frameCount: 500 }, storage)).toBeNull()
  expect(estimateExportMs({ width: 1920, height: 1088, frameCount: 500 }, storage)).toBe(10_000)
})
it('ignores corrupt storage and bad rates', () => {
  for (const bad of ['{nope', '[1]', '"x"', '{"1080":"fast"}', '{"1080":-3}']) expect(estimateExportMs({ ...hd, frameCount: 100 }, memory(bad))).toBeNull()
  const storage = memory()
  recordExportSpeed({ ...hd, framesPerSecond: 0 }, storage)
  recordExportSpeed({ ...hd, framesPerSecond: Number.NaN }, storage)
  expect(storage.value).toBeNull()
  recordExportSpeed({ ...hd, framesPerSecond: 40 }, memory('{nope'))
})
it('formats the estimate', () => {
  expect(formatEstimate(20_000)).toBe('less than a minute')
  expect(formatEstimate(180_000)).toBe('about 3 min')
  expect(formatEstimate(3_900_000)).toBe('about 1 h 5 min')
})
