import type { CaptionProject, Cue } from '../core/model'
import { displayedCues } from '../core/captionLanguages'
import { compositionFor } from '../core/composition'
import { captionClips, cuesInSequence } from '../core/timelineModel'
import { DEFAULT_CAPTION_STYLE, MOTIONS, resolveCaptionStyle, captionStyleInputs, type CaptionMotion } from '../captions/style'
import { layoutCaption, wordMotionAvailability, type MeasureText, type MotionCue } from '../captions/renderer'
import { wordDisplayCue } from '../captions/wordDisplay'
import { usToTimelineFrame } from './frames'
import { stableStringify, fnv1a32Hex } from './specHash'
import { computeMotion, type Keyframe } from './textPlusMotion'
import {
  TEXT_PLUS_INPUTS, textPlusSize, centerFor, textPlusFontFamily, colorToRgba01, horizontalJustificationFor, styleNameFor, applyTextTransform,
  textPlusCharacterSpacing, textPlusOutlineThickness, textPlusLineSpacing,
} from './textPlusInputs'
import { emphasisStyleRanges, activeWordRange, mergeActiveWordRange, type TextPlusStyleRange } from './textPlusStyleRanges'
import { TEXT_PLUS_CHAR_UNIT } from './charUnits'

export type { TextPlusStyleRange } from './textPlusStyleRanges'

/** Injected measurer for `layoutCaption`'s line-break pass; the renderer passes `createDomMeasurer().measure`
 * (`src/captions/CaptionPreview.tsx`). No DOM/Electron import lives in this module or its dependencies below. */
export type Measure = MeasureText

export type TextPlusClipSpec = {
  key: string // cue id, or `${cueId}#w${index}` in word-at-a-time display mode
  cueId: string
  startFrame: number // absolute Resolve record frame (inclusive)
  endFrame: number // exclusive
  text: string // with '\n' at KathaCut's line breaks; emphasized-word substrings may carry their own text transform
  inputs: Record<string, number | string | { x: number; y: number }>
  keyframes: Keyframe[] // clip-relative frames
  styleRanges: TextPlusStyleRange[] // emphasized words' Character Level Styling ranges (ADR 0011); empty if none
  hash: string
}

export type SupportLevel = 'sent' | 'approximated' | 'not-sent'
export type TextPlusPlan = {
  specs: TextPlusClipSpec[]
  support: { feature: string; level: SupportLevel; note?: string }[]
  skipped: { cueId: string; reason: string }[]
}

type Draft = {
  key: string; cueId: string; motionCue: MotionCue
  /** True only for a genuine word-at-a-time draft: the whole clip's text already *is* the single active word, so
   * `active-word-highlight`/`word-pop` need no Character Level Styling (`textPlusMotion.ts`'s `computeMotion`). */
  isWordDraft: boolean
  /** Set only for a full-line active-word split draft (brief 18, `activeWordDrafts` below): which word in
   * `motionCue.words` is active during this draft's window. `motionCue` still carries every word and the full
   * cue text — only `startUs`/`endUs` narrow — so the spec loop locates and styles just this one word. */
  activeWordIndex?: number
}

/** One cue's effective style, resolved exactly as the preview resolves it (`App.tsx`'s `CaptionStage`). */
function resolvedAppearanceOf(project: CaptionProject, cue: Cue) {
  const style = resolveCaptionStyle(project.captionStyle ?? DEFAULT_CAPTION_STYLE, cue)
  return { style, appearance: style.appearance }
}

/**
 * Full-line active-word split (brief 18): one Text+ clip per word step, back to back, instead of a single
 * keyframed clip (ADR 0011 "Keyframing": no data). Windows partition `[cue.startUs, cue.endUs)` exactly like
 * `wordDisplay.ts`'s `activeWordIndex` (hold through gaps): a lead-in draft with no active word when the cue
 * starts before its first word, then one draft per word from that word's start to the next word's start (or the
 * cue's end for the last word). Every draft keeps the cue's full text, words and emphasis — only
 * `startUs`/`endUs` narrow — so Text+'s layout never shifts between steps. Only called once
 * `wordMotionAvailability(cue).enabled` is confirmed by the caller (no invented timing, AGENTS.md).
 */
