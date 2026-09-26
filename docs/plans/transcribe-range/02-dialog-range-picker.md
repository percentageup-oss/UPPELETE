# 02: Always-visible Transcribe + range picker in the dialog

Part of [docs/plans/transcribe-range](README.md). Read the README's "Shared findings" and "Project rules"
first; do not read PRODUCT/ARCHITECTURE/ROADMAP in full. Needs brief 01 (check `docs/STATUS.md`).

## Goal
1. The Transcribe button is reachable whether or not the picked video already has captions.
2. The Transcribe dialog has a **What to transcribe** choice:
   - **Whole video** (default, today's behaviour)
   - **In–Out range**: shown only when an In/Out range is set and overlaps the picked video on the timeline
   - **Part of the video**: Start / End text fields in the video's own time, each with a "Playhead" button
3. A partial run sends `range`, sets `Delivered.partial = true`, and the dialog text says what happens to
   captions in and around the range.

## Read only these files
- `src/TranscriptionPanel.tsx` (whole file, ~320 lines)
- `src/CaptionsPanel.tsx:1-100` (props, `offerTranscription`, heading actions, empty state)
- `src/App.tsx:283-300` (rail tab, `pickedVideoId`), `:326-332` (`marks`, `activeRange`), `:432-442`
  (`under`, `pickedVideo`), `:2285-2315` (the `<CaptionsPanel ... />` props)
- `src/core/timelineModel.ts:20-60` and `:120-140` (`sourceUsAt`, `spansInSequence`), `:215-235` (`videoUnderPlayhead`)
- `src/core/time.ts`
- `src/core/transcriptionIpc.ts` (the `range` and `MIN_TRANSCRIPTION_RANGE_US` added in 01)

## Steps

### 1. Pure helpers: new `src/core/transcriptionRange.ts`
```ts
export type SourceRange = { startUs: number; endUs: number }
/** Source time of `assetId` shown at sequence time `sequenceUs`, or null when no clip of that video is there. */
export function sourceUsForAssetAt(sequenceUs: number, assetId: string, clips: readonly Clip[]): number | null
/** The source span of `assetId` that a sequence range covers: hull of every clip span of that video inside it. Null when none. */
export function sourceRangeForSequenceRange(range: SequenceRange, assetId: string, clips: readonly Clip[]): SourceRange | null
/** Null when valid, else a short user-facing reason (start ≥ end, beyond the video, shorter than MIN_TRANSCRIPTION_RANGE_US). */
export function transcriptionRangeProblem(range: SourceRange, durationUs: number): string | null
/** Lenient input: "22", "22.5", "0:22.5", "1:02:03.25" → integer µs; null when unparsable. */
export function parseRangeInput(text: string): number | null
/** Short display for range fields and labels: "0:22.5", "1:02:03.3". Tenths of a second. */
export function formatRangeTime(us: number): string
```
- `sourceUsForAssetAt`: first clip with `assetIdOf(clip) === assetId`, kind video or audio, whose sequence
  span contains `sequenceUs`; return `Math.round(sourceUsAt(clip, sequenceUs))`.
- `sourceRangeForSequenceRange`: for each clip of that video, intersect its sequence span with `range`,
  map both ends with `sourceUsAt`, take min start / max end. Comment: if the video appears twice or is
  cut, the hull may include source material that is not on the timeline; that only means a little extra
  audio is transcribed.
- Integer µs everywhere; round once at the end.

### 2. One stable mount (`src/CaptionsPanel.tsx`)
Mount `TranscriptionPanel` **once**, in `.caption-heading-actions` (before "Edit all"), always, with
`primary={offerTranscription}`. Remove it from the empty-state block; keep the empty-state "Import SRT"
button and add a one-line hint there ("Transcribe the video's audio or import an SRT."). One instance
matters: two instances would be two dialogs with separate running jobs.

### 3. Context the panel needs (`App.tsx` → `CaptionsPanel` → `TranscriptionPanel`)
Add one prop object, computed in App with `useMemo` from `pickedVideo`, `project.clips`, `currentUs`,
`activeRange`:
```ts
transcribeContext: {
  durationUs: number | null            // pickedVideo.metadata?.durationUs
  playheadSourceUs: number | null      // sourceUsForAssetAt(currentUs, pickedVideo.id, clips)
  inOutSourceRange: SourceRange | null // activeRange ? sourceRangeForSequenceRange(...) : null
}
```
Don't recompute on every playback frame if avoidable: rounding `currentUs` to 100 ms before the memo is fine.

### 4. The dialog (`src/TranscriptionPanel.tsx`)
State: `scope: 'whole' | 'inout' | 'part'` (default `'whole'`; reset to `'whole'` on `openDialog` from
setup/error/cancelled, but if an In/Out range exists default to `'inout'`), `partStart` / `partEnd` text.
- Put a `fieldset` "What to transcribe" **above** the Engine row in the setup phase, as radio buttons.
  - Whole video — "0:00–9:46" (from `durationUs`).
  - In–Out range — "0:10.0–0:40.0 of the video". Hide when `inOutSourceRange` is null.
  - Part of the video — two text inputs (`inputMode="decimal"`, placeholder `0:00.0`) plus a "Playhead"
    button next to each that writes `formatRangeTime(playheadSourceUs)`; the button is disabled with a
    `title` "The playhead is not over this video" when `playheadSourceUs` is null. When switching to
    Part with empty fields, prefill from the In–Out range if any.
  - Hint under the fieldset (`.transcription-hint`): "Times are positions in this video file. Captions
    inside the range are handled by your choice below; captions outside it, or crossing its edge, are
    never changed."
- Resolve the chosen range: `whole` → null; `inout` → `inOutSourceRange`; `part` → parsed fields. Show
  `transcriptionRangeProblem(...)` (or "Enter a start and end time") as a `role="alert"` line and
  **disable** the start button while there is a problem.
- `start()` sends `range` when non-null, stores the range in the `running` phase, and sets
  `partial: range !== null` on the delivered result.
- Start button label: for a range, "Transcribe 0:00.0–0:22.5" (keep the translate / provider wording
  otherwise, e.g. "Transcribe 0:00.0–0:22.5 with Gemini").
- Running label: append " (0:00.0–0:22.5)" when partial.
- Choose section (`:297-304`): for a partial result, heading "Existing captions in this range", and the
  count sentence says "in 0:00.0–0:22.5". Buttons unchanged.

### 5. Typecheck
`npx tsc --noEmit -p .` must pass. Fix `src/CaptionsPanel.test.tsx` minimally only if the new prop breaks
its typecheck (make `transcribeContext` optional with a null-filled default rather than editing tests).

## Out of scope
The gap list and timeline context menu (03). Auto-selecting ranges. Saving the chosen scope between sessions.

## Done checklist
- [ ] `src/core/transcriptionRange.ts` with the five helpers
- [ ] One `TranscriptionPanel` instance, always in the Captions heading
- [ ] Dialog scope choice with In–Out and Part (with Playhead buttons), validation, disabled start on problems
- [ ] Partial runs send `range` and deliver `partial: true`; labels show the range
- [ ] `npx tsc --noEmit -p .` passes
- [ ] `docs/STATUS.md` entry: what the dialog offers, "Not tested, typecheck only", limitation: ranges are
      in the video's own time; a running job is lost if the Captions tab is closed (pre-existing)
- [ ] Commit only the files changed here: `Transcribe dialog: always available; transcribe a range of the video`
