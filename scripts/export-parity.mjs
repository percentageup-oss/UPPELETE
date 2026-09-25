// X3 — preview/export parity and sync validation.
//
// Two independent checks, both against the real production pipeline, never a second caption
// implementation:
//  (1) Caption-layer parity: the same FrameRequest rendered by the on-screen preview window and by
//      the offscreen export host must produce byte-identical caption pixels (X1's own invariant,
//      exercised here across every real manifest this script builds instead of one fixture).
//  (2) Composited-frame parity + sync: real MP4s built through `electron . --export-smoke`
//      (ExportService -> JobScheduler -> media worker -> export host -> pinned FFmpeg), then
//      inspected with the pinned ffprobe/ffmpeg to measure how closely the encoded frames match an
//      alpha composite of the real caption layer over a clean backdrop frame, and how closely
//      caption/audio onsets in the output land on their planned source times.
//
// Every source is synthesized locally with the pinned FFmpeg (a static SMPTE bars/color pattern, so
// any pixel change between frames is attributable to the caption layer, not scene motion). Nothing
// is faked: real encodes, real ffprobe reads, real pixel buffers. Soft pixel-delta metrics are
// reported, not asserted, until a real run establishes a tolerance (per ADR 0003's policy) — hard
// invariants (caption-layer equality, frame count, duration, rotation, sync-in-range) are asserted.
import { app, BrowserWindow, nativeImage } from 'electron'
import { build } from 'esbuild'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, cpus, totalmem, release } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { renderOffscreen, renderPreview, toPng } from './export-frame-transport.mjs'

const run = promisify(execFile)
const repoRoot = resolve('.')
const onlyArg = process.argv.indexOf('--only')
const only = onlyArg >= 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null
const include = (name) => !only || only.has(name)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
// Overridable so a developer can point large scratch media at a different disk; defaults to the
// system temp directory, same as every other script here (export-renderer-prototype.mjs included).
const scratchRoot = process.env.CAPTION_STUDIO_PARITY_WORKDIR || tmpdir()
await mkdir(scratchRoot, { recursive: true })

// The project's TypeScript sources use extensionless relative imports throughout (resolved by
// esbuild/tsc everywhere they are normally loaded); Node's own type-stripping ESM loader cannot
// resolve those transitively when a `.ts` file is imported directly, unlike the single-file,
// no-local-import modules `export-host.mjs` imports. Bundling this script's own small re-export
// module once, up front, sidesteps that instead of changing the project's import style.
const helpersPath = join(await mkdtemp(join(scratchRoot, 'caption-x3-helpers-')), 'helpers.mjs')
await build({ entryPoints: ['scripts/export-parity-helpers.ts'], outfile: helpersPath, bundle: true, platform: 'node', format: 'esm' })
const { frameRequestAt, frameSourceUs, exportFrameCountFor, exportOutputDurationUs, exportPlanSchema,
  captionTokens, DEFAULT_CAPTION_STYLE, captionFixtures, CAPTION_TEMPLATES, titleTemplateChanges, defaultTextOverlay, defaultShape, SHAPE_PRESETS,
  decorativeTextCue, textMotionAt, frameRequestV4Schema, readLocalToolConfig, resolveToolchain, LOCAL_TOOL_CONFIG_FILE,
  frameRequestAtSequence, graphicsPasses, bakeGrade, NEUTRAL_GRADE, encodeLog, encodeCubeData, exportManifestV3Schema, exportFilterGraphV3, paintAt, compositionToPixels } = await import(pathToFileURL(helpersPath).href)

const tools = resolveToolchain(process.env, readLocalToolConfig(join(repoRoot, LOCAL_TOOL_CONFIG_FILE)), LOCAL_TOOL_CONFIG_FILE)
if (!tools) throw new Error(`Configure ${LOCAL_TOOL_CONFIG_FILE} (or CAPTION_STUDIO_FFMPEG_PATH/CAPTION_STUDIO_FFPROBE_PATH) before running the parity suite`)
const ffmpeg = (args) => run(tools.ffmpegPath, ['-v', 'error', '-y', ...args])
const ffprobeJson = async (args) => JSON.parse((await run(tools.ffprobePath, ['-v', 'error', '-of', 'json', ...args])).stdout)

app.commandLine.appendSwitch('force-device-scale-factor', '1')
// `main`'s `finally` destroys its windows before the rejection handler below runs; Electron's
// default `window-all-closed` quit would otherwise exit 0 first, silently dropping the error.
app.on('window-all-closed', () => {})

// ---------------------------------------------------------------------------------------------
// Source synthesis. `smptebars` is a static pattern (unlike `testsrc2`, which animates), so every
// frame of a given source is pixel-identical outside the caption layer: any inter-frame delta in
// the encoded output is attributable to the caption, not scene motion or encoder drift.
// ---------------------------------------------------------------------------------------------
const SOURCES = {
  landscape: { width: 1920, height: 1080, rate: '30/1', durationSec: 20 },
  portrait: { width: 1080, height: 1920, rate: '30/1', durationSec: 20 },
  ntsc: { width: 1280, height: 720, rate: '30000/1001', durationSec: 4 },
  rotatedBase: { width: 1920, height: 1080, rate: '30/1', durationSec: 6 },
  vfrBase: { width: 1920, height: 1080, rate: '30/1', durationSec: 6 },
  longform: { width: 960, height: 540, rate: '30/1', durationSec: 240 },
}

async function synthesizeSource(dir, name, { width, height, rate, durationSec }) {
  const path = join(dir, `${name}.mp4`)
  await ffmpeg([
    '-f', 'lavfi', '-i', `smptebars=size=${width}x${height}:rate=${rate}:duration=${durationSec}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${durationSec}`,
    '-pix_fmt', 'yuv420p', '-c:v', 'h264_videotoolbox', '-c:a', 'aac', path,
  ])
  return path
}

/** Real display-matrix rotation via stream copy (an input option in this FFmpeg build — verified:
 * applying it as an output option is rejected). No re-encode, so pixel content is untouched. */
async function rotateSource(dir, sourcePath, degrees) {
  const path = join(dir, `rotated.mp4`)
  await ffmpeg(['-display_rotation', String(degrees), '-i', sourcePath, '-c', 'copy', path])
  const probe = await ffprobeJson(['-select_streams', 'v:0', '-show_entries', 'stream_side_data=rotation', path])
  const reported = probe.streams?.[0]?.side_data_list?.[0]?.rotation
  assert.equal(Number(reported), degrees, `Rotation side data was not applied (got ${reported})`)
  return path
}

/** Irregular presentation timestamps (avg_frame_rate diverges from the constant r_frame_rate),
 * representative of a genuinely variable-rate source rather than a synthetic constant one. */
async function buildVfrSource(dir, sourcePath) {
  const path = join(dir, 'vfr.mp4')
  await ffmpeg(['-i', sourcePath, '-vf', 'setpts=if(mod(N\\,2)\\,PTS+0.5/TB\\,PTS)', '-fps_mode', 'passthrough',
    '-c:v', 'h264_videotoolbox', '-c:a', 'copy', path])
  const probe = await ffprobeJson(['-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,avg_frame_rate', path])
  const { r_frame_rate: r, avg_frame_rate: a } = probe.streams[0]
  assert.notEqual(r, a, 'VFR fixture did not produce a genuinely irregular frame rate')
  return path
}

/** A 4-minute source with silent stretches and short audible beeps at known offsets — the
 * long-pause / long-form sync case ADR 0004 named as unmeasured. */
async function buildLongformSource(dir, { width, height, rate, durationSec }, beepTimesSec) {
  const path = join(dir, 'longform.mp4')
  const beepInputs = beepTimesSec.flatMap(() => ['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=0.3'])
  // Input 0 is the video-only backdrop (no audio stream), input 1 is the silent bed, inputs 2.. are
  // the beeps — every audio reference below is offset by that, not by the beep's own array index.
  const delays = beepTimesSec.map((t, i) => `[${i + 2}:a]adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)}[b${i}]`).join(';')
  const mixInputs = beepTimesSec.map((_, i) => `[b${i}]`).join('')
  const filter = `${delays};[1:a]${mixInputs}amix=inputs=${beepTimesSec.length + 1}:duration=first:normalize=0[aout]`
  await ffmpeg([
    '-f', 'lavfi', '-i', `smptebars=size=${width}x${height}:rate=${rate}:duration=${durationSec}`,
    '-f', 'lavfi', '-i', `anullsrc=sample_rate=48000:channel_layout=stereo:duration=${durationSec}`,
    ...beepInputs, '-filter_complex', filter, '-map', '0:v', '-map', '[aout]',
    '-pix_fmt', 'yuv420p', '-c:v', 'h264_videotoolbox', '-c:a', 'aac', path,
  ])
  return path
}

