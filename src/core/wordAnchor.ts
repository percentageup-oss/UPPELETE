import type { CaptionSummary } from './agentProtocol'

/**
 * Finds where a spoken word or phrase sits on the timeline, so an agent can drop an image, title or effect
 * exactly on it (`place_at_word` MCP tool). Works on `get_transcript` output, i.e. SEQUENCE time, so the
 * result lines up with clips as they are placed.
 *
 * Matching never splits or re-cuts text: words are compared whole after Unicode NFC normalisation, so a
 * Malayalam word with its vowel signs matches only itself. Estimated word timing is reported as such and
 * never presented as aligned (AGENTS.md).
 */
export type WordAnchor =
  | { cueId: string; wordIndex: number; wordCount?: number }
  | { text: string; occurrence?: number }

export type ResolvedAnchor = {
  cueId: string
  startUs: number
  endUs: number
  matchedText: string
  /** True when any matched word's timing is an estimate rather than model/aligned/manual. */
  estimated: boolean
  /** How many times the phrase occurs in the transcript (1 for a cueId anchor). */
  totalMatches: number
}

type FlatWord = { cueId: string; text: string; startUs: number; endUs: number; timingSource: string }

const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu
const normalize = (value: string) => value.normalize('NFC').replace(EDGE_PUNCTUATION, '').toLocaleLowerCase()

function flatten(cues: CaptionSummary[]): FlatWord[] {
  const words: FlatWord[] = []
  for (const cue of [...cues].sort((a, b) => a.startUs - b.startUs)) {
    if (!cue.words) throw new Error('The transcript has no word timing; request it with words: true.')
    for (const word of cue.words) words.push({ cueId: cue.id, text: word.text, startUs: word.startUs, endUs: word.endUs, timingSource: word.timingSource })
  }
  return words
}

function span(words: FlatWord[], from: number, count: number, totalMatches: number): ResolvedAnchor {
  const matched = words.slice(from, from + count)
  return {
    cueId: matched[0].cueId, startUs: matched[0].startUs, endUs: matched[matched.length - 1].endUs,
    matchedText: matched.map((word) => word.text).join(' '), estimated: matched.some((word) => word.timingSource === 'estimated'), totalMatches,
  }
}

export function resolveWordAnchor(cues: CaptionSummary[], anchor: WordAnchor): ResolvedAnchor {
  if ('cueId' in anchor) {
    const cue = cues.find((candidate) => candidate.id === anchor.cueId)
    if (!cue) throw new Error(`No cue "${anchor.cueId}" in the transcript (it may be inside a removed range).`)
    if (!cue.words) throw new Error('The transcript has no word timing; request it with words: true.')
    const count = anchor.wordCount ?? 1
    if (anchor.wordIndex < 0 || anchor.wordIndex + count > cue.words.length) throw new Error(`Cue "${cue.id}" has ${cue.words.length} words; wordIndex ${anchor.wordIndex} with wordCount ${count} is out of range.`)
    const words: FlatWord[] = cue.words.map((word) => ({ cueId: cue.id, text: word.text, startUs: word.startUs, endUs: word.endUs, timingSource: word.timingSource }))
    return span(words, anchor.wordIndex, count, 1)
  }
  const tokens = anchor.text.split(/\s+/).map(normalize).filter(Boolean)
  if (tokens.length === 0) throw new Error('The anchor text is empty.')
  const words = flatten(cues)
  const normalized = words.map((word) => normalize(word.text))
  const starts: number[] = []
  for (let index = 0; index + tokens.length <= words.length; index += 1) {
    if (tokens.every((token, offset) => normalized[index + offset] === token)) starts.push(index)
  }
  if (starts.length === 0) throw new Error(`"${anchor.text}" was not found in the transcript. Check the exact spoken words with get_transcript.`)
  const occurrence = anchor.occurrence ?? 1
  if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > starts.length) throw new Error(`"${anchor.text}" occurs ${starts.length} time(s); occurrence ${occurrence} does not exist.`)
  return span(words, starts[occurrence - 1], tokens.length, starts.length)
}
