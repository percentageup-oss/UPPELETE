import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WhisperCppAdapter } from '../electron/whisperAdapter'
import { benchmarkTranscript, type AsrBenchmarkResult } from '../src/core/asrMetrics'
import type { ManagedModelId, ModelArtifact } from '../src/core/modelCatalog'
import { languageCodeSchema } from '../src/core/transcription'
import { MediaWorkerClient } from '../workers/media/client'
import { runTranscription } from '../workers/transcription/run'

/**
 * Dev-only Malayalam ASR benchmark (T5): runs each candidate whisper.cpp-compatible model file
 * against the developer's own reference-transcribed clips and reports accuracy/repetition/cue-
 * timing metrics (`src/core/asrMetrics.ts`) plus real-time factor. Candidate models are addressed
 * by file path, not by the shipped `MODEL_CATALOG` — nothing here downloads, trusts or ships a
 * model; a candidate only reaches the catalog after a human reviews these results and its license
 * (see the plan this ticket followed and docs/MODELS.md).
 *
 * Runs every candidate on CPU only, so results are comparable across models with very different
 * memory footprints regardless of which GPU backend whisper-cli happens to initialize for each.
 */

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')))
  })
}

type ModelSpec = { path: string; label: string }
type Fixture = { name: string; mediaPath: string; referencePath: string }
type BenchRow = { model: string; fixture: string; elapsedMs: number; realTimeFactor: number; language: string | null; metrics: AsrBenchmarkResult | null; error: string | null }

function parseModelSpec(raw: string): ModelSpec {
  const [rawPath, label] = raw.split(':')
  const resolved = path.resolve(rawPath)
  return { path: resolved, label: label ?? path.basename(resolved) }
}

async function findFixtures(dir: string): Promise<Fixture[]> {
  const entries = await readdir(dir)
  const fixtures: Fixture[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.ref.txt')) continue
    const name = entry.slice(0, -'.ref.txt'.length)
    const media = entries.find((candidate) => candidate !== entry && candidate.startsWith(`${name}.`) && !candidate.endsWith('.ref.txt'))
    if (!media) throw new Error(`Fixture "${name}" has a reference but no matching media file (expected "${name}.<ext>") in ${dir}`)
    fixtures.push({ name, mediaPath: path.join(dir, media), referencePath: path.join(dir, entry) })
  }
  if (fixtures.length === 0) throw new Error(`No *.ref.txt fixtures found in ${dir}. Each fixture needs "<name>.<ext>" media plus a hand-corrected "<name>.ref.txt".`)
  return fixtures
}