// ---------------------------------------------------------------------------------------------
// Manifest authoring. Text is drawn from the project's own shaping fixtures; word timing is
// authored (evenly spaced, manual), never a claimed transcript.
// ---------------------------------------------------------------------------------------------
function authoredCue(id, text, startUs, wordDurationUs) {
  const words = captionTokens(text).map((token, index) => ({
    id: `${id}-w${index}`, text: token.text, textStart: token.textStart, textEnd: token.textEnd,
    startUs: startUs + index * wordDurationUs, endUs: startUs + index * wordDurationUs + Math.round(wordDurationUs * 0.8),
    timingSource: 'manual', needsReview: false,
  }))
  const endUs = Math.max(startUs + 1_000_000, (words.at(-1)?.endUs ?? startUs) + 200_000)
  return { id, startUs, endUs, text, timingSource: 'manual', needsReview: false, textSource: 'user', words }
}

const FIXTURE_TEXTS = Object.fromEntries(captionFixtures.map((f) => [f.id, f.text]))

function manifestFor(cues, motion) {
  return {
    version: 2, cues, style: { ...DEFAULT_CAPTION_STYLE, motion }, overlays: [], blurRegions: [], audioClips: [],
  }
}

/** Three cues spread across a 20s source, well clear of frame 0 (kept clean as the backdrop
 * reference) and of each other. */
function shortManifest(motion) {
  return manifestFor([
    authoredCue('c1', FIXTURE_TEXTS['vowel-signs'], 2_000_000, 300_000),
    authoredCue('c2', FIXTURE_TEXTS.conjuncts, 8_000_000, 300_000),
    authoredCue('c3', FIXTURE_TEXTS.wrapping, 14_000_000, 250_000),
  ], motion)
}

/** One cue for the shorter edge-case sources (ntsc/rotated/vfr, 4-6s). */
function edgeManifest(motion) {
  return manifestFor([authoredCue('e1', FIXTURE_TEXTS.decomposed, 1_500_000, 300_000)], motion)
}

/** One cue starting exactly at each beep, so caption onset can be measured against audio onset. */
function longformManifest(motion, beepTimesSec) {
  return manifestFor(beepTimesSec.map((t, i) => authoredCue(`beep${i}`, FIXTURE_TEXTS.punctuation, Math.round(t * 1_000_000), 200_000)), motion)
}

// ---------------------------------------------------------------------------------------------
// Stage (d): caption-layer parity — preview window vs. export-host window, same FrameRequest.
// ---------------------------------------------------------------------------------------------
function createWindow(composition, offscreen) {
  const window = new BrowserWindow({ ...composition, useContentSize: true, frame: false, show: !offscreen,
    enableLargerThanScreen: true, transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen, nodeIntegration: false, contextIsolation: true, sandbox: true,
      backgroundThrottling: false, partition: `x3-${offscreen ? 'export' : 'preview'}-${Math.random().toString(36).slice(2)}` } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  return window
}

/** Fixed absolute timestamps per cue: one frame before start, start, well inside (a word
 * boundary for word-driven motions), one frame before end, and end (the first blank frame). */
function frameTimesForCue(cue, plan) {
  const rawIndex = (us) => (us - plan.range.startUs) * plan.frameRate.numerator / (1_000_000 * plan.frameRate.denominator)
  // Nearest frame to `us`.
  const at = (us) => { const index = Math.max(0, Math.round(rawIndex(us))); return { index, timestampUs: frameSourceUs(index, plan.range.startUs, plan.frameRate) } }
  // Last frame strictly before `us` (ceil-then-subtract-one lands one frame earlier even when `us`
  // falls exactly on a frame boundary, unlike `at`'s nearest-frame rounding).
  const before = (us) => { const index = Math.max(0, Math.ceil(rawIndex(us)) - 1); return { index, timestampUs: frameSourceUs(index, plan.range.startUs, plan.frameRate) } }
  const midWord = cue.words[Math.floor(cue.words.length / 2)]
  return [
    { label: 'start-1f', ...before(cue.startUs) },
    { label: 'start', ...at(cue.startUs) },
    { label: 'mid-word', ...at(midWord ? Math.round((midWord.startUs + midWord.endUs) / 2) : cue.startUs) },
    { label: 'end-1f', ...before(cue.endUs) },
    { label: 'end', ...at(cue.endUs) },
  ]
}

async function captionLayerParity(preview, exported, plan, manifest, cases) {
  let marker = 0
  for (const cue of manifest.cues) {
    for (const point of frameTimesForCue(cue, plan)) {
      const { request } = frameRequestAt(manifest, plan, point.index)
      const a = await renderPreview(preview, request, ++marker)
      const b = await renderOffscreen(exported, request, ++marker)
      assert.deepEqual(b.state, a.state, `Preview/export composition state differs (${manifest.style.motion}, ${cue.id}, ${point.label})`)
      let differingBytes = 0, maxByteDelta = 0
      for (let i = 0; i < a.bitmap.length; i++) {
        if (a.bitmap[i] !== b.bitmap[i]) differingBytes++
        maxByteDelta = Math.max(maxByteDelta, Math.abs(a.bitmap[i] - b.bitmap[i]))
      }
      assert.equal(differingBytes, 0, `Caption-layer pixel mismatch (${manifest.style.motion}, ${cue.id}, ${point.label})`)
      cases.push({ motion: manifest.style.motion, cue: cue.id, point: point.label, frameIndex: point.index, timestampUs: point.timestampUs, differingBytes, maxByteDelta })
    }
  }
}

/** Real Chromium preview/export bitmap equality for each built-in keynote title at fixed times. */
async function keynoteLayerParity(preview, exported, cases) {
  let marker = 0x400000
  for (const template of CAPTION_TEMPLATES.filter((entry) => entry.id.startsWith('keynote-'))) {
    for (const composition of [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }]) {
      preview.setContentSize(composition.width, composition.height)
      exported.setContentSize(composition.width, composition.height)
      const original = defaultTextOverlay('keynote', 0, 3_000_000, 'മലയാളം and English')
      const item = { ...original, ...titleTemplateChanges(template, original) }
      for (const timestampUs of [100_000, 1_500_000, 2_850_000]) {
        const { visible: _visible, ...motion } = textMotionAt(item, timestampUs)
        const request = frameRequestV4Schema.parse({ version: 4, composition,
          cue: { text: ' ', startUs: 0, endUs: 3_000_000 }, style: DEFAULT_CAPTION_STYLE, timestampUs,
          overlays: [], frameEffects: {}, textActors: [{ item, cue: decorativeTextCue(item), timestampUs, ...motion }] })
        const a = await renderPreview(preview, request, ++marker)
        const b = await renderOffscreen(exported, request, ++marker)
        assert.deepEqual(b.state, a.state, `Keynote state mismatch: ${template.id}, ${composition.width}x${composition.height}, ${timestampUs}`)
        assert.deepEqual(b.bitmap, a.bitmap, `Keynote pixel mismatch: ${template.id}, ${composition.width}x${composition.height}, ${timestampUs}`)
        cases.push({ template: template.id, composition, timestampUs, differingBytes: 0 })
      }
      // Layer opacity (docs/EDITING.md "Layer opacity and blend"): a 50 % title must paint identically and dimmer.
      const half = { ...item, opacity: 0.5 }
      const halfRequest = frameRequestV4Schema.parse({ version: 4, composition,
        cue: { text: ' ', startUs: 0, endUs: 3_000_000 }, style: DEFAULT_CAPTION_STYLE, timestampUs: 1_500_000,
        overlays: [], frameEffects: {}, textActors: [{ item: half, cue: decorativeTextCue(half), timestampUs: 1_500_000, ...(({ visible: _v, ...m }) => m)(textMotionAt(half, 1_500_000)) }] })
      const fullRequest = { ...halfRequest, textActors: [{ ...halfRequest.textActors[0], item }] }
      const ha = await renderPreview(preview, halfRequest, ++marker)
      const hb = await renderOffscreen(exported, halfRequest, ++marker)
      const full = await renderOffscreen(exported, fullRequest, ++marker)
      assert.deepEqual(hb.bitmap, ha.bitmap, `Title opacity pixel mismatch: ${template.id}, ${composition.width}x${composition.height}`)
      const alphaSum = (bitmap) => { let sum = 0; for (let i = 3; i < bitmap.length; i += 4) sum += bitmap[i]; return sum }
      assert.ok(alphaSum(hb.bitmap) < alphaSum(full.bitmap), `A 50% title must be fainter than an opaque one: ${template.id}`)
      cases.push({ template: template.id, composition, titleOpacity: 0.5, differingBytes: 0 })
    }
  }
}

