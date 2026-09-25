// Throwaway spike for docs/plans/liquid-glass/02-glass-spike.md. Not product code.
//   npx electron scripts/spikes/glass-spike.mjs
// Q1: does `backdrop-filter: blur() saturate() url(#svg)` (feImage + feDisplacementMap) work here, and which
//     ancestors stop the backdrop seeing the picture? Q2: map encoding + feDisplacementMap scale that match
//     FFmpeg `displace`. Writes images to a temp dir and prints the numbers; look at the printed paths.
import { app, BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.commandLine.appendSwitch('force-color-profile', 'srgb')
async function main() {
const local = JSON.parse(await readFile('caption-studio.local.json', 'utf8'))
const ffmpeg = (args) => run(local.ffmpegPath, ['-v', 'error', '-y', ...args])
const rawRgb = async (path) => (await run(local.ffmpegPath, ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 26 })).stdout
const W = 400, H = 300, MAX_SHIFT = 12
const dir = await mkdtemp(join(tmpdir(), 'glass-spike-'))
console.log('workdir', dir)

await ffmpeg(['-f', 'lavfi', '-i', `smptebars=size=${W}x${H}:rate=1:duration=1`, '-frames:v', '1', join(dir, 'bars.png')])

const filterSvg = (mapHref, scale) => `<svg width="0" height="0" style="position:absolute"><filter id="f" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
  <feImage href="${mapHref}" x="0" y="0" width="200" height="150" preserveAspectRatio="none" result="m"/>
  <feDisplacementMap in="SourceGraphic" in2="m" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/></filter></svg>`

const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: true, frame: false, webPreferences: { backgroundThrottling: false } })
async function shot(html) {
  await writeFile(join(dir, 'page.html'), html)
  await win.loadFile(join(dir, 'page.html'))
  await win.webContents.executeJavaScript('Promise.all([...document.images].map(i=>i.decode())).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))')
  await new Promise((r) => setTimeout(r, 150))
  const image = await win.webContents.capturePage()
  return { bgra: image.toBitmap(), ...image.getSize() }
}
const px = (s, x, y) => { const i = (y * s.width + x) * 4; return [s.bgra[i + 2], s.bgra[i + 1], s.bgra[i]] }
const meanAbsDiff = (a, b, rect) => {
  let t = 0, n = 0
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) { const p = px(a, x, y), q = px(b, x, y); for (let c = 0; c < 3; c++) { t += Math.abs(p[c] - q[c]); n++ } }
  return t / n
}
const PANEL = { x: 100, y: 75, w: 200, h: 150 }
const inner = { x: PANEL.x + 20, y: PANEL.y + 20, w: PANEL.w - 40, h: PANEL.h - 40 }
const base = (body) => `<!doctype html><body style="margin:0;background:#000;overflow:hidden"><img src="bars.png" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px">${body}</body>`
const panel = (filter, ancestorStyle = '') => `<div style="position:absolute;inset:0;${ancestorStyle}"><div style="position:absolute;left:${PANEL.x}px;top:${PANEL.y}px;width:${PANEL.w}px;height:${PANEL.h}px;backdrop-filter:${filter}"></div></div>`

const plain = await shot(base(''))

// Opaque map with exact bytes (canvas putImageData, PNG). 'const': R=byteR, G=byteG. 'lens': push outward near the edges.
const mapPng = async (byteR, byteG, mode = 'const') => {
  const url = await win.webContents.executeJavaScript(`(()=>{const c=document.createElement('canvas');c.width=200;c.height=150;const g=c.getContext('2d');const d=g.createImageData(200,150);
    for(let y=0;y<150;y++)for(let x=0;x<200;x++){const i=(y*200+x)*4;let r=${byteR},gg=${byteG};
      if('${mode}'==='lens'){const nx=(x-99.5)/100,ny=(y-74.5)/75;const e=Math.min(1,Math.max(0,(Math.max(Math.abs(nx),Math.abs(ny))-0.6)/0.4));r=Math.round(128+127*e*Math.sign(nx));gg=Math.round(128+127*e*Math.sign(ny));}
      d.data[i]=r;d.data[i+1]=gg;d.data[i+2]=128;d.data[i+3]=255}
    g.putImageData(d,0,0);return c.toDataURL('image/png')})()`)
  return Buffer.from(url.split(',')[1], 'base64')
}
const scale = 255 * MAX_SHIFT / 127
const pageWith = (filter, anc = '', svg) => base(svg + panel(filter, anc))
const withMap = async (name, r, g, mode) => { await writeFile(join(dir, name), await mapPng(r, g, mode)); return filterSvg(name, scale) }

