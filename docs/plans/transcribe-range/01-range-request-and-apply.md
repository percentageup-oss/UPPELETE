# 01: Range in the transcription request, boundary-safe apply

Part of [docs/plans/transcribe-range](README.md). Read the README's "Shared findings" and "Project rules"
first; do not read PRODUCT/ARCHITECTURE/ROADMAP in full.

## Goal
The renderer can ask to transcribe one source-time range of a video. Applying the result replaces only
captions that lie **inside** that range; a caption that straddles either edge is always kept, whatever
the user chose. No UI for picking a range yet (brief 02). The whole-video path behaves exactly as today.

## Read only these files
- `src/core/transcriptionIpc.ts` (whole file, ~70 lines)
- `electron/transcriptionIpc.ts:35-80` (the `transcription:start` handler)
- `src/core/transcriptionApply.ts` (whole file, ~90 lines)
- `src/TranscriptionPanel.tsx:12-22` (`Delivered`, `ApplyTranscript`) and `:176-209` (`finish`, `start`, `choiceCounts`)
- `src/App.tsx:763-790` (`applyTranscript`)
- `src/core/time.ts` (for `formatClock`)

## Steps

### 1. Request schema (`src/core/transcriptionIpc.ts`)
- Export `const MIN_TRANSCRIPTION_RANGE_US = 1_000_000`.
- Export `transcriptionRangeSchema = z.strictObject({ startUs: z.number().int().min(0), endUs: z.number().int().positive() }).refine((r) => r.endUs > r.startUs, 'Range end must follow its start')`
  and its type `TranscriptionRange`.
- Add `range: transcriptionRangeSchema.optional()` to **both** union members. Absent = the whole video.
  Keep the doc comment: the range is source time of the media identified by `fingerprint`.

### 2. Main process check (`electron/transcriptionIpc.ts`, replace line 43)
Build `sourceRange` from `request.range` when present:
- Clamp `endUs` to `durationUs` (the probe duration can be a few µs off the audio length).
- Fail with `failed(...)` (not a throw) when `startUs >= durationUs`, or when the clamped length is below
  `MIN_TRANSCRIPTION_RANGE_US`. Messages: "The range starts after the end of this video." /
  "Pick a range of at least 1 second to transcribe."
- Absent range: `{ startUs: 0, endUs: durationUs }` as now. Leave the smoke path (`:92`) unchanged.
Nothing in `TranscriptionService` needs to change (see README findings).

### 3. Boundary-safe apply (`src/core/transcriptionApply.ts`)
Add an optional last parameter to `applyTranscription`: `options?: { partial?: boolean }`. Existing callers
and tests keep compiling.
- New exported helper:
  ```ts
  /** For a partial-range run, a cue that overlaps the range but extends past either edge is never replaced. */
  export function straddlesRange(cue: Cue, range: { startUs: number; endUs: number }): boolean
  ```
  true when `cue.startUs < range.startUs || cue.endUs > range.endUs` (and it overlaps).
- New exported `replaceableCaptionsInRange(cues, range, assetId, partial)`: `captionsOverlappingRange(...)`
  minus, when `partial`, the ones that straddle. Use it for the `choice === null` throw and for the
  removal filter, so a straddling cue lands in `kept`. The existing `added` filter already skips new cues
  that overlap a kept cue; keep that.
- Add `boundaryKept: number` to `TranscriptionApplySummary` (straddling cues kept because of the range
  edge; 0 for whole-video runs).
- Update the file's header comment: captions outside the range are always kept, and for a partial range
  so are captions crossing its edge.

### 4. Carry `partial` through the renderer
- `Delivered` (`TranscriptionPanel.tsx:14`) gets `partial: boolean`. In `start()` set `partial: false`
  for now (brief 02 sets it from the chosen range).
- The "choose" decision (`:195`) and `choiceCounts` (`:209`) switch to
  `replaceableCaptionsInRange(cues, range, assetId, result.partial)`, so a result whose only overlaps are
  straddling cues applies without asking.
- `applyTranscript` (`App.tsx:765`) passes `{ partial: result.partial }`.
- Notice (`App.tsx:~784-787`): for a partial run, say which part, e.g.
  `Transcribed 0:00–0:22 of full-video.mp4 with Gemini (...)`, using `formatClock` on
  `transcript.sourceRange`. When `summary.boundaryKept > 0`, add
  `kept N caption(s) crossing the range edge` to `parts` and make the notice a warning.

### 5. Typecheck
`npx tsc --noEmit -p .` must pass.

## Out of scope
UI to pick a range (02), the gap list and timeline menu (03), padding the audio range, automatic retries.

## Done checklist
- [ ] `range` optional on both request variants; main clamps/validates it against the probed duration
- [ ] `applyTranscription(..., { partial })` keeps straddling cues and reports `boundaryKept`
- [ ] Panel decides "choose" with the replaceable set; `Delivered.partial` exists (always false for now)
- [ ] Notice names the range for partial runs
- [ ] `npx tsc --noEmit -p .` passes
- [ ] `docs/STATUS.md` entry: "Transcribe range 01: request range + boundary-safe apply. Not tested,
      typecheck only. No UI yet (brief 02)."
- [ ] Commit only the files changed here: `Transcription: accept a source range; keep captions crossing its edge`