function activeWordDrafts(cue: Cue): Draft[] {
  const words = cue.words
  const drafts: Draft[] = []
  if (words[0].startUs > cue.startUs) {
    drafts.push({ key: `${cue.id}#a0`, cueId: cue.id, motionCue: { ...cue, endUs: words[0].startUs }, isWordDraft: false })
  }
  words.forEach((word, index) => {
    const endUs = index + 1 < words.length ? words[index + 1].startUs : cue.endUs
    drafts.push({
      key: `${cue.id}#a${index + 1}`, cueId: cue.id, motionCue: { ...cue, startUs: word.startUs, endUs }, isWordDraft: false, activeWordIndex: index,
    })
  })
  return drafts
}

/** Splits a line cue into one draft per shown word when the project displays captions word-at-a-time and this
 * cue's word timing can drive it; into one active-word draft per word step (above) when it displays full lines
 * but the motion needs the active word (`active-word-highlight`/`word-pop`) and word timing can drive it;
 * otherwise (line mode, a different motion, or incomplete/invalid word timing) one draft for the whole cue.
 * Returns whether this cue fell back from a requested word split, for the support report. */
function draftsForCue(cue: Cue, wordDisplay: boolean, motion: CaptionMotion): { drafts: Draft[]; fellBackFromWordSplit: boolean; usedEstimatedWordSplit: boolean } {
  if (wordDisplay) {
    const availability = wordMotionAvailability(cue)
    if (availability.enabled) {
      return {
        drafts: cue.words.map((_, index) => ({ key: `${cue.id}#w${index}`, cueId: cue.id, motionCue: wordDisplayCue(cue, index), isWordDraft: true })),
        fellBackFromWordSplit: false, usedEstimatedWordSplit: availability.estimated,
      }
    }
    return { drafts: [{ key: cue.id, cueId: cue.id, motionCue: cue, isWordDraft: false }], fellBackFromWordSplit: true, usedEstimatedWordSplit: false }
  }
  if ((motion === 'active-word-highlight' || motion === 'word-pop') && wordMotionAvailability(cue).enabled) {
    return { drafts: activeWordDrafts(cue), fellBackFromWordSplit: false, usedEstimatedWordSplit: false }
  }
  return { drafts: [{ key: cue.id, cueId: cue.id, motionCue: cue, isWordDraft: false }], fellBackFromWordSplit: false, usedEstimatedWordSplit: false }
}

/**
 * Turns a linked project's captions into Text+ clip specs the Lua bridge (06) can apply verbatim, plus an honest
 * per-feature support report (sent / approximated / not-sent — see docs/plans/resolve-textplus/05-textplus-planner.md
 * and the ADR's own caveats, several of which are unconfirmed by the spike and noted below). Pure: no IPC, no Lua,
 * no Resolve calls — 06 is the only caller that talks to the bridge.
 */
