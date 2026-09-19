import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
await mkdir('dist-export', { recursive: true })
await build({ entryPoints: ['scripts/export-host.mjs'], outfile: 'dist-export/host.cjs', bundle: true,
  platform: 'node', format: 'cjs', external: ['electron'] })
await build({ entryPoints: ['src/export/frameHarness.tsx'], outfile: 'dist-export/frame-harness.js', bundle: true,
  platform: 'browser', format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
await writeFile('dist-export/index.html', (await readFile('tests/export-frames.html', 'utf8')).replace('/src/export/frameHarness.tsx', './frame-harness.js'))
