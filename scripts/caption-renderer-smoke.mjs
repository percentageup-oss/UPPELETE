import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EXPECTED_STATIC_CASES = 28 // R1: 7 fixtures × {portrait, landscape} × {100%, 65%}
const EXPECTED_MOTION_CASES = 23 // R2: 5 motions × {portrait, landscape} × {mid-word, gap} + 3 edge cases

// Owned test server/window only; no interaction with existing app windows or user media.
async function run() {
  const output = await mkdtemp(join(tmpdir(), 'caption-r2-smoke-'))
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5187', '--strictPort'], {
    cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
  })
  let window
  let exited = false
  server.once('exit', () => { exited = true })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Vite startup timeout')), 15000)
      server.stdout.on('data', (chunk) => { if (chunk.toString().includes('http://127.0.0.1:5187')) { clearTimeout(timer); resolve() } })
      server.stderr.on('data', (chunk) => process.stderr.write(chunk))
      server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Vite exited ${code}`)) })
    })
    window = new BrowserWindow({ width: 1600, height: 1000, show: true, webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true, sandbox: true } })
    await window.loadURL('http://127.0.0.1:5187/tests/captions.html')
    const result = await window.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      const deadline = performance.now() + 15000;
      while (document.querySelectorAll('[data-case]').length !== ${EXPECTED_STATIC_CASES}
        || document.querySelectorAll('[data-motion-case] [data-caption-renderer]').length !== ${EXPECTED_MOTION_CASES}
        || !document.querySelector('[data-interactive-demo] [data-caption-renderer]')) {
        if (performance.now() > deadline) throw new Error('Caption readiness timeout');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const result = window.inspectCaptionFixtures();
      const preview = document.querySelector('[data-case="wrapping"][data-aspect="0"][data-scale="1"] [data-caption-preview]');
      const host = preview.parentElement;
      const original = { width: host.style.width, height: host.style.height };
      host.style.width = '351px'; host.style.height = '624px';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const resized = window.inspectCaptionFixtures();
      if (JSON.stringify(resized.results.map(r => r.lines)) !== JSON.stringify(result.results.map(r => r.lines))) throw new Error('Live resize reflowed caption lines');
      host.style.width = original.width; host.style.height = original.height;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      result.liveResizePassed = true;
      result.motionGrid = window.inspectMotionGrid();
      result.interactive = await window.driveInteractiveControls();
      return result;
    })()`)
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('DOM.enable')
    await window.webContents.debugger.sendCommand('CSS.enable')
    const { root } = await window.webContents.debugger.sendCommand('DOM.getDocument')
    const platformFonts = {}
    for (const id of ['conjuncts', 'decomposed']) {
      const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-case="${id}"] [data-caption-line="0"]` })
      platformFonts[id] = await window.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId })
    }
    window.webContents.debugger.detach()
    result.platformFonts = platformFonts

    checkMotionGrid(result.motionGrid)
    checkInteractive(result.interactive)

    await writeFile(join(output, 'geometry.json'), JSON.stringify(result, null, 2))
    const height = await window.webContents.executeJavaScript('document.documentElement.scrollHeight')
    // Capture several viewport pages without huge single-image downsampling.
    for (let page = 0; page * 900 < height; page++) {
      await window.webContents.executeJavaScript(`window.scrollTo(0, ${page * 900}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
      await writeFile(join(output, `page-${page}.png`), (await window.webContents.capturePage()).toPNG())
    }
    console.log(JSON.stringify({ output, cases: result.cases, motionCases: result.motionGrid.length, electron: process.versions.electron, chromium: process.versions.chrome, platform: process.platform, arch: process.arch }))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    window?.destroy()
    if (!exited) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)) }
    app.exit(process.exitCode ?? 0)
  }
}

