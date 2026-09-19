import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MediaWorkerClient } from '../workers/media/client'
import { proxySupportFromConfiguration } from '../src/core/proxy'

async function main() {
  const [ffmpegPath, ffprobePath, mediaPath] = process.argv.slice(2)
  if (Boolean(ffmpegPath) !== Boolean(ffprobePath)) throw new Error('Supply both absolute ffmpeg and ffprobe paths, or neither')
  const client = new MediaWorkerClient({
    workerPath: path.join(__dirname, 'server.cjs'),
    tools: ffmpegPath && ffprobePath ? { ffmpegPath, ffprobePath } : undefined,
  })
  try {
    const runtime = await client.start({ operation: 'runtime' }).result
    if (runtime.pid === process.pid) throw new Error('Worker did not run in a separate process')
    console.log(JSON.stringify({ parentPid: process.pid, worker: runtime }, null, 2))
    if (!ffmpegPath) return
    const report = await client.start({ operation: 'inspectToolchain' }, {
      onProgress: (message) => console.log(JSON.stringify(message)),
    }).result
    console.log(JSON.stringify(report, null, 2))
    if (!mediaPath) return
    const probe = await client.start({ operation: 'probe', inputPath: mediaPath }).result
    console.log(JSON.stringify(probe, null, 2))
    if (!probe.metadata.durationUs) throw new Error('Probed media has no usable duration for waveform/thumbnail/proxy smoke')
    const durationUs = probe.metadata.durationUs
    const waveform = await client.start({ operation: 'waveform', inputPath: mediaPath,
      range: { startUs: 0, endUs: durationUs }, maxPeaks: 128 }, {
      onProgress: (message) => console.log(JSON.stringify(message)),
    }).result
    console.log(JSON.stringify({ operation: waveform.operation, range: waveform.range, peakCount: waveform.peaks.length,
      maximumPeak: Math.max(...waveform.peaks) }, null, 2))

    const thumbDirectory = await mkdtemp(path.join(tmpdir(), 'media-worker-smoke-thumbs-'))
    try {
      const timestampsUs = [0.1, 0.5, 0.9].map((fraction) => Math.floor(durationUs * fraction))
      const thumbnails = await client.start({ operation: 'thumbnails', inputPath: mediaPath, timestampsUs, width: 160, outputDirectory: thumbDirectory }, {
        onProgress: (message) => console.log(JSON.stringify(message)),
      }).result
      console.log(JSON.stringify(thumbnails, null, 2))
    } finally { await rm(thumbDirectory, { recursive: true, force: true }) }

    const proxySupport = proxySupportFromConfiguration(report.ffmpeg.versionOutput)
    console.log(JSON.stringify({ proxySupport }, null, 2))
    if (proxySupport.supported) {
      const proxyDirectory = await mkdtemp(path.join(tmpdir(), 'media-worker-smoke-proxy-'))
      try {
        const outputPath = path.join(proxyDirectory, 'proxy.webm')
        const proxy = await client.start({ operation: 'proxy', inputPath: mediaPath, outputPath, durationUs }, {
          onProgress: (message) => console.log(JSON.stringify(message)),
        }).result
        console.log(JSON.stringify(proxy, null, 2))
      } finally { await rm(proxyDirectory, { recursive: true, force: true }) }
    }
  } finally { await client.close() }
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
