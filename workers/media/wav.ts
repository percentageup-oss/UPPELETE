import { open } from 'node:fs/promises'

export class WavFormatError extends Error {
  constructor(message: string) { super(message); this.name = 'WavFormatError' }
}

export type WavPcmInfo = { sampleRate: number; channels: number; dataOffset: number; dataBytes: number; sampleCount: number }

const WAVE_FORMAT_PCM = 1
const WAVE_FORMAT_EXTENSIBLE = 0xfffe
export const WAV_HEADER_READ_BYTES = 64 * 1024

/**
 * Walks RIFF chunks to the `data` chunk of 16-bit integer PCM, never assuming a 44-byte layout (FFmpeg can
 * write LIST metadata before `data`). Rejects anything else rather than reinterpreting bytes.
 */
export function parseWavHeader(header: Buffer, fileSize: number): WavPcmInfo {
  if (header.length < 12 || header.toString('latin1', 0, 4) !== 'RIFF' || header.toString('latin1', 8, 12) !== 'WAVE') {
    throw new WavFormatError('Not a RIFF/WAVE file')
  }
  let format: { channels: number; sampleRate: number; blockAlign: number } | null = null
  let offset = 12
  while (offset + 8 <= header.length) {
    const id = header.toString('latin1', offset, offset + 4)
    const size = header.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > header.length) throw new WavFormatError('Truncated WAVE format chunk')
      let audioFormat = header.readUInt16LE(body)
      const channels = header.readUInt16LE(body + 2)
      const sampleRate = header.readUInt32LE(body + 4)
      const blockAlign = header.readUInt16LE(body + 12)
      const bitsPerSample = header.readUInt16LE(body + 14)
      // The extensible sub-format GUID begins with the underlying format code.
      if (audioFormat === WAVE_FORMAT_EXTENSIBLE && size >= 40 && body + 26 <= header.length) audioFormat = header.readUInt16LE(body + 24)
      if (audioFormat !== WAVE_FORMAT_PCM || bitsPerSample !== 16 || channels < 1 || sampleRate < 1 || blockAlign !== channels * 2) {
        throw new WavFormatError('Expected 16-bit integer PCM WAVE data')
      }
      format = { channels, sampleRate, blockAlign }
    } else if (id === 'data') {
      if (!format) throw new WavFormatError('WAVE data chunk precedes its format chunk')
      if (size > fileSize - body) throw new WavFormatError('WAVE data chunk is truncated')
      if (size % format.blockAlign !== 0) throw new WavFormatError('WAVE data ends inside a sample frame')
      return { sampleRate: format.sampleRate, channels: format.channels, dataOffset: body, dataBytes: size, sampleCount: size / format.blockAlign }
    }
    offset = body + size + (size % 2)
  }
  throw new WavFormatError('WAVE data chunk was not found in the file header')
}

export async function readWavInfo(filePath: string): Promise<WavPcmInfo> {
  const handle = await open(filePath, 'r')
  try {
    const { size } = await handle.stat()
    const header = Buffer.alloc(Math.min(WAV_HEADER_READ_BYTES, size))
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    return parseWavHeader(header.subarray(0, bytesRead), size)
  } finally { await handle.close() }
}

/** Canonical 44-byte header for mono 16-bit PCM. */
export function pcm16MonoWavHeader(sampleCount: number, sampleRate: number): Buffer {
  const dataBytes = sampleCount * 2
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0 || dataBytes > 0xffffffff - 36) throw new WavFormatError('WAVE sample count is out of range')
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'latin1')
  header.write('fmt ', 12, 'latin1')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(WAVE_FORMAT_PCM, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'latin1')
  header.writeUInt32LE(dataBytes, 40)
  return header
}