function formatRate(rate: number | null): string {
  return rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`
}

function renderTable(rows: readonly BenchRow[]): string {
  const header = '| Model | Fixture | Language | WER | CER | Latin recall | Repeats | Median cue (s) | Max cue (s) | Cues >7s | RTF | Error |'
  const divider = '|---|---|---|---|---|---|---|---|---|---|---|---|'
  const lines = rows.map((row) => {
    if (!row.metrics) return `| ${row.model} | ${row.fixture} | — | — | — | — | — | — | — | — | — | ${row.error ?? 'unknown error'} |`
    const m = row.metrics
    return [
      row.model, row.fixture, row.language ?? 'n/a', formatRate(m.wer.rate), formatRate(m.cer.rate),
      m.latinRecall.recall === null ? 'n/a' : `${formatRate(m.latinRecall.recall)} (${m.latinRecall.matched}/${m.latinRecall.total})`,
      m.repetition.repeated ? 'yes' : 'no',
      m.cueDurations.medianSeconds === null ? 'n/a' : m.cueDurations.medianSeconds.toFixed(1),
      m.cueDurations.maxSeconds === null ? 'n/a' : m.cueDurations.maxSeconds.toFixed(1),
      String(m.cueDurations.overThresholdCount),
      row.realTimeFactor.toFixed(2), '',
    ].map((cell) => `| ${cell} `).join('') + '|'
  })
  return [header, divider, ...lines].join('\n')
}

async function main() {
  const [ffmpegPath, ffprobePath, whisperCliPath, benchDir, languageArgument, ...modelArgs] = process.argv.slice(2)
  if (!ffmpegPath || !ffprobePath || !whisperCliPath || !benchDir || !languageArgument || modelArgs.length === 0) {
    throw new Error('Usage: npm run bench:transcription -- <ffmpeg> <ffprobe> <whisper-cli> <bench-dir> <language-code|auto> <model-file[:label]> [<model-file[:label]> ...]')
  }
  const language = languageArgument === 'auto' ? 'auto' as const : languageCodeSchema.parse(languageArgument)
  const fixtures = await findFixtures(benchDir)
  const models = modelArgs.map(parseModelSpec)
  console.log(JSON.stringify({ step: 'setup', fixtures: fixtures.map((f) => f.name), models: models.map((m) => m.label) }))

  const client = new MediaWorkerClient({ workerPath: path.join(__dirname, 'server.cjs'), tools: { ffmpegPath, ffprobePath, whisperCliPath } })
  const rows: BenchRow[] = []
  try {
    for (const model of models) {
      const [{ size: sizeBytes }, sha256] = await Promise.all([stat(model.path), sha256File(model.path)])
      // Not a shipped ModelArtifact: id/url are placeholders for this run only. See file header.
      const artifact: ModelArtifact = {
        id: model.label as ManagedModelId, name: model.label, summary: '', recommended: false, fileName: path.basename(model.path), backend: 'whisper.cpp', format: 'GGML F16',
        languageCapability: 'Benchmark candidate, not a catalog entry', multilingual: true, sizeBytes, sha256, url: `file://${model.path}`,
        deviceModes: ['CPU (fallback)'],
      }
      console.log(JSON.stringify({ step: 'model', label: model.label, path: model.path, sizeBytes, sha256 }))
      const inspection = await client.start({ operation: 'inspectWhisper', modelPath: model.path }, { timeoutMs: 180_000 }).result
      const adapter = new WhisperCppAdapter(client, artifact, model.path, inspection)

      for (const fixture of fixtures) {
        const directory = await mkdtemp(path.join(tmpdir(), 'caption-studio-bench-'))
        try {
          const probe = await client.start({ operation: 'probe', inputPath: fixture.mediaPath }).result
          const durationUs = probe.metadata.durationUs
          if (!durationUs) throw new Error('Media has no probed duration')
          const audio = await client.start({
            operation: 'extractAudio', inputPath: fixture.mediaPath, range: { startUs: 0, endUs: durationUs },
            outputPath: path.join(directory, 'audio.wav'), sampleRate: 16000, channels: 1,
          }, { timeoutMs: Math.min(86_400_000, 300_000 + Math.ceil(durationUs / 1000) * 2) }).result

          const started = performance.now()
          const transcript = await runTranscription(adapter, {
            audio: { path: audio.path, sourceStartUs: audio.sourceStartUs, durationUs: audio.durationUs, sampleRate: audio.sampleRate as 16000, channels: 1, sampleCount: audio.sampleCount },
          }, { language, device: 'cpu', wordTimestamps: false })
          const elapsedMs = performance.now() - started

          const reference = (await readFile(fixture.referencePath, 'utf8')).trim()
          const metrics = benchmarkTranscript(reference, transcript.segments)
          const row: BenchRow = { model: model.label, fixture: fixture.name, elapsedMs: Math.round(elapsedMs), realTimeFactor: elapsedMs / 1000 / (durationUs / 1_000_000), language: transcript.language, metrics, error: null }
          rows.push(row)
          console.log(JSON.stringify({ step: 'result', ...row }))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const row: BenchRow = { model: model.label, fixture: fixture.name, elapsedMs: 0, realTimeFactor: 0, language: null, metrics: null, error: message }
          rows.push(row)
          console.log(JSON.stringify({ step: 'error', ...row }))
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      }
    }
  } finally {
    await client.close()
  }

  console.log('\n' + renderTable(rows))
}

void main().catch((error) => { console.error(error); process.exitCode = 1 })
