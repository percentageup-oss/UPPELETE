import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { agentMediaFileName, assertImportPath, assertImportUrl, decodeBase64Image, fetchImageBytes, saveAgentMedia, sniffImageMime, type FetchLike } from './importMedia'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')])

describe('sniffImageMime', () => {
  it('identifies each supported format by magic bytes and refuses everything else', () => {
    expect(sniffImageMime(PNG)).toBe('image/png')
    expect(sniffImageMime(JPEG)).toBe('image/jpeg')
    expect(sniffImageMime(Buffer.from('GIF89a'))).toBe('image/gif')
    expect(sniffImageMime(WEBP)).toBe('image/webp')
    expect(sniffImageMime(Buffer.from('BMxxxx'))).toBe('image/bmp')
    expect(sniffImageMime(Buffer.from('<html></html>'))).toBeNull()
    expect(sniffImageMime(Buffer.from([]))).toBeNull()
  })
})

describe('assertImportPath', () => {
  it('accepts absolute media paths and rejects relative or non-media ones', () => {
    const absolute = path.resolve('picture.PNG')
    expect(() => assertImportPath(absolute)).not.toThrow()
    expect(() => assertImportPath(path.resolve('clip.mp4'))).not.toThrow()
    expect(() => assertImportPath('picture.png')).toThrow(/absolute/)
    expect(() => assertImportPath(path.resolve('notes.txt'))).toThrow(/image, audio or video/)
    expect(() => assertImportPath(path.resolve('.env'))).toThrow()
  })
})

describe('assertImportUrl', () => {
  it('accepts public https urls', () => {
    expect(assertImportUrl('https://upload.wikimedia.org/a/b.png').hostname).toBe('upload.wikimedia.org')
  })
  it.each([
    ['http://example.com/a.png', /https/],
    ['https://user:pw@example.com/a.png', /credentials/],
    ['https://127.0.0.1/a.png', /public/],
    ['https://192.168.1.5/a.png', /public/],
    ['https://[::1]/a.png', /public/],
    ['https://localhost/a.png', /public/],
    ['https://printer.local/a.png', /public/],
    ['https://intranet/a.png', /public/],
    ['not a url', /valid/],
  ])('refuses %s', (url, message) => {
    expect(() => assertImportUrl(url)).toThrow(message)
  })
})

describe('decodeBase64Image', () => {
  it('decodes an image and rejects empty, oversize and non-image data', () => {
    expect(decodeBase64Image(PNG.toString('base64')).mime).toBe('image/png')
    expect(() => decodeBase64Image('')).toThrow(/empty/)
    expect(() => decodeBase64Image(Buffer.from('hello world').toString('base64'))).toThrow(/not a png/)
    expect(() => decodeBase64Image(Buffer.alloc(5 * 1024 * 1024 + 1, 0x89).toString('base64'))).toThrow(/larger/)
  })
})

const respond = (body: Uint8Array | null, init: ResponseInit = {}) => new Response(body as BodyInit | null, init)

describe('fetchImageBytes', () => {
  it('downloads an image and identifies it by content, not by header', async () => {
    const fetchImpl: FetchLike = async () => respond(PNG, { status: 200, headers: { 'content-type': 'text/plain' } })
    expect((await fetchImageBytes('https://example.com/a', fetchImpl)).mime).toBe('image/png')
  })

  it('follows redirects but validates every hop', async () => {
    const seen: string[] = []
    const fetchImpl: FetchLike = async (input) => {
      seen.push(input)
      return input.includes('cdn') ? respond(JPEG, { status: 200 }) : respond(null, { status: 302, headers: { location: 'https://cdn.example.com/x.jpg' } })
    }
    expect((await fetchImageBytes('https://example.com/a', fetchImpl)).mime).toBe('image/jpeg')
    expect(seen).toEqual(['https://example.com/a', 'https://cdn.example.com/x.jpg'])

    const toLocal: FetchLike = async () => respond(null, { status: 302, headers: { location: 'https://127.0.0.1/secret.png' } })
    await expect(fetchImageBytes('https://example.com/a', toLocal)).rejects.toThrow(/public/)
    const downgrade: FetchLike = async () => respond(null, { status: 302, headers: { location: 'http://example.com/a.png' } })
    await expect(fetchImageBytes('https://example.com/a', downgrade)).rejects.toThrow(/https/)
  })

  it('stops a redirect loop', async () => {
    const loop: FetchLike = async () => respond(null, { status: 302, headers: { location: 'https://example.com/again' } })
    await expect(fetchImageBytes('https://example.com/a', loop)).rejects.toThrow(/too many/)
  })

  it('reports HTTP errors and non-image bodies, and enforces the size cap', async () => {
    await expect(fetchImageBytes('https://example.com/a', async () => respond(null, { status: 404 }))).rejects.toThrow(/404/)
    await expect(fetchImageBytes('https://example.com/a', async () => respond(Buffer.from('<html>'), { status: 200 }))).rejects.toThrow(/did not return/)
    await expect(fetchImageBytes('https://example.com/a', async () => respond(PNG, { status: 200, headers: { 'content-length': String(26 * 1024 * 1024) } }))).rejects.toThrow(/larger/)
    const streaming: FetchLike = async () => respond(new Uint8Array(26 * 1024 * 1024), { status: 200 })
    await expect(fetchImageBytes('https://example.com/a', streaming)).rejects.toThrow(/larger/)
  })
})

describe('saveAgentMedia', () => {
  let directory = ''
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

  it('lands bytes content-addressed, atomically, and never rewrites an existing file', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'kathacut-agent-media-'))
    const first = await saveAgentMedia(path.join(directory, 'nested'), PNG, 'image/png')
    const second = await saveAgentMedia(path.join(directory, 'nested'), PNG, 'image/png')
    expect(second).toBe(first)
    expect(path.basename(first)).toBe(agentMediaFileName(PNG, 'image/png'))
    expect(path.extname(first)).toBe('.png')
    expect(await readFile(first)).toEqual(PNG)
    expect(await readdir(path.join(directory, 'nested'))).toEqual([path.basename(first)])
    const other = await saveAgentMedia(path.join(directory, 'nested'), JPEG, 'image/jpeg')
    expect(other).not.toBe(first)
  })
})