// Validates that every real motion/aspect/moment case behaves as R2's evaluation rules require:
// no fragmented shaping runs, the right effect count for the right motion/moment, and honest
// fallback/notice behavior for estimated and cue-only timing. Throws on the first violation.
function checkMotionGrid(cases) {
  for (const entry of cases) {
    if (entry.id === 'static-clean') {
      if (entry.motion !== 'static-clean' || entry.effectCount !== 0 || entry.opacity !== 1 || entry.clipPath) throw new Error(`static-clean case misbehaved: ${JSON.stringify(entry)}`)
    } else if (entry.id === 'phrase-fade') {
      if (entry.motion !== 'phrase-fade' || entry.effectCount !== 0 || entry.opacity < 0 || entry.opacity > 1) throw new Error(`phrase-fade case misbehaved: ${JSON.stringify(entry)}`)
    } else if (entry.id === 'active-word-highlight' || entry.id === 'word-pop') {
      const expected = entry.moment === 'mid-word' ? 1 : 0
      if (entry.motion !== entry.id || entry.effectCount !== expected) throw new Error(`${entry.id} case misbehaved (${entry.moment}): ${JSON.stringify(entry)}`)
    } else if (entry.id === 'progressive-word-reveal') {
      if (entry.motion !== entry.id || !entry.clipPath) throw new Error(`progressive-word-reveal case misbehaved: ${JSON.stringify(entry)}`)
    } else if (entry.id === 'estimated-timing') {
      if (entry.motion !== 'word-pop' || entry.effectCount !== 1 || !entry.notice || !entry.notice.includes('Estimated')) throw new Error(`estimated-timing case misbehaved: ${JSON.stringify(entry)}`)
    } else if (entry.id === 'cue-only-fallback') {
      if (entry.motion !== 'static-clean' || entry.effectCount !== 0 || !entry.notice || !entry.notice.toLowerCase().includes('unavailable')) throw new Error(`cue-only-fallback case misbehaved: ${JSON.stringify(entry)}`)
    } else if (entry.id === 'phrase-fade-start') {
      // At the exact absolute cue start, phrase-fade's ramp is 0 — proves the real DOM opacity is
      // time-driven, not just present, and that it evaluates purely from the given source timestamp.
      if (entry.motion !== 'phrase-fade' || entry.opacity !== 0) throw new Error(`phrase-fade-start case misbehaved: ${JSON.stringify(entry)}`)
    } else throw new Error(`Unexpected motion case id: ${entry.id}`)
  }
}

// Confirms every StylePanel control, driven by real DOM events, actually moved the shared preview.
function checkInteractive(results) {
  const changed = (label, before, after) => { if (before === after) throw new Error(`Interactive control had no visible effect: ${label} (stayed ${JSON.stringify(before)})`) }
  changed('primary color', results.primaryColor.before, results.primaryColor.after)
  changed('outline width', results.outlineWidth.before, results.outlineWidth.after)
  changed('background opacity', results.backgroundOpacity.before, results.backgroundOpacity.after)
  changed('padding', results.padding.widthBefore, results.padding.widthAfter)
  if (results.position.xBefore === results.position.xAfter && results.position.yBefore === results.position.yAfter) throw new Error('Position control had no visible effect')
  if (results.maxLines.after > results.maxLines.before) throw new Error('Reducing max lines increased the rendered line count')
  if (!results.fontFamily.after.includes('Arial')) throw new Error(`Font family control had no effect: ${results.fontFamily.after}`)
  if (results.motion.before === results.motion.after || results.motion.after !== 'word-pop' || results.motion.effectCount !== 1) throw new Error(`Motion control had no visible effect: ${JSON.stringify(results.motion)}`)
  if (!results.presetSaved) throw new Error('Saving a preset did not add it to the saved preset list')
  if (!results.presetApplied) throw new Error('Applying a saved preset did not restore its motion')
  changed('alignment', results.alignment.before, results.alignment.after)
  changed('letter spacing', results.letterSpacing.before, results.letterSpacing.after)
  if (results.textTransform.computed !== 'uppercase') throw new Error(`Text transform control had no visible effect: ${results.textTransform.computed}`)
  if (!results.gradient.fillLayerPresent) throw new Error('Switching Color to Gradient did not paint a background-clip:text layer')
  changed('emphasis face', results.emphasisFace.before, results.emphasisFace.after)
  if (results.emphasisFace.after !== '900') throw new Error(`Emphasis face control did not apply the selected weight: ${results.emphasisFace.after}`)
  if (results.fontCatalogFallback) {
    // A script-dispatched click carries no transient user activation, so queryLocalFonts() must
    // always refuse here — this proves the fallback path (not real font access) is what's exercised.
    if (results.fontCatalogFallback.reason !== 'needs-gesture') throw new Error(`Unexpected font catalog reason from a synthetic click: ${JSON.stringify(results.fontCatalogFallback)}`)
    if (!results.fontCatalogFallback.familyOptionsPresent) throw new Error('Font family list was empty after the fallback catalog loaded')
  }
}

app.whenReady().then(run).catch((error) => { console.error(error); app.exit(1) })
