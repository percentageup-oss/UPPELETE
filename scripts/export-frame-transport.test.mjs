import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ nativeImage: {} }))
import { markedBitmap, renderOffscreen, alphaStats } from './export-frame-transport.mjs'

const composition = { width: 16, height: 16 }
function image(marker) {
  const bytes = Buffer.alloc(16 * 16 * 4)
  bytes.set([marker >> 16 & 255, marker >> 8 & 255, marker & 255, 255], bytes.length - 4)
  return { getSize: () => composition, toBitmap: () => Buffer.from(bytes) }
}
describe('X1 committed-paint correlation', () => {
  it('rejects old tokens and strips only the reserved marker pixel', () => {
    expect(markedBitmap(image(1), composition, 2)).toBeNull()
    expect(markedBitmap(image(0xabcdef), composition, 0xabcdef)).toEqual(Buffer.alloc(1024))
    expect(() => markedBitmap(image(1), { width: 32, height: 16 }, 1)).toThrow(/dimensions/)
  })
  it('ignores uncommitted and stale paints, invalidates static frames and removes listeners', async () => {
    const wc = new EventEmitter()
    wc.executeJavaScript = async () => { wc.emit('paint', {}, {}, image(2)); return { state: 'ready' } }
    wc.invalidate = () => { wc.emit('paint', {}, {}, image(1)); wc.emit('paint', {}, {}, image(2)) }
    const result = await renderOffscreen({ webContents: wc }, { composition }, 2)
    expect(result.stalePaints).toBe(2)
    expect(result.bitmap).toEqual(Buffer.alloc(1024))
    expect(wc.listenerCount('paint')).toBe(0)
  })
  it('cleans listeners when font/request validation fails', async () => {
    const wc = new EventEmitter()
    wc.executeJavaScript = async () => { throw new Error('font failed') }
    await expect(renderOffscreen({ webContents: wc }, { composition }, 2)).rejects.toThrow('font failed')
    expect(wc.listenerCount('paint')).toBe(0)
  })
  it('distinguishes fully transparent, partial and opaque pixels', () => {
    expect(alphaStats(Buffer.from([0, 0, 0, 0, 20, 20, 20, 128, 255, 255, 255, 255]))).toEqual({ clear: 1, partial: 1, opaque: 1, nonzeroRgbUnderClear: 0 })
  })
})
