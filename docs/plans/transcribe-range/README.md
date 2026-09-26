# Transcribe part of a video: session briefs

Each brief is one **fresh session**'s work. Open a new session and say:

> Implement docs/plans/transcribe-range/0N-<name>.md

The session reads that brief and only the files it lists, implements it, runs the typecheck, appends a
short entry to `docs/STATUS.md`, commits, and stops. Briefs never rely on earlier conversation. Anything a
later brief needs from an earlier one is recorded in `docs/STATUS.md` or in the code.

## Why
`img/full-video.cstudio` (9:46 video, Gemini run, 4 speech chunks) has no captions for 0:00-0:22.5. The
audio there is normal speech (-18 to -28 dB RMS every second), and the run record already flags it:
`transcriptionRuns[0].uncoveredRanges = [{0, 22.5 s}, {575.43 s, 586.07 s}]`. Gemini returned no words for
the start of chunk 1. Its timestamps are not shifted: the only quiet second (38 s, -38 dB) matches a pause
Gemini reported at 38.1-39.1 s.

There is no way to fix that in the app today:
- Every request transcribes the whole file. `electron/transcriptionIpc.ts:43` hard-codes
  `sourceRange = { startUs: 0, endUs: durationUs }`, and the request schema has no range field.
- Once a video has captions, the Transcribe button disappears. `offerTranscription`
  (`src/CaptionsPanel.tsx:79`) is true only when the picked video has no captions, and there is no other
  entry point (no menu command, no shortcut).

## Goal
After these briefs a user can transcribe **just a part** of a video and slot the result in between the
existing captions, without touching captions outside that part:
- The Transcribe button is always reachable in the Captions panel.
- The Transcribe dialog has a "What to transcribe" choice: whole video, the In/Out range, or a custom
  start/end (with "use playhead" buttons).
