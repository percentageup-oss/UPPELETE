// Stages the media tools an installer ships: build/bin/<os>/{ffmpeg,ffprobe,whisper-cli}(+ runtime libs).
// electron-builder copies that folder to <resources>/bin, where electron/toolConfig.ts finds it.
//   node scripts/stage-tools.mjs win    (Windows x64: BtbN LGPL FFmpeg 9.0 + whisper.cpp CUDA build, CPU fallback built in)
//   node scripts/stage-tools.mjs mac    (macOS arm64: expects scripts/build-ffmpeg.sh + scripts/build-whisper.sh outputs)
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const target = process.argv[2]
if (!['win', 'mac'].includes(target)) throw new Error('usage: stage-tools.mjs <win|mac>')
const root = path.resolve(import.meta.dirname, '..')
const tools = path.join(root, '.tools')
const out = path.join(root, 'build', 'bin', target)
const inCi = Boolean(process.env.CI)
const log = (message) => console.log(`==> ${message}`)

const FFMPEG_BASE = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'
const FFMPEG_ASSET = 'ffmpeg-n9.0-latest-win64-lgpl-9.0.zip'
const WHISPER_TAG = 'b5130' // the whisper.cpp build tag cut with v1.9.4 (the only one with Windows binaries)
const WHISPER_ASSET = 'whisper-cublas-12.4.0-bin-x64.zip'
// Exactly what whisper-cli needs at runtime. The CUDA libraries are loaded by ggml-cuda.dll only when an
// NVIDIA driver is present, so PCs without one run the same files on the CPU backend.
const WHISPER_FILES = ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cuda.dll', 'cudart64_12.dll', 'cublas64_12.dll', 'cublasLt64_12.dll']
const WHISPER_PATTERNS = [/^ggml-cpu-.*\.dll$/]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  if (result.error) throw result.error
  return result
}
const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex')

async function download(url, destination) {
  log(`GET ${url}`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  await writeFile(destination, Buffer.from(await response.arrayBuffer()))
}

function extract(archive, destination) {
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  const result = run(tar, ['-xf', archive, '-C', destination])
  if (result.status !== 0) throw new Error(`extracting ${archive} failed: ${result.stderr}`)
}

async function findFile(directory, name) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) { const found = await findFile(full, name); if (found) return found }
    else if (entry.name.toLowerCase() === name) return full
  }
  return undefined
}

async function stageWindows() {
  await mkdir(path.join(tools, 'downloads'), { recursive: true })

  // FFmpeg + ffprobe: BtbN LGPL build, checked against the release's published checksums.
  const ffmpegZip = path.join(tools, 'downloads', FFMPEG_ASSET)
  const ffmpegDir = path.join(tools, 'ffmpeg-win64-lgpl')
  if (!existsSync(path.join(ffmpegDir, 'bin', 'ffmpeg.exe'))) {
    await download(`${FFMPEG_BASE}/${FFMPEG_ASSET}`, ffmpegZip)
    const sums = await (await fetch(`${FFMPEG_BASE}/checksums.sha256`)).text()
    const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(FFMPEG_ASSET))
    const expected = line?.split(/\s+/)[0]?.toLowerCase()
    if (!expected) throw new Error(`checksums.sha256 has no entry for ${FFMPEG_ASSET}`)
    if (await sha256(ffmpegZip) !== expected) { await rm(ffmpegZip); throw new Error(`SHA-256 mismatch for ${FFMPEG_ASSET}`) }
    const extractTo = path.join(tools, 'ffmpeg-extract')
    await rm(extractTo, { recursive: true, force: true }); await mkdir(extractTo, { recursive: true })
    extract(ffmpegZip, extractTo)
    const inner = (await readdir(extractTo, { withFileTypes: true })).find((e) => e.isDirectory())
    await rm(ffmpegDir, { recursive: true, force: true })
    await cp(path.join(extractTo, inner.name), ffmpegDir, { recursive: true })
    await rm(extractTo, { recursive: true, force: true })
  }
  for (const name of ['ffmpeg.exe', 'ffprobe.exe']) await copyFile(path.join(ffmpegDir, 'bin', name), path.join(out, name))

  // whisper-cli: reuse a build dev.ps1 already fetched, otherwise download the same asset.
  const whisperSource = path.join(tools, `whisper.cpp-${WHISPER_TAG}-win-cublas`)
  const existing = existsSync(whisperSource) ? await findFile(whisperSource, 'whisper-cli.exe') : undefined
  if (!existing) {
    const zip = path.join(tools, 'downloads', WHISPER_ASSET)
    await download(`https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/${WHISPER_ASSET}`, zip)
    const release = await (await fetch(`https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/${WHISPER_TAG}`)).json()
    const digest = release.assets?.find((a) => a.name === WHISPER_ASSET)?.digest?.replace(/^sha256:/, '')
    if (!digest) throw new Error(`no published digest for ${WHISPER_ASSET}`)
    if (await sha256(zip) !== digest) { await rm(zip); throw new Error(`SHA-256 mismatch for ${WHISPER_ASSET}`) }
    await rm(whisperSource, { recursive: true, force: true }); await mkdir(whisperSource, { recursive: true })
    extract(zip, whisperSource)
  }
  const whisperDir = path.dirname(await findFile(whisperSource, 'whisper-cli.exe'))
  for (const name of await readdir(whisperDir)) {
    if (WHISPER_FILES.includes(name) || WHISPER_PATTERNS.some((p) => p.test(name))) await copyFile(path.join(whisperDir, name), path.join(out, name))
  }
  for (const name of WHISPER_FILES) if (!existsSync(path.join(out, name))) throw new Error(`whisper build is missing ${name}`)

  // App-local VC++ runtime so a fresh PC needs no Visual C++ Redistributable install.
  const crt = await findVcRuntime()
  if (crt) {
    for (const name of await readdir(crt)) if (/^(msvcp140|vcruntime140).*\.dll$/i.test(name)) await copyFile(path.join(crt, name), path.join(out, name))
  } else if (inCi) throw new Error('Visual C++ runtime folder not found')
  else console.warn('WARNING: Visual C++ runtime not found; the package relies on the target PC having it.')
}

