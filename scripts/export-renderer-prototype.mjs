import { app, BrowserWindow, nativeImage } from 'electron'
import { build } from 'esbuild'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir, cpus, totalmem, release } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { renderOffscreen, renderPreview, toPng, alphaStats } from './export-frame-transport.mjs'

const software = process.argv.includes('--software')
if (software) app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const framesArg = process.argv.indexOf('--frames')
const frames = framesArg < 0 ? 120 : Number(process.argv[framesArg + 1])
if (!Number.isSafeInteger(frames) || frames < 1 || frames > 2000) throw new Error('--frames must be 1..2000')
let marker = 0
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const memory = () => app.getAppMetrics().map(({ pid, type, memory }) => ({ pid, type, workingSetKiB: memory.workingSetSize, peakWorkingSetKiB: memory.peakWorkingSetSize }))
const totalWorkingSet = (metrics) => metrics.reduce((sum, metric) => sum + metric.workingSetKiB, 0)

function createWindow(composition, offscreen, interactive = false) {
  const window = new BrowserWindow({ ...composition, useContentSize: true, frame: false, show: !offscreen,
    enableLargerThanScreen: true, transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen, nodeIntegration: false, contextIsolation: true, sandbox: true,
      backgroundThrottling: false, partition: `x1-${offscreen ? 'export' : 'preview'}` },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  return window
}

async function run() {
  const output = await mkdtemp(join(tmpdir(), 'caption-x1-'))
  const windows = new Set()
  const report = { mode: software ? 'software' : 'gpu-bitmap', output, framesPerAspect: frames,
    machine: { platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0].model, logicalCores: cpus().length, ramBytes: totalmem() },
    versions: process.versions, cases: [], benchmarks: [], memorySamples: [], custom: [] }
  try {
    const bundle = await build({ metafile: true, entryPoints: ['src/export/frameHarness.tsx'], outfile: join(output, 'frame-harness.js'), bundle: true,
      platform: 'browser', format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
    report.sourceHashes = Object.fromEntries(await Promise.all(Object.keys(bundle.metafile.inputs).filter((path) => !path.startsWith('node_modules/')).map(async (path) => [path, hash(await readFile(path))])))
    report.bundleSha256 = hash(await readFile(join(output, 'frame-harness.js')))
    report.transportSha256 = hash(await readFile('scripts/export-frame-transport.mjs'))
    const html = (await readFile('tests/export-frames.html', 'utf8')).replace('/src/export/frameHarness.tsx', './frame-harness.js')
    await writeFile(join(output, 'index.html'), html)
    report.baselineMemory = memory()
    for (const [aspect, composition] of Object.entries({ portrait: { width: 1080, height: 1920 }, landscape: { width: 1920, height: 1080 } })) {
      const preview = createWindow(composition, false, true), exported = createWindow(composition, true)
      windows.add(preview); windows.add(exported)
      exported.webContents.setFrameRate(240)
      await preview.loadFile(join(output, 'index.html'), { query: { interactive: '1' } })
      await exported.loadFile(join(output, 'index.html'))
      const fixture = await preview.webContents.executeJavaScript('window.x1.editedState()')
      fixture.composition = composition
      // Real input event changes the preview's React state; export takes that edited state.
      await renderPreview(preview, fixture, ++marker)
      await preview.webContents.executeJavaScript(`(() => {
        const input = document.getElementById('parity-color');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#ffcc44');
        input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`)
      const edited = await preview.webContents.executeJavaScript('window.x1.editedState()')
      assert.equal(edited.style.appearance.primaryColor, '#ffcc44', 'Interactive preview edit failed')
      await writeFile(join(output, `${aspect}-request.json`), JSON.stringify(edited, null, 2))
      // Remove the editor control before comparing caption-only pixels.
      await preview.webContents.executeJavaScript("document.getElementById('parity-color').parentElement.parentElement.remove()")
      for (const motion of ['static-clean', 'active-word-highlight', 'word-pop', 'phrase-fade', 'progressive-word-reveal']) {
        const origin = edited.cue.startUs
        const times = [origin + 625000, origin - 1, origin, origin + 100000, origin + 225000, edited.cue.endUs - 1, edited.cue.endUs, origin + 625000]
        let firstHash
        let repeatMatches = true
        for (const timestampUs of times) {
          const request = { ...edited, timestampUs, style: { ...edited.style, motion } }
          const a = await renderPreview(preview, request, ++marker)
          const b = await renderOffscreen(exported, request, ++marker)
          assert.deepEqual(b.state, a.state, 'Preview/export composition state differs')
          assert.equal(b.state.elapsedUs, timestampUs - request.cue.startUs)
          if (motion === 'phrase-fade' && timestampUs === origin + 100000) assert.equal(b.state.opacity, .5)
          if (motion === 'word-pop' && timestampUs === origin + 625000) {
            assert.equal(b.state.words.find((word) => word.active).wordIndex, 2)
            assert.equal(b.state.words[2].scale, 1.1108655439013544)
          }
          let differingBytes = 0, maxByteDelta = 0
          for (let i = 0; i < a.bitmap.length; i++) {
            if (a.bitmap[i] !== b.bitmap[i]) differingBytes++
            maxByteDelta = Math.max(maxByteDelta, Math.abs(a.bitmap[i] - b.bitmap[i]))
          }
          const stats = alphaStats(b.bitmap), digest = hash(b.bitmap)
          if (timestampUs < origin || timestampUs >= edited.cue.endUs || (motion === 'phrase-fade' && timestampUs === origin)) assert.equal(stats.clear, composition.width * composition.height)
          else { assert.ok(stats.clear > 0); if (b.state.opacity > 1 / 255) assert.ok(stats.partial > 0); if (b.state.opacity === 1) assert.ok(stats.opaque > 0) }
          if (!firstHash) firstHash = digest
          else if (timestampUs === times[0]) repeatMatches = digest === firstHash
          const png = toPng(b.bitmap, composition)
          assert.deepEqual(nativeImage.createFromBuffer(png).toBitmap(), b.bitmap, 'PNG alpha/bitmap round trip differs')
          report.cases.push({ aspect, motion, timestampUs, differingBytes, maxByteDelta, alpha: stats,
            hash: digest, repeatMatches, readinessMs: b.readinessMs, fontsStatus: b.fontsStatus, stalePaints: b.stalePaints })
          if (timestampUs === origin + 625000) {
            await writeFile(join(output, `${aspect}-${motion}-${report.cases.length}.png`), png)
            await writeFile(join(output, `${aspect}-${motion}-preview-${report.cases.length}.png`), toPng(a.bitmap, composition))
          }
        }
      }
      // Selected mixed-font emphasis must survive the production frame contract and render identically
      // in the preview and offscreen export, including backwards seeks and untimed SRT fallback.
      for (const motion of ['static-clean', 'word-pop', 'phrase-fade', 'progressive-word-reveal']) {
        for (const delta of [100000, 625000, 1600000, 625000]) {
          const emphasized = [edited.cue.words[0], edited.cue.words[2], edited.cue.words[7]].map(({ text, textStart, textEnd }) => ({ text, textStart, textEnd }))
          const request = { ...edited, timestampUs: edited.cue.startUs + delta,
            cue: { ...edited.cue, emphasized }, style: { ...edited.style, motion,
              appearance: { ...edited.style.appearance, emphasisFontFamily: 'Georgia', emphasisWeight: 700,
                emphasisItalic: true, emphasisMotion: 'pop', secondaryColor: '#edff39' } } }
          const a = await renderPreview(preview, request, ++marker), b = await renderOffscreen(exported, request, ++marker)
          assert.deepEqual(b.state, a.state, 'Selected emphasis composition mismatch')
          assert.deepEqual(b.bitmap, a.bitmap, 'Selected emphasis pixel mismatch')
          assert.deepEqual(b.state.layout.inputs.emphasized, emphasized)
          report.cases.push({ aspect, fixture: 'selected-emphasis', motion, timestampUs: request.timestampUs,
            differingBytes: 0, maxByteDelta: 0, repeatMatches: true, hash: hash(b.bitmap), readinessMs: b.readinessMs })
          if (delta === 1600000) await writeFile(join(output, `${aspect}-selected-${motion}.png`), toPng(b.bitmap, composition))
        }
      }
      const samples = await exported.webContents.executeJavaScript('window.x1.sampleTexts')
      for (const sample of [...samples, { id: 'estimated', text: edited.cue.text }, { id: 'cue-only', text: edited.cue.text }, { id: 'styled', text: edited.cue.text }]) {
        const request = { ...edited, cue: { ...edited.cue, text: sample.text,
          words: sample.id === 'styled' ? edited.cue.words : sample.id === 'estimated' ? edited.cue.words.map((word) => ({ ...word, timingSource: 'estimated', needsReview: true })) : [] },
          style: { ...edited.style, motion: ['styled', 'estimated', 'cue-only'].includes(sample.id) ? 'word-pop' : 'static-clean',
            appearance: sample.id === 'styled' ? { ...edited.style.appearance, gradientEnabled: true, emphasisGradientEnabled: true,
              glowEnabled: true, depthEnabled: true, underline: true, letterSpacing: 1, wordSpacing: 2, lineHeight: 1.8 } : edited.style.appearance } }
        const a = await renderPreview(preview, request, ++marker), b = await renderOffscreen(exported, request, ++marker)
        assert.deepEqual(b.state, a.state)
        assert.deepEqual(b.bitmap, a.bitmap, `Text fixture pixel mismatch: ${sample.id}`)
        assert.equal(b.state.layout.lines.map((line) => line.text + line.separator).join(''), sample.text)
        if (sample.id === 'estimated') assert.match(b.state.timingNotice, /Estimated/)
        if (sample.id === 'cue-only') assert.equal(b.state.motion, 'static-clean')
        report.cases.push({ aspect, fixture: sample.id, motion: request.style.motion, timestampUs: request.timestampUs,
          differingBytes: 0, maxByteDelta: 0, repeatMatches: true, alpha: alphaStats(b.bitmap), hash: hash(b.bitmap), readinessMs: b.readinessMs })
        await writeFile(join(output, `${aspect}-${sample.id}.png`), toPng(b.bitmap, composition))
      }
      exported.webContents.debugger.attach('1.3')
      await exported.webContents.debugger.sendCommand('DOM.enable'); await exported.webContents.debugger.sendCommand('CSS.enable')
      await renderOffscreen(exported, edited, ++marker)
      const { root } = await exported.webContents.debugger.sendCommand('DOM.getDocument')
      const { nodeIds } = await exported.webContents.debugger.sendCommand('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-caption-line]' })
      report[`${aspect}Fonts`] = await Promise.all(nodeIds.map((nodeId) => exported.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId })))
      exported.webContents.debugger.detach()
      // Actual FontFaceSet failure (missing local face), not a mocked readiness flag.
      await exported.webContents.executeJavaScript(`document.fonts.add(new FontFace('X1 Broken Local', 'local("X1 nonexistent face 916")'))`)
      const fontFailureStart = performance.now()
      await assert.rejects(renderOffscreen(exported, { ...edited, style: { ...edited.style, appearance: { ...edited.style.appearance, fontFamily: 'X1 Broken Local' } } }, ++marker), /font failed/)
      report[`${aspect}FontFailureMs`] = performance.now() - fontFailureStart
      await renderOffscreen(exported, edited, ++marker) // recovery to the real system stack
      await assert.rejects(renderOffscreen(exported, { ...edited, timestampUs: .5 }, ++marker))
      // Benchmark excludes preview capture and disk writes; includes request, readiness, repaint and bitmap copy.
      const rawMs = [], pngMs = []
      const beforeMemory = memory()
      for (let index = 0; index < frames; index++) {
        // Absolute mapping, deliberately varied word phases; no rounded-duration accumulation.
        const timestampUs = edited.cue.startUs + Number(BigInt(index) * 1000000n * 1001n / 30000n) % (edited.cue.endUs - edited.cue.startUs)
        const start = performance.now()
        const frame = await renderOffscreen(exported, { ...edited, timestampUs }, ++marker)
        rawMs.push(performance.now() - start)
        const encode = performance.now(); toPng(frame.bitmap, composition); pngMs.push(performance.now() - encode)
        if (index % 10 === 0 || index === frames - 1) report.memorySamples.push({ aspect, index, metrics: memory() })
      }
      const sum = (values) => values.reduce((a, b) => a + b, 0)
      const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1]
      report.benchmarks.push({ aspect, composition, frames, bitmapBytes: composition.width * composition.height * 4,
        rawFps: frames * 1000 / sum(rawMs), rawMeanMs: sum(rawMs) / frames, rawP95Ms: p95(rawMs),
        pngMeanMs: sum(pngMs) / frames, pngP95Ms: p95(pngMs), rawPlusPngFps: frames * 1000 / (sum(rawMs) + sum(pngMs)),
        beforeWorkingSetKiB: totalWorkingSet(beforeMemory), afterWorkingSetKiB: totalWorkingSet(memory()),
        sampledMaxWorkingSetKiB: Math.max(...report.memorySamples.filter((sample) => sample.aspect === aspect).map((sample) => totalWorkingSet(sample.metrics))) })
      const requestArg = process.argv.indexOf('--request')
      if (requestArg >= 0) {
        const path = resolve(process.argv[requestArg + 1])
        const bytes = await readFile(path); assert.ok(bytes.length <= 256 * 1024, 'Request file too large')
        const value = JSON.parse(bytes.toString('utf8'))
        const requests = Array.isArray(value) ? value : [value]
        assert.ok(requests.length <= 100, 'Too many custom requests')
        // Custom dimensions are configured explicitly; renderer validates each request before painting.
        if (aspect === 'portrait') for (const [index, request] of requests.entries()) {
          assert.ok(Number.isInteger(request.composition?.width) && request.composition.width >= 16 && request.composition.width <= 3840)
          assert.ok(Number.isInteger(request.composition?.height) && request.composition.height >= 16 && request.composition.height <= 3840)
          exported.setContentSize(request.composition.width, request.composition.height)
          const frame = await renderOffscreen(exported, request, ++marker)
          const name = `requested-${index}.png`; await writeFile(join(output, name), toPng(frame.bitmap, request.composition))
          report.custom.push({ file: name, timestampUs: request.timestampUs, state: frame.state, alpha: alphaStats(frame.bitmap) })
        }
      }
      preview.destroy(); exported.destroy(); windows.delete(preview); windows.delete(exported)
    }
    assert.ok(report.cases.every((entry) => entry.differingBytes === 0), 'Preview/export pixels differ')
    assert.ok(report.cases.every((entry) => entry.repeatMatches), 'Seek order changed exported pixels')
    report.sourceHashesAfterRun = Object.fromEntries(await Promise.all(Object.keys(report.sourceHashes).map(async (path) => [path, hash(await readFile(path))])))
    assert.deepEqual(report.sourceHashesAfterRun, report.sourceHashes, 'Sources changed during measurement; rerun required')
    report.finalMemory = memory()
    report.gpuFeatures = app.getGPUFeatureStatus()
    await writeFile(join(output, 'measurements.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ output, mode: report.mode, parityCases: report.cases.length,
      maxDifferingBytes: Math.max(...report.cases.map((entry) => entry.differingBytes)), benchmarks: report.benchmarks }))
  } finally { await writeFile(join(output, 'measurements.json'), JSON.stringify(report, null, 2)); console.log(`Evidence: ${output}`); for (const window of windows) window.destroy() }
}
app.on('window-all-closed', () => {})
app.whenReady().then(run).then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1) })