// ---------- Q1a
const svgConst = await withMap('map-255.png', 255, 128)
const blurOnly = await shot(pageWith('blur(4px) saturate(1.6)', '', svgConst))
const blurUrl = await shot(pageWith('blur(4px) saturate(1.6) url(#f)', '', svgConst))
const urlOnly = await shot(pageWith('url(#f)', '', svgConst))
console.log('Q1a blur+sat vs plain (large = backdrop blurred):', meanAbsDiff(blurOnly, plain, inner).toFixed(2))
console.log('Q1a blur+sat+url vs blur+sat (nonzero = url() applied):', meanAbsDiff(blurUrl, blurOnly, inner).toFixed(2))
console.log('Q1a url only vs plain (nonzero = url() displaced backdrop):', meanAbsDiff(urlOnly, plain, inner).toFixed(2))

// ---------- Q2: horizontal stripe edges (SMPTE bars are vertical stripes) on row y=110 of the panel: an edge that moves from x0 to x1 means the picture sampled at x+s with s = x0 - x1
const edges = (get, y = 110) => { const out = []; let prev = get(0, y); for (let x = 1; x < W; x++) { const q = get(x, y); if (Math.abs(q[0] - prev[0]) + Math.abs(q[1] - prev[1]) + Math.abs(q[2] - prev[2]) > 40) out.push(x); prev = q } return out.filter((x) => x > inner.x && x < inner.x + inner.w) }
const srcEdges = edges((x, y) => px(plain, x, y))
console.log('Q2 source edges in panel row:', srcEdges.join(','), ' scale =', scale.toFixed(3), '(= 255*maxShift/127, maxShift', MAX_SHIFT + ')')
const barsRaw = await rawRgb(join(dir, 'bars.png'))
const ffDisplace = (mapFile, out) => ffmpeg(['-i', join(dir, 'bars.png'), '-i', join(dir, mapFile), '-filter_complex',
  `[0:v]format=gbrp,crop=${PANEL.w}:${PANEL.h}:${PANEL.x}:${PANEL.y}[c];[1:v]format=gbrp,lutrgb=r='128+(val-128)*${MAX_SHIFT}/127':g='128+(val-128)*${MAX_SHIFT}/127':b=128,split=2[m1][m2];[m1]colorchannelmixer=rr=1:gr=1:br=1:gg=0:bb=0[xm];[m2]colorchannelmixer=rr=0:rg=1:gg=1:bg=1:bb=0[ym];[c][xm][ym]displace=edge=smear,format=rgb24`, '-frames:v', '1', join(dir, out)])
for (const byte of [128, 160, 192, 255]) {
  const svg = await withMap(`map-${byte}.png`, byte, 128)
  const cap = await shot(pageWith('url(#f)', '', svg))
  const ce = edges((x, y) => px(cap, x, y))
  await ffDisplace(`map-${byte}.png`, `ff-${byte}.png`)
  const raw = await rawRgb(join(dir, `ff-${byte}.png`))
  const fe = edges((x, y) => { const i = (y - PANEL.y) * PANEL.w + (x - PANEL.x); return x < PANEL.x || x >= PANEL.x + PANEL.w ? [0, 0, 0] : [raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]] }, 110)
  console.log(`  byte ${byte}: encoding says shift ${(MAX_SHIFT * (byte - 128) / 127).toFixed(2)} px | chromium edges ${ce.join(',')} | ffmpeg edges ${fe.join(',')}`)
}