/** The visible preview window's pixels after a request, without the marker handshake the text checks use.
 * While a shape is on screen that window's capture adds a few levels of noise to flat colours, including the
 * 1-pixel marker, so an exact marker match never settles; two animation frames plus a short wait do. */
async function settledPreviewBitmap(window, request) {
  await window.webContents.executeJavaScript(`window.x1.render(${JSON.stringify(request)}, 0)`)
  await window.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const deadline = Date.now() + 15000
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 120))
    const image = await window.webContents.capturePage()
    const size = image.getSize()
    if (size.width === request.composition.width && size.height === request.composition.height) {
      const bitmap = image.toBitmap()
      bitmap.fill(0, bitmap.length - 4) // the marker pixel is not part of the picture
      return bitmap
    }
    if (Date.now() > deadline) throw new Error(`Preview never reached ${request.composition.width}x${request.composition.height} (last ${size.width}x${size.height})`)
  }
}

/** Vector shapes (docs/EDITING.md "Shapes"): every preset, at rest and part-way through its draw-on/sweep,
 * in a portrait and a landscape frame, painted by the export host (offscreen, exact marker handshake) and by the
 * live-preview window must agree, and the export host must actually draw the shape. A title above the captions is
 * mixed in to exercise the shared layer order. Each composition gets its own pair of windows created at exactly
 * that size: resizing an existing offscreen window can keep painting at the old size, and the preview is a real
 * window that Windows will not grow past the work area (so the portrait frame is 4:5, not 9:16). */
async function shapeLayerParity(bundleDir, windows, cases) {
  let marker = 0xC00000
  for (const composition of [{ width: 1080, height: 1350 }, { width: 1920, height: 1080 }]) {
    const preview = createWindow(composition, false), exported = createWindow(composition, true)
    windows.add(preview); windows.add(exported)
    exported.webContents.setFrameRate(240)
    await preview.loadFile(join(bundleDir, 'index.html'))
    await exported.loadFile(join(bundleDir, 'index.html'))
    const height = composition.height * 1080 / composition.width
    const title = { ...defaultTextOverlay('title', 0, 3_000_000, 'മലയാളം and English'), layerOrder: 2 }
    // Every preset, plus a filled box with four different corner radii (schema 20 `cornerRadii`).
    const box = defaultShape('box', 'shape-box-corners', 0, 3_000_000, height)
    const cornerBox = { ...box, geometry: { ...box.geometry, cornerRadius: 40, cornerRadii: { tl: 0, tr: 90, br: 0, bl: 90 } }, fill: { color: '#4361EE', opacity: 1 } }
    const entries = [...SHAPE_PRESETS.map((preset) => [preset, defaultShape(preset, `shape-${preset}`, 0, 3_000_000, height)]), ['box-corners', cornerBox]]
    for (const [preset, shape] of entries) {
      for (const timestampUs of [50_000, 300_000, 1_500_000, 2_900_000]) {
        const { visible: _visible, ...motion } = textMotionAt(title, timestampUs)
        const build = (shapeActors) => frameRequestV4Schema.parse({ version: 4, composition,
          cue: { text: ' ', startUs: 0, endUs: 3_000_000 }, style: DEFAULT_CAPTION_STYLE, timestampUs,
          overlays: [], frameEffects: {}, textActors: [{ item: title, cue: decorativeTextCue(title), timestampUs, ...motion }], shapeActors })
        const request = build([{ shape, timestampUs }])
        const b = await renderOffscreen(exported, request, ++marker)
        const a = await settledPreviewBitmap(preview, request)
        assert.equal(a.length, b.bitmap.length, `Shape bitmap size: ${preset}`)
        // Noise, not geometry: flat colours can differ by a few levels between the two rasterisers, while a
        // wrong position, size or timing changes hundreds of levels over many pixels.
        let differingBytes = 0, maxByteDelta = 0
        for (let index = 0; index < a.length; index++) {
          const delta = Math.abs(a[index] - b.bitmap[index])
          if (delta) { differingBytes++; maxByteDelta = Math.max(maxByteDelta, delta) }
        }
        assert.ok(maxByteDelta <= 8, `Shape pixel mismatch: ${preset}, ${composition.width}x${composition.height}, ${timestampUs} (${differingBytes} bytes, max delta ${maxByteDelta})`)
        // The export host must really draw the shape: the same frame without it must differ by many bytes once
        // the shape is up (the draw-on has barely started at 50 ms, and the sweep draws nothing yet).
        let shapeBytes = null
        if (timestampUs >= 1_500_000) {
          const bare = await renderOffscreen(exported, build([]), ++marker)
          shapeBytes = 0
          for (let index = 0; index < a.length; index++) if (bare.bitmap[index] !== b.bitmap[index]) shapeBytes++
          assert.ok(shapeBytes > 2000, `Export host did not draw the shape: ${preset}, ${composition.width}x${composition.height}, ${timestampUs} (${shapeBytes} bytes differ from the bare frame)`)
        }
        cases.push({ preset, composition, timestampUs, differingBytes, maxByteDelta, shapeBytes, stalePaints: b.stalePaints })
      }
    }
    preview.destroy(); exported.destroy(); windows.delete(preview); windows.delete(exported)
  }
}

/** Frame-paint effects that cover the whole frame (grain, VHS, vignette, horizontal letterbox) also
 * cover the host's bottom-right marker pixel; this proves the marker still stacks above them, so
 * both windows see a committed paint instead of timing out. Paint-only check: no pixel parity yet. */
async function frameEffectsPaint(preview, exported, composition, cases) {
  const manifest = shortManifest('static-clean')
  const plan = exportPlanSchema.parse({ ...composition, frameRate: { numerator: 30, denominator: 1 }, range: { startUs: 0, endUs: 20_000_000 } })
  const { request: v2 } = frameRequestAt(manifest, plan, 60)
  const frameEffects = {
    vignette: { amount: 0.8, softness: 0.5 },
    letterbox: { orientation: 'horizontal', barPx: 120, color: '#000000' },
    grain: { amount: 0.6, size: 1.5, seed: 7 },
    vhs: { amount: 0.8, scanlines: 0.6, tracking: 0.7, bandY: 0.95, jitter: 0.3, flicker: 0.5, seed: 11 },
  }
  let marker = 0x800000
  for (const [label, effects] of [...Object.entries(frameEffects).map(([kind, value]) => [kind, { [kind]: value }]), ['all', frameEffects]]) {
    const request = { ...v2, version: 3, overlays: v2.overlays ?? [], frameEffects: effects }
    const a = await renderPreview(preview, request, ++marker)
    const b = await renderOffscreen(exported, request, ++marker)
    for (const bitmap of [a.bitmap, b.bitmap]) assert.equal(bitmap.length, composition.width * composition.height * 4, `Frame-effects bitmap size (${label})`)
    cases.push({ effects: label, composition, stalePaints: b.stalePaints })
  }
}

/** Caption-plane opacity (docs/EDITING.md "Layer opacity and blend"): a 50 % plane must paint identically in the
 * preview window and the export host, and fainter than the same request at full opacity. */
async function captionOpacityParity(preview, exported, cases) {
  let marker = 0x500000
  const composition = { width: 1920, height: 1080 }
  preview.setContentSize(composition.width, composition.height)
  exported.setContentSize(composition.width, composition.height)
  const manifest = shortManifest('static-clean')
  const plan = exportPlanSchema.parse({ ...composition, frameRate: { numerator: 30, denominator: 1 }, range: { startUs: 0, endUs: 20_000_000 } })
  const { request: v2 } = frameRequestAt(manifest, plan, 60)
  const dim = frameRequestV4Schema.parse({ version: 4, composition, cue: { text: 'Opacity caption', startUs: 0, endUs: 3_000_000 }, style: DEFAULT_CAPTION_STYLE, timestampUs: 1_500_000,
    overlays: [], frameEffects: {}, textActors: [], captionOpacity: 0.5 })
  const opaque = { ...dim }; delete opaque.captionOpacity
  const a = await renderPreview(preview, dim, ++marker)
  const b = await renderOffscreen(exported, dim, ++marker)
  const solid = await renderOffscreen(exported, opaque, ++marker)
  assert.deepEqual(b.bitmap, a.bitmap, 'Caption plane opacity pixel mismatch between preview and export host')
  const alphaTotal = (bitmap) => { let sum = 0; for (let i = 3; i < bitmap.length; i += 4) sum += bitmap[i]; return sum }
  assert.ok(alphaTotal(b.bitmap) < alphaTotal(solid.bitmap), 'A 50% caption plane must be fainter than an opaque one')
  cases.push({ composition, captionOpacity: 0.5, differingBytes: 0 })
}

