import { cueSchema, type CaptionProject, type Cue } from './model'
import { estimateWordTimings, estimateMissingWordTimings, cuesNeedingWordTiming, retainSafeWordTimings, untimedTokenCount } from './wordTiming'
import { groupCaption, type GroupingOptions } from './captionGrouping'
import { retainEmphasis, sliceEmphasis } from './emphasis'
import { captionTokens, graphemeBoundaries, locateWordSpans } from './captionText'
import type { CaptionDisplay } from '../captions/wordDisplay'
import type { CaptionMotion, CaptionStyle } from '../captions/style'
import type { Selection } from './timelineItems'
import { bindUnboundItems, defaultBindingAssetId } from './projectClips'
import type { TranslationTarget } from './transcription'

/**
 * A word-menu target: a timed word entry (`wordId`), or a plain text token that has no word
 * timing yet (`textStart`, the token's offset in `cue.text`). Commands that only ever touch text
 * (delete-word, line-break-before-word) accept either; commands that must read a word's timing to
 * place a cue boundary (split-before-word, the move-* commands) still require a real `wordId`.
 */
export type WordTarget = { wordId: string } | { textStart: number }

export type CaptionCommand =
  | { type: 'toggle-emphasis'; cueId: string; textStart: number }
  | { type: 'estimate-words'; cueId: string; idPrefix: string; missingOnly?: boolean }
  /** `estimateIfUntimed` (an id prefix) restores word timing this edit broke on a cue that already had
   * complete timing, so a word-driven motion preset keeps animating instead of silently falling back to
   * static-clean. It never estimates a cue that had no word timing to begin with (e.g. imported SRT). */
  | { type: 'update-text'; cueId: string; text: string; estimateIfUntimed?: string }
  /** Global edit: several captions' text in one undo step. Unchanged texts are skipped; the whole command fails if any cue is missing. */
  | { type: 'update-text-many'; edits: { cueId: string; text: string }[]; estimateIfUntimed?: string }
  | { type: 'update-time'; cueId: string; startUs: number; endUs: number }
  | { type: 'shift-time'; cueId: string; deltaUs: number }
  | { type: 'add'; cue: Cue }
  | { type: 'duplicate'; cueId: string; duplicateId: string }
  | { type: 'delete'; cueId: string }
  | { type: 'delete-word'; cueId: string; target: WordTarget }
  | { type: 'split'; cueId: string; atUs: number; rightCueId: string }
  /** Merges with the next cue *of the same language*. */
  | { type: 'merge-next'; cueId: string }
  /** Chooses which translation is shown on video, in export and in SRT; `null` shows the original. A language must have at least one cue. */
  | { type: 'set-shown-translation'; language: TranslationTarget | null }
  | { type: 'regroup'; cueId: string; idPrefix: string; estimateMissing: boolean; options?: GroupingOptions }
  | { type: 'regroup-many'; cueIds: string[]; idPrefix: string; estimateMissing: boolean; options?: GroupingOptions }
  | { type: 'set-timeline-display'; display: CaptionDisplay }
  /** Legacy command name retained for project integrations; it is now timeline-only and never estimates timings. */
  | { type: 'set-display'; display: CaptionDisplay; idPrefix?: string }
  | { type: 'set-caption-display'; display: CaptionDisplay }
  | { type: 'apply-template'; style: CaptionStyle; idPrefix: string }
  | { type: 'set-motion-override'; cueId: string; override?: { motion?: CaptionMotion; motionSpeed?: number } }
  | { type: 'reset-motion-overrides' }
  | { type: 'set-placement-override'; cueId: string; override?: Cue['placementOverride'] }
  | { type: 'reset-placement-overrides' }
  | { type: 'line-break-before-word'; cueId: string; target: WordTarget }
  | { type: 'split-before-word'; cueId: string; wordId: string; rightCueId: string }
  | { type: 'move-from-word-to-next'; cueId: string; wordId: string }
  | { type: 'move-through-word-to-previous'; cueId: string; wordId: string }

/**
 * Shared by caption commands (`applyCaptionCommand`) and item commands (`itemCommands.ts`), so one
 * `runCommand` in App.tsx reports both. `cueIds` carries the affected IDs of whatever kind —
 * the field name predates schema 3's single ID namespace.
 */
export type ValidationIssue = {
  kind: 'invalid-duration' | 'media-bounds' | 'word-containment' | 'word-text' | 'overlap' | 'estimate-skipped'
    | 'asset-missing' | 'asset-kind' | 'rect-bounds' | 'clip-order' | 'clip-empty' | 'gain-range' | 'value-range' | 'asset-in-use'
  cueIds: string[]
  message: string
}

