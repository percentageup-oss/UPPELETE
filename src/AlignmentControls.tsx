import { useEffect, useState } from 'react'
import type { AlignmentOutcome } from './core/alignmentIpc'
import type { AlignmentRun, Cue } from './core/model'
import type { AlignedTranscript } from './core/transcription'
import type { AlignmentRequestSegment } from './core/transcription'
import type { MediaFingerprint } from './core/media'
import type { JobSnapshot } from './core/jobs'
import { describeJob } from './TranscriptionPanel'

/** Renders only when alignment can actually run (captions plus linked media), or while a request is in flight. */
export function AlignmentControls({ fingerprint, mediaReady, cues, keyConfigured, onNeedKey, onApply, onMessage }: {
  fingerprint: MediaFingerprint | null | undefined
  mediaReady: boolean
  cues: Cue[]
  keyConfigured: boolean
  onNeedKey(): void
  onApply(transcript: AlignedTranscript, run: AlignmentRun, snapshot: AlignmentRequestSegment[]): void
  onMessage(tone: 'info' | 'warning' | 'error', text: string): void
}) {
  const [running, setRunning] = useState<{ requestId: string; job: JobSnapshot | null } | null>(null)
  useEffect(() => window.captionStudio?.onAlignmentProgress((message) => {
    setRunning((state) => state?.requestId === message.requestId ? { ...state, job: message.job } : state)
  }), [])

  const start = async () => {
    if (!window.captionStudio || !fingerprint || !mediaReady || !cues.length) return
    if (!keyConfigured) { onNeedKey(); return }
    const segments = cues.filter((cue) => cue.text.trim()).map(({ id, startUs, endUs, text }) => ({ id, startUs, endUs, text }))
    if (!segments.length) return onMessage('warning', 'There are no caption words to align.')
    const requestId = crypto.randomUUID()
    setRunning({ requestId, job: null })
    let outcome: AlignmentOutcome
    try { outcome = await window.captionStudio.startAlignment({ requestId, fingerprint, segments }) }
    catch (error) { setRunning(null); return onMessage('error', error instanceof Error ? error.message : 'Alignment failed.') }
    setRunning(null)
    if (outcome.state === 'cancelled') return onMessage('info', 'Alignment cancelled.')
    if (outcome.state === 'failed') return onMessage('error', outcome.error.message)
    onApply(outcome.transcript, outcome.run, segments)
  }

  if (running) {
    const job = describeJob(running.job)
    return <span className="job-pill" role="status"><span>Aligning · {job.label}{job.percent === null ? '' : ` ${job.percent}%`}</span><button onClick={() => window.captionStudio?.cancelAlignment(running.requestId)}>Cancel</button></span>
  }
  if (!mediaReady || !cues.length) return null
  return <button onClick={() => void start()} title="Improve word timing of existing captions with Gemini. Uploads only caption-covered audio; caption text is never replaced.">Align audio</button>
}
