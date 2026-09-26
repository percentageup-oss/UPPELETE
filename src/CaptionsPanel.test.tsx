import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CaptionsPanel } from './CaptionsPanel'
import type { Cue } from './core/model'
import { DEFAULT_CAPTION_STYLE } from './captions/style'

const cue = (text: string, words: Cue['words'] = []): Cue => ({
  id: 'c1', text, startUs: 0, endUs: 2_000_000, words, timingSource: 'manual', textSource: 'user', needsReview: true,
})

const render = (cues: Cue[]) => renderToStaticMarkup(<CaptionsPanel
  cueCount={cues.length} totalCueCount={cues.length} languageTab={null} languages={{ originalLanguage: null, translations: [] }} shownTranslation={null}
  onLanguageTab={() => {}} onShowOnVideo={() => {}} onRebuildOriginal={null} visibleCues={cues} selectedCueId="c1" selectedWordId={null} warningCueIds={new Set()}
  notInSequence={() => false} videoNameOf={() => null} historyPastLength={0} historyFutureLength={0} onUndo={() => {}} onRedo={() => {}}
  effectiveStyle={DEFAULT_CAPTION_STYLE} selected={cues[0] ?? null} captionDisplay="line" onCaptionDisplay={() => {}} onProjectStyle={() => {}}
  onOverride={() => {}} onResetOverrides={() => {}} onPlacementOverride={() => {}} onEstimate={() => {}} onGroup={() => {}}
  onSelect={() => {}} onApplyEdits={() => true} onUpdateText={() => true} onSelectWord={() => {}} onWordAction={() => {}} onEstimateMissing={() => {}}
  cueButtonRefs={{ current: new Map() }} videos={[]} pickedVideo={null} onPickVideo={() => {}} mediaReady={false}
  onApplyTranscript={(() => {}) as never} providerKeys={null} transcriptionDefaults={{ provider: 'whisper', models: {} }} onNeedGeminiKey={() => {}} onImportSrt={() => {}} allCues={[]} onTranslated={() => {}} />)

const wordButtons = (html: string) => [...html.matchAll(/<button[^>]*class="transcript-word[^"]*"[^>]*>([^<]*)<\/button>/g)].map((match) => match[1])

it('makes every word clickable in a caption with no word timing (a newly added or edited cue)', () => {
  // Before the fix this rendered bare text: no word buttons, so no menu and no way to emphasize.
  expect(wordButtons(render([cue('hello brave world')]))).toEqual(['hello', 'brave', 'world'])
})

it('keeps Malayalam grapheme clusters whole in the clickable words of an untimed caption', () => {
  expect(wordButtons(render([cue('ഇൻകം ടാക്സ് English')]))).toEqual(['ഇൻകം', 'ടാക്സ്', 'English'])
})

it('makes timed and untimed words of a partially-timed caption clickable', () => {
  const words: Cue['words'] = [{ id: 'w1', text: 'brave', startUs: 0, endUs: 500_000, timingSource: 'model', needsReview: false, textStart: 6, textEnd: 11 }]
  expect(wordButtons(render([cue('hello brave world', words)]))).toEqual(['hello', 'brave', 'world'])
})

it('renders an empty caption without word buttons', () => {
  expect(wordButtons(render([cue('')]))).toEqual([])
})