export function planTextPlus(project: CaptionProject, measure: Measure): TextPlusPlan {
  const link = project.resolveLink
  if (!link) return { specs: [], support: [], skipped: [] }

  const composition = compositionFor(link.width / link.height)
  const wordDisplay = project.captionDisplay === 'word'

  // Captions are placed by sequence time (the KathaCut timeline), not by time on one proxy asset, so the same
  // mapping works whether the link is a proxy render, an imported edit or a pushed timeline (10). A cue spanning
  // a non-contiguous cut becomes one cue per contiguous run, with render id `${cue.id}:${n}` for the 2nd and later.
  const originalCues = displayedCues(project.cues, project.shownTranslation)
  const originalCueById = new Map(originalCues.map((cue) => [cue.id, cue]))
  const baseCueId = (id: string) => { const at = id.indexOf(':'); return at === -1 ? id : id.slice(0, at) }
  const cues = cuesInSequence(originalCues, captionClips(project.tracks, project.clips))

  const skipped: TextPlusPlan['skipped'] = []
  const drafts: Draft[] = []
  const resolvedByCueId = new Map<string, ReturnType<typeof resolvedAppearanceOf>>()
  let anyWordFallback = false, anyEstimatedWordSplit = false
  let anyGradient = false, anyGlow = false, anyDepth = false, anyRotation = false
  let anyEmphasis = false, anyUnderline = false, anyTextTransform = false, anyEmphasisFontFamily = false, anySpotlight = false

  for (const cue of cues) {
    if (!cue.text.trim()) { skipped.push({ cueId: cue.id, reason: 'empty text' }); continue }
    const original = originalCueById.get(baseCueId(cue.id)) ?? cue
    const resolved = resolvedAppearanceOf(project, original)
    resolvedByCueId.set(cue.id, resolved)
    const { appearance } = resolved
    if (appearance.gradientEnabled || appearance.emphasisGradientEnabled) anyGradient = true
    if (appearance.glowEnabled || appearance.emphasisGlowEnabled) anyGlow = true
    if (appearance.depthEnabled) anyDepth = true
    if (appearance.rotation !== 0) anyRotation = true
    if (cue.emphasized?.length) {
      anyEmphasis = true
      if (appearance.emphasisFontFamily && appearance.emphasisFontFamily !== appearance.fontFamily) anyEmphasisFontFamily = true
      if (appearance.emphasisMode === 'spotlight') anySpotlight = true
    }
    if (appearance.underline) anyUnderline = true
    if (appearance.textTransform !== 'none') anyTextTransform = true
    const { drafts: cueDrafts, fellBackFromWordSplit, usedEstimatedWordSplit } = draftsForCue(cue, wordDisplay, resolved.style.motion)
    if (fellBackFromWordSplit) anyWordFallback = true
    if (usedEstimatedWordSplit) anyEstimatedWordSplit = true
    drafts.push(...cueDrafts)
  }

  // Worst level wins per motion kind (not-sent > approximated > sent); reasons accumulate across every cue/draft
  // that used the kind, so the report covers every path a cue actually took (e.g. some cues gated on missing word
  // timing, others on the unconfirmed CLS format).
  const LEVEL_RANK: Record<SupportLevel, number> = { 'not-sent': 0, approximated: 1, sent: 2 }
  const motionAgg = new Map<CaptionMotion, { level: SupportLevel; reasons: Set<string> }>()
  let anyMotionEstimatedTiming = false
  const noteMotion = (kind: CaptionMotion, level: SupportLevel, reason: string) => {
    const existing = motionAgg.get(kind)
    if (!existing) { motionAgg.set(kind, { level, reasons: new Set([reason]) }); return }
    existing.reasons.add(reason)
    if (LEVEL_RANK[level] < LEVEL_RANK[existing.level]) existing.level = level
  }

  const specs: TextPlusClipSpec[] = []
  const malayalamFontFallbacks = new Set<string>()
  for (let index = 0; index < drafts.length; index++) {
    const draft = drafts[index]
    const next = drafts[index + 1]
    const startFrame = usToTimelineFrame(draft.motionCue.startUs, link)
    const rawEndFrame = usToTimelineFrame(draft.motionCue.endUs, link)
    const nextStartFrame = next ? usToTimelineFrame(next.motionCue.startUs, link) : null
    let endFrame = nextStartFrame !== null ? Math.min(rawEndFrame, nextStartFrame) : rawEndFrame
    if (endFrame <= startFrame) {
      if (nextStartFrame !== null && nextStartFrame > startFrame) endFrame = startFrame + 1
      else { skipped.push({ cueId: draft.cueId, reason: 'shorter than one frame' }); continue }
    }

    const { style: cueStyle, appearance: a } = resolvedByCueId.get(draft.cueId)!

    const transformedText = applyTextTransform(draft.motionCue.text, a.textTransform)
    const layoutInputsBase = captionStyleInputs(cueStyle, composition)
    // `emphasized`'s offsets are into `draft.motionCue.text`; only reuse them for line-wrap measurement (so Text+'s
    // wraps match the preview's, ADR 0011/05) when the whole-text transform didn't change the string's length —
    // otherwise they'd point at the wrong characters. `emphasisStyleRanges` below locates words by content, not by
    // these offsets, so it always runs regardless.
    const layoutEmphasized = transformedText.length === draft.motionCue.text.length ? draft.motionCue.emphasized : undefined
    const layoutInputs = { ...layoutInputsBase, font: { ...layoutInputsBase.font, readiness: 'ready' as const }, emphasized: layoutEmphasized }
    const layout = layoutCaption(transformedText, layoutInputs, measure)
    const wrappedText = layout.lines.length ? layout.lines.map((line) => line.text).join('\n') : transformedText
    const { text, ranges: emphasisRanges } = emphasisStyleRanges(wrappedText, draft.motionCue.emphasized, a, TEXT_PLUS_CHAR_UNIT)

    const fill = colorToRgba01(a.primaryColor)
    const outline = colorToRgba01(a.outlineColor)
    const secondaryFill = colorToRgba01(a.secondaryColor)
    // From the same layout the preview draws: the fitted font size and the positioned block, not the raw style
    // fields (`a.fontSize` is in 1080-wide units and `a.vertical` is a fraction of the safe area's free space).
    const size = textPlusSize(layout.font.size * layout.fitScale, composition.width)

    // Full-line active-word split (brief 18): colour the one word active during this draft's window via
    // Character Level Styling, merged with this cue's own emphasis ranges (17) — `mergeActiveWordRange` makes
    // the active word win where a spotlight dim range would otherwise cover it.
    let styleRanges = emphasisRanges
    if (draft.activeWordIndex !== undefined && draft.motionCue.words) {
      const active = activeWordRange(
        text, draft.motionCue.words, draft.activeWordIndex,
        (word) => applyTextTransform(word, a.textTransform),
        { r: secondaryFill.r, g: secondaryFill.g, b: secondaryFill.b },
        cueStyle.motion === 'word-pop' ? a.emphasisScale : undefined,
        TEXT_PLUS_CHAR_UNIT,
      )
      if (active) styleRanges = mergeActiveWordRange(emphasisRanges, active)
    }
    const { family: fontFamily, substituted: fontSubstituted } = textPlusFontFamily(a.fontFamily, text)
    if (fontSubstituted) malayalamFontFallbacks.add(a.fontFamily)
    const inputs: TextPlusClipSpec['inputs'] = {
      [TEXT_PLUS_INPUTS.text]: text,
      [TEXT_PLUS_INPUTS.font]: fontFamily,
      [TEXT_PLUS_INPUTS.style]: styleNameFor(a.fontWeight, a.fontItalic),
      [TEXT_PLUS_INPUTS.size]: size,
      [TEXT_PLUS_INPUTS.fillEnabled]: 1,
      [TEXT_PLUS_INPUTS.fillRed]: fill.r, [TEXT_PLUS_INPUTS.fillGreen]: fill.g, [TEXT_PLUS_INPUTS.fillBlue]: fill.b, [TEXT_PLUS_INPUTS.fillAlpha]: fill.a,
      [TEXT_PLUS_INPUTS.outlineEnabled]: a.strokeEnabled ? 1 : 0,
      [TEXT_PLUS_INPUTS.outlineRed]: outline.r, [TEXT_PLUS_INPUTS.outlineGreen]: outline.g, [TEXT_PLUS_INPUTS.outlineBlue]: outline.b,
      [TEXT_PLUS_INPUTS.outlineThickness]: textPlusOutlineThickness(a.outlineWidth, a.fontSize),
      [TEXT_PLUS_INPUTS.shadowEnabled]: a.shadowEnabled ? 1 : 0,
      [TEXT_PLUS_INPUTS.backgroundEnabled]: a.backgroundEnabled ? 1 : 0,
      [TEXT_PLUS_INPUTS.center]: centerFor(layout.bounds, composition),
      [TEXT_PLUS_INPUTS.lineSpacing]: textPlusLineSpacing(a.lineHeight),
      [TEXT_PLUS_INPUTS.characterSpacing]: textPlusCharacterSpacing(a.letterSpacing, a.fontSize),
      [TEXT_PLUS_INPUTS.horizontalJustification]: horizontalJustificationFor(a.alignment),
      // Plain baseline (no animation) so a clip re-synced from an earlier motion never keeps a stale write-on
      // keyframe: `applySpec` (bridge.lua) sets these before attaching any of this spec's own keyframes.
      [TEXT_PLUS_INPUTS.writeOnStart]: 0, [TEXT_PLUS_INPUTS.writeOnEnd]: 1,
    }

    const motion = computeMotion({
      motion: cueStyle.motion, motionSpeed: cueStyle.motionSpeed, cue: draft.motionCue, isWordDraft: draft.isWordDraft,
      text, transform: a.textTransform, startFrame, endFrame, link, fillAlpha: fill.a,
      secondaryFill: { r: secondaryFill.r, g: secondaryFill.g, b: secondaryFill.b }, emphasisScale: a.emphasisScale, baseSize: size,
    })
    Object.assign(inputs, motion.inputOverrides)
    if (motion.outcome) {
      noteMotion(cueStyle.motion, motion.outcome.level, motion.outcome.reason)
      if (motion.outcome.estimated) anyMotionEstimatedTiming = true
    }

    const draftSpec: Omit<TextPlusClipSpec, 'hash'> = { key: draft.key, cueId: draft.cueId, startFrame, endFrame, text, inputs, keyframes: motion.keyframes, styleRanges }
    specs.push({ ...draftSpec, hash: fnv1a32Hex(stableStringify(draftSpec)) })
  }

  const support: TextPlusPlan['support'] = []
  const push = (feature: string, level: SupportLevel, note?: string) => support.push(note ? { feature, level, note } : { feature, level })
  if (specs.length) {
    push('Text', 'sent', 'StyledText round-tripped a mixed Malayalam/English string unchanged (T9); the user visually confirmed correct conjunct/vowel-sign shaping.')
    push('Font family', 'approximated', 'Font accepts any string with no existence validation (ADR 0008); an unavailable font silently falls back, with no error from the API.')
    push('Font weight / italic (Style)', 'approximated', 'Mapped to a guessed Style name (Regular/Italic/Bold/Bold Italic); Style is free text with no validation and may not match the font\'s real named styles (ADR 0008).')
    push('Font size', 'approximated', 'Size = em size ÷ (frame width × 9/16), Fusion\'s width-relative scale, measured on one 16:9 still (ADR 0009); fonts with different metrics and non-16:9 timelines are not measured.')
    push('Primary color (fill)', 'sent', 'Uses the same Red1/Green1/Blue1/Alpha1 mechanism T9 confirmed working for the outline color.')
    push('Outline enable + color', 'sent', 'Enabled2/Red2/Green2/Blue2 confirmed set-and-read-back correctly by T9.')
    push('Outline thickness', 'approximated', 'Thickness2 is assumed by analogy with Thickness1 and scaled as outline px ÷ font px; neither is confirmed (ADR 0008).')
    push('Shadow', 'approximated', 'Only Enabled3 (on/off) is confirmed; shadow color/blur/offset have no confirmed input IDs, so KathaCut\'s shadow styling is not sent — Resolve\'s own default shadow renders when enabled.')
    push('Background box', 'approximated', 'Only Enabled4 (on/off) is confirmed; box color/opacity have no confirmed input IDs and are not sent.')
    push('Position', 'sent', 'Center\'s y axis points up, confirmed on a rendered still (ADR 0009).')
    push('Line spacing / letter spacing', 'approximated', 'LineSpacing/CharacterSpacing input IDs are confirmed present; CharacterSpacing is sent as 1 + letter-spacing px ÷ font px (1 = normal), a guessed scale. LineSpacing is sent as KathaCut\'s line height ÷ Anek Malayalam\'s natural 1.4325 em line height, so other fonts are approximate (ADR 0008).')
    push('Alignment', 'approximated', 'HorizontalJustificationNew\'s mapping is unconfirmed: values 0/1/2 render a single line identically (ADR 0009); multi-line alignment uses a guessed 0/1/2 = left/center/right.')
    push('Line breaks', 'approximated', 'Lines are joined with \'\\n\' to match KathaCut\'s own wrapping, but no confirmed Resolve input sets Text+\'s own layout/wrap width, so Text+ could still re-wrap inside its own text box.')
  }
  if (malayalamFontFallbacks.size) push('Malayalam in a non-Malayalam font', 'approximated', `${[...malayalamFontFallbacks].join(', ')} has no Malayalam; the preview draws Malayalam in Anek Malayalam from its fallback stack, and Text+ has no per-character fallback, so those clips are sent entirely in Anek Malayalam (English words included).`)
  if (anyTextTransform) push('Text transform (uppercase/lowercase/capitalize)', 'sent', 'Applied to the text itself before sending, grapheme-safe; Text+ has no text-transform of its own.')
  if (anyGradient) push('Gradient fill', 'not-sent', 'No confirmed Text+ gradient-fill input; the solid primary/outline color is sent instead.')
  if (anyGlow) push('Glow', 'not-sent', 'No Text+ equivalent identified.')
  if (anyDepth) push('3D depth', 'not-sent', 'No Text+ equivalent identified.')
  if (anyUnderline) push('Underline', 'not-sent', 'No confirmed Text+ input for underline.')
  if (anyRotation) push('Rotation', 'not-sent', 'No single confirmed Angle input exists yet (ADR 0008); the candidates (LayoutRotation/TransformRotation/AngleX,Y,Z) are untested.')
  if (anyEmphasis) {
    push('Emphasis colour', 'sent', 'Character Level Styling ids 2401/2402/2403 (fill R/G/B) are confirmed from a hand-styled clip (ADR 0011); emphasized words are located on grapheme boundaries only — a word that can\'t be found verbatim is left unstyled, not split.')
    push('Emphasis size', 'sent', 'CLS id 102 is confirmed absolute, not a multiplier (ADR 0011); sent as the base Size input × emphasisScale.')
    push('Emphasis weight / italic / underline', 'sent', 'CLS ids 109 (style name, String) and 105 (underline) are confirmed from the same hand-styled clip (ADR 0011).')
    push('Emphasis text transform', 'approximated', 'Applied to the emphasized word\'s own substring in the sent text only when it keeps the exact UTF-16 length; ADR 0011 has no per-range text-transform id, and a length-changing transform (e.g. German ß -> SS) is skipped for that one word.')
    if (anySpotlight) push('Emphasis spotlight dim', 'approximated', 'Uses fill-alpha id 2404, which ADR 0011 only guesses at by sequence — no hand-styled evidence covered it.')
  }
  if (anyEmphasisFontFamily) push('Emphasis font family', 'not-sent', 'ADR 0011\'s property table has no confirmed id for a per-range font family (only 109, a style *name* string), so a distinct emphasis font never reaches Resolve; the base Font input is sent for the whole clip instead.')
  for (const motion of MOTIONS) {
    const agg = motionAgg.get(motion.id)
    if (agg) push(motion.label, agg.level, [...agg.reasons].join(' '))
  }
  if (anyMotionEstimatedTiming) push('Motion word timing', 'approximated', 'Some caption-motion keyframes are built from estimated word timing, not aligned to audio.')
  if (anyWordFallback) push('Word-at-a-time display', 'approximated', 'One or more cues fell back to whole-cue display because word timing was missing or invalid.')
  if (anyEstimatedWordSplit) push('Word-at-a-time timing', 'approximated', 'Some per-word Text+ clip timings come from estimated word timing, not aligned audio — not exact sync.')

  return { specs, support, skipped }
}
