import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { geminiRecognizer, type GeminiLocale, type GeminiRecognition } from '../electron/geminiRecognition'
import { MediaWorkerClient } from '../workers/media/client'

/**
 * Dev-only, never-CI real-request probe for the Gemini transcription bug: code-switched English
 * words inside Malayalam speech coming back transliterated into Malayalam script (docs/STATUS.md,
 * docs/decisions/). No live Gemini request had ever been made from this code before this script;
 * every claim in docs/TRANSCRIPTION.md about `language_codes` behavior was a reading of the SDK's
 * own doc comment, not a measurement. This script is the measurement.
 *
 * It runs the same `speechChunks` gating GeminiTranscriptionAdapter uses, then recognizes every
 * resulting chunk under each candidate configuration, so the four variants are compared on
 * identical audio. Requires a real GEMINI_API_KEY (never the encrypted app store) and a real clip —
 * neither is available in a sandboxed dev environment, which is why this had to be a script for the
 * developer to run rather than something run automatically here.
 */

const SYSTEM_INSTRUCTION = 'Transcribe verbatim. This audio mixes Malayalam and English. Write Malayalam speech in Malayalam script and English words in Latin script. Never transliterate one language into the other’s script.'

type Variant = { id: string; locales: readonly GeminiLocale[]; systemInstruction?: string; customVocabulary?: readonly string[] }

function variants(customVocabulary: readonly string[]): Variant[] {
  return [
    // 1 was the production default until the published transcription docs confirmed it was the cause;
    // 2 is the production default now. Both are kept so a run still measures the regression directly.
    { id: '1-former-default-ml-en-hint', locales: ['ml-IN', 'en-IN'] },
    { id: '2-omitted-auto-detect', locales: [] },
    // `system_instruction` is not documented as supported by `gemini-3.5-transcribe`; this variant may
    // be a silent no-op, so a result identical to variant 2 is not evidence that the wording helped.
    { id: '3-omitted-plus-system-instruction', locales: [], systemInstruction: SYSTEM_INSTRUCTION },
    // The docs state custom_vocabulary "cannot be combined with speaker diarization or word-level
    // timestamps", and this probe always requests word timestamps — expect an error or an ignored
    // field. Kept only to record what the API actually does; do not read its output as a comparison.
    { id: '4-omitted-plus-custom-vocabulary', locales: [], customVocabulary },
  ]
}

/** Same script-detection idiom as `src/core/scriptCheck.ts`, at word granularity for this report. */
function classifyWord(text: string): 'latin' | 'malayalam' | 'other' {
  if (/\p{Script=Malayalam}/u.test(text)) return 'malayalam'
  if (/\p{Script=Latin}/u.test(text)) return 'latin'
  return 'other'
}

async function main() {
  const [ffmpegPath, ffprobePath, mediaPath, ...vocabWords] = process.argv.slice(2)
  const apiKey = process.env.GEMINI_API_KEY
  if (!ffmpegPath || !ffprobePath || !mediaPath) {
    throw new Error('Usage: GEMINI_API_KEY=... npm run probe:gemini -- <ffmpeg> <ffprobe> <clip with code-switched English> [known English word]...')
  }
  if (!apiKey) throw new Error('Set GEMINI_API_KEY in the environment. This script never reads the app’s encrypted key store.')

  const client = new MediaWorkerClient({ workerPath: path.join(__dirname, 'server.cjs'), tools: { ffmpegPath, ffprobePath } })
  const workDirectory = await mkdtemp(path.join(tmpdir(), 'gemini-probe-'))
  try {
    const probe = await client.start({ operation: 'probe', inputPath: mediaPath }).result
    const durationUs = probe.metadata.durationUs
    if (!durationUs) throw new Error('Media has no probed duration.')

    const audio = await client.start({
      operation: 'extractAudio', inputPath: mediaPath, range: { startUs: 0, endUs: durationUs },
      outputPath: path.join(workDirectory, 'audio.wav'), sampleRate: 16000, channels: 1,
    }).result
    console.log(JSON.stringify({ step: 'extractAudio', durationUs: audio.durationUs }))

    const chunkDirectory = path.join(workDirectory, 'speech')
    await mkdir(chunkDirectory)
    const plan = await client.start({
      operation: 'speechChunks', audioPath: audio.path, outputDirectory: chunkDirectory, durationUs: audio.durationUs, maxChunkUs: 20 * 60 * 1_000_000,
    }).result
    console.log(JSON.stringify({ step: 'speechChunks', chunkCount: plan.chunks.length, silenceCount: plan.silences.length }))
    if (!plan.chunks.length) throw new Error('No speech chunks were gated from this clip — pick a clip with clear speech.')

    const recognize = geminiRecognizer(apiKey, 'transcribe')
    const controller = new AbortController()
    const report: Record<string, unknown>[] = []
    for (const variant of variants(vocabWords)) {
      const perChunk: GeminiRecognition[] = []
      for (const chunk of plan.chunks) {
        perChunk.push(await recognize(chunk.path, { locales: variant.locales, systemInstruction: variant.systemInstruction, customVocabulary: variant.customVocabulary }, controller.signal))
      }
      const words = perChunk.flatMap((chunk) => chunk.words)
      const droppedAnnotations = perChunk.reduce((sum, chunk) => sum + chunk.droppedAnnotations, 0)
      const byScript = { latin: 0, malayalam: 0, other: 0 }
      for (const word of words) byScript[classifyWord(word.text)] += 1
      const row = {
        variant: variant.id, locales: variant.locales, systemInstruction: variant.systemInstruction ?? null, customVocabulary: variant.customVocabulary ?? null,
        wordCount: words.length, droppedAnnotations, byScript,
        text: words.map((word) => word.text).join(' '),
      }
      console.log(JSON.stringify({ step: 'variant', ...row }))
      report.push(row)
    }

    const outputPath = path.join(process.cwd(), 'docs', 'decisions', 'evidence', `gemini-codeswitch-${new Date().toISOString().slice(0, 10)}.json`)
    await writeFile(outputPath, JSON.stringify({ media: path.basename(mediaPath), recordedAt: new Date().toISOString(), variants: report }, null, 2))
    console.log(JSON.stringify({ step: 'done', outputPath }))
  } finally {
    await client.close()
    await rm(workDirectory, { recursive: true, force: true })
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1 })
