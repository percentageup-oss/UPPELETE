import type { JobSnapshot } from '../core/jobs'
import { describeJob } from '../TranscriptionPanel'

export type ExportRateView = { percent: number | null; etaMs: number | null; framesPerSecond: number | null }

const MIN_WINDOW_MS = 3000
const MIN_PERCENT = 2
const SMOOTHING = 0.3

/** Measures export speed from FFmpeg frame counts. Nothing is reported until enough has been
 * observed for the numbers to be stable; a rate is never guessed. */
export function createProgressRate() {
  let firstMs: number | null = null
  let firstCompleted = 0
  let lastMs = 0
  let lastCompleted = 0
  let ewma: number | null = null
  return {
    sample(completed: number, total: number, nowMs: number): ExportRateView {
      const percent = total > 0 ? Math.min(100, Math.floor(completed * 100 / total)) : null
      if (firstMs === null) {
        firstMs = nowMs; firstCompleted = completed; lastMs = nowMs; lastCompleted = completed
      } else if (completed > lastCompleted && nowMs > lastMs) {
        const instant = (completed - lastCompleted) / ((nowMs - lastMs) / 1000)
        ewma = ewma === null ? instant : ewma + SMOOTHING * (instant - ewma)
        lastMs = nowMs; lastCompleted = completed
      }
      const stable = ewma !== null && lastMs - (firstMs ?? lastMs) >= MIN_WINDOW_MS && total > 0
        && (lastCompleted - firstCompleted) * 100 / total >= MIN_PERCENT
      if (!stable || ewma === null || ewma <= 0) return { percent, etaMs: null, framesPerSecond: null }
      return { percent, etaMs: Math.max(0, total - completed) / ewma * 1000, framesPerSecond: ewma }
    },
  }
}

/** "about 1:12 left", "less than a minute left". */
export function formatEta(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return 'less than a minute left'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  return hours > 0 ? `about ${hours}:${String(minutes).padStart(2, '0')}:${rest} left` : `about ${minutes}:${rest} left`
}

export function describeExport(job: JobSnapshot | null, rate: ExportRateView | null): { label: string; percent: number | null } {
  if (job && (job.state === 'queued' || job.cancelRequested)) return describeJob(job)
  if (!job?.progress || job.progress.kind !== 'measured') return { label: 'Preparing…', percent: null }
  const percent = rate?.percent ?? Math.floor(job.progress.completed * 100 / job.progress.total)
  const parts = [`Exporting ${percent}%`]
  if (rate?.etaMs != null) parts.push(formatEta(rate.etaMs))
  if (rate?.framesPerSecond != null) parts.push(`${Math.round(rate.framesPerSecond)} fps`)
  return { label: parts.join(' · '), percent }
}