/** Layer masks (docs/EDITING.md "Layer masks"): the same masked request must paint byte-identically in
 * the live-preview window and the export host (host-painted layers), and a v5 mask-fill request must
 * produce a PNG whose alpha *is* the mask — opaque inside the shape, transparent outside — which is
 * what FFmpeg multiplies onto a video clip or blur region. */
async function layerMaskParity(preview, exported, composition, cases) {
  const manifest = shortManifest('static-clean')
  const plan = exportPlanSchema.parse({ ...composition, frameRate: { numerator: 30, denominator: 1 }, range: { startUs: 0, endUs: 20_000_000 } })
  const { request: v2 } = frameRequestAt(manifest, plan, 60)
  const scale = composition.width / 1080
  const ellipse = { enabled: true, invert: false, feather: 24, density: 1, shape: { kind: 'ellipse', rect: { x: 240, y: 240, width: 600, height: 400 } } }
  let marker = 0x900000
  const masked = { ...v2, version: 3, overlays: v2.overlays ?? [], captionMask: ellipse, frameEffects: { vignette: { amount: 0.8, softness: 0.5, mask: { ...ellipse, invert: true } } } }
  const a = await renderPreview(preview, masked, ++marker)
  const b = await renderOffscreen(exported, masked, ++marker)
  assert.equal(a.bitmap.length, b.bitmap.length, 'Masked layer bitmap size')
  let differingBytes = 0
  for (let i = 0; i < a.bitmap.length; i++) if (a.bitmap[i] !== b.bitmap[i]) differingBytes++
  assert.equal(differingBytes, 0, 'Masked layer pixel mismatch between preview and export host')
  assert.ok(b.bitmap.some((value, index) => index % 4 === 3 && value > 0), 'The masked vignette painted nothing')


  const fill = await renderOffscreen(exported, { version: 5, composition, cue: { text: ' ', startUs: 0, endUs: 1 }, style: v2.style, timestampUs: 1_000_000, maskFill: ellipse }, ++marker)
  const alphaAt = (x, y) => fill.bitmap[(Math.round(y * scale) * composition.width + Math.round(x * scale)) * 4 + 3]
  const inside = alphaAt(540, 440), outside = alphaAt(20, 20), edge = alphaAt(240, 440)
  assert.equal(inside, 255, 'Mask fill must be opaque inside the shape')
  assert.equal(outside, 0, 'Mask fill must be transparent outside the shape')
  assert.ok(edge > 0 && edge < 255, `Feathered edge must be partial, got ${edge}`)
  cases.push({ composition, differingBytes, maskFill: { inside, outside, edge } })
}

// ---------------------------------------------------------------------------------------------
// Stage (b)/(c): real MP4 export through the production path.
// ---------------------------------------------------------------------------------------------
async function realExport(mediaPath, manifest, workDir, tag) {
  const manifestPath = join(workDir, `${tag}-manifest.json`)
  const outputPath = join(workDir, `${tag}.mp4`)
  await writeFile(manifestPath, JSON.stringify(manifest))
  const env = { ...process.env, CAPTION_STUDIO_EXPORT_SMOKE_PATH: mediaPath, CAPTION_STUDIO_EXPORT_SMOKE_OUTPUT: outputPath, CAPTION_STUDIO_EXPORT_SMOKE_MANIFEST: manifestPath }
  delete env.ELECTRON_RUN_AS_NODE
  // Observed occasionally (a handful of times in dozens of runs): the smoke process's own stdout
  // arrives empty even though it exits 0, a pipe-flush race in the child's shutdown rather than an
  // export failure (the same manifest/source succeeds when retried). One retry absorbs that flake
  // instead of masking a real failure — a genuine export error still throws (`execFile` rejects on
  // the smoke process's own nonzero exit).
  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    const { stdout } = await run(process.execPath, ['.', '--export-smoke'], { cwd: repoRoot, env, maxBuffer: 64 * 1024 * 1024 })
    try {
      const result = JSON.parse(stdout.trim().split('\n').pop())
      result.plan = exportPlanSchema.parse(result.plan)
      result.outputPath = outputPath
      return result
    } catch (error) { lastError = error }
  }
  throw lastError
}

// ---------------------------------------------------------------------------------------------
// Stage (e): composited-frame parity — real encoded frame vs. a straight-alpha composite of the
// real caption-layer render over a clean backdrop frame taken from the same encode (frame 0, before
// any cue — the static pattern makes this a valid backdrop for every later frame).
// ---------------------------------------------------------------------------------------------
async function extractFrameRgba(mp4Path, frameIndex, composition) {
  const png = join(scratchRoot, `x3-frame-${process.pid}-${frameIndex}-${Math.random().toString(36).slice(2)}.png`)
  // `-fps_mode passthrough` (this FFmpeg build has no `-vsync`) keeps exactly the frame `select`
  // matched, with no drop/duplicate, so `frameIndex` names the same frame `frameSourceUs` computed.
  await ffmpeg(['-i', mp4Path, '-vf', `select=eq(n\\,${frameIndex})`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'image2', png])
  const image = nativeImage.createFromPath(png)
  await rm(png, { force: true })
  const size = image.getSize()
  assert.deepEqual(size, composition, `Extracted frame ${frameIndex} has unexpected dimensions`)
  return image.toBitmap() // BGRA on this platform's nativeImage bitmap; consistent for both sides of every comparison below.
}

/** S-Log3-coded source -> production v3 `lut3d` export vs the production WebGL LUT renderer.
 * Both decode the same H.264 frame; the comparison is on interior pixels so chroma
 * subsampling and H.264 edge ringing do not dominate the measurement. */
