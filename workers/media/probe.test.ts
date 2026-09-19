import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { decimalSecondsToUs, fingerprintMedia, parseProbeJson, parseRational } from './probe'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('ffprobe metadata parsing', () => {
  it('preserves VFR-relevant reported rates as exact rationals and reads audio/video codec details', async () => {
    const metadata = parseProbeJson(await readFile('tests/fixtures/ffprobe-vfr.json', 'utf8'))
    expect(metadata).toMatchObject({
      durationUs: 10_010_000,
      width: 1080,
      height: 1920,
      frameRate: { numerator: 30000, denominator: 1001 },
      nominalFrameRate: { numerator: 30, denominator: 1 },
    })
    expect(metadata.streams).toEqual([
      expect.objectContaining({ kind: 'video', codec: expect.objectContaining({ name: 'h264', profile: 'High' }), averageFrameRate: { numerator: 30000, denominator: 1001 } }),
      expect.objectContaining({ kind: 'audio', codec: expect.objectContaining({ name: 'aac', profile: 'LC' }), startUs: -21_333, sampleRate: 48_000, channels: 2 }),
    ])
  })

  it('reads display rotation from stream side data without swapping coded dimensions', async () => {
    const metadata = parseProbeJson(await readFile('tests/fixtures/ffprobe-rotated.json', 'utf8'))
    expect(metadata).toMatchObject({ durationUs: 2_502_500, width: 1920, height: 1080, rotationDegrees: -90 })
    expect(metadata.streams[0]).toMatchObject({ rotationDegrees: -90, codec: { name: 'hevc', longName: 'H.265 / HEVC', profile: 'Main', level: 120, tag: 'hvc1' } })
  })

  it('converts decimal source times exactly and leaves unknown rationals unknown', () => {
    expect(decimalSecondsToUs('123.4567894')).toBe(123_456_789)
    expect(decimalSecondsToUs('123.4567895')).toBe(123_456_790)
    expect(decimalSecondsToUs('-0.000001', true)).toBe(-1)
    expect(parseRational('0/0')).toBeNull()
    expect(parseRational('30000/1001')).toEqual({ numerator: 30000, denominator: 1001 })
  })
})

describe('sampled media fingerprint', () => {
  it('is stable for paths containing spaces and Unicode and changes with sampled content', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'caption metadata മലയാളം space-'))
    directories.push(directory)
    const mediaPath = path.join(directory, 'എന്റെ clip & sample.bin')
    await writeFile(mediaPath, Buffer.alloc(900_000, 1))
    const first = await fingerprintMedia(mediaPath, new AbortController().signal)
    const second = await fingerprintMedia(mediaPath, new AbortController().signal)
    expect(first).toEqual(second)
    expect(first).toMatchObject({ algorithm: 'sha256-sampled-v1', sizeBytes: 900_000, sampledBytes: 3 * 256 * 1024 })
    await writeFile(mediaPath, Buffer.alloc(900_000, 2))
    expect((await fingerprintMedia(mediaPath, new AbortController().signal)).value).not.toBe(first.value)
  })
})
