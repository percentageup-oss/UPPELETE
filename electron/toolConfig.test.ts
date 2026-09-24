import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readLocalToolConfig, resolveToolchain } from './toolConfig'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

const label = '/repo/caption-studio.local.json'
const pair = { ffmpegPath: '/tools/ffmpeg', ffprobePath: '/tools/ffprobe' }

describe('local media tool configuration', () => {
  it('leaves tools unconfigured without environment or local file', () => {
    expect(resolveToolchain({}, undefined, label)).toBeUndefined()
  })

  it('uses the local file when no environment variables are set', () => {
    expect(resolveToolchain({}, JSON.stringify({ ...pair, whisperCliPath: '/tools/whisper-cli' }), label))
      .toEqual({ ...pair, whisperCliPath: '/tools/whisper-cli' })
  })

  it('lets each environment variable override the matching file key', () => {
    const env = { CAPTION_STUDIO_FFPROBE_PATH: '/env tools/ffprobe' }
    expect(resolveToolchain(env, JSON.stringify(pair), label)).toEqual({ ffmpegPath: '/tools/ffmpeg', ffprobePath: '/env tools/ffprobe' })
  })

  it('keeps the environment-only workflow working', () => {
    const env = { CAPTION_STUDIO_FFMPEG_PATH: '/env/ffmpeg', CAPTION_STUDIO_FFPROBE_PATH: '/env/ffprobe' }
    expect(resolveToolchain(env, undefined, label)).toEqual({ ffmpegPath: '/env/ffmpeg', ffprobePath: '/env/ffprobe' })
  })

  it('rejects relative paths and unknown keys, naming the file', () => {
    expect(() => resolveToolchain({}, JSON.stringify({ ...pair, ffmpegPath: 'ffmpeg' }), label)).toThrow(label)
    expect(() => resolveToolchain({}, JSON.stringify({ ...pair, ffplayPath: '/tools/ffplay' }), label)).toThrow(label)
  })

  it('rejects malformed JSON, naming the file', () => {
    expect(() => resolveToolchain({}, '{ "ffmpegPath": ', label)).toThrow(`${label} is not valid JSON`)
  })

  it('requires the FFmpeg/ffprobe pair, including for whisper-cli', () => {
    expect(() => resolveToolchain({}, JSON.stringify({ ffmpegPath: '/tools/ffmpeg' }), label)).toThrow('Configure both media-tool executable paths')
    expect(() => resolveToolchain({}, JSON.stringify({ whisperCliPath: '/tools/whisper-cli' }), label)).toThrow('together with whisper-cli')
  })

  it('reads an existing file and treats a missing one as absent', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'caption tools-'))
    directories.push(directory)
    const configPath = path.join(directory, 'caption-studio.local.json')
    expect(readLocalToolConfig(configPath)).toBeUndefined()
    await writeFile(configPath, JSON.stringify(pair))
    expect(resolveToolchain({}, readLocalToolConfig(configPath), configPath)).toEqual(pair)
  })
})

describe('bundled tool lookup', () => {
  it('falls back to bundled tools only when nothing else is configured', () => {
    const bundled = { ffmpeg: '/res/bin/ffmpeg', ffprobe: '/res/bin/ffprobe', whisperCli: '/res/bin/whisper-cli' }
    expect(resolveToolchain({}, undefined, label, bundled)).toEqual({ ffmpegPath: '/res/bin/ffmpeg', ffprobePath: '/res/bin/ffprobe', whisperCliPath: '/res/bin/whisper-cli' })
    expect(resolveToolchain({ CAPTION_STUDIO_FFMPEG_PATH: '/env/ffmpeg' }, undefined, label, bundled)?.ffmpegPath).toBe('/env/ffmpeg')
  })

  it('finds only the files that exist under resources/bin', async () => {
    const { bundledToolPaths } = await import('./toolConfig')
    const root = await mkdtemp(path.join(tmpdir(), 'bundled-tools-'))
    directories.push(root)
    await import('node:fs/promises').then((fs) => fs.mkdir(path.join(root, 'bin')))
    await writeFile(path.join(root, 'bin', 'ffmpeg.exe'), '')
    expect(bundledToolPaths(root, 'win32')).toEqual({ ffmpeg: path.join(root, 'bin', 'ffmpeg.exe') })
    expect(bundledToolPaths(root, 'darwin')).toEqual({})
  })
})