// ---------- eyeball: lens map through both
const svgLens = await withMap('map-lens.png', 0, 0, 'lens')
await shot(pageWith('url(#f)', '', svgLens))
await writeFile(join(dir, 'chromium-lens.png'), (await win.webContents.capturePage({ x: PANEL.x, y: PANEL.y, width: PANEL.w, height: PANEL.h })).toPNG())
await ffDisplace('map-lens.png', 'ffmpeg-lens.png')
await ffmpeg(['-i', join(dir, 'chromium-lens.png'), '-i', join(dir, 'ffmpeg-lens.png'), '-filter_complex', '[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]hstack,format=rgb24', '-frames:v', '1', join(dir, 'lens-side-by-side.png')])
const a = await rawRgb(join(dir, 'chromium-lens.png')), b = await rawRgb(join(dir, 'ffmpeg-lens.png'))
let t = 0, big = 0
for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); t += d; if (d > 40) big++ }
console.log(`Lens: chromium vs ffmpeg mean abs diff ${(t / a.length).toFixed(2)}, channels off by >40: ${big}/${a.length}; ${join(dir, 'lens-side-by-side.png')}`)

// ---------- Q1b ancestors
const full = 'blur(4px) saturate(1.6) url(#f)'
const ctl = await shot(pageWith(full, '', svgConst))
const report = (name, cap) => console.log(`  ${name.padEnd(26)} diff-from-control ${meanAbsDiff(cap, ctl, inner).toFixed(2).padStart(6)}  diff-from-plain ${meanAbsDiff(cap, plain, inner).toFixed(2).padStart(6)}`)
console.log('Q1b ancestor wraps ONLY the panel (picture outside it):')
const variants = {
  'opacity:.99': 'opacity:.99', 'opacity:1': 'opacity:1', 'mask-image': 'mask-image:linear-gradient(#000,#000)', 'filter:blur(0)': 'filter:blur(0px)', 'filter:none': 'filter:none',
  'mix-blend-mode:multiply': 'mix-blend-mode:multiply', 'will-change:opacity': 'will-change:opacity', 'will-change:transform': 'will-change:transform', 'will-change:filter': 'will-change:filter',
  'transform:translateZ(0)': 'transform:translateZ(0)', 'clip-path': 'clip-path:inset(0)', 'isolation:isolate': 'isolation:isolate', 'overflow:hidden': 'overflow:hidden', 'z-index:3': 'z-index:3',
}
for (const [name, style] of Object.entries(variants)) report(name, await shot(pageWith(full, style, svgConst)))
console.log('Q1b picture AND panel inside the same ancestor:')
for (const [name, style] of Object.entries({ 'opacity:.99': 'opacity:.99', 'mask-image': 'mask-image:linear-gradient(#000,#000)', 'filter:blur(0)': 'filter:blur(0px)', 'mix-blend-mode:multiply': 'mix-blend-mode:multiply' })) {
  report(name, await shot(`<!doctype html><body style="margin:0;background:#000;overflow:hidden">${svgConst}<div style="position:absolute;inset:0;${style}"><img src="bars.png" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px"><div style="position:absolute;left:${PANEL.x}px;top:${PANEL.y}px;width:${PANEL.w}px;height:${PANEL.h}px;backdrop-filter:${full}"></div></div></body>`))
}
console.log('Q1b properties on the panel element itself:')
for (const [name, style] of Object.entries({ 'opacity:.5': 'opacity:.5', 'mask-image': 'mask-image:linear-gradient(#000,#000)', 'mix-blend-mode:multiply': 'mix-blend-mode:multiply', 'filter:blur(0)': 'filter:blur(0px)', 'radius+overflow': 'border-radius:40px;overflow:hidden' })) {
  report(name, await shot(base(svgConst + `<div style="position:absolute;left:${PANEL.x}px;top:${PANEL.y}px;width:${PANEL.w}px;height:${PANEL.h}px;backdrop-filter:${full};${style}"></div>`)))
}
console.log('done', dir)
}

app.whenReady().then(main).then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1) })