async function colorGradeParity(workDir, report) {
  const size = 128
  const raw = Buffer.alloc(size * size * 3)
  const levels = [0.02, 0.18, 0.5, 0.9]
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const col = Math.floor(x / 32), row = Math.floor(y / 32)
    const linear = [levels[col], levels[row], levels[(col + row) % 4]]
    for (let channel = 0; channel < 3; channel++) raw[(y * size + x) * 3 + channel] = Math.round(Math.max(0, Math.min(1, encodeLog('s-log3', linear[channel]))) * 255)
  }
  const rawPath = join(workDir, 'color-slog3.rgb')
  const sourcePath = join(workDir, 'color-slog3.mp4')
  await writeFile(rawPath, raw)
  await ffmpeg(['-stream_loop', '-1', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${size}x${size}`, '-framerate', '30', '-i', rawPath,
    '-t', '1', '-c:v', 'h264_videotoolbox', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', sourcePath])
  const cube = bakeGrade({ ...NEUTRAL_GRADE, input: { type: 'log', profile: 's-log3' }, look: { id: 'cinema-soft', strength: 0.8 } })
  const manifest = {
    version: 3, cues: [], style: DEFAULT_CAPTION_STYLE, format: { width: size, height: size, frameRate: { numerator: 30, denominator: 1 } },
    sequenceDurationUs: 1_000_000, inputs: [{ path: sourcePath, kind: 'video' }],
    clips: [{ id: 'color', inputIndex: 0, assetId: 'color', kind: 'video', trackIndex: 0, timelineStartUs: 0, sourceStartUs: 0,
      sourceEndUs: 1_000_000, opacity: 1, fit: 'contain', gain: 0, lutId: 'slog3-look' }],
    overlays: [], blurRegions: [], luts: [{ id: 'slog3-look', size: cube.size, data: encodeCubeData(cube.data) }],
  }
  const result = await realExport(sourcePath, manifest, workDir, 'color-slog3-look')
  const exported = await extractFrameRgba(result.outputPath, 15, { width: size, height: size })
  const sourceDecoded = await extractFrameRgba(sourcePath, 15, { width: size, height: size })
  const bundlePath = join(workDir, 'color-parity-harness.js')
  await build({ entryPoints: ['scripts/color-parity-harness.ts'], outfile: bundlePath, bundle: true, platform: 'browser', format: 'esm' })
  const htmlPath = join(workDir, 'color-parity.html')
  await writeFile(htmlPath, '<!doctype html><canvas></canvas><script type="module" src="./color-parity-harness.js"></script>')
  const window = createWindow({ width: size, height: size }, false)
  try {
    await window.loadFile(htmlPath)
    await window.webContents.executeJavaScript('new Promise(resolve => { const check = () => window.renderColorParity ? resolve(true) : setTimeout(check, 10); check() })')
    const render = (lut) => window.webContents.executeJavaScript(`window.renderColorParity(${JSON.stringify(pathToFileURL(sourcePath).href)}, ${JSON.stringify({ ...lut, data: Array.from(lut.data) })})`)
    const measure = (preview, reference) => {
      let total = 0, max = 0, count = 0
      const signedByChannel = [0, 0, 0], deltas = []
      for (let y = 4; y < size - 4; y++) for (let x = 4; x < size - 4; x++) {
        if (x % 32 < 4 || x % 32 > 27 || y % 32 < 4 || y % 32 > 27) continue
        // WebGL readPixels is bottom-up RGBA; nativeImage.toBitmap is top-down BGRA on macOS.
        const pi = ((size - 1 - y) * size + x) * 4, ei = (y * size + x) * 4
        for (let c = 0; c < 3; c++) {
          const delta = Math.abs(preview[pi + c] - reference[ei + (2 - c)])
          signedByChannel[c] += preview[pi + c] - reference[ei + (2 - c)]
          total += delta; max = Math.max(max, delta); count++; deltas.push(delta)
        }
      }
      deltas.sort((a, b) => a - b)
      return { comparedChannels: count, meanAbsoluteChannelDelta: total / count,
        p95ChannelDelta: deltas[Math.floor(deltas.length * 0.95)], maxChannelDelta: max,
        meanSignedByChannel: signedByChannel.map((sum) => sum / (count / 3)) }
    }
    const sourceDecode = measure(await render(bakeGrade(NEUTRAL_GRADE)), sourceDecoded)
    const graded = measure(await render(cube), exported)
    report.colorGrade = { source: 'S-Log3-coded H.264', look: 'cinema-soft',
      ...graded, sourceDecode,
      preview: 'LutRenderer WebGL2 readPixels', export: 'v3 worker + FFmpeg lut3d + H.264 MP4',
      tolerance: { kind: 'observed bound on this fixture and machine', maxChannelDelta: graded.maxChannelDelta } }
  } finally { window.destroy() }
}

function compositeStraightAlpha(caption, backdrop) {
  const out = Buffer.alloc(caption.length)
  for (let i = 0; i < caption.length; i += 4) {
    const a = caption[i + 3] / 255
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(caption[i + c] * a + backdrop[i + c] * (1 - a))
    out[i + 3] = 255
  }
  return out
}

function captionBoundingBox(bitmap, composition) {
  let minX = composition.width, minY = composition.height, maxX = -1, maxY = -1
  for (let y = 0; y < composition.height; y++) for (let x = 0; x < composition.width; x++) {
    if (bitmap[(y * composition.width + x) * 4 + 3] > 0) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY }
}

// `differingPixels` counts pixels whose max channel delta exceeds `threshold` (0 by default, for
// the descriptive composited-frame report). h264/yuv420p re-encoding of even a static backdrop
// carries real quantization noise — measured on this suite's own longform source at ~1.6 MSE
// (max channel delta well under 10) between two genuinely caption-free frames, against ~1200 MSE
// for a frame that actually carries caption content — so onset detection (below) passes a much
// higher threshold to tell a real caption apart from that noise floor.
function pixelDelta(a, b, composition, box, threshold = 0) {
  let count = 0, differing = 0, maxDelta = 0, total = 0
  for (let y = 0; y < composition.height; y++) for (let x = 0; x < composition.width; x++) {
    if (box && (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY)) continue
    const i = (y * composition.width + x) * 4
    count++
    let pixelMax = 0
    for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] - b[i + c]); pixelMax = Math.max(pixelMax, d); total += d }
    if (pixelMax > threshold) differing++
    maxDelta = Math.max(maxDelta, pixelMax)
  }
  return { pixels: count, differingPixels: differing, maxChannelDelta: maxDelta, meanAbsoluteChannelDelta: count ? total / (count * 3) : 0 }
}

async function compositedFrameParity(exportResult, exported, manifest, cases) {
  const { plan, outputPath } = exportResult
  const composition = { width: plan.width, height: plan.height }
  const backdrop = await extractFrameRgba(outputPath, 0, composition)
  let marker = 100000
  for (const cue of manifest.cues) {
    for (const point of frameTimesForCue(cue, plan)) {
      const { request, active } = frameRequestAt(manifest, plan, point.index)
      const rendered = await renderOffscreen(exported, request, ++marker)
      const captionPng = toPng(rendered.bitmap, composition)
      const box = captionBoundingBox(rendered.bitmap, composition)
      const expected = compositeStraightAlpha(rendered.bitmap, backdrop)
      const actual = await extractFrameRgba(outputPath, point.index, composition)
      const global = pixelDelta(expected, actual, composition, null)
      const boxed = box ? pixelDelta(expected, actual, composition, box) : null
      cases.push({ motion: manifest.style.motion, cue: cue.id, point: point.label, frameIndex: point.index, active, box, global, boxed,
        captionPngSha256: hash(captionPng) })
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Stage (f): sync — audio beep onsets vs. caption onset (frame-diff against the clean backdrop,
// restricted to the caption's own predicted bounding box).
// ---------------------------------------------------------------------------------------------
async function decodePcm(mp4Path) {
  const { stdout } = await run(tools.ffmpegPath, ['-v', 'error', '-i', mp4Path, '-f', 's16le', '-ar', '48000', '-ac', '1', 'pipe:1'], { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 })
  return stdout
}

/** First sample index whose local RMS (a 5ms window) exceeds a fixed threshold, scanning forward
 * from `fromSample`. Threshold is well above AAC dither noise on our silent `anullsrc` bed and well
 * below the synthesized 880Hz tone's amplitude. */
function findOnsetSample(pcm, fromSample, sampleRate) {
  const window = Math.round(sampleRate * 0.005)
  const samples = pcm.length / 2
  for (let start = fromSample; start < samples - window; start++) {
    let sumSquares = 0
    for (let i = 0; i < window; i++) { const s = pcm.readInt16LE((start + i) * 2); sumSquares += s * s }
    if (Math.sqrt(sumSquares / window) > 1500) return start
  }
  return null
}

async function beepSync(exportResult, beepTimesSec) {
  const pcm = await decodePcm(exportResult.outputPath)
  const results = []
  let cursor = 0
  for (const expectedSec of beepTimesSec) {
    const onsetSample = findOnsetSample(pcm, cursor, 48000)
    const onsetSec = onsetSample === null ? null : onsetSample / 48000
    cursor = onsetSample === null ? cursor : onsetSample + 48000 * 0.4
    results.push({ expectedSec, onsetSec, deltaMs: onsetSec === null ? null : Math.round((onsetSec - expectedSec) * 1000) })
  }
  return results
}

async function captionOnsetSync(exportResult, exported, manifest) {
  const { plan, outputPath } = exportResult
  const composition = { width: plan.width, height: plan.height }
  const backdrop = await extractFrameRgba(outputPath, 0, composition)
  const results = []
  let marker = 200000
  for (const cue of manifest.cues) {
    const startIndex = Math.round((cue.startUs - plan.range.startUs) * plan.frameRate.numerator / (1_000_000 * plan.frameRate.denominator))
    const { request } = frameRequestAt(manifest, plan, startIndex)
    const rendered = await renderOffscreen(exported, request, ++marker)
    const box = captionBoundingBox(rendered.bitmap, composition)
    let onsetIndex = null
    if (box) {
      // A real caption's white-on-color-bar text changes its region by hundreds of levels (MSE
      // ~1200, measured); h264 quantization noise between two genuinely caption-free frames of this
      // static backdrop measured MSE ~1.6 (max channel delta well under 10) — so a channel-delta
      // threshold far above that noise floor, on a real fraction of the box, is what tells a caption
      // apart from encoder dither, not "any pixel changed at all".
      const boxArea = (box.maxX - box.minX + 1) * (box.maxY - box.minY + 1)
      for (let index = Math.max(0, startIndex - 3); index <= startIndex + 3; index++) {
        const frame = await extractFrameRgba(outputPath, index, composition)
        const delta = pixelDelta(frame, backdrop, composition, box, 20)
        if (delta.differingPixels > boxArea * 0.2) { onsetIndex = index; break }
      }
    }
    const onsetUs = onsetIndex === null ? null : frameSourceUs(onsetIndex, plan.range.startUs, plan.frameRate)
    results.push({ cue: cue.id, expectedStartUs: cue.startUs, onsetUs, deltaFrames: onsetIndex === null ? null : onsetIndex - startIndex })
  }
  return results
}

// ---------------------------------------------------------------------------------------------
// Layer blend modes (docs/EDITING.md "Layer blend modes"): the preview paints CSS `mix-blend-mode`
// inside an isolated black backdrop; export runs the real v3 filter graph (`split`/`blend`/`overlay`).
// Both render the same scene at 540x540 and are compared per pixel. Pictures are solid colour clips
// and a still PNG (an image over the picture is the case that forces FFmpeg compositing); no video
// decoder is needed, so this runs on machines without an H.264 encoder.
// ---------------------------------------------------------------------------------------------
async function paintBlendScene(window, layers, composition, marker, call = `window.renderBlendScene(${JSON.stringify(layers)}, ${JSON.stringify(composition)}, ${marker})`) {
  const wc = window.webContents
  let committed = false
  let latest = null
  const listener = (_event, _dirty, image) => {
    if (!committed) return
    const size = image.getSize()
    if (size.width !== composition.width || size.height !== composition.height) return
    const bitmap = image.toBitmap()
    const at = bitmap.length - 4
    // nativeImage bitmaps are BGRA; the harness paints rgb(marker) in the corner.
    if (bitmap[at] === (marker & 255) && bitmap[at + 1] === (marker >> 8 & 255) && bitmap[at + 2] === (marker >> 16 & 255)) latest = bitmap
  }
  wc.on('paint', listener)
  try {
    await wc.executeJavaScript(call)
    committed = true
    // Raster of a freshly decoded image can trail the marker by a frame or two: keep the last committed paint.
    for (let attempt = 0; attempt < 8; attempt++) { wc.invalidate(); await new Promise((resolve) => setTimeout(resolve, 100)) }
    if (!latest) throw new Error('Blend scene never painted its marker')
    return latest
  } finally { wc.removeListener('paint', listener) }
}

async function layerBlendParity(workDir, windows, cases) {
  const size = 540, composition = { width: size, height: size }, output = composition
  const harnessPath = join(workDir, 'blend-parity-harness.js')
  await build({ entryPoints: ['scripts/blend-parity-harness.tsx'], outfile: harnessPath, bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(workDir, 'blend-parity.html'), '<!doctype html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="./blend-parity-harness.js"></script></body>')
  const still = join(workDir, 'blend-still.png')
  await ffmpeg(['-f', 'lavfi', '-i', 'smptebars=size=270x270:rate=1:duration=1', '-frames:v', '1', still])
  const backdrop = join(workDir, 'blend-backdrop.png')
  await ffmpeg(['-f', 'lavfi', '-i', `smptebars=size=${size}x${size}:rate=1:duration=1`, '-frames:v', '1', backdrop])

  const window = createWindow(composition, true)
  windows.add(window)
  window.webContents.setFrameRate(60)
  await window.loadFile(join(workDir, 'blend-parity.html'))
  const solid = (color) => ({ type: 'solid', color })
  const scenes = [
    { name: 'multiply picture-in-picture', pictures: [{ color: '#c8a060', rect: null }, { color: '#4080c0', rect: { x: 270, y: 270, width: 540, height: 540 }, blend: 'multiply' }] },
    { name: 'screen image over the picture', pictures: [{ color: '#604020', rect: null }, { image: still, rect: { x: 270, y: 270, width: 540, height: 540 }, blend: 'screen' }] },
    { name: 'overlay colour clip at 60 %', pictures: [{ image: backdrop, rect: null }, { color: '#ff8040', rect: null, opacity: 0.6, blend: 'overlay' }] },
    { name: 'hard light, difference and exclusion tiles', pictures: [{ image: backdrop, rect: null },
      { color: '#8090a0', rect: { x: 0, y: 0, width: 360, height: 1080 }, blend: 'hard-light' }, { color: '#a08060', rect: { x: 360, y: 0, width: 360, height: 1080 }, blend: 'difference' },
      { color: '#60a0c0', rect: { x: 720, y: 0, width: 360, height: 1080 }, blend: 'exclusion' }] },
  ]
  let marker = 0xb00000
  for (const scene of scenes) {
    const layers = scene.pictures.map((picture, index) => picture.image
      ? { kind: 'image', id: `p${index}`, url: pathToFileURL(picture.image).href, label: 'image', rect: picture.rect, opacity: picture.opacity ?? 1, fit: 'stretch', ...(picture.blend ? { blendMode: picture.blend } : {}) }
      : { kind: 'color', id: `p${index}`, paint: paintAt({ kind: 'color', fill: solid(picture.color) }, 0), rect: picture.rect, opacity: picture.opacity ?? 1, ...(picture.blend ? { blendMode: picture.blend } : {}) })
    const preview = await paintBlendScene(window, layers, composition, ++marker)

    const images = scene.pictures.flatMap((picture) => picture.image ? [picture.image] : [])
    let imageIndex = 0
    const clips = scene.pictures.map((picture, index) => {
      const base = { id: `p${index}`, trackIndex: index, timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 1_000_000, opacity: picture.opacity ?? 1,
        ...(picture.rect ? { rect: compositionToPixels(picture.rect, output) } : {}), ...(picture.blend ? { blendMode: picture.blend } : {}) }
      return picture.image
        ? { ...base, kind: 'image', inputIndex: imageIndex++, assetId: `image${imageIndex}`, fit: 'stretch', gain: 0 }
        : { ...base, kind: 'color', fill: solid(picture.color), fit: 'contain', gain: 0 }
    })
    const manifest = exportManifestV3Schema.parse({ version: 3, cues: [], style: DEFAULT_CAPTION_STYLE, format: { ...output, frameRate: { numerator: 30, denominator: 1 } },
      sequenceDurationUs: 1_000_000, inputs: images.map((path) => ({ path, kind: 'image' })), overlays: [], blurRegions: [], clips })
    const graph = exportFilterGraphV3(manifest, []).filterComplex.replace('format=yuv420p[outv]', 'format=rgb24[outv]')
    const { stdout } = await run(tools.ffmpegPath, ['-v', 'error', '-nostdin',
      ...images.flatMap((path) => ['-loop', '1', '-framerate', '30', '-t', '1', '-i', path]),
      '-f', 'lavfi', '-i', `color=c=black@0:s=${size}x${size}:r=30:d=1,format=rgba`,
      '-filter_complex', graph, '-map', '[outv]', '-frames:v', '1', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })

    let max = 0, total = 0, over = 0, count = 0
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (x === size - 1 && y === size - 1) continue // the marker pixel
      for (let channel = 0; channel < 3; channel++) {
        const delta = Math.abs(preview[(y * size + x) * 4 + (2 - channel)] - stdout[(y * size + x) * 3 + channel])
        max = Math.max(max, delta); total += delta; count++
        if (delta > 3) over++
      }
    }
    cases.push({ scene: scene.name, composition, path: images.length ? 'ffmpeg blend (image input)' : 'ffmpeg blend', maxChannelDelta: max, meanAbsoluteChannelDelta: total / count, channelsOverTolerance: over, tolerance: 3 })
    assert.ok(over === 0, `Blend parity: ${scene.name} has ${over} channels off by more than 3 (max ${max})`)
  }
}

// ---------------------------------------------------------------------------------------------
// Shape blend (docs/EDITING.md "Shapes"): a Multiply box and a Screen highlighter above a title, over a picture.
// Preview: the live stage's structure with CSS `mix-blend-mode` on the shapes. Export: the real per-band frame
// requests (`frameRequestAtSequence`, K = 5) painted by the offscreen host, piped through the real v3 filter graph.
// ---------------------------------------------------------------------------------------------
async function shapeBlendParity(workDir, bundleDir, windows, cases) {
  const size = 540, composition = { width: size, height: size }, frameRate = { numerator: 30, denominator: 1 }, frame = 30, timestampUs = 1_000_000
  const harnessPath = join(workDir, 'blend-parity-harness.js')
  await build({ entryPoints: ['scripts/blend-parity-harness.tsx'], outfile: harnessPath, bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(workDir, 'blend-parity.html'), '<!doctype html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="./blend-parity-harness.js"></script></body>')
  const backdrop = join(workDir, 'shape-blend-backdrop.png')
  await ffmpeg(['-f', 'lavfi', '-i', `smptebars=size=${size}x${size}:rate=1:duration=1`, '-frames:v', '1', backdrop])

  const title = { ...defaultTextOverlay('title', 0, 2_000_000, 'Blend മലയാളം'), id: 'blend-title', layerOrder: -3 }
  const box = { ...defaultShape('box', 'blend-box', 0, 2_000_000, 1080), layerOrder: -2, stroke: null, fill: { color: '#4080c0', opacity: 1 }, blendMode: 'multiply' }
  const highlighter = { ...defaultShape('highlight', 'blend-highlighter', 0, 2_000_000, 1080), layerOrder: -1, blendMode: 'screen' }
  const withoutBlend = ({ blendMode: _blendMode, ...shape }) => shape

  const previewWindow = createWindow(composition, true)
  const exportWindow = createWindow(composition, true)
  windows.add(previewWindow); windows.add(exportWindow)
  previewWindow.webContents.setFrameRate(60)
  exportWindow.webContents.setFrameRate(240)
  await previewWindow.loadFile(join(workDir, 'blend-parity.html'))
  await exportWindow.loadFile(join(bundleDir, 'index.html'))

  const layers = [{ kind: 'image', id: 'backdrop', url: pathToFileURL(backdrop).href, label: 'image', rect: null, opacity: 1, fit: 'stretch' }]
  const scene = (shapes, marker) => `window.renderShapeBlendScene(${JSON.stringify(layers)}, ${JSON.stringify([title])}, ${JSON.stringify(shapes)}, ${timestampUs}, ${JSON.stringify(composition)}, ${marker})`
  const preview = await paintBlendScene(previewWindow, layers, composition, 0xd00001, scene([box, highlighter], 0xd00001))
  const plainPreview = await paintBlendScene(previewWindow, layers, composition, 0xd00002, scene([withoutBlend(box), withoutBlend(highlighter)], 0xd00002))

  const manifestFor = (shapes) => exportManifestV3Schema.parse({ version: 3, cues: [], style: DEFAULT_CAPTION_STYLE, format: { ...composition, frameRate },
    sequenceDurationUs: 2_000_000, inputs: [{ path: backdrop, kind: 'image' }], overlays: [], blurRegions: [], textOverlays: [title], shapes,
    clips: [{ id: 'backdrop', kind: 'image', inputIndex: 0, assetId: 'image1', trackIndex: 0, timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 2_000_000, opacity: 1, fit: 'stretch', gain: 0 }] })
  let marker = 0xd10000
  const exportFrame = async (manifest) => {
    const passes = graphicsPasses(manifest.shapes).count
    const sub = []
    for (let pass = 0; pass < passes; pass++) {
      const { request } = frameRequestAtSequence(manifest, frame, null, pass)
      sub.push((await renderOffscreen(exportWindow, request, ++marker)).bitmap)
    }
    const graph = exportFilterGraphV3(manifest, [false], undefined, 'png').filterComplex.replace('format=yuv420p[outv]', 'format=rgb24[outv]')
    const rate = `${frameRate.numerator * passes}/${frameRate.denominator}`
    const child = spawn(tools.ffmpegPath, ['-v', 'error', '-nostdin', '-loop', '1', '-framerate', '30', '-t', '1', '-i', backdrop,
      '-f', 'image2pipe', '-framerate', rate, '-c:v', 'png', '-i', 'pipe:0',
      '-filter_complex', graph, '-map', '[outv]', '-frames:v', '1', '-f', 'rawvideo', '-'])
    const output = new Promise((resolvePromise, reject) => {
      const chunks = []; let stderr = ''
      child.stdout.on('data', (chunk) => chunks.push(chunk)); child.stderr.on('data', (chunk) => { stderr += chunk })
      child.on('close', (code) => code === 0 ? resolvePromise(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exit ${code}: ${stderr}`)))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(Buffer.concat(sub.map((bitmap) => toPng(bitmap, composition))))
    return { rgb: await output, passes }
  }
  const blended = await exportFrame(manifestFor([box, highlighter]))
  const plain = await exportFrame(manifestFor([withoutBlend(box), withoutBlend(highlighter)]))
  assert.equal(blended.passes, 5, 'Two blending shapes must plan five bands')
  assert.equal(plain.passes, 1, 'Shapes without a blend mode must stay a single band')

  // Flat regions only: a pixel whose four neighbours match it in the preview. Glyph and shape edges antialias differently
  // in the two rasterisers (and do not blend identically at partial coverage), so they are reported but not asserted.
  const at = (bitmap, x, y, channel) => bitmap[(y * size + x) * 4 + (2 - channel)]
  let max = 0, total = 0, count = 0, flatMax = 0, flatTotal = 0, flatCount = 0, flatOver = 0
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (x === size - 1 && y === size - 1) continue // the marker pixel
    const flat = x > 0 && y > 0 && x < size - 1 && y < size - 1 && [0, 1, 2].every((channel) => {
      const value = at(preview, x, y, channel)
      return at(preview, x - 1, y, channel) === value && at(preview, x + 1, y, channel) === value && at(preview, x, y - 1, channel) === value && at(preview, x, y + 1, channel) === value
    })
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(at(preview, x, y, channel) - blended.rgb[(y * size + x) * 3 + channel])
      max = Math.max(max, delta); total += delta; count++
      if (flat) { flatMax = Math.max(flatMax, delta); flatTotal += delta; flatCount++; if (delta > 3) flatOver++ }
    }
  }
  // The blend must be visible: the same scene with Normal shapes differs from it by many bytes, in both renderers.
  let previewDiffers = 0, exportDiffers = 0
  for (let index = 0; index < preview.length - 4; index++) if (preview[index] !== plainPreview[index]) previewDiffers++
  for (let index = 0; index < blended.rgb.length; index++) if (blended.rgb[index] !== plain.rgb[index]) exportDiffers++
  cases.push({ scene: 'multiply box and screen highlighter above a title', composition, passes: blended.passes, maxChannelDelta: max, meanAbsoluteChannelDelta: total / count,
    flatMaxChannelDelta: flatMax, flatMeanAbsoluteChannelDelta: flatTotal / flatCount, flatChannels: flatCount, flatChannelsOverTolerance: flatOver, tolerance: 3,
    previewBytesDifferingFromNormal: previewDiffers, exportBytesDifferingFromNormal: exportDiffers })
  assert.ok(flatCount > 50_000, `Shape blend parity: only ${flatCount} flat channels to compare`)
  assert.ok(previewDiffers > 2000 && exportDiffers > 2000, `Blend is not visible against Normal (preview ${previewDiffers}, export ${exportDiffers} bytes)`)
  assert.ok(flatOver === 0, `Shape blend parity: ${flatOver} flat channels off by more than 3 (max ${flatMax})`)
}

