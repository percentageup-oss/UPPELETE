import { describe, expect, it } from 'vitest'
import { parseWavHeader, pcm16MonoWavHeader, WavFormatError } from './wav'

function chunk(id: string, body: Buffer) {
  const header = Buffer.alloc(8)
  header.write(id, 0, 'latin1')
  header.writeUInt32LE(body.length, 4)
  return Buffer.concat([header, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
}
function fmt(format: number, channels: number, sampleRate: number, bits: number, extensibleSubFormat?: number) {
  const body = Buffer.alloc(extensibleSubFormat === undefined ? 16 : 40)
  body.writeUInt16LE(format, 0)
  body.writeUInt16LE(channels, 2)
  body.writeUInt32LE(sampleRate, 4)
  body.writeUInt32LE(sampleRate * channels * bits / 8, 8)
  body.writeUInt16LE(channels * bits / 8, 12)
  body.writeUInt16LE(bits, 14)
  if (extensibleSubFormat !== undefined) { body.writeUInt16LE(22, 16); body.writeUInt16LE(extensibleSubFormat, 24) }
  return chunk('fmt ', body)
}
function riff(...chunks: Buffer[]) {
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), ...chunks])
  const header = Buffer.alloc(8)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}

describe('WAVE header parsing', () => {
  it('round-trips the canonical mono 16-bit header', () => {
    const file = Buffer.concat([pcm16MonoWavHeader(16000, 16000), Buffer.alloc(32000)])
    expect(parseWavHeader(file, file.length)).toEqual({ sampleRate: 16000, channels: 1, dataOffset: 44, dataBytes: 32000, sampleCount: 16000 })
  })

  it('walks odd-sized metadata chunks (as FFmpeg can write) instead of assuming a 44-byte layout', () => {
    const file = riff(fmt(1, 1, 16000, 16), chunk('LIST', Buffer.from('abc')), chunk('data', Buffer.alloc(8)))
    expect(parseWavHeader(file, file.length)).toMatchObject({ dataOffset: 56, dataBytes: 8, sampleCount: 4 })
  })

  it('accepts extensible PCM and rejects non-PCM, non-16-bit, truncated and misordered files', () => {
    const extensible = riff(fmt(0xfffe, 1, 16000, 16, 1), chunk('data', Buffer.alloc(4)))
    expect(parseWavHeader(extensible, extensible.length).sampleCount).toBe(2)
    const invalid = [
      riff(fmt(3, 1, 16000, 32), chunk('data', Buffer.alloc(8))),
      riff(fmt(1, 1, 16000, 24), chunk('data', Buffer.alloc(6))),
      riff(fmt(0xfffe, 1, 16000, 16, 3), chunk('data', Buffer.alloc(4))),
      riff(chunk('data', Buffer.alloc(4)), fmt(1, 1, 16000, 16)),
      riff(fmt(1, 1, 16000, 16), chunk('data', Buffer.alloc(3))),
      riff(fmt(1, 1, 16000, 16)),
      Buffer.from('not a wave file at all'),
    ]
    for (const file of invalid) expect(() => parseWavHeader(file, file.length)).toThrow(WavFormatError)
    const truncated = riff(fmt(1, 1, 16000, 16), chunk('data', Buffer.alloc(8)))
    expect(() => parseWavHeader(truncated, truncated.length - 4)).toThrow('truncated')
  })
})
