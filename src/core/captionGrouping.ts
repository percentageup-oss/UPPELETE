import { sliceEmphasis } from './emphasis'
import type { Cue } from './model'
import { graphemes, locateWordSpans } from './captionText'
import { untimedTokenCount } from './wordTiming'

export type GroupingOptions = { maxWords: number; maxGraphemes: number; maxDurationUs: number; pauseUs: number }
export const DEFAULT_GROUPING: GroupingOptions = { maxWords: 7, maxGraphemes: 42, maxDurationUs: 6_000_000, pauseUs: 800_000 }

/** Group text separately from recognition/timing. Every word ID and source boundary remains exact. */
export function groupCaption(cue: Cue, newId: () => string, options: GroupingOptions = DEFAULT_GROUPING): Cue[] {
  if (Object.values(options).some((value) => !Number.isSafeInteger(value) || value <= 0)) throw new Error('Grouping limits must be positive integers.')
  if (!cue.words.length) return [cue]
  const spans = locateWordSpans(cue.text, cue.words)
  if (!spans || untimedTokenCount(cue) > 0) throw new Error('Some words have no timing. Estimate word timing explicitly before grouping.')
  const ids = new Set<string>()
  for (const [index, word] of cue.words.entries()) {
    if (ids.has(word.id) || !Number.isSafeInteger(word.startUs) || !Number.isSafeInteger(word.endUs)
      || word.startUs < cue.startUs || word.endUs > cue.endUs || word.endUs <= word.startUs
      || (index > 0 && word.startUs < cue.words[index - 1].endUs)) throw new Error('Grouping requires unique, ordered words contained by the caption.')
    ids.add(word.id)
  }
  const groups: number[][] = []
  let current: number[] = []
  for (let index = 0; index < cue.words.length; index += 1) {
    const word = cue.words[index]
    const first = current[0]
    const previous = cue.words[index - 1]
    const between = index > 0 ? cue.text.slice(spans[index - 1].textEnd, spans[index].textStart) : ''
    if (current.length && (current.length >= options.maxWords
      || graphemes(cue.text.slice(spans[first].textStart, spans[index].textEnd)).length > options.maxGraphemes
      || word.endUs - cue.words[first].startUs > options.maxDurationUs
      || word.startUs - previous.endUs >= options.pauseUs
      || /[.!?。！？।]\s*$/u.test(between) || /[.!?。！？।]$/u.test(previous.text))) {
      groups.push(current)
      current = []
    }
    current.push(index)
  }
  if (current.length) groups.push(current)
  if (groups.length === 1) return [cue]
  return groups.map((indices, groupIndex) => {
    const first = indices[0], last = indices.at(-1)!
    const textStart = groupIndex === 0 ? 0 : spans[first].textStart
    const textEnd = last === cue.words.length - 1 ? cue.text.length : spans[last + 1].textStart
    const words = indices.map((index) => ({ ...cue.words[index], textStart: spans[index].textStart - textStart, textEnd: spans[index].textEnd - textStart }))
    const sources = new Set(words.map((word) => word.timingSource))
    // Mixed sources are a derived boundary; use the least certain source, never promote estimates.
    const timingSource = sources.has('estimated') ? 'estimated' : sources.has('manual') ? 'manual' : sources.has('model') ? 'model' : 'aligned'
    return {
      ...cue, id: groupIndex === 0 ? cue.id : newId(), text: cue.text.slice(textStart, textEnd), emphasized: sliceEmphasis(cue.emphasized, textStart, textEnd), words,
      // Keep the original cue's outer source range (including lead-in/trailing gaps) while
      // preserving natural gaps between generated groups. This avoids silently shortening SRT.
      startUs: groupIndex === 0 ? cue.startUs : words[0].startUs,
      endUs: groupIndex === groups.length - 1 ? cue.endUs : words.at(-1)!.endUs, timingSource,
      needsReview: cue.needsReview || words.some((word) => word.needsReview || word.timingSource === 'estimated'),
    }
  })
}