export type CommandContext = {
  /** Duration bound for items **not** bound to a video (SRT-first projects) and the App's runtime-measured fallback. */
  mediaDurationUs?: number | null
  /**
   * A video asset's duration, overriding what its stored metadata says — the App passes the
   * duration the `<video>` element measured for a file whose probe reported none.
   */
  assetDurationUs?: (assetId: string) => number | null | undefined
  /** The video a newly created, unbound caption or item belongs to (the asset under the playhead). */
  defaultAssetId?: string | null
  /**
   * The composition height for the *current* display aspect (1080 / aspect). A rect taller than
   * this is a **warning**, never a schema error: relinking media with a different aspect must never
   * make a saved project unloadable, so the height bound cannot live in the schema.
   */
  compositionHeight?: number | null
}
export type CommandResult =
  // `selectedId: undefined` means "leave the current selection alone" — used by project-wide
  // commands (set-display) that have no single cue to select.
  | { ok: true; project: CaptionProject; selectedId: string | null | undefined; warnings: ValidationIssue[]
      /** Set by item commands, which select things that are not cues. Caption commands use `selectedId`. */
      selection?: Selection | null | undefined }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] }

/** A cue bound to a video is bounded by that video's duration; an unbound cue by `mediaDurationUs`. */
export function boundFor(mediaAssetId: string | undefined, context: CommandContext): number | null {
  if (mediaAssetId !== undefined) return context.assetDurationUs?.(mediaAssetId) ?? null
  return context.mediaDurationUs ?? null
}

function cueErrors(cue: Cue, mediaDurationUs?: number | null): ValidationIssue[] {
  const errors: ValidationIssue[] = []
  if (!Number.isSafeInteger(cue.startUs) || !Number.isSafeInteger(cue.endUs) || cue.startUs < 0 || cue.endUs <= cue.startUs) {
    errors.push({ kind: 'invalid-duration', cueIds: [cue.id], message: 'Cue end must be after its non-negative start.' })
  }
  if (mediaDurationUs != null && (cue.startUs > mediaDurationUs || cue.endUs > mediaDurationUs)) {
    errors.push({ kind: 'media-bounds', cueIds: [cue.id], message: 'Cue timing must stay within the known media duration.' })
  }
  for (const word of cue.words) {
    if (!Number.isSafeInteger(word.startUs) || !Number.isSafeInteger(word.endUs) || word.startUs < cue.startUs || word.endUs > cue.endUs || word.endUs <= word.startUs) {
      errors.push({
        kind: 'word-containment',
        cueIds: [cue.id],
        message: `Word “${word.text}” must have a positive duration contained by its cue.`,
      })
    }
  }
  if (!cueSchema.safeParse(cue).success && errors.length === 0) {
    errors.push({ kind: 'word-text', cueIds: [cue.id], message: 'Words must have unique IDs, ordered timing, and match whole words/graphemes in the caption.' })
  }
  return errors
}

const sameLanguage = (a: Cue, b: Cue) => a.translationLanguage === b.translationLanguage

/** The index of the nearest cue in `direction` from `index` that is in the same language, or -1. */
function adjacentSameLanguage(cues: readonly Cue[], index: number, direction: 1 | -1): number {
  for (let at = index + direction; at >= 0 && at < cues.length; at += direction) if (sameLanguage(cues[at], cues[index])) return at
  return -1
}

export function validateCaptions(cues: Cue[], context: CommandContext = {}): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors = cues.flatMap((cue) => cueErrors(cue, boundFor(cue.mediaAssetId, context)))
  const wordIds = new Set<string>()
  for (const cue of cues) for (const word of cue.words) {
    if (wordIds.has(word.id)) errors.push({ kind: 'word-text', cueIds: [cue.id], message: 'Word IDs must be unique across captions.' })
    wordIds.add(word.id)
  }
  const warnings: ValidationIssue[] = []
  // Cues of different videos live on different source timelines, so they can never overlap each other;
  // an original and its translations share one timeline on purpose, so each language is its own group.
  const byVideo = new Map<string, Cue[]>()
  for (const cue of cues) {
    const key = `${cue.mediaAssetId ?? ''}|${cue.translationLanguage ?? ''}`
    byVideo.set(key, [...(byVideo.get(key) ?? []), cue])
  }
  for (const group of byVideo.values()) {
    const ordered = [...group].sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
    for (let index = 0; index < ordered.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < ordered.length && ordered[otherIndex].startUs < ordered[index].endUs; otherIndex += 1) {
        const left = ordered[index]
        const right = ordered[otherIndex]
        warnings.push({
          kind: 'overlap',
          cueIds: [left.id, right.id],
          message: `Cues overlap by ${Math.min(left.endUs, right.endUs) - right.startUs} µs.`,
        })
      }
    }
  }
  return { errors, warnings }
}

