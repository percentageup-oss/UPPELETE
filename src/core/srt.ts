import type { Cue } from './model'
import { formatTimestamp, parseTimestamp } from './time'

export type SrtIssue = { block: number; message: string }

export function parseSrt(input: string): { cues: Cue[]; issues: SrtIssue[] } {
  const normalized = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!normalized) return { cues: [], issues: [] }
  const cues: Cue[] = []
  const issues: SrtIssue[] = []
  for (const [blockIndex, rawBlock] of normalized.split(/\n{2,}/).entries()) {
    const lines = rawBlock.split('\n')
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0) {
      issues.push({ block: blockIndex + 1, message: 'Missing timestamp line' })
      continue
    }
    const timing = lines[timingIndex].match(/^\s*(\S+)\s*-->\s*(\S+)/)
    const startUs = timing ? parseTimestamp(timing[1]) : null
    const endUs = timing ? parseTimestamp(timing[2]) : null
    if (startUs === null || endUs === null || endUs <= startUs) {
      issues.push({ block: blockIndex + 1, message: 'Invalid or non-positive timestamp range' })
      continue
    }
    cues.push({
      id: crypto.randomUUID(),
      startUs,
      endUs,
      text: lines.slice(timingIndex + 1).join('\n'),
      timingSource: 'imported',
      needsReview: false,
      textSource: 'imported',
      words: [],
    })
  }
  return { cues, issues }
}

export function serializeSrt(cues: Cue[]): string {
  return cues.map((cue, index) => [
    index + 1,
    `${formatTimestamp(cue.startUs)} --> ${formatTimestamp(cue.endUs)}`,
    cue.text,
  ].join('\n')).join('\n\n') + (cues.length ? '\n' : '')
}
