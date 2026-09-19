import { expect, it } from 'vitest'
import { captionTokens, graphemeBoundaries } from './captionText'
import { emphasisRuns } from './emphasis'
import { cueSchema, createProject, loadProject } from './model'
import { applyCaptionCommand, type CaptionCommand } from './captionCommands'
import { commitHistory, createHistory, redoHistory, undoHistory } from './history'
import { serializeSrt } from './srt'
import { frameRequestAt } from '../export/plan'
import { CAPTION_TEMPLATES } from '../captions/templates'

const text = 'മലയാളം quick brown quick'
const tokens = captionTokens(text)
const cue = cueSchema.parse({ id: 'c', text, startUs: 0, endUs: 4_000_000 })
const original = { ...createProject(), cues: [cue] }
function apply(project = original, command: CaptionCommand) {
  const result = applyCaptionCommand(project, command)
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.project
}
const mark = (start: number): CaptionCommand => ({ type: 'toggle-emphasis', cueId: 'c', textStart: start })

it('selects a particular repeated word without changing SRT text, timing or word provenance; undo/redo/reopen preserves it', () => {
  const marked = apply(original, mark(tokens[3].textStart))
  expect(marked.cues[0].emphasized).toEqual([tokens[3]])
  expect(marked.cues[0].words).toEqual([])
  expect(serializeSrt(marked.cues)).toBe(serializeSrt(original.cues))
  expect(loadProject(JSON.parse(JSON.stringify(marked))).project).toEqual(marked)
  const history = commitHistory(createHistory(original), marked)
  expect(undoHistory(history).present).toEqual(original)
  expect(redoHistory(undoHistory(history)).present).toEqual(marked)
  expect(apply(marked, mark(tokens[3].textStart)).cues[0].emphasized).toEqual([])
})

it('rejects partial Malayalam graphemes and duplicate or stale emphasis spans', () => {
  for (const emphasized of [[{ text: text.slice(0, 1), textStart: 0, textEnd: 1 }], [tokens[0], tokens[0]], [{ ...tokens[0], text: 'wrong' }]]) {
    expect(cueSchema.safeParse({ ...cue, emphasized }).success).toBe(false)
  }
  expect(applyCaptionCommand(original, mark(1)).ok).toBe(false)
  for (const run of emphasisRuns(text, [tokens[0]])) {
    expect(graphemeBoundaries(text).has(run.textStart)).toBe(true)
    expect(graphemeBoundaries(text).has(run.textEnd)).toBe(true)
  }
  expect(emphasisRuns(text, [tokens[0]]).map((run) => run.text).join('')).toBe(text)
})

it('retains unambiguous emphasis through edits but never moves an ambiguous repeated selection', () => {
  let marked = apply(apply(original, mark(tokens[2].textStart)), mark(tokens[3].textStart))
  marked = apply(marked, { type: 'update-text', cueId: 'c', text: `hello ${text}` })
  expect(marked.cues[0].emphasized?.map((span) => span.text)).toEqual(['brown'])
  expect(marked.cues[0].text.slice(marked.cues[0].emphasized![0].textStart, marked.cues[0].emphasized![0].textEnd)).toBe('brown')
})

it('preserves exact selected occurrences through split and merge', () => {
  const marked = apply(original, mark(tokens[3].textStart))
  const split = apply(marked, { type: 'split', cueId: 'c', rightCueId: 'r', atUs: 2_000_000 })
  expect(split.cues.flatMap((c) => c.emphasized ?? []).map((span) => span.text)).toEqual(['quick'])
  expect(split.cues[0].emphasized).toEqual([])
  const merged = apply(split, { type: 'merge-next', cueId: 'c' })
  expect(merged.cues[0].emphasized).toEqual(marked.cues[0].emphasized)
})

it('estimates only after an explicit command, preserves cue bounds and selections, and retains them through regrouping', () => {
  const marked = apply(original, mark(tokens[3].textStart))
  const estimated = apply(marked, { type: 'estimate-words', cueId: 'c', idPrefix: 'estimate' })
  expect(estimated.cues[0]).toMatchObject({ text, startUs: cue.startUs, endUs: cue.endUs, emphasized: [tokens[3]] })
  expect(estimated.cues[0].words.every((word) => word.timingSource === 'estimated' && word.needsReview)).toBe(true)
  const grouped = apply(estimated, { type: 'regroup', cueId: 'c', idPrefix: 'group', estimateMissing: false,
    options: { maxWords: 2, maxGraphemes: 42, maxDurationUs: 6_000_000, pauseUs: 800_000 } })
  expect(grouped.cues[1].emphasized).toEqual([{ text: 'quick', textStart: 6, textEnd: 11 }])
})

it('passes selected word styles through the actual export frame contract', () => {
  const marked = apply(original, mark(tokens[0].textStart))
  const { request } = frameRequestAt({ version: 1, cues: marked.cues, style: CAPTION_TEMPLATES[1].style }, {
    width: 1080, height: 1920, frameRate: { numerator: 30, denominator: 1 }, range: { startUs: 0, endUs: 4_000_000 },
  }, 15)
  expect(request.cue.emphasized).toEqual([tokens[0]])
  expect(request.style.appearance.emphasisFontFamily).toBe('Impact')
})