function splitTextAtRatio(text: string, ratio: number): [string, string] {
  if (!text) return ['', '']
  const graphemes = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)]
  const target = Math.min(graphemes.length - 1, Math.max(1, Math.round(graphemes.length * ratio)))
  const whitespaceBoundaries = graphemes
    .map((segment, index) => (/\s/u.test(segment.segment) ? index : -1))
    .filter((index) => index > 0 && index < graphemes.length)
  const boundary = whitespaceBoundaries.length
    ? whitespaceBoundaries.reduce((nearest, candidate) => Math.abs(candidate - target) < Math.abs(nearest - target) ? candidate : nearest)
    : target
  const offset = graphemes[boundary]?.index ?? text.length
  return [text.slice(0, offset).trimEnd(), text.slice(offset).trimStart()]
}

function replaceCue(cues: Cue[], cueId: string, replacement: Cue[]): Cue[] {
  const index = cues.findIndex((cue) => cue.id === cueId)
  return index < 0 ? cues : [...cues.slice(0, index), ...replacement, ...cues.slice(index + 1)]
}

/** Resolves a `WordTarget` to its span in `cue.text`, for the commands that accept either a timed word or a plain token. */
function locateTarget(cue: Cue, target: WordTarget): { textStart: number; textEnd: number; wordId: string | null } | null {
  if ('wordId' in target) {
    const wordIndex = cue.words.findIndex((word) => word.id === target.wordId)
    const spans = locateWordSpans(cue.text, cue.words)
    if (wordIndex < 0 || !spans) return null
    return { textStart: spans[wordIndex].textStart, textEnd: spans[wordIndex].textEnd, wordId: target.wordId }
  }
  const token = captionTokens(cue.text).find((item) => item.textStart === target.textStart)
  return token ? { textStart: token.textStart, textEnd: token.textEnd, wordId: null } : null
}

/** A video's duration: the caller's lookup (a runtime-measured value) first, else what its stored probe says. */
function boundContext(project: Pick<CaptionProject, 'assets'>, context: CommandContext): CommandContext {
  const durations = new Map(project.assets.flatMap((asset) => asset.metadata?.durationUs != null ? [[asset.id, asset.metadata.durationUs] as const] : []))
  return { ...context, assetDurationUs: (assetId) => context.assetDurationUs?.(assetId) ?? durations.get(assetId) }
}

function fail(message: string, warnings: ValidationIssue[] = []): CommandResult {
  return { ok: false, errors: [{ kind: 'invalid-duration', cueIds: [], message }], warnings }
}

