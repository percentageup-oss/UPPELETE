import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function run() {
  const output = await mkdtemp(join(tmpdir(), 'caption-emphasis-'))
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5197', '--strictPort'], {
    cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
  })
  let window
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Vite startup timeout')), 15000)
      server.stdout.on('data', (chunk) => { if (chunk.toString().includes('http://127.0.0.1:5197')) { clearTimeout(timer); resolve() } })
      server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Vite exited ${code}`)) })
    })
    window = new BrowserWindow({ width: 1220, height: 1000, show: true, webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true, sandbox: true } })
    await window.loadURL('http://127.0.0.1:5197/tests/emphasis.html')
    const result = await window.webContents.executeJavaScript(`(async () => {
      const assert = (value, message) => { if (!value) throw new Error(message) };
      const preview = () => document.querySelector('[data-emphasis-preview] [data-caption-renderer]');
      const wait = async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const deadline = performance.now() + 10000;
        while (!preview()) { if (performance.now() > deadline) throw new Error('Caption readiness timeout'); await new Promise(resolve => setTimeout(resolve, 20)); }
      };
      const setValue = async (id, value) => {
        const input = document.getElementById(id); input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => requestAnimationFrame(resolve)); input.blur(); await wait();
      };
      const project = () => JSON.parse(document.getElementById('demo-state').textContent);
      await wait();
      assert(document.querySelectorAll('.template-card').length === 4, 'Missing visual templates');
      document.querySelector('[aria-label="Apply Bold reveal"]').click(); await wait();
      const word = [...document.querySelectorAll('.emphasis-word-list button')].find(button => button.textContent === 'brown');
      word.click(); await wait();
      assert(project().cues[0].emphasized[0].text === 'brown', 'Word selection not persisted');
      assert(preview().querySelector('[data-caption-emphasis]')?.textContent === 'brown', 'Untimed emphasis not painted');
      document.getElementById('demo-undo').click(); await wait();
      assert(!preview().querySelector('[data-caption-emphasis]'), 'Undo did not remove emphasis');
      document.getElementById('demo-redo').click(); await wait();
      await setValue('style-emphasis-family', 'Georgia');
      const chosen = preview().querySelector('[data-caption-emphasis]');
      assert(getComputedStyle(chosen).fontFamily.includes('Georgia'), 'Distinct selected font missing');
      [...document.querySelectorAll('button')].find(button => button.textContent === 'Estimate word timing').click(); await wait();
      const cue = project().cues[0];
      assert(cue.text === 'മലയാളം quick brown fox jumps' && cue.startUs === 0 && cue.endUs === 3000000, 'Estimating changed SRT text or cue bounds');
      assert(cue.words.every(word => word.timingSource === 'estimated'), 'Missing estimate provenance');
      const brown = cue.words.find(word => word.text === 'brown');
      await setValue('demo-time', String(brown.startUs - 1));
      assert(getComputedStyle(preview().querySelector('[data-caption-emphasis]')).opacity === '0', 'Word revealed early');
      const geometry = () => [...preview().querySelectorAll('[data-caption-line]')].map(line => [line.style.left, line.style.top, line.style.width]);
      const before = geometry();
      await setValue('demo-time', String(brown.startUs + 100000));
      assert(getComputedStyle(preview().querySelector('[data-caption-emphasis]')).opacity === '1', 'Selected word did not reveal');
      assert(JSON.stringify(before) === JSON.stringify(geometry()), 'Reveal reflowed caption');
      assert(preview().querySelector('[data-caption-emphasis]').style.transform.includes('scale'), 'Selected word did not animate');
      await setValue('demo-time', String(cue.words.at(-1).startUs + 210000));
      const lines = [...preview().querySelectorAll('[data-caption-line]')].map(line => {
        const range = document.createRange(); range.selectNodeContents(line);
        return { width: line.getBoundingClientRect().width, paintedWidth: range.getBoundingClientRect().width, text: line.textContent };
      });
      assert(lines.every(line => Math.abs(line.width - line.paintedWidth) < 1), 'Measured and painted mixed-font widths differ');
      document.querySelector('[aria-label="Apply Neon punch"]').focus(); await new Promise(resolve => setTimeout(resolve, 150));
      assert(document.querySelector('[aria-label="Apply Neon punch"] [data-caption-renderer]'), 'Animated card preview missing');
      document.activeElement.blur(); await wait();
      return { selectedFont: getComputedStyle(preview().querySelector('[data-caption-emphasis]')).fontFamily,
        lines, estimatedWords: cue.words.length, selected: cue.emphasized, undoRedo: true, stableReveal: true };
    })()`)
    await writeFile(join(output, 'editor.png'), (await window.webContents.capturePage()).toPNG())
    await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify({ output, ...result }))
  } finally {
    window?.destroy(); server.kill('SIGTERM');
  }
}
app.on('window-all-closed', () => {})
app.whenReady().then(run).then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1) })