// ---------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------
async function main() {
  const workDir = await mkdtemp(join(scratchRoot, 'caption-x3-'))
  const report = {
    machine: { platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0].model, logicalCores: cpus().length, ramBytes: totalmem() },
    versions: process.versions, workDir, captionLayer: [], keynoteLayer: [], composited: [], sync: {}, notes: [],
  }
  const evidenceDir = 'docs/decisions/evidence'
  await mkdir(evidenceDir, { recursive: true })
  const evidencePath = join(evidenceDir, `x3-parity-${only?.size === 1 && (only.has('keynote') || only.has('shapes') || only.has('layer-blend') || only.has('shape-blend')) ? `${[...only][0]}-` : ''}${new Date().toISOString().slice(0, 10)}.json`)
  // Written after every stage below, not only at the end, so a run that is interrupted (killed,
  // crashed) still leaves the evidence file showing everything completed up to that point instead
  // of an empty or missing file.
  const saveEvidence = () => writeFile(evidencePath, JSON.stringify(report, null, 2))
  const windows = new Set()
  try {
    // Bundle the same shared harness the real export host loads (dist-export), fresh, so this
    // script always exercises the current renderer, not a stale build.
    const bundleDir = join(workDir, 'harness')
    await mkdir(bundleDir, { recursive: true })
    const bundle = await build({ metafile: true, entryPoints: ['src/export/frameHarness.tsx'], outfile: join(bundleDir, 'frame-harness.js'), bundle: true,
      platform: 'browser', format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
    report.sourceHashes = Object.fromEntries(await Promise.all(Object.keys(bundle.metafile.inputs).filter((p) => !p.startsWith('node_modules/')).map(async (p) => [p, hash(await readFile(p))])))
    const html = (await readFile('tests/export-frames.html', 'utf8')).replace('/src/export/frameHarness.tsx', './frame-harness.js')
    await writeFile(join(bundleDir, 'index.html'), html)

    const beepTimesSec = [5, 90, 175, 230]

    // Synthesize sources
    const paths = {}
    if (include('landscape')) paths.landscape = await synthesizeSource(workDir, 'landscape', SOURCES.landscape)
    if (include('portrait')) paths.portrait = await synthesizeSource(workDir, 'portrait', SOURCES.portrait)
    if (include('ntsc')) paths.ntsc = await synthesizeSource(workDir, 'ntsc', SOURCES.ntsc)
    if (include('rotated')) {
      const base = await synthesizeSource(workDir, 'rotated-base', SOURCES.rotatedBase)
      paths.rotated = await rotateSource(workDir, base, 90)
    }
    if (include('vfr')) {
      const base = await synthesizeSource(workDir, 'vfr-base', SOURCES.vfrBase)
      paths.vfr = await buildVfrSource(workDir, base)
    }
    if (include('longform')) paths.longform = await buildLongformSource(workDir, SOURCES.longform, beepTimesSec)

    const jobs = []
    const motions = ['static-clean', 'active-word-highlight', 'word-pop', 'phrase-fade', 'progressive-word-reveal']
    if (paths.landscape) for (const m of motions) jobs.push({ tag: `landscape-${m}`, mediaPath: paths.landscape, manifest: shortManifest(m), composition: { width: SOURCES.landscape.width, height: SOURCES.landscape.height } })
    if (paths.portrait) for (const m of motions) jobs.push({ tag: `portrait-${m}`, mediaPath: paths.portrait, manifest: shortManifest(m), composition: { width: SOURCES.portrait.width, height: SOURCES.portrait.height } })
    for (const [key, dims] of [['ntsc', SOURCES.ntsc], ['rotated', SOURCES.rotatedBase], ['vfr', SOURCES.vfrBase]]) {
      if (!paths[key]) continue
      for (const m of ['static-clean', 'word-pop']) jobs.push({ tag: `${key}-${m}`, mediaPath: paths[key], manifest: edgeManifest(m), composition: dims })
    }
    let longformJob = null
    if (paths.longform) longformJob = { tag: 'longform-word-pop', mediaPath: paths.longform, manifest: longformManifest('word-pop', beepTimesSec), composition: { width: SOURCES.longform.width, height: SOURCES.longform.height }, beepTimesSec }

    // Stage (d): caption-layer parity, cheap in-memory renders across every manifest above.
    const preview = createWindow({ width: 1920, height: 1920 }, false), exported = createWindow({ width: 1920, height: 1920 }, true)
    windows.add(preview); windows.add(exported)
    exported.webContents.setFrameRate(240)
    await preview.loadFile(join(bundleDir, 'index.html'))
    await exported.loadFile(join(bundleDir, 'index.html'))
    for (const job of [...jobs, ...(longformJob ? [longformJob] : [])]) {
      // Frame rate for the caption-layer stage comes from the manifest's own cues only (no encode
      // needed yet); a frame grid at the source's real rate over a generous range is enough to
      // place fixed offsets inside each cue, matching X1's own prototype approach.
      const approxPlan = exportPlanSchema.parse({ width: job.composition.width, height: job.composition.height,
        frameRate: job.tag.startsWith('ntsc') ? { numerator: 30000, denominator: 1001 } : { numerator: 30, denominator: 1 },
        range: { startUs: 0, endUs: 10_000_000_000 } })
      preview.setContentSize(job.composition.width, job.composition.height)
      exported.setContentSize(job.composition.width, job.composition.height)
      await captionLayerParity(preview, exported, approxPlan, job.manifest, report.captionLayer)
    }
    if (include('keynote')) await keynoteLayerParity(preview, exported, report.keynoteLayer)
    if (include('shapes')) { report.shapeLayer = []; await shapeLayerParity(bundleDir, windows, report.shapeLayer) }
    if (include('frame-effects')) {
      report.frameEffects = []
      // The windows' own creation size: a fresh offscreen resize can still paint at the old size.
      const composition = { width: 1920, height: 1920 }
      await frameEffectsPaint(preview, exported, composition, report.frameEffects)
    }
    if (include('layer-opacity')) { report.captionOpacity = []; await captionOpacityParity(preview, exported, report.captionOpacity) }
    if (include('layer-blend')) { report.layerBlend = []; await layerBlendParity(workDir, windows, report.layerBlend) }
    if (include('shape-blend')) { report.shapeBlend = []; await shapeBlendParity(workDir, bundleDir, windows, report.shapeBlend) }
    if (include('layer-masks')) {
      report.layerMasks = []
      await layerMaskParity(preview, exported, { width: 1920, height: 1920 }, report.layerMasks)
    }
    await saveEvidence()

    if (include('color')) {
      try { await colorGradeParity(workDir, report) }
      catch (error) { report.notes.push({ tag: 'color-slog3-look', stage: 'color-parity', error: error?.stack || String(error) }); throw error }
      await saveEvidence()
    }

    // Stage (e)/(f): real exports. One job's failure is recorded and does not stop the rest —
    // the evidence file should show every case this run could reach, not abort on the first.
    let hardFailure = null
    for (const job of jobs) {
      try {
        const result = await realExport(job.mediaPath, job.manifest, workDir, job.tag)
        assert.equal(result.frameCount, exportFrameCountFor(exportOutputDurationUs(result.plan), result.plan.frameRate), `${job.tag}: encoded frame count does not match the plan`)
        exported.setContentSize(result.plan.width, result.plan.height)
        await compositedFrameParity(result, exported, job.manifest, report.composited)
        if (job.tag.startsWith('rotated')) assert.deepEqual({ width: result.plan.width, height: result.plan.height }, { width: SOURCES.rotatedBase.height, height: SOURCES.rotatedBase.width }, 'Rotated export did not swap dimensions')
      } catch (error) {
        report.notes.push({ tag: job.tag, stage: 'composited', error: error?.stack || String(error) })
        hardFailure ??= error
      }
      await saveEvidence()
    }
    if (longformJob) {
      try {
        const result = await realExport(longformJob.mediaPath, longformJob.manifest, workDir, longformJob.tag)
        exported.setContentSize(result.plan.width, result.plan.height)
        report.sync.beeps = await beepSync(result, longformJob.beepTimesSec)
        report.sync.captions = await captionOnsetSync(result, exported, longformJob.manifest)
        for (const b of report.sync.beeps) assert.ok(b.deltaMs !== null && Math.abs(b.deltaMs) < 50, `Beep onset missed or drifted: ${JSON.stringify(b)}`)
        for (const c of report.sync.captions) assert.ok(c.onsetUs !== null && Math.abs(c.deltaFrames) <= 2, `Caption onset missed or drifted: ${JSON.stringify(c)}`)
      } catch (error) {
        report.notes.push({ tag: longformJob.tag, stage: 'sync', error: error?.stack || String(error) })
        hardFailure ??= error
      }
      await saveEvidence()
    }

    report.summary = {
      captionLayerCases: report.captionLayer.length,
      keynoteLayerCases: report.keynoteLayer.length,
      captionLayerMismatches: report.captionLayer.filter((c) => c.differingBytes > 0).length,
      compositedCases: report.composited.length,
      worstBoxedMeanDelta: Math.max(0, ...report.composited.map((c) => c.boxed?.meanAbsoluteChannelDelta ?? 0)),
      worstGlobalMeanDelta: Math.max(0, ...report.composited.map((c) => c.global.meanAbsoluteChannelDelta ?? 0)),
      notes: report.notes.length,
    }
    console.log(JSON.stringify(report.summary, null, 2))
    if (hardFailure) throw hardFailure
    return report
  } finally {
    for (const window of windows) window.destroy()
    await saveEvidence()
    console.log(`Evidence: ${evidencePath}`)
    console.log(`Working directory (media, not retained): ${workDir}`)
  }
}

app.whenReady().then(() => main()).then(() => app.exit(0)).catch(async (error) => {
  console.error(error)
  // Written directly, not only logged: this run's own stdout is not always captured reliably by
  // whatever launched it, but the evidence file (written in `main`'s `finally`) and this file both
  // land on disk regardless.
  try { await writeFile(join(scratchRoot, 'export-parity-error.log'), error?.stack || String(error)) } catch {}
  app.exit(1)
})
