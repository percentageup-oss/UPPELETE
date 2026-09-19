import { JobFailure, jobFailure } from '../src/core/jobs'
import type { AlignedTranscript, AlignmentRequestSegment, SourceTimedTranscript, TranscriptionOptions } from '../src/core/transcription'
import type { TranscriptionAdapter, TranscriptionInput } from '../workers/transcription/contract'
import { runAlignment, runTranscription } from '../workers/transcription/run'
import { JobScheduler, type JobHandle } from './jobScheduler'

/**
 * Wires the transcription/alignment contract into the job scheduler: run the guarded
 * adapter call, then gate the project mutation behind `ctx.enterCommit()` so a cancel that
 * arrives after validated output exists — but before it is applied — still wins, and a
 * mutation that has already started is never retroactively relabeled cancelled. Not wired
 * into `main.ts`/preload; no transcription backend exists yet (T3).
 */

async function commitOrFail<T>(commit: (value: T) => Promise<void> | void, value: T, what: string): Promise<void> {
  try {
    await commit(value)
  } catch (error) {
    if (error instanceof JobFailure) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw jobFailure('COMMIT_FAILED', `Failed to apply the ${what} result to the project.`, { diagnostic: message.slice(0, 8192) })
  }
}

export type EnqueueTranscriptionOptions = {
  adapter: TranscriptionAdapter
  input: TranscriptionInput
  options: TranscriptionOptions
  label: string
  commit(transcript: SourceTimedTranscript): Promise<void> | void
}

export function enqueueTranscription(scheduler: JobScheduler, request: EnqueueTranscriptionOptions): JobHandle<void> {
  return scheduler.enqueue({
    kind: 'transcription',
    label: request.label,
    run: async (ctx) => {
      const transcript = await runTranscription(request.adapter, request.input, request.options, {
        signal: ctx.signal,
        onProgress: ctx.reportProgress,
      })
      if (!ctx.enterCommit()) throw jobFailure('CANCELLED', 'Transcription was cancelled before it could be committed.')
      await commitOrFail(request.commit, transcript, 'transcription')
    },
  })
}

export type EnqueueAlignmentOptions = {
  adapter: TranscriptionAdapter
  input: TranscriptionInput
  language: string
  segments: readonly AlignmentRequestSegment[]
  label: string
  commit(result: AlignedTranscript): Promise<void> | void
}

export function enqueueAlignment(scheduler: JobScheduler, request: EnqueueAlignmentOptions): JobHandle<void> {
  return scheduler.enqueue({
    kind: 'alignment',
    label: request.label,
    run: async (ctx) => {
      const result = await runAlignment(request.adapter, request.input, request.language, request.segments, {
        signal: ctx.signal,
        onProgress: ctx.reportProgress,
      })
      if (!ctx.enterCommit()) throw jobFailure('CANCELLED', 'Alignment was cancelled before it could be committed.')
      await commitOrFail(request.commit, result, 'alignment')
    },
  })
}