async function findVcRuntime() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map((p) => path.join(p, 'Microsoft Visual Studio'))
  const found = []
  for (const base of roots) {
    if (!existsSync(base)) continue
    for (const version of await readdir(base)) {
      if (!existsSync(path.join(base, version))) continue
      for (const edition of await readdir(path.join(base, version))) {
        const msvc = path.join(base, version, edition, 'VC', 'Redist', 'MSVC')
        if (!existsSync(msvc)) continue
        for (const build of await readdir(msvc)) {
          const x64 = path.join(msvc, build, 'x64')
          if (!existsSync(x64)) continue
          for (const crt of await readdir(x64)) if (/^Microsoft\.VC\d+\.CRT$/.test(crt)) found.push(path.join(x64, crt))
        }
      }
    }
  }
  return found.sort().at(-1)
}

async function stageMac() {
  const sources = {
    ffmpeg: path.join(tools, 'ffmpeg-9.0.1', 'bin', 'ffmpeg'),
    ffprobe: path.join(tools, 'ffmpeg-9.0.1', 'bin', 'ffprobe'),
    'whisper-cli': path.join(tools, 'whisper.cpp-1.9.4', 'bin', 'whisper-cli'),
  }
  for (const [name, source] of Object.entries(sources)) {
    if (!existsSync(source)) throw new Error(`${source} is missing; run scripts/build-ffmpeg.sh and scripts/build-whisper.sh first`)
    await copyFile(source, path.join(out, name))
    run('chmod', ['755', path.join(out, name)])
  }
  // Only system libraries may be linked; anything else would not exist on the friend's Mac.
  for (const name of Object.keys(sources)) {
    const linked = run('otool', ['-L', path.join(out, name)]).stdout.split('\n').slice(1).map((l) => l.trim().split(' ')[0]).filter(Boolean)
    const foreign = linked.filter((lib) => !lib.startsWith('/usr/lib/') && !lib.startsWith('/System/'))
    if (foreign.length) throw new Error(`${name} links non-system libraries: ${foreign.join(', ')}`)
  }
}

function verify() {
  const suffix = target === 'win' ? '.exe' : ''
  const version = run(path.join(out, `whisper-cli${suffix}`), ['--version'])
  const text = `${version.stdout}${version.stderr}`
  if (!/whisper\.cpp version: 1\.9\.4/.test(text)) throw new Error(`whisper-cli --version reported: ${text.trim() || '(nothing)'}`)
  const ffmpeg = run(path.join(out, `ffmpeg${suffix}`), ['-version']).stdout
  if (/--enable-(gpl|nonfree)/.test(ffmpeg)) throw new Error('the staged FFmpeg is a GPL or nonfree build and cannot be redistributed')
  const encoders = run(path.join(out, `ffmpeg${suffix}`), ['-hide_banner', '-encoders']).stdout
  const required = target === 'win' ? ['png', 'h264_mf', 'libvpx', 'libopus'] : ['png', 'h264_videotoolbox', 'libvpx', 'libopus']
  const missing = required.filter((name) => !new RegExp(`\\s${name}\\s`).test(encoders))
  if (missing.length) throw new Error(`the staged FFmpeg lacks encoders: ${missing.join(', ')}`)
  log(`staged ${out}\n${ffmpeg.split('\n')[0]}\n${text.split('\n').find((l) => l.includes('version'))}`)
}

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
if (target === 'win') await stageWindows(); else await stageMac()
verify()
const sizes = await Promise.all((await readdir(out)).map(async (n) => (await stat(path.join(out, n))).size))
log(`${sizes.length} files, ${(sizes.reduce((a, b) => a + b, 0) / 1e6).toFixed(0)} MB`)
