# 03: Gap list + "Transcribe this gap..." on the timeline

Part of [docs/plans/transcribe-range](README.md). Read the README's "Shared findings" and "Project rules"
first; do not read PRODUCT/ARCHITECTURE/ROADMAP in full. Needs briefs 01 and 02 (check `docs/STATUS.md`).

## Goal
Finding the missing part should not need typing times:
1. The Transcribe dialog lists **caption gaps** of the picked video (stretches of 5 s or more with no
   caption, including before the first and after the last caption) and the **uncovered stretches** the
   provider reported on earlier runs. Clicking one selects "Part of the video" with that range filled in.
2. Right-clicking an empty stretch of a captions lane offers **"Transcribe this gap..."**. It opens the
   Transcribe dialog on that video with the gap filled in.

For `img/full-video.cstudio` both would offer 0:00.0–0:22.5.

## Read only these files
- `src/core/transcriptionRange.ts` (from 02)
- `src/TranscriptionPanel.tsx` (the setup phase and the scope fieldset added in 02)
- `src/CaptionsPanel.tsx:1-100`
- `src/timeline/CaptionsTrack.tsx:75-85` (the lane's root `div`)
- `src/Timeline.tsx:195-200` (`TimelineMenuTarget`) and `:648-682` (`openContextMenu`)
- `src/App.tsx:283-300`, `:432-442`, `:2117-2125` and the `case 'empty'` block at the end of
  `contextEntries`, and the `<CaptionsPanel ... />` props (~`:2288-2315`)
- `src/core/model.ts`: the cloud run schema around `uncoveredRanges` (~`:150-170`)

## Steps

### 1. Gap helper (`src/core/transcriptionRange.ts`)
```ts
export const MIN_CAPTION_GAP_US = 5_000_000
/** Stretches of the video with no caption of that video, at least `minGapUs` long, in source time, sorted. */
export function captionGaps(cues: readonly Cue[], assetId: string, durationUs: number, minGapUs = MIN_CAPTION_GAP_US): SourceRange[]
/** The caption gap of `assetId` containing `sourceUs`, with no minimum length; null when a caption is there. */
export function captionGapAt(cues: readonly Cue[], assetId: string, durationUs: number, sourceUs: number): SourceRange | null
```
Cues of that video = `cue.mediaAssetId === assetId` (sort a copy by `startUs`; merge overlaps while
walking). Gaps run from `0` to the first cue, between cues, and from the last cue to `durationUs`.

### 2. Gap list in the dialog (`src/TranscriptionPanel.tsx`)
Under the "Part of the video" option, when the video has any gaps, render a compact list
(`<ul className="transcription-gaps">`, max 8 rows, then "and N more"):
- One row per `captionGaps(...)` entry: button text `0:00.0–0:22.5 · no captions`.
- Rows from `uncoveredRanges` of this video's cloud runs (`project.transcriptionRuns` where
  `'provider' in run && run.mediaAssetId === media.id`), **only if** the stretch still has no captions
  (skip it when `captionGaps` already lists an overlapping gap, so each stretch appears once). Text:
  `9:35.4–9:46.1 · Gemini returned no words`.
- Clicking a row sets `scope = 'part'` and fills both fields with `formatRangeTime`.
The panel needs `transcriptionRuns` (just the runs of the picked video is enough) and the picked video's
cues. It already gets `cues={[...pickedCues]}`; add a `runs` prop from `CaptionsPanel`/App.
CSS: reuse existing list/button styles; add at most a few lines in `src/styles.css` next to
`.transcription-hint`.

### 3. Open the dialog with a range from outside (`TranscriptionPanel`)
Add a prop `openRequest: { assetId: string; range: SourceRange; nonce: number } | null`. In a `useEffect`
on `nonce`: if the panel is in setup/error/cancelled (never interrupt `running` or `choose`), set
`scope = 'part'`, fill the fields, and `showModal()`. If it is busy, do nothing; App shows a notice
(step 4) instead.

### 4. Timeline menu entry
- `CaptionsTrack.tsx`: add `data-caption-track-id={track id}` on the lane's root `div` (`:79`; pass the id
  in as a prop if the component does not have it).
- `Timeline.tsx`: extend the empty target to `{ kind: 'empty'; trackId: string | null; atUs: number; captionLane?: boolean }`
  and set `captionLane` from `target.closest('[data-caption-track-id]')` in `openContextMenu`.
- `App.tsx` `case 'empty'`: when `target.captionLane`, compute
  `under = videoUnderPlayhead(target.atUs, project.tracks, project.clips)`, its asset id, the source time
  via `sourceUsAt`, and `captionGapAt(project.cues, assetId, asset.metadata.durationUs, sourceUs)`. If a gap
  is found, put a first entry `Transcribe this gap (0:00.0–0:22.5)...` plus a separator before the
  existing entries. No video under the click or no gap: omit the entry (the menu should not show a
  disabled transcription item on every right-click).
- On select: `setPickedVideoId(assetId)`, `setRailTab('captions')` (the panel only exists on that tab),
  then set App state `transcribeRequest = { assetId, range, nonce: Date.now() }` passed down to
  `TranscriptionPanel` as `openRequest`. If a transcription is already running (the panel ignores the
  request), show `setNotice({ tone: 'info', text: 'A transcription is already running; the gap was not opened.' })`.
  Simplest detection: have the panel call an `onOpenRequestIgnored` callback.

### 5. Typecheck
`npx tsc --noEmit -p .` must pass. New props optional where a test file constructs the component.

## Out of scope
Automatic retry of uncovered stretches, transcribing several gaps in one run, a Timeline-drawn range
selection tool, MCP tools.

## Done checklist
- [ ] `captionGaps` / `captionGapAt`
- [ ] Dialog gap list (caption gaps + still-empty provider uncovered stretches), click fills Part
- [ ] `openRequest` opens the dialog prefilled; never interrupts a running job or a pending choice
- [ ] Captions-lane right-click "Transcribe this gap (…)..." opens the Captions tab and the dialog on that video
- [ ] `npx tsc --noEmit -p .` passes
- [ ] `docs/STATUS.md` entry: the two shortcuts, "Not tested, typecheck only", and the next step suggestion:
      optional automatic retry of `uncoveredRanges` inside `CloudTranscriptionAdapter`
- [ ] Commit only the files changed here: `Transcribe caption gaps from the dialog and the timeline`