- Captions that straddle the edge of the range are never removed or cut.
- The dialog lists caption gaps (and the provider's uncovered stretches) as one-click ranges, and a
  right-click on an empty stretch of the captions lane offers "Transcribe this gap...".

## Order

| # | Brief | Depends on | Size |
|---|-------|-----------|------|
| 01 | [Range in the request, boundary-safe apply](01-range-request-and-apply.md) | none | S-M |
| 02 | [Always-visible Transcribe + range picker in the dialog](02-dialog-range-picker.md) | 01 | M |
| 03 | [Gap list + "Transcribe this gap..." on the timeline](03-gap-shortcuts.md) | 01, 02 | S-M |

Run them in numeric order.

## Testing override
The user asked (2026-09-25) that session briefs **not** write or run tests, export parity stages, smoke
runs or benchmarks. This **overrides the AGENTS.md testing rule for this plan**. The only check is
`npx tsc --noEmit -p .`. Do not delete existing tests; fix one minimally only when a typecheck breaks.
STATUS entries say "not tested, typecheck only".

One higher-risk item, for the user to opt back in if wanted: brief 01 changes which captions
`applyTranscription` removes. A unit test for "a cue straddling the range edge is kept" would be cheap and
worth it (`src/core/transcriptionApply.test.ts` already exists).

## Shared findings (verified against the code, 2026-09-26)
- **The backend already works on any range.** `TranscriptionService.run` / `runCloud`
  (`electron/transcriptionService.ts:~153`, `:~238`) extract audio for `request.sourceRange` via the worker
  (`workers/media/audio.ts:25` seeks with `-ss range.startUs`, returns `sourceStartUs = range.startUs`), and
  `runTranscription` maps every timestamp to source time (`src/core/transcription.ts:~290`,
  `sourceRange` on the transcript at `:~317`). The run record stores `sourceRange` (`:193`, `:280`), and
  cloud `uncoveredRanges` are already in source time (`:290`).
- **The only full-video hard-codes:** `electron/transcriptionIpc.ts:43` (the live path) and `:92` (developer
  smoke, leave alone).
- Request schema: `transcriptionStartRequestSchema`, `src/core/transcriptionIpc.ts:21-41` (a discriminated
  union: whisper / cloud). The renderer sends IDs and choices only, never paths.
- Apply: `applyTranscription` (`src/core/transcriptionApply.ts:63-88`). It already only touches captions
  overlapping `transcript.sourceRange` and only of the same video (`sameVideo`, `:46`). **Problem for
  partial ranges:** a cue that *overlaps* the range but extends past its edge is removed under
  `replace-all` (and under `keep-authored` if unedited), yet the new transcript only covers the in-range
  part, so words outside the range are lost. Brief 01 fixes this.
- `captionsOverlappingRange` (`transcriptionApply.ts:48`) drives both the "choose" decision in the panel
  (`src/TranscriptionPanel.tsx:195`, `:209`) and the throw in `applyTranscription` (`:74`).
- Panel: `TranscriptionPanel` (`src/TranscriptionPanel.tsx:89`), the `Delivered` type (`:14`), `start()`
  (`:182-202`), the setup form (`:226-287`), the choose section (`:297-304`). It is mounted once, in
  `CaptionsPanel` (`src/CaptionsPanel.tsx:93`), inside the empty-state block `offerTranscription && ...`.
- `CaptionsPanel` is mounted only while the Captions rail tab is active (`src/App.tsx:2288`,
  `railTab === 'captions'`); `setRailTab` is at `App.tsx:283`.
- App apply handler: `applyTranscript` (`src/App.tsx:765-789`), one undo step via `commitHistory`. It builds
  the result notice (uncovered stretches at `:776-780`).
- **Time bases.** Cues and transcripts are in the **source time of their video** (`cue.mediaAssetId`).
  Timeline, playhead and In/Out marks are **sequence time**. Helpers in `src/core/timelineModel.ts`:
  `sourceUsAt(clip, sequenceUs)` (`:~44`), `sequenceUsOf` (`:~39`), `spansInSequence(range, assetId, clips)`
  (`:129`), `videoUnderPlayhead(sequenceUs, tracks, clips)` (`:221`), `assetIdOf` (same file).
- In/Out marks: `marks` / `activeRange` (`src/App.tsx:328-331`, sequence time, view state only),
  `markIn`/`markOut` (`:1689-1690`), `I`/`O` shortcuts. `SequenceRange` type: `src/core/sequenceRange.ts:7`.
- Picked video: `pickedVideo` (`App.tsx:441`, from `pickedVideoId` `:296`, else the video under the
  playhead, else the primary video); passed to `CaptionsPanel` at `:2309`.
- Time text helpers: `src/core/time.ts` (`parseTimestamp` is strict `hh:mm:ss,mmm`; `formatTimestamp`,
  `formatClock` = `mm:ss`).
- Timeline context menu: `TimelineMenuTarget` (`src/Timeline.tsx:197-199`), `openContextMenu`
  (`:650-681`) reports `{ kind: 'empty', trackId, atUs }` for empty space (`atUs` is sequence time);
  menu entries are built in `contextEntries` (`src/App.tsx:2117`), `case 'empty'` near the end.
- Run model: `transcriptionRuns` on the project; cloud runs carry `provider` and optional
  `uncoveredRanges` (`src/core/model.ts:~150-170`).

Line numbers drift: other sessions edit this repo. Search by symbol name if a line is off.

## Project rules that matter (from AGENTS.md)
- User corrections are authoritative: retranscription must never silently overwrite them. The existing
  keep-authored / replace-all choice stays; brief 01 adds that captions outside the range are never touched.
- Source-media microseconds are canonical time. Integer µs only; no float seconds in the model.
- Renderer has no Node integration. New IPC fields are zod-validated in `src/core/transcriptionIpc.ts` and
  re-checked in the main process against the probed media duration.
- Never block the UI thread. Do not present nonfunctional controls as implemented.
- Preserve Malayalam shaping; this plan does not touch caption text handling.
- Update `docs/STATUS.md` after each slice: changes, verification, limitations, next task.
- The working tree may hold other uncommitted work (e.g. the caption-languages plan). **Stage only the
  files your brief changed**, never `git add -A`.

## Out of scope (all briefs)
- Automatic retry of `uncoveredRanges` inside the cloud adapter (possible follow-up; this plan makes the
  manual path first).
- Several ranges in one request, or a queue of range jobs.
- Transcribing across several videos at once from one sequence range (the range always belongs to one video).
- MCP/agent tools for range transcription.
- Keeping a running transcription alive when the Captions tab is switched away (existing limitation: the
  panel unmounts; note it, don't fix it).
- Padding the range with extra audio. Words cut at the range edge may be lost or partial; the gap list in
  brief 03 picks ranges between captions, which usually start and end in pauses.