export function applyCaptionCommand(project: CaptionProject, command: CaptionCommand, context: CommandContext = {}): CommandResult {
  let cues = project.cues
  let selectedId: string | null | undefined = 'cueId' in command ? command.cueId : undefined
  let captionDisplay = project.captionDisplay
  let timelineDisplay = project.timelineDisplay
  let captionStyle = project.captionStyle
  let shownTranslation = project.shownTranslation
  const commandWarnings: ValidationIssue[] = []
  // Shared by 'delete' and the "word alone in an otherwise-empty cue" fallback of 'delete-word'.
  const removeCue = (cueId: string): boolean => {
    const index = cues.findIndex((item) => item.id === cueId)
    if (index < 0) return false
    const remaining = cues.filter((item) => item.id !== cueId)
    selectedId = remaining[Math.min(index, remaining.length - 1)]?.id ?? null
    cues = remaining
    return true
  }

  if (command.type === 'toggle-emphasis') {
    const cue = cues.find((item) => item.id === command.cueId)
    const token = cue && captionTokens(cue.text).find((item) => item.textStart === command.textStart)
    if (!cue || !token) return fail('Select a whole word in the caption.')
    const marks = cue.emphasized ?? []
    const emphasized = marks.some((mark) => mark.textStart === token.textStart)
      ? marks.filter((mark) => mark.textStart !== token.textStart) : [...marks, token].sort((a, b) => a.textStart - b.textStart)
    cues = replaceCue(cues, cue.id, [{ ...cue, emphasized }])
  } else if (command.type === 'estimate-words') {
    const cue = cues.find((item) => item.id === command.cueId)
    if (!cue) return fail('The selected cue no longer exists.')
    let serial = 0
    const newId = () => `${command.idPrefix}-${++serial}`
    try {
      // `missingOnly` fills only untimed gaps, leaving aligned/manual/model words untouched — used
      // by the word-menu's inline estimate so it never overwrites timing the user already trusts.
      const words = command.missingOnly ? estimateMissingWordTimings(cue, newId) : estimateWordTimings(cue, newId)
      cues = replaceCue(cues, cue.id, [{ ...cue, words, needsReview: true }])
    }
    catch (error) { return fail(error instanceof Error ? error.message : 'Cannot estimate word timing.') }
  } else if (command.type === 'update-text' || command.type === 'update-text-many') {
    const edits = command.type === 'update-text' ? [{ cueId: command.cueId, text: command.text }] : command.edits
    if (command.type === 'update-text-many' && edits.some((edit) => !edit.text.trim())) return fail('A caption cannot be empty.')
    if (edits.length === 1 && cues.find((item) => item.id === edits[0].cueId)?.text === edits[0].text) {
      return { ok: true, project, selectedId: edits[0].cueId, warnings: validateCaptions(cues, context).warnings }
    }
    for (const edit of edits) {
      const cue = cues.find((item) => item.id === edit.cueId)
      if (!cue) return fail('The selected cue no longer exists.')
      if (cue.text === edit.text) continue
      // A cue that already had complete word timing keeps a word-driven motion preset working
      // through the edit — see `wordMotionAvailability` (renderer.ts), which requires every token to
      // be covered by a timed word or falls back to static-clean. Only fill the gap this edit just
      // opened; never invent word timing for a cue that never had it (e.g. imported SRT).
      const hadCompleteTiming = cue.words.length > 0 && untimedTokenCount(cue) === 0
      let words = retainSafeWordTimings(cue.words, cue.text, edit.text)
      if (command.estimateIfUntimed !== undefined && hadCompleteTiming) {
        const draft = { ...cue, text: edit.text, words }
        if (untimedTokenCount(draft) > 0 && captionTokens(edit.text).length > 0) {
          let serial = 0
          const prefix = command.type === 'update-text' ? command.estimateIfUntimed : `${command.estimateIfUntimed}-${cue.id}`
          try { words = estimateMissingWordTimings(draft, () => `${prefix}-${++serial}`) }
          catch (error) {
            commandWarnings.push({ kind: 'estimate-skipped', cueIds: [cue.id], message: error instanceof Error ? error.message : 'Cannot estimate word timing.' })
          }
        }
      }
      cues = replaceCue(cues, cue.id, [{
        ...cue,
        text: edit.text,
        emphasized: retainEmphasis(cue.emphasized, cue.text, edit.text),
        textSource: 'user',
        needsReview: true,
        words,
      }])
    }
  } else if (command.type === 'update-time') {
    const cue = cues.find((item) => item.id === command.cueId)
    if (!cue) return fail('The selected cue no longer exists.')
    if (cue.startUs === command.startUs && cue.endUs === command.endUs) return { ok: true, project, selectedId: cue.id, warnings: validateCaptions(cues, context).warnings }
    cues = replaceCue(cues, cue.id, [{ ...cue, startUs: command.startUs, endUs: command.endUs, timingSource: 'manual' }])
  } else if (command.type === 'shift-time') {
    const cue = cues.find((item) => item.id === command.cueId)
    if (!cue) return fail('The selected cue no longer exists.')
    if (!Number.isSafeInteger(command.deltaUs)) return fail('Cue movement must use integer microseconds.')
    if (command.deltaUs === 0) return { ok: true, project, selectedId: cue.id, warnings: validateCaptions(cues, context).warnings }
    cues = replaceCue(cues, cue.id, [{
      ...cue,
      startUs: cue.startUs + command.deltaUs,
      endUs: cue.endUs + command.deltaUs,
      words: cue.words.map((word) => ({ ...word, startUs: word.startUs + command.deltaUs, endUs: word.endUs + command.deltaUs })),
      timingSource: 'manual',
    }])
  } else if (command.type === 'add') {
    if (cues.some((cue) => cue.id === command.cue.id)) return fail('Cue IDs must be unique.')
    cues = [...cues, command.cue].sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
    selectedId = command.cue.id
  } else if (command.type === 'duplicate') {
    const cue = cues.find((item) => item.id === command.cueId)
    if (!cue) return fail('The selected cue no longer exists.')
    if (cues.some((item) => item.id === command.duplicateId)) return fail('Cue IDs must be unique.')
    const length = cue.endUs - cue.startUs
    const bound = boundFor(cue.mediaAssetId, boundContext(project, context))
    // Nudge the copy forward like text-duplicate does, but clamp to the video's own duration so the
    // copy never trips the media-bounds error; a cue that already fills its bound lands on top of it.
    const offset = bound != null ? Math.min(250_000, Math.max(0, bound - cue.endUs)) : 250_000
    const startUs = cue.startUs + offset
    const duplicate: Cue = {
      ...cue,
      id: command.duplicateId,
      startUs,
      endUs: startUs + length,
      // Word IDs must stay unique across the whole project (validateCaptions), not just within a cue.
      words: cue.words.map((word, index) => ({ ...word, id: `${command.duplicateId}-w${index}`, startUs: word.startUs + offset, endUs: word.endUs + offset })),
    }
    cues = [...cues, duplicate].sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
    selectedId = duplicate.id
  } else if (command.type === 'delete') {
    if (!removeCue(command.cueId)) return fail('The selected cue no longer exists.')
  } else if (command.type === 'delete-word') {
    const cue = cues.find((item) => item.id === command.cueId)
    const spans = cue && locateWordSpans(cue.text, cue.words)
    const located = cue && locateTarget(cue, command.target)
    if (!cue || !spans || !located) return fail('The selected word no longer exists.')
    const text = cue.text
    const tokens = captionTokens(text)
    const boundaries = [...graphemeBoundaries(text)].sort((a, b) => a - b)
    const nextBoundary = (at: number) => boundaries.find((b) => b > at) ?? text.length
    const prevBoundary = (at: number) => [...boundaries].reverse().find((b) => b < at) ?? 0
    let { textStart: start, textEnd: end } = located
    // Swallow attached punctuation (not whitespace, not another token) up to the next/previous token.
    const nextTokenStart = tokens.find((token) => token.textStart >= end)?.textStart ?? text.length
    while (end < nextTokenStart && !/\s/u.test(text[end])) end = Math.min(nextBoundary(end), nextTokenStart)
    const prevTokenEnd = [...tokens].reverse().find((token) => token.textEnd <= start)?.textEnd ?? 0
    while (start > prevTokenEnd && !/\s/u.test(text[start - 1])) start = Math.max(prevBoundary(start), prevTokenEnd)
    // Swallow exactly one adjacent run of horizontal whitespace (never a line break here).
    const trailingSpace = /^[^\S\r\n]+/u.exec(text.slice(end))
    if (trailingSpace) end += trailingSpace[0].length
    else { const leadingSpace = /[^\S\r\n]+$/u.exec(text.slice(0, start)); if (leadingSpace) start -= leadingSpace[0].length }
    // A word alone on its own line leaves no blank line behind.
    const beforeEmpty = start === 0 || /(?:\r\n|\r|\n)$/u.test(text.slice(0, start))
    const afterEmpty = end === text.length || /^(?:\r\n|\r|\n)/u.test(text.slice(end))
    if (beforeEmpty && afterEmpty) {
      const following = /^(?:\r\n|\r|\n)/u.exec(text.slice(end))
      if (following) end += following[0].length
      else { const preceding = /(?:\r\n|\r|\n)$/u.exec(text.slice(0, start)); if (preceding) start -= preceding[0].length }
    }
    const newText = text.slice(0, start) + text.slice(end)
    if (captionTokens(newText).length === 0) {
      removeCue(cue.id)
    } else {
      const delta = end - start
      const shift = (from: number) => from >= end ? from - delta : from
      const words = cue.words
        .map((word, index) => ({ word, span: spans[index] }))
        .filter(({ word }) => word.id !== located.wordId)
        .map(({ word, span }) => ({ ...word, textStart: shift(span.textStart), textEnd: shift(span.textEnd) }))
      const emphasized = (cue.emphasized ?? [])
        .filter((mark) => mark.textEnd <= start || mark.textStart >= end)
        .map((mark) => ({ ...mark, textStart: shift(mark.textStart), textEnd: shift(mark.textEnd) }))
      cues = replaceCue(cues, cue.id, [{ ...cue, text: newText, words, emphasized: emphasized.length ? emphasized : undefined, textSource: 'user', needsReview: true }])
      selectedId = cue.id
    }
  } else if (command.type === 'split') {
    const cue = cues.find((item) => item.id === command.cueId)
    if (!cue) return fail('The selected cue no longer exists.')
    if (command.atUs <= cue.startUs || command.atUs >= cue.endUs) return fail('Place the playhead strictly inside the cue to split it.')
    if (cues.some((item) => item.id === command.rightCueId)) return fail('Cue IDs must be unique.')
    const leftWords = cue.words.filter((word) => word.endUs <= command.atUs)
    const rightWords = cue.words.filter((word) => word.startUs >= command.atUs)
    const [leftText, rightText] = splitTextAtRatio(cue.text, (command.atUs - cue.startUs) / (cue.endUs - cue.startUs))
    const safeLeftWords = retainSafeWordTimings(leftWords, cue.text, leftText)
    const safeRightWords = retainSafeWordTimings(rightWords, cue.text, rightText)
    const left: Cue = { ...cue, endUs: command.atUs, text: leftText, emphasized: sliceEmphasis(cue.emphasized, 0, leftText.length), words: safeLeftWords, textSource: 'user', needsReview: true, timingSource: 'manual' }
    const right: Cue = { ...cue, id: command.rightCueId, startUs: command.atUs, text: rightText, emphasized: sliceEmphasis(cue.emphasized, cue.text.length - rightText.length, cue.text.length), words: safeRightWords, textSource: 'user', needsReview: true, timingSource: 'manual' }
    cues = replaceCue(cues, cue.id, [left, right])
    selectedId = right.id
  } else if (command.type === 'regroup' || command.type === 'regroup-many') {
    const targetIds = command.type === 'regroup' ? [command.cueId] : command.cueIds
    if (!targetIds.length) return fail('Select at least one caption to group.')
    let serial = 0
    const newId = () => `${command.idPrefix}-${++serial}`
    try {
      for (const cueId of targetIds) {
        const cue = cues.find((item) => item.id === cueId)
        if (!cue) return fail('The selected cue no longer exists.')
        const prepared = command.estimateMissing ? { ...cue, words: estimateWordTimings(cue, newId), needsReview: true } : cue
        const grouped = groupCaption(prepared, newId, command.options).map((item) => ({ ...item, textSource: 'user' as const }))
        if (grouped.some((item) => item.id !== cue.id && cues.some((existing) => existing.id === item.id))) return fail('Cue IDs must be unique.')
        cues = replaceCue(cues, cue.id, grouped)
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Cannot group this caption.')
    }
  } else if (command.type === 'merge-next') {
    const index = cues.findIndex((cue) => cue.id === command.cueId)
    const cue = cues[index]
    const nextIndex = cue ? cues.findIndex((item, at) => at > index && sameLanguage(item, cue)) : -1
    const next = cues[nextIndex]
    if (!cue || !next) return fail('Select a cue that has a following cue to merge.')
    if (cue.mediaAssetId !== next.mediaAssetId) return fail('Captions of different videos cannot be merged.')
    const joiner = /\s$/u.test(cue.text) || /^\s/u.test(next.text) ? '' : ' '
    const leftSpans = locateWordSpans(cue.text, cue.words)
    const rightSpans = locateWordSpans(next.text, next.words)
    const merged: Cue = {
      ...cue,
      endUs: Math.max(cue.endUs, next.endUs),
      text: `${cue.text}${joiner}${next.text}`,
      emphasized: [...(cue.emphasized ?? []), ...(next.emphasized ?? []).map((span) => ({ ...span, textStart: span.textStart + cue.text.length + joiner.length, textEnd: span.textEnd + cue.text.length + joiner.length }))],
      words: [
        ...cue.words.map((word, index) => ({ ...word, ...(leftSpans?.[index] ?? {}) })),
        ...next.words.map((word, index) => {
          const span = rightSpans?.[index]
          return { ...word, ...(span ? { textStart: span.textStart + cue.text.length + joiner.length, textEnd: span.textEnd + cue.text.length + joiner.length } : {}) }
        }),
      ].sort((a, b) => a.startUs - b.startUs),
      timingSource: cue.timingSource === next.timingSource ? cue.timingSource : 'manual',
      textSource: 'user',
      needsReview: cue.needsReview || next.needsReview,
    }
    cues = cues.flatMap((item, at) => at === index ? [merged] : at === nextIndex ? [] : [item])
    selectedId = merged.id
  } else if (command.type === 'set-shown-translation') {
    if (command.language !== null && !cues.some((cue) => cue.translationLanguage === command.language)) return fail('There are no captions in that language to show.')
    shownTranslation = command.language ?? undefined
    selectedId = undefined
  } else if (command.type === 'set-timeline-display') {
    timelineDisplay = command.display
  } else if (command.type === 'set-display') {
    // Compatibility for pre-separation callers. The editor uses set-timeline-display, which is
    // intentionally side-effect free; old saved integrations retain their documented behavior.
    const current = project.captionDisplay ?? 'line'
    if (command.display === current && (command.display === 'line' || cuesNeedingWordTiming(cues).length === 0)) {
      return { ok: true, project, selectedId: undefined, warnings: validateCaptions(cues, context).warnings }
    }
    if (command.display === 'line') captionDisplay = 'line'
    else {
      let serial = 0
      const newId = () => `${command.idPrefix ?? 'estimated'}-${++serial}`
      cues = cues.map((item) => {
        if (cuesNeedingWordTiming([item]).length === 0) return item
        try { return { ...item, words: estimateMissingWordTimings(item, newId), needsReview: true } }
        catch (error) { commandWarnings.push({ kind: 'estimate-skipped', cueIds: [item.id], message: error instanceof Error ? error.message : 'Cannot estimate word timing.' }); return item }
      })
      captionDisplay = 'word'
    }
  } else if (command.type === 'set-caption-display') {
    captionDisplay = command.display
  } else if (command.type === 'apply-template') {
    captionStyle = command.style
    let serial = 0
    const newId = () => `${command.idPrefix}-${++serial}`
    cues = cues.map((cue) => {
      let updated = cue
      const motion = cue.motionOverride?.motion ?? command.style.motion
      const needsWords = motion === 'active-word-highlight' || motion === 'word-pop' || motion === 'progressive-word-reveal'
      if (!needsWords || !cuesNeedingWordTiming([updated]).length) return updated
      try {
        updated = { ...updated, words: estimateMissingWordTimings(updated, newId), needsReview: true }
      } catch (error) {
        commandWarnings.push({ kind: 'estimate-skipped', cueIds: [cue.id], message: error instanceof Error ? error.message : 'Cannot estimate word timing.' })
      }
      return updated
    })
  } else if (command.type === 'set-motion-override') {
    const cue = cues.find((item) => item.id === command.cueId)
    if (!cue) return fail('The selected cue no longer exists.')
    cues = replaceCue(cues, cue.id, [{ ...cue, motionOverride: command.override }])
  } else if (command.type === 'reset-motion-overrides') {
    cues = cues.map((cue) => cue.motionOverride ? { ...cue, motionOverride: undefined } : cue)
  } else if (command.type === 'set-placement-override') {
    const cue = cues.find((item) => item.id === command.cueId)
    if (!cue) return fail('The selected cue no longer exists.')
    cues = replaceCue(cues, cue.id, [{ ...cue, placementOverride: command.override }])
  } else if (command.type === 'reset-placement-overrides') {
    cues = cues.map((cue) => cue.placementOverride ? { ...cue, placementOverride: undefined } : cue)
  } else if (command.type === 'line-break-before-word') {
    const cue = cues.find((item) => item.id === command.cueId)
    const located = cue && locateTarget(cue, command.target)
    const firstToken = cue && captionTokens(cue.text)[0]
    if (!cue || !located || !firstToken || firstToken.textStart === located.textStart) return fail('Choose a word after the first word to add a line break.')
    const at = located.textStart
    const before = cue.text.slice(0, at).replace(/[^\S\r\n]+$/u, '')
    const after = cue.text.slice(at).replace(/^[^\S\r\n]+/u, '')
    const text = `${before}\n${after}`
    const words = retainSafeWordTimings(cue.words, cue.text, text)
    cues = replaceCue(cues, cue.id, [{ ...cue, text, words, emphasized: retainEmphasis(cue.emphasized, cue.text, text), textSource: 'user', needsReview: cue.needsReview }])
  } else if (command.type === 'split-before-word') {
    const cue = cues.find((item) => item.id === command.cueId)
    const index = cue?.words.findIndex((word) => word.id === command.wordId) ?? -1
    const spans = cue && locateWordSpans(cue.text, cue.words)
    if (!cue || index <= 0 || !spans) return fail('Choose a word after the first word to split.')
    if (cues.some((item) => item.id === command.rightCueId)) return fail('Cue IDs must be unique.')
    const boundary = cue.words[index].startUs
    const at = spans[index].textStart
    const leftText = cue.text.slice(0, at).trimEnd(), rightText = cue.text.slice(at).trimStart()
    const left: Cue = { ...cue, endUs: boundary, text: leftText, words: retainSafeWordTimings(cue.words.slice(0, index), cue.text, leftText), emphasized: sliceEmphasis(cue.emphasized, 0, at), textSource: 'user', needsReview: true, timingSource: 'manual' }
    const right: Cue = { ...cue, id: command.rightCueId, startUs: boundary, text: rightText, words: retainSafeWordTimings(cue.words.slice(index), cue.text, rightText), emphasized: sliceEmphasis(cue.emphasized, at, cue.text.length), textSource: 'user', needsReview: true, timingSource: 'manual' }
    cues = replaceCue(cues, cue.id, [left, right]); selectedId = right.id
  } else if (command.type === 'move-from-word-to-next' || command.type === 'move-through-word-to-previous') {
    const sourceIndex = cues.findIndex((cue) => cue.id === command.cueId)
    const source = cues[sourceIndex]
    const forwards = command.type === 'move-from-word-to-next'
    const destinationIndex = source ? adjacentSameLanguage(cues, sourceIndex, forwards ? 1 : -1) : -1
    const destination = cues[destinationIndex]
    const wordIndex = source?.words.findIndex((word) => word.id === command.wordId) ?? -1
    const spans = source && locateWordSpans(source.text, source.words)
    if (!source || !destination || wordIndex < 0 || !spans) return fail('This word cannot move because there is no adjacent caption.')
    if (source.mediaAssetId !== destination.mediaAssetId) return fail('A word cannot move to a caption of a different video.')
    const splitIndex = command.type === 'move-from-word-to-next' ? wordIndex : wordIndex + 1
    if (splitIndex <= 0 || splitIndex >= source.words.length) return fail('Use Split to create a new caption at this boundary.')
    const at = spans[splitIndex].textStart
    const keepText = command.type === 'move-from-word-to-next' ? source.text.slice(0, at).trimEnd() : source.text.slice(at).trimStart()
    const movedText = command.type === 'move-from-word-to-next' ? source.text.slice(at).trimStart() : source.text.slice(0, at).trimEnd()
    const keptWords = command.type === 'move-from-word-to-next' ? source.words.slice(0, splitIndex) : source.words.slice(splitIndex)
    const movedWords = command.type === 'move-from-word-to-next' ? source.words.slice(splitIndex) : source.words.slice(0, splitIndex)
    const join = command.type === 'move-from-word-to-next' ? `${movedText} ${destination.text}`.trim() : `${destination.text} ${movedText}`.trim()
    const joinWords = command.type === 'move-from-word-to-next' ? [...movedWords, ...destination.words] : [...destination.words, ...movedWords]
    const forward = command.type === 'move-from-word-to-next'
    const keptRange: [number, number] = forward ? [0, at] : [at, source.text.length]
    const movedRange: [number, number] = forward ? [at, source.text.length] : [0, at]
    const sourceEmphasis = sliceEmphasis(source.emphasized, ...keptRange)
    const movedEmphasis = sliceEmphasis(source.emphasized, ...movedRange)
    const destinationEmphasis = destination.emphasized ?? []
    const combinedEmphasis = forward
      ? [...movedEmphasis, ...destinationEmphasis.map((mark) => ({ ...mark, textStart: mark.textStart + movedText.length + 1, textEnd: mark.textEnd + movedText.length + 1 }))]
      : [...destinationEmphasis, ...movedEmphasis.map((mark) => ({ ...mark, textStart: mark.textStart + destination.text.length + 1, textEnd: mark.textEnd + destination.text.length + 1 }))]
    // These lists are explicit ordered token moves, so assigning the new whole-token spans is
    // safer than matching stale offsets from their former captions (especially for repeated text).
    const rebaseWords = (words: readonly Cue['words'][number][], text: string) => {
      const tokens = captionTokens(text)
      return words.map((word, index) => ({ ...word, ...tokens[index] }))
    }
    const updatedSource: Cue = { ...source, text: keepText, words: rebaseWords(keptWords, keepText), emphasized: sourceEmphasis.length ? sourceEmphasis : undefined, endUs: keptWords.at(-1)!.endUs, textSource: 'user', needsReview: true }
    const updatedDestination: Cue = { ...destination, text: join, words: rebaseWords(joinWords, join), emphasized: combinedEmphasis.length ? combinedEmphasis : undefined, startUs: joinWords[0].startUs, endUs: joinWords.at(-1)!.endUs, textSource: 'user', needsReview: true }
    cues = cues.map((cue, index) => index === sourceIndex ? updatedSource : index === destinationIndex ? updatedDestination : cue).sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
    selectedId = updatedDestination.id
  }

  // A project with clips requires every cue to name its video. A cue created here (add) or by a
  // caller that did not say which video takes the explicit default, else the sequence's only video.
  const next = { ...project, cues, captionDisplay, timelineDisplay, captionStyle, ...(shownTranslation ? { shownTranslation } : {}) }
  if (!shownTranslation) delete next.shownTranslation
  const bound = bindUnboundItems(next, defaultBindingAssetId(next, context.defaultAssetId))
  const validation = validateCaptions(bound.cues, boundContext(bound, context))
  if (validation.errors.length) return { ok: false, ...validation }
  return { ok: true, project: bound, selectedId, warnings: [...commandWarnings, ...validation.warnings] }
}
