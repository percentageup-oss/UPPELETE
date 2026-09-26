# 02: Captions panel language tabs + "Show on video"

Read `README.md` in this folder first for the shared findings, project rules and the testing override
(typecheck only; no tests). Brief 01 must have landed: check `docs/STATUS.md` and that
`src/core/captionLanguages.ts` and the `set-shown-translation` command exist.

## Goal
The Captions tab gets one tab per language (Original plus each translation). Each translation tab has a
**"Show on video"** checkbox. Ticking it makes that translation replace the original on video; only one is shown
at a time; unticking all shows the original. Everything in the panel acts on the active tab's cues.

## Read only these files
- `src/CaptionsPanel.tsx` (props ~21-73, render ~81-102, `TranscriptCue` ~171-264)
- `src/GlobalCaptionEditor.tsx` (tab pattern ~73-75, checkbox label ~85)
- `src/styles.css` (`.global-edit-tabs` ~900, `.global-edit-check` ~904)
- `src/core/captionLanguages.ts` (from brief 01), `src/core/translationLanguages.ts`
- `src/App.tsx` only around: `railTab === 'captions'` render (~2283-2294), `visibleCues` (~348), prev/next cue
  (~1691-1694), timeline cue selection, `runCommand` (~691-726)
- `src/core/recognition.ts` (`recognitionToCaptions`), `src/core/captionGrouping.ts` (`groupCaption`)

## Steps

### 1. Active tab state
Hold `captionLanguageTab: LanguageCode | null` (`null` = Original) in `App.tsx` and pass it to `CaptionsPanel`.
- It follows `project.shownTranslation` whenever that changes (ticking a checkbox or undo/redo).
- Selecting a cue from the timeline switches the tab to that cue's `translationLanguage`.
- If the active tab's language no longer exists in the project, fall back to `null`.

### 2. Tab strip
Under the Captions heading, render the strip **only when the project has at least one translation**
(`projectLanguages(project).translations.length > 0`).
- Tabs: Original (label from `originalLanguage`, else "Original") then one per translation, labelled with
  `translationTargetLabel(code)`.
- Reuse the `role="tab"` + `aria-selected` pattern and `.global-edit-tabs` styling from `GlobalCaptionEditor`. Add a
  small class if the strip needs its own spacing; keep it in `styles.css` next to the existing rules.
- Show a small dot or "On video" marker on whichever tab is currently shown on video.

### 3. "Show on video" checkbox
On a translation tab, render a checkbox using the `.global-edit-check` style:
- Checked = `project.shownTranslation === thatLanguage`.
- Toggling runs `set-shown-translation` with that language, or `null` when unticking. Ticking one automatically
  unticks the others (the setting is a single value).
- On the Original tab show a non-interactive line: "Shown on video" when no translation is ticked, otherwise
  "Hidden while a translation is shown".
- The toggle is one undo step (it goes through `runCommand`).

### 4. Filter the panel by the active tab
Pass the panel `cuesForLanguage(project.cues, captionLanguageTab)` instead of all cues:
- the cue list (`TranscriptCue` cards);
- the `cueCount`, `GlobalCaptionEditor` "Edit all", and regroup-all (`App.tsx:~2294`, which builds
  `cueIds: project.cues.map(...)`): use the active tab's cue ids only;
- prev/next cue navigation (`App.tsx:~1691-1694`): step within the active tab;
- **add caption**: new cues created from the panel or the playhead set `translationLanguage` from the tab.
Keep drag preview behaviour (`visibleCues`) working: the panel receives the drag-previewed version of the
active tab's cues.

Hidden layers keep their cues in the project; this brief only changes what the panel lists.

### 5. "Rebuild original captions"
On an old migrated project the Original tab can be empty (only translated cues existed). When the Original
layer has **no cues for the picked video** but a `transcriptionRuns[].recognition` exists for it, show a
"Rebuild original captions" button on the Original tab.
- It builds cues with `recognitionToCaptions(run.recognition, run.id, uuid)` then `groupCaption`, binds
  `mediaAssetId`/`captionTrackId` the way `applyTranscription` does (`transcriptionApply.ts:79-81`), and commits
  them in **one** history step through `commit()`.
- No API call, and no existing cue is touched. If original cues for that range already exist, do not show it.

### 6. Empty states
An empty active tab shows a short hint instead of the blank list. The existing `TranscriptionPanel` empty state
(`CaptionsPanel.tsx:~92-96`) applies only when the project has no cues at all; do not show it because one tab is
empty.

## Out of scope
Translating existing captions ("+ Translate..." is brief 03), multi-language transcribe (04), removing a
language, bilingual display, changing the timeline UI beyond what brief 01 did.

## Checks
- `npx tsc --noEmit -p .` passes. No tests (README override); fix an existing test minimally only if the
  typecheck breaks, e.g. `src/CaptionsPanel.test.tsx` when `CaptionsPanel` props change.
- Note: `src/CaptionsPanel.tsx`, `src/App.tsx` and `src/styles.css` may have uncommitted work from other
  sessions. Re-read before editing and do not revert unrelated changes.

## Done
- [ ] Tab strip (hidden when there are no translations) with an "On video" marker.
- [ ] "Show on video" checkbox: single-select, undoable, Original tab status line.
- [ ] List, Edit all, regroup-all, prev/next and add-caption act on the active tab.
- [ ] "Rebuild original captions" for migrated projects.
- [ ] `npx tsc --noEmit -p .` clean.
- [ ] `docs/STATUS.md` entry: changes, "not tested, typecheck only", limitations, next task (brief 03). Commit.
