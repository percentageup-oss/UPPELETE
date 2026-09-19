import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { captionTokens } from '../src/core/captionText'
import { jobFailure, type JobSnapshot } from '../src/core/jobs'
import type { AlignmentRun } from '../src/core/model'
import {
  TRANSCRIPTION_CONTRACT_VERSION, toAudioRelativeSegments, validateAlignmentOutput,
  type AlignedTranscript, type AlignmentRequestSegment, type TranscriptionCapabilities,
} from '../src/core/transcription'
import type { MediaWorkerClient } from '../workers/media/client'
import type { JobContext, JobHandle, JobScheduler } from './jobScheduler'
import { alignWithGemini, GEMINI_ALIGNMENT_MODEL } from './geminiAlignment'

const MAX_CHUNK_US = 20 * 60 * 1_000_000
const PADDING_US = 500_000
const MERGE_GAP_US = 2_000_000
const capabilities: TranscriptionCapabilities = {
  contractVersion: TRANSCRIPTION_CONTRACT_VERSION,
  engine: { id: 'gemini-api', version: 'v1beta' }, model: { id: GEMINI_ALIGNMENT_MODEL },
  transcription: { languages: ['ml', 'en'], autoDetectLanguage: false, devices: ['cpu'], inputSampleRates: [16000], wordTiming: 'model', confidence: { segment: false, word: false } },
  alignment: { languages: ['ml', 'en'], granularity: 'word' },
}

type Chunk = { startUs: number; endUs: number; segments: AlignmentRequestSegment[] }
function chunksFor(segments: readonly AlignmentRequestSegment[], mediaDurationUs: number): Chunk[] {
  const result: Chunk[] = []
  for (const segment of [...segments].sort((a, b) => a.startUs - b.startUs)) {
    const startUs = Math.max(0, segment.startUs - PADDING_US)
    const endUs = Math.min(mediaDurationUs, segment.endUs + PADDING_US)
    const last = result.at(-1)
    if (last && startUs - last.endUs < MERGE_GAP_US && Math.max(last.endUs, endUs) - last.startUs <= MAX_CHUNK_US) {
      last.endUs = Math.max(last.endUs, endUs); last.segments.push(segment)
    } else result.push({ startUs, endUs, segments: [segment] })
  }
  return result
}

export type AlignmentJobValue = { transcript: AlignedTranscript; run: AlignmentRun }
export class AlignmentService {
  constructor(private readonly options: {
    worker: Pick<MediaWorkerClient, 'start'>; scheduler: JobScheduler; temporaryRoot: string; now?: () => Date
  }) {}

  start(request: { mediaPath: string; mediaDurationUs: number; apiKey: string; segments: AlignmentRequestSegment[] }, onUpdate: (snapshot: JobSnapshot) => void): JobHandle<AlignmentJobValue> {
    let jobId: string | null = null
    const unsubscribe = this.options.scheduler.subscribe((snapshot) => { if (snapshot.id === jobId) onUpdate(snapshot) })
    const handle = this.options.scheduler.enqueue<AlignmentJobValue>({
      kind: 'alignment', label: `Align ${path.basename(request.mediaPath)}`.slice(0, 256), run: (ctx) => this.run(request, ctx),
    })
    jobId = handle.id
    const current = this.options.scheduler.get(handle.id); if (current) onUpdate(current)
    void handle.outcome.finally(unsubscribe)
    return handle
  }

  private async run(request: { mediaPath: string; mediaDurationUs: number; apiKey: string; segments: AlignmentRequestSegment[] }, ctx: JobContext): Promise<AlignmentJobValue> {
    const chunks = chunksFor(request.segments, request.mediaDurationUs)
    if (!chunks.length) throw jobFailure('INVALID_INPUT', 'There are no non-empty captions to align.')
    const directory = await mkdtemp(path.join(this.options.temporaryRoot, 'caption-studio-alignment-'))
    const allSegments: AlignedTranscript['segments'] = []
    let inputTokens = 0, outputTokens = 0
    try {
      for (const [index, chunk] of chunks.entries()) {
        ctx.reportProgress({ kind: 'indeterminate', phase: 'extracting-audio' })
        const audio = await this.options.worker.start({
          operation: 'extractAudio', inputPath: request.mediaPath, range: { startUs: chunk.startUs, endUs: chunk.endUs },
          outputPath: path.join(directory, `audio-${index}.wav`), sampleRate: 16000, channels: 1,
        }, { signal: ctx.signal, timeoutMs: 1_800_000 }).result
        ctx.reportProgress({ kind: 'measured', phase: 'aligning', completed: index, total: chunks.length, unit: 'items' })
        const window = { sourceStartUs: audio.sourceStartUs, durationUs: audio.durationUs }
        const relative = toAudioRelativeSegments(window, chunk.segments)
        const response = await alignWithGemini(request.apiKey, audio.path, relative, ctx.signal)
        const validated = validateAlignmentOutput(window, capabilities, chunk.segments, relative, response.output)
        allSegments.push(...validated.segments)
        inputTokens += response.usage.inputTokens ?? 0; outputTokens += response.usage.outputTokens ?? 0
        ctx.reportProgress({ kind: 'measured', phase: 'aligning', completed: index + 1, total: chunks.length, unit: 'items' })
      }
      if (!ctx.enterCommit()) throw jobFailure('CANCELLED', 'Alignment was cancelled before its timing was delivered.')
      const alignedWordCount = allSegments.reduce((sum, segment) => sum + segment.words.length, 0)
      const requestedWordCount = request.segments.reduce((sum, segment) => sum + captionTokens(segment.text).length, 0)
      const sourceRange = { startUs: Math.min(...request.segments.map((segment) => segment.startUs)), endUs: Math.max(...request.segments.map((segment) => segment.endUs)) }
      return {
        transcript: { contractVersion: TRANSCRIPTION_CONTRACT_VERSION, engine: 'gemini-api', model: GEMINI_ALIGNMENT_MODEL, language: 'ml', segments: allSegments },
        run: {
          id: randomUUID(), createdAt: (this.options.now?.() ?? new Date()).toISOString(), provider: 'gemini', model: GEMINI_ALIGNMENT_MODEL,
          sourceRange, segmentCount: request.segments.length, alignedWordCount, estimatedWordCount: Math.max(0, requestedWordCount - alignedWordCount),
          ...(inputTokens ? { inputTokens } : {}), ...(outputTokens ? { outputTokens } : {}),
        },
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
}
