import { build } from 'esbuild'
await build({
  entryPoints: { server: 'workers/media/server.ts', 'media-worker-smoke': 'scripts/media-worker-smoke.ts', 'transcription-smoke': 'scripts/transcription-smoke.ts', 'transcription-bench': 'scripts/transcription-bench.ts' },
  bundle: true, platform: 'node', format: 'cjs', outdir: 'dist-worker', outExtension: { '.js': '.cjs' },
})

await import('./build-export.mjs')
