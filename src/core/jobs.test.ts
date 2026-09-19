import { describe, expect, it } from 'vitest'
import {
  canTransition, isProgressRegression, jobErrorSchema, jobFailure, JobFailure, jobProgressSchema, jobSnapshotSchema,
  TERMINAL_STATES, type JobProgress, type JobState,
} from './jobs'

const STATES: JobState[] = ['queued', 'running', 'succeeded', 'failed', 'cancelled']

describe('job state transitions', () => {
  it('allows only the documented forward transitions', () => {
    const allowed = new Set(['queued->running', 'queued->cancelled', 'queued->failed', 'running->succeeded', 'running->failed', 'running->cancelled'])
    for (const from of STATES) {
      for (const to of STATES) {
        expect(canTransition(from, to)).toBe(allowed.has(`${from}->${to}`))
      }
    }
  })
  it('treats every terminal state as having no outgoing transitions', () => {
    for (const terminal of TERMINAL_STATES) {
      for (const to of STATES) expect(canTransition(terminal, to)).toBe(false)
    }
  })
})

describe('job progress', () => {
  type MeasuredProgress = Extract<JobProgress, { kind: 'measured' }>
  const measured = (completed: number, total = 100): MeasuredProgress => ({ kind: 'measured', phase: 'recognizing', completed, total, unit: 'sourceUs' })

  it('accepts indeterminate and bounded measured progress, rejecting completed beyond total', () => {
    expect(jobProgressSchema.safeParse({ kind: 'indeterminate', phase: 'loading-model' }).success).toBe(true)
    expect(jobProgressSchema.safeParse(measured(50)).success).toBe(true)
    expect(jobProgressSchema.safeParse(measured(150)).success).toBe(false)
    expect(jobProgressSchema.safeParse({ kind: 'measured', phase: 'recognizing', completed: 1, total: 10, unit: 'bogus' }).success).toBe(false)
    expect(jobProgressSchema.safeParse({ kind: 'indeterminate', phase: 'bogus' }).success).toBe(false)
  })

  it('detects only a same-phase, same-unit decrease as regression', () => {
    expect(isProgressRegression(null, measured(10))).toBe(false)
    expect(isProgressRegression(measured(10), measured(20))).toBe(false)
    expect(isProgressRegression(measured(10), measured(10))).toBe(false)
    expect(isProgressRegression(measured(20), measured(10))).toBe(true)
    expect(isProgressRegression({ kind: 'indeterminate', phase: 'loading-model' }, measured(0))).toBe(false)
    expect(isProgressRegression(measured(20), { ...measured(10), phase: 'aligning' })).toBe(false)
    expect(isProgressRegression(measured(20), { ...measured(10), unit: 'items' })).toBe(false)
  })
})

describe('job errors and snapshots', () => {
  it('builds a structured, validated JobFailure', () => {
    const failure = jobFailure('MALFORMED_OUTPUT', 'bad output', { diagnostic: 'x'.repeat(100) })
    expect(failure).toBeInstanceOf(JobFailure)
    expect(failure.detail.code).toBe('MALFORMED_OUTPUT')
    expect(failure.detail.retryable).toBe(false)
    expect(jobErrorSchema.parse(failure.detail)).toEqual(failure.detail)
  })

  it('rejects a diagnostic longer than 8192 characters — callers must truncate themselves', () => {
    expect(() => jobFailure('MALFORMED_OUTPUT', 'bad output', { diagnostic: 'x'.repeat(9000) })).toThrow()
  })

  it('rejects a job snapshot with extra keys or an inconsistent progress/error shape', () => {
    const base = {
      id: 'job-1', kind: 'transcription', label: 'Transcribe clip', state: 'running', cancelRequested: false,
      progress: null, error: null, queuedAtMs: 0, startedAtMs: 1, finishedAtMs: null,
    }
    expect(jobSnapshotSchema.parse(base)).toEqual(base)
    expect(jobSnapshotSchema.safeParse({ ...base, extra: true }).success).toBe(false)
    expect(jobSnapshotSchema.safeParse({ ...base, state: 'bogus' }).success).toBe(false)
  })
})
