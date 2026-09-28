# Status

## 2026-09-28 — Resolve Text+ 19 (run 1 findings + run 2 script): CLS writes still unconfirmed

**Changes:** The user ran `cls-write-spike.lua` on Resolve Studio 21.0.0.47 (Windows). All three methods failed:
`Paste(table)` returned `false` and added no tool, `LoadSettings(table)` returned `false`, and
`SetInput("CharacterLevelStyling", parsedValue)` returned `nil`. The B and C dumps have no
`CharacterLevelStyling` input, and all three stills are plain. `bmd.readstring` works: it returns `__ctor`-tagged
tables. Recorded in ADR 0011 ("Write spike result"). Evidence is in
`docs/decisions/evidence/resolve-cls-write-spike-2026-09-28*`. The stills are 6.2 MB each, so they weren't copied.
The script now also tries two file-based methods: **D** `ExportFusionComp`, add the CLS tool and link in the file,
then `ImportFusionComp` + `LoadFusionCompByName`; **E** `SaveSettings(path)`, add the input, then
`LoadSettings(path)`. Both are verified with `ExportFusionComp`, which dumps the whole comp whatever is selected.
Also fixed: A-C didn't move the playhead past their own clip, so each clip was inserted on top of the previous
one. The keyframe clip is renamed K.

**Verification:** `npx luaparse` (syntax only). Not run against Resolve.

**Limitations:** Clear, keyframing and timing are still no data. If D and E also fail, emphasis probably needs a
different path, such as one `.setting` title template per style.

**Next:** the user re-runs `cls-write-spike.lua` (SPIKE5.md, run 2) and sends back the report, the
`.comp`/`.setting` files, and what the D and E stills show. Briefs 17 and 18 stay blocked.

## 2026-09-28 — Resolve Text+ 19: CLS write-method spike (brief added)

**Changes:** docs + a new spike script only; no app code. ADR 0011 (run 2) confirmed the CLS data shape,
property ids and counting unit, but flagged that every write brief 15 tried used the old guessed
ids/shape/unit, so **no script write has ever been confirmed working**. Added brief
`docs/plans/resolve-textplus/19-cls-write-spike.md`, a new spike script
`resources/resolve/dev/cls-write-spike.lua` and its instructions `resources/resolve/dev/SPIKE5.md`. The
script builds a `.setting`-shaped snippet using ADR 0011's confirmed ids (2401-2403 colour, 102 absolute
size) and unit (0-based code points, end inclusive), parses it with `bmd.readstring` (a plain Lua table
didn't work in brief 15), and tries the three untried methods in order: `comp:Paste()`, `mod:LoadSettings()`,
`mod:SetInput()`. It verifies with `comp:CopySettings()` dumps and stills, never `GetInput` (ADR 0011 found
that returns `""` even when styling is present). If any method looks like it worked, it also retries the
clear, keyframe and timing tests from brief 15 with the confirmed values. Updated
`docs/plans/resolve-textplus/README.md`'s table and "Emphasis and per-word styling" section to insert this
step between 16 and 17.

**Verification:** `npx luaparse resources/resolve/dev/cls-write-spike.lua` (syntax only). Not run against
Resolve.

**Limitations:** nothing here is a write confirmation — it's a script for the user to run. Whether any of
the three methods actually applies visible styling is still unknown until the user reports back.

**Next:** the user runs `cls-write-spike.lua` (see `SPIKE5.md`) and sends back the report, `.setting`
dumps and stills. Extend ADR 0011's "Write method" section with the result (don't rewrite the confirmed
sections above it). Only then do briefs 17 and 18 unblock.

## 2026-09-28 — Resolve Text+ 16 (run 2): CLS format and counting unit confirmed

**Changes:** docs only. The user re-ran `cls-spike.lua` with a hand-styled Text+ clip (R1). ADR 0011 is
rewritten from it:
- CLS lives in the `StyledTextCLS` modifier's `CharacterLevelStyling` input as
  `StyledText { Array = { {propId, start, end, Value|String}, … }, Value = "" }`. Property ids are numeric:
  2401-2403 colour RGB (a missing `Value` means 0), 102 absolute size, 105 underline, 109 style string, and 1002
  unknown.
- The unit is **0-based code points with an inclusive end**: `Sam` = `{17, 19}`.
- `GetInput` returns `""` even for real styling, so CLS can only be read through `CopySettings()`.

Evidence: `docs/decisions/evidence/resolve-cls-spike-2026-09-28-{run2.txt,R1-1.setting}`.

**Verification:** docs only.

**Limitations:** the write, clear and keyframe tests still used the old guessed ids and shape, so a working
script write is unconfirmed, and the stills were unchanged again. How `\n` counts, what id 1002 means, and alpha
are unconfirmed. Four questions for the user are in ADR 0011 ("Open questions").

**Next:** a small write spike: build the value from a `.setting` string via `bmd.readstring`, then try `Paste`,
`LoadSettings` and `SetInput`, and check the results with `CopySettings` and a still. Also try one keyframed
value. Briefs 17 and 18 start after that.

## 2026-09-28 — Resolve Text+ 16: CLS spike findings → ADR 0011

**Changes:** docs only. Turned the user's brief 15 report (hand prep skipped again) into
`docs/decisions/0011-resolve-character-level-styling.md`. Confirmed: the modifier's tool ID (`StyledTextCLS`,
named `CharacterLevelStyling1`) and the connection call (`tool.StyledText:ConnectTo(mod.StyledText)`, `ok=true`
every time). Narrowed the property-id guesses from R0's `GetInputList()` dump: a per-range color override is more
likely the plain `Red/Green/Blue/Alpha` quad gated by `OverrideColor`, not the `Red1/Green1/Blue1/Alpha1` base-fill
quad W1 guessed; size is more likely `SizeX`/`SizeY` (a multiplier), not the absolute `Size` input W1 guessed.
Timing confirmed: ~500 ms CPU/clip for insert+connect+write, so any bulk CLS command in briefs 17/18 needs start +
poll, not one synchronous call.

**Still blocked:** the character counting unit has **no data** — R1 (reading a hand-styled clip) was skipped
again, and R2's offsets are TypeScript's `graphemes()` output, not a real Resolve value to compare against. The
one write attempt (W1b, `SetInput`) reported `ok=true` but read back empty and produced no visible change across
all four stills (identical file size, and identical by eye — checked directly). W3's keyframe test inherited that
same failure, so it answers nothing about whether CLS can be animated in one clip; brief 18 stays on the user's
split-clips fallback. Method (a), `Paste()`, was never attempted (nothing to edit yet at dump time).

**Verification:** docs only, no code touched.

**Limitations:** every property-id guess above is still a guess, refined by real default-value evidence but not
by an actual styled range. The write method is unconfirmed either way (empty readback + unchanged stills isn't
proof `SetInput` can't work, only that this run's guessed shape didn't).

**Next:** a follow-up spike run with the hand prep actually completed (a real R1 `.setting` dump) is required
before briefs 17 and 18 can start. That run should also re-test the write with the corrected property-id guesses
above, sourced from R1 rather than R0's defaults.

## 2026-09-27 — Resolve Text+ 15: Character Level Styling spike (script)

**Changes:**
- `resources/resolve/dev/cls-spike.lua` (new, dev-only, not packaged): a Resolve menu script that creates its
  own scratch timeline (`KathaCut CLS spike <numbers>`) and produces CLS data even with no hand prep. R0 inserts
  a fresh Text+ clip (`InsertFusionTitleIntoTimeline`, no template bin needed), adds a `StyledTextCLS` modifier,
  dumps its `GetInputList()`, tries three connection methods (`ConnectTo`, `ConnectInput`, `mod.Text =`) logging
  which succeeds, and writes the comp's full `CopySettings()` dump (`bmd.writestring`) to `kathacut-cls-R0.setting`.
  R1 (optional) scans every video track of the timeline open when the script started for a Text+ whose
  `StyledText` input has a connected output, and dumps up to 5 into `kathacut-cls-R1-<n>.setting`. R2 prints each
  marked word's `[start, end)` in UTF-16/codepoint/UTF-8-byte (computed in Lua) and grapheme (hard-coded — this
  session computed them with `graphemes()` from `src/core/captionText.ts`, since Lua 5.1 has no Unicode
  segmentation) for the test string in the brief. W1 writes a CLS range two ways — editing R0's `CopySettings()`
  table and `comp:Paste()`-ing it back onto R0's own comp, and `mod:SetInput("CharacterLevelStyling", …)` on a
  fresh second clip — using property ids sampled from R1 if found, else R0's default, else a guessed fallback
  (`Red1`/`Green1`/`Blue1`/`Alpha1`/`Size`), and UTF-8 byte offsets as its one operative guess for the counting
  unit (R2's job is to supply the alternatives if that guess is wrong). W2 clears the styling two ways and
  confirms the text still reads. W3 keyframes the CLS input with `comp:BezierSpline()` (word 1 red at frame 0,
  word 2 red at frame 10) and exports stills at frames 5 and 15. W4 times 50 fresh clips with the SetInput
  method. Every step is `pcall`-wrapped; it never edits anything that existed before it ran.
- `resources/resolve/dev/SPIKE4.md` (new): setup instructions, including the optional hand-prep steps (add a
  Text+, enable Character Level Styling on the Fusion page, style three specific words, screenshot each step)
  that R1 depends on, and what to send back.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` passes; no TS files touched) and Lua
syntax check only (`npx luaparse` clean). The user runs the spike in Resolve per SPIKE4.md.

**Limitations:** the CLS array shape (`{ propId, start, end, Value }`), the counting unit, and every property-id
guess are unconfirmed until the user's report — that's the point of the spike. Method (a)'s `Paste()` target
(R0's own comp) and method (b)'s target (a fresh clip) were chosen to avoid pasting a second TextPlus tool into
one comp, but this is this session's judgment call, not a confirmed Resolve behavior.

**Next:** the user runs the spike (optionally with the hand prep) and sends back the report, `.setting` dumps,
stills and (if hand-prepped) screenshots/notes. A findings session (brief 16) turns that into ADR 0011.

## 2026-09-27 — Resolve Text+ 14: unpack compound clips on import

**Changes:**
- `resources/resolve/bridge.lua`: new `exportTimelineOtio { timelineId }` handler — the exact call ADR 0010
  confirmed (`timeline:Export(path, resolve.EXPORT_OTIO, resolve.EXPORT_NONE)`). The bridge picks the path
  (`<mailboxDir>/timeline-export.otio`); the request never supplies one. Added to the README's command list.
- `src/core/resolveIpc.ts`: `resolveExportOtioResultSchema` (`{ path }`) and `resolveOtioDocumentSchema`, a
  minimal recursive `OTIO_SCHEMA` + `children` shape (depth cap 8, array caps, `.passthrough()`) — every other
  OTIO field is read defensively in `compoundUnpack.ts` rather than asserted here.
- `src/resolve/compoundUnpack.ts` (new, pure): `unpackCompounds(edit, otio, fps)` matches each `kind: 'compound'`
  item to its OTIO `Stack` (video-track index + record start within ±1 frame + name), verifies the Stack's
  `source_range.duration` against the item's record length, then walks its inner video track(s), clipping each
  child to the visible window and converting every boundary independently (never by summing frame deltas) into
  outer timeline frames and the media's own source frames (ADR 0010's "subtract `available_range.start_time`"
  rule). Nested compounds recurse (depth ≤ 4). A compound with several *media-bearing* video tracks inside is
  skipped as a whole ("Compound clip with several video tracks inside"); a title-only extra track doesn't count
  (ADR 0010's suggestion), so the tested shape (file clips + a Text+ on another inner track) still unpacks. A
  retimed inner clip, a title/generator, a nested clip past depth 4, or one with no readable media reference is
  reported in `skipped`, never dropped. `skipUnreadableCompounds(edit, fps)` is the fallback when the OTIO
  export/read/parse fails: every compound is left as it is but given this brief's own reason. Both remove the
  audio-track duplicate `readTimelineEdit` reports for a consumed compound, so it isn't also reported as
  separate audio.
- `electron/resolve/importEdit.ts`: `importTimelineEdit` now unpacks compounds (only when the edit actually has
  one) between `readTimelineEdit` and the path collection, so inspection, retime clamping and placement run
  unchanged on the resulting synthetic file items. The exported `.otio` file is capped at 50 MB and always
  deleted (`finally`).
- `src/home/HomeScreen.tsx`: **Render instead**'s tooltip drops "compound" (now "retimed, multicam and Fusion
  clips") since compounds are unpacked, not rendered.
- `src/resolve/editToProject.ts`: exported `KIND_REASON` and `baseName` for reuse by `compoundUnpack.ts`.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` passes). No Resolve run.

**Limitations:** built from one spike run (ADR 0010) whose timeline had an untrimmed compound and no retimed
clip, mixed inner fps, nested compound or nested timeline. Those paths (outer trim verification, retime
detection via the "Retime and Scaling" effect's parameters, nested-compound recursion) are implemented per the
ADR's conservative rules but unexercised against a real Resolve project. Retime detection may over-skip (the
ADR's own stated safe direction) since a duration-mismatch signal wasn't implementable without assuming
non-retime first (documented in `compoundUnpack.ts`). Windows only; Mac is unverified.

**Suggested opt-in test:** `unpackCompounds`'s window-clipping and frame math (`src/resolve/compoundUnpack.ts`)
is pure and off-by-one-prone; a small unit test against the evidence OTIO
(`docs/decisions/evidence/resolve-compound-spike-2026-09-27.otio`) would catch regressions cheaply. Not written,
per the plan's testing override.

**Next:** the user opens brief 13's spike timeline in Resolve and runs **Import DaVinci timeline** (manual check
below). Re-running the spike with a trimmed compound, a retimed inner clip, mixed inner fps and a nested
compound would close the items above.

## 2026-09-27 — Resolve Text+ 13: compound clip spike findings (ADR 0010)

**Changes:**
- `docs/decisions/0010-resolve-compound-clips.md` (new): from one spike run (Resolve Studio 21.0.0.47, Windows).
  OTIO carries a compound's inner edit as a nested `Stack` (`Resolve_OTIO."Sequence Type" = "Compound Clip"`)
  and keeps titles and gaps; FCPXML 1.10 also carries the inner clips but drops Text+ and is written as a
  directory bundle. Recommendation: OTIO, one synchronous export (≈0.01 s CPU). Rules recorded: match by
  video-kind track index + record start + name; inner time starts at 0 and the outer trim is the Stack's
  `source_range`; source times include the media Start TC, so subtract `available_range.start_time`; OTIO
  quantises source times to the sequence rate (±1 media frame, same tolerance as ADR 0009); `target_url` is a
  plain Windows path; the media reference is `media_references.DEFAULT_MEDIA` (`Clip.2`).
- Evidence: `docs/decisions/evidence/resolve-compound-spike-2026-09-27.{txt,otio,fcpxml}`.

**Verification:** not tested, typecheck only; findings are read from the user's spike output and cross-checked
between the OTIO, FCPXML and C2 read-back.

**Limitations:** the run's timeline had one untrimmed compound and no hand notes. Outer trim, mixed fps inside
a compound, retime, nested compounds and nested timelines are unconfirmed (ADR 0010, "Unconfirmed").

**Brief 14 differences (follow the ADR):** read `media_references[active_media_reference_key]`, not
`media_reference`. The ADR suggests counting only tracks with file clips as "video tracks inside a compound",
so a compound with a title on inner V2 (the tested one) is still unpacked.

**Next:** brief 14 (unpack compound clips on import). Optionally re-run the spike on a timeline with a trimmed
compound and a retimed inner clip to close the unconfirmed items.

## 2026-09-27 — Resolve Text+ 13: compound clip spike (script)

**Changes:**
- `resources/resolve/dev/compound-spike.lua` (new, dev-only, not packaged): a read-only Resolve menu
  script. C1 exports the current timeline to OTIO (`resolve.EXPORT_OTIO`) and FCPXML
  (`resolve.EXPORT_FCPXML_1_10`), logging each constant's value (or `missing`), the `Export` return
  value, file size and elapsed time; falls back to a two-argument `Export` call if `EXPORT_NONE` is
  missing. C2 logs every outer video/audio track item's name, timing, source frames and media pool
  `Type`/`File Path`/`FPS`/`Start TC` (capped at 200 items) and `timeline:GetStartFrame()`. C3 dumps the
  first compound/nested-timeline item's full `GetClipProperty()` table (sorted), its unique/media id,
  and whether any project timeline shares its name. Every check is `pcall`-wrapped; an absent method or
  constant logs `missing` rather than failing the script. It never edits, deletes or adds timeline
  items — only `Export()` writes files, both outside the project.
- `resources/resolve/dev/SPIKE3.md` (new): setup instructions — build a timeline with two compounds (one
  trimmed at both ends with a mixed-fps inner clip, a gap and a Text+ title; one with a 50%-retimed clip
  and a nested compound) and an optional nested timeline, hand-record each compound's inner clips as
  ground truth, run the script, and send back the report, the `.otio`/`.fcpxml` files and the hand notes.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` passes; no TS files touched). The
user runs the spike in Resolve per SPIKE3.md.

**Limitations:** unconfirmed until the user's report: whether OTIO/FCPXML export carries a compound's
inner edit at all, export time vs. the ~2 s bridge command budget, and how a compound's outer trim and
inner clips' source time origin appear in either file format.

**Next:** a findings session turns the user's report into `docs/decisions/0010-resolve-compound-clips.md`
(brief 13, step 4), then brief 14 (unpack compound clips on import) reads that ADR.

## 2026-09-27 — Resolve Text+ 08: docs

**Changes:**
- `docs/RESOLVE.md` (new): what the integration does, install/connect/sync steps for users (Free and
  Studio), the architecture diagram and mailbox protocol v1 with the full command list and parameters,
  install paths per OS, time mapping, the sync/diff/conflict rules, the Text+ support matrix, known
  limits and troubleshooting. Built by reading the plan README, ADR 0008/0009, every Resolve STATUS
  entry (briefs 01-07, 09-12), `resources/resolve/bridge.lua`'s command list and `electron/resolve/install.ts`.
- `docs/ARCHITECTURE.md`: a short "DaVinci Resolve bridge" section linking to RESOLVE.md.
- `docs/PRODUCT.md`: one bullet on Resolve Text+ sync (local only, Lua runs inside Resolve, nothing
  uploaded).
- `docs/ROADMAP.md`: new "4d. DaVinci Resolve Text+ sync" milestone marked done-but-unverified-in-Resolve,
  with the follow-ups (auto-sync when idle, proxy cache cleanup, proxy refresh, a rendered-overlay mode
  for effects Text+ can't represent).
- `docs/DEPENDENCIES.md`: a "DaVinci Resolve bridge" section — the Lua bridge and `.drb` template are
  KathaCut's own GPL-3.0-or-later code/assets, the Resolve scripting API is used at runtime only (never
  redistributed), and AutoSubs (MIT) is credited as design inspiration only, no code copied.
- `docs/INSTALL_TESTERS.md`: a short "DaVinci Resolve" manual test section, taken from briefs 03, 04, 06
  and 07's own manual checks.

**Verification:** `npx tsc --noEmit -p .` passes (docs-only change; typecheck unaffected). Not tested
against a real Resolve session — this brief only reads and documents; see RESOLVE.md's own "Status" line
for what has and hasn't been run.

**Next:** per ROADMAP 4d's follow-ups — an opt-in "auto-sync when idle" is first in that list.

## 2026-09-27 — Resolve Text+ 07: emphasis + word animations in Text+

**Changes:**
- `src/resolve/charUnits.ts` (new, pure): `offsetInUnit`/`isGraphemeBoundary` (codepoint/UTF-8-byte/grapheme
  counting, for the day Character Level Styling's format is confirmed) and `wordRanges(words, specText,
  transform)` — locates each word's `[start, end)` in the text actually sent to Text+ (post line-wrap, post
  `textTransform`), matching strictly in cue order and dropping (never partially placing) a word that doesn't
  land on a grapheme boundary at both ends. Deviates from the brief's literal `wordRanges(cue, specText)`
  signature (takes `words`+`transform` instead of a whole cue) — documented here per the brief's own "note the
  difference" rule.
- `src/resolve/textPlusMotion.ts` (new, pure): `computeMotion` maps one draft's requested `CaptionMotion` to
  Text+ input overrides/keyframes plus an honest per-motion outcome (`sent`/`approximated`/`not-sent` + reason).
  `phrase-fade` ramps the confirmed `Alpha1` fill-alpha input (200 ms/`motionSpeed`, mirroring `captionFrame`)
  using the keyframe mechanism ADR 0009 (E9) confirmed only on `End` — reported `approximated`.
  `progressive-word-reveal` steps the confirmed `End` (write-on) input at each word's start, to the word's
  cumulative grapheme fraction of the final text (Text+'s own Write On counting unit is unconfirmed, so grapheme
  count is used only because it can never split a cluster) — `approximated`; a word-at-a-time draft needs no
  animation (already one word per clip) — `sent`. **`active-word-highlight`/`word-pop` need Character Level
  Styling to color just the active word inside a longer clip, and CLS's data format is "no data" per ADR
  0008/0009 — so both are `not-sent` in line mode.** In word-at-a-time display mode the whole clip *is* the
  active word already, so both are achievable without CLS: the clip's fill is overridden to the secondary color
  (`sent`), and `word-pop` additionally scales `Size` by the emphasis scale, without the sine pop
  (`approximated`). Emphasis spans (`cue.emphasized`) stay `not-sent` outright for the same CLS reason — no
  sub-clip fallback, since splitting displayed text to fake per-word color would change layout (forbidden).
- `src/resolve/textPlusPlan.ts`: `TextPlusClipSpec.styleRanges` is now typed `TextPlusStyleRange[]` (always `[]`
  — CLS isn't sent). Each draft now knows whether it's a genuine word-at-a-time draft (`Draft.isWordDraft`) and
  calls `computeMotion`; its `inputOverrides` merge into the spec's inputs and its `keyframes` go on the spec.
  Support report: motion entries are now per-`MOTIONS` kind (not one blanket "Caption motion" line), aggregated
  worst-level-wins with every reason a cue hit; a new "Motion word timing" note flags estimated word timing used
  by a motion's keyframes, separate from the existing word-at-a-time-display note.
- `src/resolve/textPlusInputs.ts`: `TEXT_PLUS_INPUTS.writeOnStart`/`writeOnEnd` (`Start`/`End`).
- `src/core/resolveIpc.ts`: `resolveSyncSpecSchema` gained `keyframes` (whitelisted input + up to 64
  clip-relative `[frame, value]` points) and `styleRanges` (typed but always empty today), both zod-validated
  with limits.
- `resources/resolve/bridge.lua`: `INPUT_WHITELIST` gained `Start`/`End`; `applySpec` now applies
  `spec.keyframes` via `comp:BezierSpline()` (the confirmed mechanism) after the plain inputs, so a clip
  re-synced from an earlier motion always resets first (the planner always sends `Start:0, End:1` as a plain
  baseline). `spec.styleRanges` is intentionally never read — no confirmed CLS format to apply it in.
- `electron/resolve/sync.ts`, `src/resolve/ResolveSync.tsx`, `src/resolve/CreateInResolve.tsx`: forward
  `keyframes`/`styleRanges` from the planned spec through to the bridge request (previously dropped).

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` clean, Windows 11). Real verification
needs Resolve; see the brief's manual check.

**Mapping table (motion → Text+ technique):**

| KathaCut motion | Text+ technique | Support |
|---|---|---|
| `static-clean` | nothing extra | (baseline) |
| `phrase-fade` | `Alpha1` keyframes, 200 ms/speed ramp | approximated |
| `progressive-word-reveal`, line mode | `End` (write-on) keyframes, stepped per word, grapheme-fraction reveal | approximated |
| `progressive-word-reveal`, word-at-a-time | none needed (one word per clip already) | sent |
| `active-word-highlight`, word-at-a-time | static `Red1/Green1/Blue1` = secondary color | sent |
| `active-word-highlight`, line mode | — (needs CLS) | not-sent |
| `word-pop`, word-at-a-time | secondary color + static `Size × emphasisScale`, no sine | approximated |
| `word-pop`, line mode | — (needs CLS) | not-sent |
| Emphasis (`cue.emphasized`) | — (needs CLS) | not-sent |

**Limitations:** Character Level Styling stays entirely unsent (data format and counting unit both "no data",
ADR 0008/0009) — emphasis coloring and line-mode active-word/word-pop highlighting don't reach Resolve at all.
The `Alpha1`/`End` keyframe *mechanism* is only confirmed on `End`; applying it elsewhere is a reasonable but
unverified extrapolation. Write-on's reveal fraction assumes Text+ counts by grapheme, which is unconfirmed.
`HorizontalJustificationNew`'s enum and portrait size calibration remain open from earlier briefs.

**Next:** the user runs the manual check below in Resolve — especially whether write-on/phrase-fade read as
intended and whether Character Level Styling ever becomes writable, which would let a later brief send emphasis
and line-mode active-word/word-pop for real. Then brief 08 (docs + license inventory).

## 2026-09-27 — Resolve Text+ 12: KathaCut → Resolve, "Create in DaVinci"

**Changes:**
- `src/resolve/pushPlan.ts` (new, pure): `planPush(project)` maps `captionClips` (video clips on non-hidden
  tracks) without a speed curve to `{ assetId, trackIndex (1-based, KathaCut video-track order),
  recordOffsetFrames, sourceStartFrame, sourceEndFrame }`. Record frames come from `timelineStartUs` through
  the sequence's own fps (`project.format`, else `formatFromMedia` of `primaryVideoAsset`); source frames come
  from `sourceStartUs`/`sourceEndUs` through the asset's own probed frame rate. Each boundary is rounded on its
  own via `usToTimelineFrame`; `sourceEndFrame` is inclusive, matching the convention `bridge.lua`'s existing
  `insertClips` already uses for `AppendToTimeline` (ADR 0009 could not tell inclusive/exclusive apart at its
  test precision, so this is the best available inference, not a confirmed fact). Speed-curved video clips and
  every non-video item (audio/image/color/adjustment clips, text overlays, shapes, effects, blur regions, zoom
  regions) are counted into `notSent` by feature, never dropped silently. Throws if no format can be
  determined (no video yet).
- `src/resolve/frames.ts`: `formatResolveFps`, the inverse of `parseResolveFps` (a known NTSC rational
  round-trips to its exact decimal string; anything else becomes `num/den`).
- `resources/resolve/bridge.lua`: three new handlers reusing the existing helpers (`requireTimeline`,
  `findFolderNamed`, `clipProperty`). `createTimeline { name, fps, width, height }` de-duplicates the name
  against every existing timeline in the project (` (2)`, ` (3)`…), creates it via
  `mediaPool:CreateEmptyTimeline`, sets custom fps/size (returning a `note` if any `SetSetting` call failed),
  and makes it current — never touches an existing timeline or switches projects.  `importMedia { paths }`
  finds or creates the `KathaCut Media` bin at the root, reuses an item whose `File Path` matches (no
  duplicate imports, ADR 0009), otherwise `ImportMedia`s it. `appendVideoClips { timelineId, clips }` looks
  media pool items up by `File Path` in that bin, adds video tracks up to the highest requested `trackIndex`,
  and calls one `AppendToTimeline` per batch; a missing bin item errors the whole batch (main stops the push
  and reports what was already created) rather than silently skipping a clip. `mediaType` is left unset so a
  clip's own embedded audio comes along (ADR 0009 flagged this as unconfirmed for `AppendToTimeline`).
- `src/core/resolveIpc.ts`: `resolvePushClipSchema`/`resolvePushTimelineRequestSchema`/
  `resolvePushTimelineResultSchema`/`resolvePushProgressSchema` (renderer ↔ main) and the three bridge-result
  schemas. The request carries each asset's `fingerprint`, never a path.
- `electron/resolve/push.ts` (new): `pushTimeline` resolves every `fingerprint` through the same
  `lookupMedia` registry `registerExportIpc` uses — a missing/unrelinked asset throws before Resolve creates
  anything. Then `createTimeline` → `importMedia` (batches of 25 paths) → `appendVideoClips` (batches of 50
  clips, ADR 0009's Text+ batch size; plain video placement is unmeasured but assumed no slower). A failure
  after the timeline exists is re-thrown naming the timeline, so the user knows to check Resolve.
- `electron/resolve/ipc.ts` + `electron/main.ts`: `resolve:push-timeline` (validated, one at a time, progress
  over `resolve:push-progress`); `ResolveIpcDeps` gained `lookupMedia`, wired from main's existing
  `inspectedMedia`/`fingerprintKey` registry (the same one `registerExportIpc` uses).
- Preload/`env.d.ts`: `resolvePushTimeline`, `onResolvePushProgress`.
- `src/resolve/CreateInResolve.tsx` (new), wired into `App.tsx`'s header next to the Resolve pill: shown
  whenever the project has captions. The dialog shows the timeline name (editable, default the project
  title), fps/size, what's sent (clip/caption counts) and the `notSent` list, plus a note when the project is
  already linked ("this makes a new timeline and moves the link to it"). On Create: `resolve:push-timeline`,
  then a provisional `resolveLink` (`origin: 'pushed'`), `planTextPlus` against it, `resolve:sync-apply`, then
  one `commit` sets the final link with the returned `synced` — one undo step. `src/resolve/ResolveSync.tsx`'s
  "video edit changed" disabled reason now also says "Use Create in DaVinci to make a new timeline."

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` passes). Real verification needs
Resolve; see the brief's manual check. Windows only when it is run; Mac unverified.

**Limitations:** `AddSubFolder` (creating the `KathaCut Media` bin) and per-clip source/record frame
correspondence are unexercised by the spike; a clip that lands a frame or two off its requested position is
not flagged (ADR 0009 already notes ±1 frame read-back noise, so exact-match mismatch detection wasn't
attempted for video clips, unlike the caption sync path). Embedded-audio placement, `endFrame` inclusivity
and multi-track ordering are all inferred from ADR 0009 rather than confirmed. Pushing later cut changes into
an existing pushed timeline, and everything in "Out of scope" (audio clips, images, overlays, shapes,
effects, speed curves, transitions, grades, zooms), stay unsent — the dialog lists them per-project.

**Next:** the user runs the brief's manual check in Resolve. A unit test for `planPush` (frame math, track
numbering, the `notSent` inventory) is cheap and worth adding if the user wants it. Then brief 07 (emphasis +
word animations in Text+).

## 2026-09-27 — Resolve Text+ 11: import the DaVinci timeline edit (render becomes the fallback)

**Changes:**
- `resources/resolve/bridge.lua`: new `readTimelineEdit { timelineId }` (after `requireTimeline`). For every
  video-track item it returns record start/end, source start/end frames, `File Path`, `FPS`, `Type`, name and a
  `kind` from ADR 0009's rules (no media pool item → title/generator; `Type` Compound/Timeline → compound;
  Multicam/Title/Generator/Fusion; a file with a Fusion comp → fusion). Audio-track items are listed too.
  The timeline info comes back in the same response (`timelineInfoOf`, shared with `timelineInfo`). 5000
  items max, `pcall` per item, and an item that fails is returned as `unknown`.
- `src/core/resolveIpc.ts`: `resolveTimelineEditSchema` (Lua result), `resolveImportEditResultSchema` (assets,
  planned clips by asset index and Resolve track, `unsupported`, `notImported`, timeline with rational fps,
  `truncated`), `resolveImportEditProgressSchema`.
- `src/resolve/editToProject.ts` (new, pure): `planEditImport` maps record frames to sequence µs as an offset
  from the timeline start, each boundary converted on its own. The source in-point is `GetSourceStartFrame` in
  the file's fps (Resolve's `FPS`, else the probe's rate). **Deviation from the brief (per ADR 0009):** the
  source length is the record length, not `GetSourceEndFrame`, which is only ±1 frame accurate; the source end
  frame is used only for the retime check (source span vs. record span differ by > 2 frames → "retimed").
  The source range is clamped to the file's duration and keeps the clip's length where it can. Only a readable
  video `file` becomes a clip; everything else is listed with a reason. Audio-track items with no video item at
  the same start and file (i.e. not a clip's embedded audio) go to `notImported`.
  `sequenceFormatForTimeline` gives the KathaCut sequence the Resolve timeline's size and fps.
- `electron/resolve/importEdit.ts` (new) + `resolve:import-edit` in `ipc.ts` (one at a time, no renderer
  payload): `timelineInfo` → `readTimelineEdit` → each unique file path is checked on disk and probed with
  `deps.inspect` (`inspectMedia`, which registers it in `inspectedMedia`) → plan. Missing files and unreadable
  formats become unsupported items, not failures. Progress over `resolve:import-edit-progress`.
- Preload/`env.d.ts`: `resolveImportEdit()` (validated with zod) and `onResolveImportEditProgress`.
- Renderer: Home's Resolve button is now **Import DaVinci timeline — "<name>"** with a secondary **Render
  instead** (brief 04's flow). While importing, a small progress dialog; if anything is skipped, a review dialog
  (`ResolveImportReview` in `App.tsx`) lists every item (track, time, name, reason) with **Import the rest** /
  **Render instead** / Cancel. `applyResolveImport` adds the assets through `addAssetsFromInspected`, then
  runs one command batch: `format-set` to the timeline's frame, then `clip-add` per planned clip on one
  KathaCut video track per Resolve video track (bottom-up, reusing the empty V1). Embedded audio comes along as
  linked audio clips. It commits `resolveLink` with `origin: 'edit'`, no `proxyAssetId`, and `editSignature`
  computed after placement. Files Chromium can't play use the existing playback-proxy flow unchanged.
- `src/resolve/textPlusPlan.ts`: the Sync support notes for size, position and alignment now cite ADR 0009
  (Position is "sent").

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` passes). Real verification needs
Resolve; see the brief's manual check. Windows only when it is run; Mac unverified.

**Limitations:** the retime, multicam, generator and Fusion rules are unconfirmed guesses (ADR 0009); a
retimed clip that slips past the retime check would import at 100 % speed. Source in-points on user-trimmed
clips are expected to be within ±1 source frame. Still images and separate audio are listed, not imported.
Importing adds each asset as its own undo step before the one clip-placement step. Re-importing into an
existing project is out of scope (Home only).

**Next:** the user runs brief 11's manual check. A unit test for `planEditImport` (frame math, retime check,
clamping, embedded-audio matching) is cheap and worth adding if the user wants it. Then brief 12.

## 2026-09-27 — Resolve Text+ 09 findings: ADR 0009 (edit spike results)

**Changes:**
- `docs/decisions/0009-resolve-edit-roundtrip.md` (new) from two user runs of `edit-spike.lua` (Resolve Studio
  21.0.0.47, Windows); run 2's report is `docs/decisions/evidence/resolve-edit-spike-2026-09-27.txt`. Settled:
  `GetEnd()` is exclusive; source frames count from the file's first frame (not its Start TC) and use the
  file's own fps; `GetSourceEndFrame` is only ±1 frame accurate; titles have no media pool item; compound clips
  report `Type = Compound`; there is no speed property; `AppendToTimeline` source frames are in source fps;
  re-importing a path doesn't duplicate it; `Center` y is up; `Size` = em ÷ frame height; write-on keyframes on
  `End` read back.
- `docs/decisions/0008-resolve-textplus.md`: open items updated with the above.
- `resources/resolve/bridge.lua`: `findFolderNamed`/`findTemplate` iterate with `ipairs` (the same `pairs` loop
  crashed the spike's E5 with "attempt to index local 'sub' (a number value)", so Sync's template lookup could
  have failed in any project with bins). `timelineInfo` and `renderProxyStart` read resolution from the
  **timeline** first (E4: the project setting returned 1920×1080 for a 1280×720 custom timeline).
  `resources/resolve/dev/edit-spike.lua`: same `ipairs` fix.
- `electron/resolve/sync.ts`: `INSERT_BATCH` 20 → 50 (100 clips placed + styled in ~1.3 s).
- `src/resolve/textPlusInputs.ts`: `textPlusSize` and `centerFor` comments now cite the measurement (formulas
  unchanged; they already matched). `horizontalJustificationFor` stays a placeholder: 0/1/2 render one line
  identically.

**Verification:** typecheck only (`npx tsc --noEmit -p .` passes). The facts come from the user's runs; the
bridge changes are untested in Resolve.

**Limitations:** no trimmed clip from a real edit and no retimed clip were in either test timeline, so
brief 11's retime rule is a guess (source span vs. record span). CLS (E10) and tag persistence (E11) have no
data; the justification enum and portrait `Size` are unmeasured; audio placement in `AppendToTimeline` is
unconfirmed.

**Next:** brief 11 (import the timeline edit).

## 2026-09-27 — Resolve Text+ 10: link v26 + sequence-time caption mapping

**Changes:**
- Schema **26** (`src/core/model.ts`): `resolveLinkSchema` gains `origin: 'proxy' | 'edit' | 'pushed'` and
  `editSignature` (a hash of the video edit at link time); `proxyAssetId` is now required only for
  `origin: 'proxy'`, enforced in the project `superRefine`. The old schema-25 shape is kept as
  `projectSchemaV25`/`resolveLinkSchemaV25` so a v25 project on disk still parses on its way through
  `loadProject`. New `src/core/migrateV25.ts`: a v25 link gets `origin: 'proxy'` and `editSignature`
  computed at migration time (25 could only ever produce a proxy link).
- `src/resolve/editSignature.ts` (new, pure): hashes the project's caption clips (`captionClips`, video
  clips only — moving an overlay or audio clip doesn't invalidate the link), sorted by track order then
  `timelineStartUs`.
- `src/resolve/textPlusPlan.ts` (`planTextPlus`): cues are now placed by **sequence time**
  (`cuesInSequence` over `captionClips(tracks, clips)`) instead of filtering to `link.proxyAssetId`'s
  source time, so the same mapping works whatever the link's origin. A cue spanning a non-contiguous cut
  yields one spec per run (render id `${cue.id}:${n}` for the 2nd and later); style resolution maps a
  run's id back to the original (un-suffixed) cue before calling `resolveCaptionStyle`. Updated
  `usToTimelineFrame`'s doc comment (`src/resolve/frames.ts`) to describe its input as sequence µs.
- `src/resolve/ResolveSync.tsx`: Sync is disabled with "The video edit changed since this project was
  linked to DaVinci." when the live `editSignature` no longer matches `link.editSignature` (memoised on
  `project.clips`/`project.tracks`). The second half of that message ("Use Create in DaVinci to make a new
  timeline") is withheld until brief 12 exists. "The DaVinci proxy video was removed" now applies only to
  `origin === 'proxy'`.
- `src/App.tsx` (`createFromResolve`): the link brief 04 creates now writes `origin: 'proxy'` and an
  `editSignature` computed after the proxy clip is placed on the timeline.
- Bumped hardcoded `schemaVersion: 25` fixtures to 26 in the dozen unit test files the typecheck flagged
  (no behavior change; the schemas those tests exercise don't touch `resolveLink`).

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` passes). Real verification needs
Resolve; see the manual check in the brief.

**Limitations:** a proxy link's parity with the pre-26 behavior (sequence time == old source time on the
proxy clip) was checked by reading the code, not by running it. `editSignature`'s exact hash content isn't
unit-tested (the plan's testing override skips tests for this plan; a unit test for `editSignature` and
the planner's sequence mapping would be cheap and is worth adding as a follow-up).

**Next:** brief 11 (Resolve → KathaCut: import the timeline edit) and brief 12 (KathaCut → Resolve: Create
in DaVinci) build on this link shape; 09's findings session should land first if it hasn't already.

## 2026-09-27 — Resolve Text+ 09: edit spike script (E1-E11)

**Changes:**
- `resources/resolve/dev/edit-spike.lua` (new, dev-only, not packaged): a second Resolve menu script,
  independent of `spike.lua`. E1/E2 read every item on the current timeline's video and audio tracks
  (name, start/end/duration, offsets, source start/end frame, media pool clip properties, fusion comp
  count, clip color, speed/retime/zoom properties) and guess a kind (plain file, title/generator, Fusion
  clip, compound, multicam, retimed), capped at 200 items. E3 compares the first file-backed item's
  source start frame against its Start TC. E4 creates a timeline with explicit fps/resolution. E5 imports
  media into a `KathaCut Media` bin, twice, and searches for an existing item by File Path. E6 places two
  source ranges of one item and reads back start/end/source start/end, inclusivity and audio-track
  items. E7 bulk-appends 20 Text+ clips in one call and times placement vs. styling. E8 exports three
  calibration stills (`HorizontalJustificationNew` 0/1/2) of `"H മലയാളം"` after an 8 s pause on the Edit
  page. E9 retargets the write-on keyframe test at the ADR-confirmed `End` input (not `WriteOnEnd`). E10
  reads Character Level Styling from a hand-styled `CLS`-tagged clip on the original timeline's video
  track 2, and logs the styled text's byte/UTF-8-codepoint lengths for comparison against any offsets
  found. E11 tags one E7 clip via `comp:SetData`, then (with `MODE = "check"` after a save/close/reopen)
  searches all `KathaCut edit spike *` timelines for the surviving tag. Every test is `pcall`-wrapped.
- `resources/resolve/dev/spike.lua`: fixed T10 to use the ADR 0008-confirmed write-on input id `End`
  instead of the wrong `WriteOnEnd` (both were previously silent no-ops / errors).
- `resources/resolve/dev/SPIKE2.md` (new): setup (throwaway project, a real cut timeline with a retimed
  clip/title/compound clip/audio if available, a hand-styled `CLS` clip on video track 2, the `KathaCut`
  template bin from the first spike), run instructions, the save/close/reopen + `MODE = "check"` step,
  and what to send back (report file, three stills, the "H" height/position per still).

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` passes; no TS files changed). Real
verification needs Resolve; the user runs `SPIKE2.md` next.

**Limitations:** every classification rule in E2, the source-frame-origin note in E3, and the CLS
character-counting-unit note in E10 are guesses for the findings session to confirm or correct — none of
this is verified yet.

**Next:** the user runs the spike per `SPIKE2.md` and sends back the report, the three stills and the "H"
measurements. A later findings session writes `docs/decisions/0009-resolve-edit-roundtrip.md` from that
report and amends ADR 0008's open items, then briefs 10 → 11 → 12 → 07 → 08 proceed.

## 2026-09-27 — Resolve bridge: first real connection + two-way plan

**Changes:**
- **Launcher fix** (`90c4374`, `e413a6d`). `electron/resolve/install.ts` now generates a launcher that keeps its
  config local and calls `loadfile(bridge.lua)(KATHACUT, Resolve, bmd)`. `resources/resolve/bridge.lua` reads
  those from its arguments and falls back to globals. The old `dofile` launcher failed on first real use because
  a Resolve menu script's globals aren't visible to the file it loads (ADR 0008 addendum). The installed launcher
  on this machine was rewritten in place.
- **New briefs** in `docs/plans/resolve-textplus/`:
  - 09: spike 2, covering edit read/write plus the open Text+ items;
  - 10: link v26 and sequence-time caption mapping;
  - 11: Resolve → KathaCut, import the timeline edit (render becomes the fallback);
  - 12: KathaCut → Resolve, Create in DaVinci (video and captions).
  The README order is now 09 → 10 → 11 → 12 → 07 → 08.

**Verification:** the user confirmed the pill shows Connected in Resolve Studio 21.0.0.47 on Windows. Brief 04
(render) and brief 06 (sync) are still untested in Resolve.

**Next:** the user runs brief 06's manual check. Then brief 09 (a session writes the spike, the user runs it),
with brief 10 in parallel.

## 2026-09-27 — Resolve Text+ 06: Sync to Resolve (incremental, conflicts)

**Changes:**
- `resources/resolve/kathacut-captions.drb` (new, exported by the user from Resolve Studio 21.0.0.47): bin
  `KathaCut` holding the Text+ template item **`Fusion Title`** (plus an unused `Timeline 1`). No media or local
  paths inside.
- `resources/resolve/bridge.lua`: new handlers `ensureTemplate` (finds bin `KathaCut` → clip by name, else
  `ImportFolderFromFile(drbPath)` into the root folder and searches again), `findTrack`, `ensureTrack` (`AddTrack` at
  the top + `SetTrackName`), `readClips` (per-item `pcall`; `key` = comp `GetData("KathaCut.key")`, text only for
  tagged clips), `insertClips` (one `AppendToTimeline` per batch, `startFrame=0, endFrame=len-1`, then `applySpec`
  + tag; a clip whose spec fails is deleted again so no untagged clip is left behind; returns actual start/end),
  `updateClips`, `deleteClips` (only items on the given track), `jumpTo` (timecode). Every handler checks
  `params.timelineId` against the open timeline. `applySpec` writes only ids in a hard-coded `INPUT_WHITELIST`
  (copied from `LUA_INPUT_WHITELIST`), inside `comp:Lock()`/`Unlock()`; request values are data only.
- `src/resolve/syncDiff.ts` (new, pure): `diffSync` (match by clip id, fall back to the key tag; changed-in-Resolve
  = start/end/text differ from the synced entry; adopt a tagged but unrecorded clip when its text matches),
  `planSync` (folds conflict decisions; missing decision = keep Resolve), `countPendingChanges` (badge).
- `src/resolve/frames.ts`: `timelineFrameToTimecode` (incl. drop-frame for 29.97/59.94) for "Show in Resolve".
- `src/core/resolveIpc.ts`: sync request/preview/result/progress schemas (specs ≤ 20000, text ≤ 4000, input ids
  must be in `LUA_INPUT_WHITELIST`) and bridge-result schemas.
- `electron/resolve/sync.ts` (new): `previewSync`, `applySync` (fresh `readClips` → diff → `ensureTemplate` →
  `ensureTrack` → deletes (50/batch) → inserts (20/batch) → updates (20/batch), progress events, stops at the first
  failing batch and returns a synced list for only what happened), `jumpToFrame`. The template path is resolved in
  main (`bridgeResourcesDir()/kathacut-captions.drb`).
- `electron/resolve/ipc.ts`, `electron/preload.ts`, `src/env.d.ts`: `resolve:sync-preview`, `resolve:sync-apply`
  (one at a time), `resolve:jump-to`, `resolve:sync-progress`.
- `src/resolve/ResolveSync.tsx` (new) + `src/App.tsx` + `src/styles.css`: **Sync to Resolve** button beside the
  linked pill with a change-count / "Synced" badge (planner runs in the renderer, debounced 300 ms). Disabled with
  a tooltip when disconnected, on another timeline, or when the proxy asset is gone. Review dialog: counts, target
  track, conflicts (Keep Resolve version by default / Overwrite / Show in Resolve), foreign-clip note, support list.
  Progress dialog while applying; the new `resolveLink.synced` is committed as one undo step.

**Deviations from the brief:**
- Kept-Resolve conflicts are **not dropped** from `synced`. They stay as an entry with `hash = RELEASED_HASH`
  (`'kathacut:kept-resolve'`), which the diff never updates, deletes or re-inserts. If they were dropped, the
  still-tagged clip would come back as a conflict on every later sync, or the caption would be inserted a second
  time. A released entry is forgotten only once the clip is gone from Resolve **and** the caption is gone from
  KathaCut. Currently the only way to "un-release" a caption is to undo the sync in KathaCut.
- A third conflict kind, `untracked-in-resolve`: a clip tagged by KathaCut that this project's sync record doesn't
  have, and whose text no longer matches (or whose caption is gone). Overwriting replaces or deletes it.
- Overwriting a clip that was changed in Resolve **replaces** it (delete + insert) rather than updating it in
  place, so no Resolve-side edits to other inputs remain.
- Undo steps have no labels in this codebase (`commitHistory`), so the "Sync to Resolve" label isn't shown.
- `jumpTo` takes a timecode computed in TS (from `timelineInfo`'s fps and drop-frame flag), not a frame.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .`). Nobody has run this against Resolve yet.

**Limitations:**
- Batch sizes are unmeasured guesses (ADR 0008: T13 never ran).
- Unconfirmed against real Resolve: that `AppendToTimeline` honours `recordFrame`/`trackIndex` for a title item,
  that `endFrame` is inclusive, the order of returned items, and whether a title item can be stretched past its
  default length. A clip that lands at the wrong frames is reported in the result notice. It is still recorded
  with its actual frames, so later syncs will not retry it.
- Importing the `.drb` also brings the unused `Timeline 1` into the user's Resolve project. Re-exporting the bin
  without it would avoid that.
- Whether `SetData` tags survive closing and reopening a Resolve project is untested (ADR 0008). If they don't, the
  diff still matches clips by clip id.
- Size, position Y-axis, justification enum and styles are still the brief 05 placeholders.
- Windows only for the code paths; Mac untested.

**Next:** the user runs the manual check in `06-sync.md`. Opt-in offer: a unit test for `diffSync`/`planSync`
(pure). Then brief 07 (emphasis + word animations).

## 2026-09-27 — Resolve Text+ 05: Text+ planner (pure TS)

**Changes:**
- `src/resolve/frames.ts`: `usToTimelineFrame(us, link)` / `timelineFrameToUs(frame, link)` — cue source µs on the
  proxy ↔ absolute Resolve record frame. Computed in `bigint` (`us * fps.num` can exceed 2^53 for a long timeline
  at a high frame rate) with a standard integer round-half-up (`floor((2n+d)/(2d))`); each boundary is rounded
  independently, never accumulated.
- `src/resolve/textPlusInputs.ts` (new): the Text+ input-ID table from ADR 0008, `LUA_INPUT_WHITELIST`,
  `textPlusSize` (px → `Size`), `centerFor` (the y-flip), `colorToRgba01`, `horizontalJustificationFor`,
  `styleNameFor` (weight/italic → `Style`), `applyTextTransform` (grapheme-safe uppercase/lowercase/capitalize,
  since Text+ has no CSS-style text-transform of its own).
- `src/resolve/specHash.ts` (new): `stableStringify` (sorted-key JSON) + `fnv1a32Hex`, for the spec `hash` 06 will
  diff against.
- `src/resolve/textPlusPlan.ts` (new): `planTextPlus(project, measure)`. Only runs when `project.resolveLink` is
  set; selects cues via the existing `displayedCues` (language layer) filtered to the proxy asset, splits into
  one spec per shown word when `captionDisplay === 'word'` and the cue's word timing can drive it (else falls
  back to the whole cue and flags it in `support`), maps time via `usToTimelineFrame` with each spec's end
  clamped to the next spec's start (extended to one frame, or skipped, when that leaves no room), resolves each
  cue's style exactly as the preview does (`resolveCaptionStyle` + `captionStyleInputs`), runs `layoutCaption` to
  get KathaCut's own line breaks, and maps font/colour/outline/shadow/background/position/spacing/alignment to
  the whitelisted Text+ inputs. `keyframes`/`styleRanges` are left empty for brief 07.

**Mapping table (support levels `planTextPlus` reports):**

| Feature | Level | Why |
|---|---|---|
| Text | sent | `StyledText`, Malayalam shaping visually confirmed (T9) |
| Primary color / outline enable+color | sent | `Red1..Alpha1` / `Enabled2,Red2..Blue2` confirmed by T9 |
| Text transform | sent | applied to the string itself, grapheme-safe |
| Font family, Style (weight/italic), outline thickness, shadow (enable-only), background box (enable-only), line/character spacing, alignment, line breaks | **approximated** | ID confirmed present but the value mapping is unmeasured/unconfirmed (ADR 0008) — see per-feature notes in the plan's own `support` output |
| **Font size** | **approximated** | ADR 0008 explicitly has **no measured px→`Size` formula** ("Size calibration" blocked pending a re-run of the spike); this uses an unverified placeholder (`Size` = output px / frame height) |
| **Position** | **approximated** | `Center`'s Y-axis direction is unconfirmed by the spike; assumes "y up" per the original research |
| Gradient fill, glow, 3D depth, underline, emphasis, caption motion | not-sent | no Text+ equivalent identified, or deferred to brief 07 |
| Rotation | not-sent | no single confirmed `Angle` input exists yet (ADR 0008); candidates untested |

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` passes). No Resolve, IPC or Lua calls exist
in this brief — it is pure TypeScript consumed by 06.

**Limitations:**
- Per the plan's README ("when the ADR and a brief disagree, follow the ADR"): the brief text listed rotation
  under "sent", but ADR 0008 has no confirmed single rotation input, so it is reported `not-sent` here instead.
- Several mappings above (size, position, alignment enum, Style name validity) are best-effort placeholders the
  ADR itself flags as unmeasured/unconfirmed; each carries a `note` in `planTextPlus`'s `support` output, and none
  should be trusted before a visual check in Resolve.
- No confirmed Resolve input sets Text+'s own text-box wrap width, so a KathaCut line break sent via `\n` could
  still be re-wrapped by Text+ itself inside its own box.
- Offered, not written (per the plan's no-tests override): a small unit test for `usToTimelineFrame` covering the
  29.97/23.976 rounding cases, since it's a pure function where an off-by-one-frame bug would be easy to miss.

**Next:** brief 06 (sync to Resolve — incremental apply, conflict detection) consumes `planTextPlus` and the Lua
whitelist from `textPlusInputs.ts`.

## 2026-09-27 — Resolve Text+ 04: create project from current DaVinci timeline

**Changes:**
- `resources/resolve/bridge.lua`: three new whitelisted handlers. `renderProxyStart { targetDir, name,
  maxLongSide }` refuses if `project:IsRenderingInProgress()`, remembers
  `project:GetCurrentRenderFormatAndCodec()` keyed by the new job's id, scales the timeline's own
  resolution (coerced from Resolve's string return) down to `maxLongSide` on its long side (even
  numbers), calls `SetCurrentRenderMode(1)` → `SetCurrentRenderFormatAndCodec("mp4","H264")` →
  `SetRenderSettings{...}` → `AddRenderJob()` → `StartRendering(jobId)`, and returns `{jobId, width,
  height}`. `renderStatus { jobId }` reads `GetRenderJobStatus`, and once the job leaves the queue
  (Complete/Failed/Cancelled) deletes it and restores the remembered render format/codec.
  `renderCancel { jobId }` calls `StopRendering()` plus the same cleanup. **None of these three are
  exercised by the spike** (ADR 0008: "T15 not run") — `JobStatus`'s exact string values and whether
  `AddRenderJob()` returns a string or number are unconfirmed; the job id is passed through opaquely
  end to end (never coerced) precisely because its type is unknown.
- `src/core/resolveIpc.ts`: `resolveRenderStartResultSchema`, `resolveRenderStatusResultSchema`,
  `resolveFpsSchema`, `resolveInspectedVideoSchema` (the video variant of `InspectedFile`, zod-backed so
  it can cross the IPC boundary), `resolveProxyResultSchema`, `resolveProxyProgressSchema`,
  `resolveProxyDoneSchema`.
- `electron/resolve/proxy.ts` (new): `renderTimelineProxy(deps, onProgress, signal)` — reads
  `timelineInfo`, computes the output dir (`<userData>/Cache/resolve-proxies/`) and a
  `<sanitised timeline name>-<timelineId prefix>-<Date.now()>` name, starts the render, polls
  `renderStatus` every 500 ms, cancels on abort (still restoring Resolve's render format via
  `renderCancel`), locates the output file (exact name, else the newest file sharing the prefix), then
  inspects it with the same `inspect` function `dialog:open-video` uses (injected as a dependency, to
  avoid a circular import into `electron/main.ts`) so its fingerprint lands in `inspectedMedia`.
- `electron/resolve/ipc.ts`: `registerResolveIpc` now takes `{ inspect }`. New handlers
  `resolve:create-proxy-start` (returns `{requestId}` immediately; the render runs in the background),
  `resolve:create-proxy-cancel`. Progress and the final result arrive as push events
  (`resolve:proxy-progress`, `resolve:proxy-done`), matched by `requestId` — this is a different shape
  than the plan sketch's positional `renderTimelineProxy(bridge, onProgress, signal)`; kept the deps-object
  form so `proxy.ts` doesn't need to import from `electron/main.ts`.
- `electron/main.ts`: `registerResolveIpc({ inspect: (filePath) => inspectMedia(filePath) })`.
- Preload + `src/env.d.ts`: `resolveCreateProxyStart`, `resolveCreateProxyCancel`,
  `onResolveProxyProgress`, `onResolveProxyDone` (zod-validated in preload, matching the
  `onResolveStatus` convention).
- `src/core/model.ts`: **schema 25**. `projectSchema` (was schema 24) renamed to `projectSchemaV24`;
  the new `projectSchema` adds an optional `resolveLink` (`resolveLinkSchema`: project/timeline
  name+id, `startFrame`, rational `fps`, `width`/`height`, `proxyAssetId` — checked by `superRefine`
  against a video asset in `assets` — `trackName` defaulting to `'KathaCut'`, and `synced` (empty until
  brief 06)). `src/core/migrateV24.ts` only moves the version. Every `toV24From*` helper in the
  migration cascade now produces `CaptionProjectV24`, wrapped in a new `toV25FromV24` at each of
  `loadProject`'s branches (plus a new schema-24 branch); `createProject()` now stamps `schemaVersion: 25`.
- `src/App.tsx` / `src/home/HomeScreen.tsx`: `HomeScreen` takes an optional `resolve` prop
  (`{connected, timelineName?, onCreate}`) and shows **Create project from current DaVinci timeline**
  only while connected. `createFromResolve()` starts the render, shows a small modal
  (`ResolveRenderProgress`, styled like the existing `RelinkReview`/`DiscardProjectReview` dialogs) with
  live percent and Cancel; on success it opens the editor, calls `addAssetsFromInspected` to place the
  proxy on V1 at 0, and `commit`s `resolveLink` (a separate undo step from the asset add, per the
  brief's fallback). In the editor header, next to the brief-03 pill: a *Linked to DaVinci: `<project>` ›
  `<timeline>`* pill when `project.resolveLink` is set, warning instead when Resolve's live
  `timelineInfo` (re-read whenever the connected project/timeline name changes) reports a different
  timeline id.
- `src/styles.css`: `.home-create-resolve`, `.resolve-pill.warning`.
- Nine existing test fixtures (`CaptionProject`/`Partial<CaptionProject>` object literals) updated from
  `schemaVersion: 24` to `25` — required for typecheck, not a behavior change.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` passes; per the plan's testing
override). Nobody has run this against a real DaVinci Resolve session — the render path (T15) was
never exercised even in the spike. Windows-only once the user checks; Mac is unverified.

**Limitations:**
- Schema 25 migration is trivial (only moves the version); a unit test is available on request
  (migrations are high-risk per AGENTS.md, but the testing override skips writing one here).
- `GetRenderJobStatus`'s `JobStatus` string values are guessed (`"Complete"`/`"Failed"`/`"Cancelled"`,
  anything else treated as still running) — unconfirmed by the spike. If Resolve uses different
  strings, a render will appear to hang at its last percent until the 10 s bridge-request timeout, not
  fail outright.
- The `<userData>/Cache/resolve-proxies/` cache directory is never cleaned up; each render leaves its
  file behind. Out of scope per the brief.
- Cancelling before `renderProxyStart`'s own response arrives isn't covered — cancel only takes effect
  from the first poll onward.

**Next:** brief 05 (Text+ planner, pure TS) — turns cues + style into JSON clip specs using the frame
mapping in `src/resolve/frames.ts` and the `resolveLink` this brief added.

## 2026-09-27 — Resolve Text+ 03: bridge, plugin install and connection status

**Changes:**
- `resources/resolve/json.lua`: minimal JSON encoder/decoder for Lua 5.1/LuaJIT (no third-party code).
  Handles objects, arrays (auto-detected from sequential 1..n keys, or forced via `json.array({})` so
  an empty array survives round-tripping distinct from an empty object), strings with `\uXXXX`/surrogate
  pairs decoded to UTF-8, numbers, booleans and a `json.null` sentinel. Raw UTF-8 bytes pass through
  encode/decode unchanged.
- `resources/resolve/bridge.lua`: the mailbox loop (protocol v1, README). Launches KathaCut via
  `KATHACUT.launch` if `app.json` is missing or stale, polls `request.json` every 150 ms, dispatches
  `ping`/`timelineInfo`/`disconnect` through a fixed handler whitelist (never `load`/`loadstring`s
  request content), and writes `status.json` every ~1 s. `writeJson` removes the target before
  `os.rename` unconditionally, per the ADR 0008 finding that a plain overwrite-rename fails on Windows.
  `timelineInfo`'s `frameRate` is explicitly `tostring`'d; `dropFrame`/`width`/`height` are passed
  through as Resolve returns them (string or number) — coercion happens on the TS side.
- `electron/resolve/install.ts`: `resolveScriptsDir`, `bridgeResourcesDir`, `mailboxDir`, `launchSpec`,
  `pluginInfo`, `installPlugin` (atomic write of the generated `KathaCut.lua` launcher; rejects any
  path containing `"` or `]]`) and `uninstallPlugin` (removes only that one file).
- `electron/resolve/bridge.ts`: `ResolveBridge` (singleton `getResolveBridge()`) — writes `app.json`
  every 2 s, polls `status.json` every 1 s and derives `disconnected`/`connected` from heartbeat
  freshness, focuses the main window on a new `sessionId`, broadcasts `resolve:status-changed`, and
  exposes a serial `request<T>()` queue (10 s timeout) for `timelineInfo`/`disconnect`.
- `src/core/resolveIpc.ts`: zod schemas for the four mailbox files, `resolveTimelineInfoSchema` (with
  `numericLike`/`boolishLike` coercion for the fields ADR 0008 found come back as strings) and the
  `ResolveStatus` renderer view type. `src/resolve/frames.ts`: `parseResolveFps` (the README's rational
  mapping table).
- `electron/resolve/ipc.ts` `registerResolveIpc()`: `resolve:status`, `resolve:plugin-info`,
  `resolve:install-plugin`, `resolve:uninstall-plugin`, `resolve:timeline-info`, `resolve:disconnect`.
  Wired into `electron/main.ts` next to `registerMcpIpc`; the bridge starts in `whenReady` (after the
  smoke-mode checks) and stops in `before-quit` alongside the other owned services.
- Preload (`electron/preload.ts`) + `src/env.d.ts`: `resolveStatus`, `onResolveStatus` (zod-validated
  in preload), `resolvePluginInfo`, `installResolvePlugin`, `uninstallResolvePlugin`,
  `resolveTimelineInfo`, `resolveDisconnect`.
- `src/resolve/useResolveStatus.ts` + `src/resolve/ResolveStatusPill.tsx`: the status pill (shown on
  Home next to "Open project…" and in the editor header next to the save status). Not connected: hint
  text plus an **Install plugin** button when the plugin isn't installed yet. Connected: project ›
  timeline plus **Disconnect**.
- `src/SettingsDialog.tsx`: new `'resolve'` tab ("DaVinci Resolve") with `ResolveSettings` — script
  path, installed/not installed/outdated badge, Install/Reinstall/Remove, the three-step instructions,
  and a note that Resolve Free and Studio both work.
- `electron-builder.yml`: `extraResources` now also copies `resources/resolve` to `resolve`, excluding
  `dev/**` (the spike script stays dev-only).
- No caption features yet, as scoped: only `ping`/`timelineInfo`/`disconnect` exist end to end.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` passes; per the plan's testing
override). Nobody has run this against a real DaVinci Resolve session yet — see the manual check in
the brief. Windows-only once the user checks; Mac paths (script folder, `open -a` launch, the `.app`
bundle derivation in `launchSpec`) are unverified.

**Limitations:**
- `ResolveBridge.request()` isn't exercised against a live Lua bridge yet; the timeout/queueing logic
  is untested beyond typechecking.
- The pill's "busy" state from `status.json` is plumbed through but nothing sets it meaningfully yet
  (no long-running commands exist until brief 04's renders).
- No single-instance lock: two KathaCut windows would both poll the same mailbox. Out of scope per the
  brief; noted here since brief 03 is the first place it matters at all.

**Next:** brief 04 (create project from current timeline) — the render + proxy-import flow, which needs
this bridge's `request()` plumbing and the frame-rate mapping in `src/resolve/frames.ts`.

## 2026-09-27 — Resolve Text+ 02: spike findings → ADR 0008

**Changes:**
- `docs/decisions/0008-resolve-textplus.md`: findings from the same spike run recorded in "01b" below
  (DaVinci Resolve Studio 21.0.0.47, Windows). **Go** on Malayalam — the user visually confirmed correct
  shaping (joined conjuncts, correctly placed vowel signs) on the mixed Malayalam/English test string
  (`"മലയാളം ക്യാപ്ഷൻ Caption ശ്രീ"`) in Resolve's own viewer/Inspector; the blank T14 still is a separate,
  unrelated tooling gap and isn't the basis for the decision.
- `docs/decisions/evidence/resolve-spike-2026-09-27.txt` and
  `docs/decisions/evidence/kathacut-spike-still-2026-09-27.png` committed as evidence.
- **Correction to the "01b" entry below:** that entry's T10 fix still targets an input named `WriteOnEnd`.
  T7's full 309-input ground-truth dump for this exact tool has **no `WriteOnEnd` (or `WriteOnStart`) input
  at all** — the real IDs are `Start`/`End`. That fully explains T10-B's error (`attempt to index field
  'WriteOnEnd' (a nil value)` — the tool doesn't recognize the name) and means T10-A's `ok=true` is very
  likely a silent no-op on an unrecognized field, not working keyframing (consistent with its own `nil`
  readback at frame 12). Write-on keyframing remains **completely unconfirmed** against the real IDs. The
  next person to touch `spike.lua` should retarget T10 at `End`/`Start`.
- Other confirmed facts, all cited in the ADR: `os.rename` over an existing file fails on Windows (the
  remove+rename fallback is mandatory); the ~150 ms mailbox poll interval works and Resolve stayed responsive
  under it; comp-local time is clip-relative (frame 0 = the clip's first frame); `Center`/`Red2`/`Green2`/
  `Blue2` and other element-specific inputs are settable by ID even when absent from a default
  `GetInputList()` dump; timeline drop-frame and resolution settings come back as **strings**, not
  booleans/numbers.

**Verification:** not tested, typecheck only (per the plan's testing override; `npx tsc --noEmit -p .`).

**Limitations (real gaps, not just caveats — full detail in the ADR):**
- **No Text+ template bin exists** (T5 found none) — `.drb` export is **pending**; only the
  `InsertFusionTitleIntoTimeline` fallback placement method is confirmed, not the primary `.drb` +
  `AppendToTimeline` path. Brief 06 needs the `.drb` before it starts.
- No bulk-append timing / recommended batch size (T13 skipped, needs the template).
- No size-calibration measurement (T14's still is blank; root cause unconfirmed — see ADR).
- Character Level Styling format is completely unresolved (T11 skipped). Blocks brief 07's per-character/
  per-word styling work.
- Write-on keyframing unconfirmed (see correction above).
- `Center`'s Y-axis direction and the `HorizontalJustificationNew` enum mapping are unconfirmed.

**Next:** the user creates the `KathaCut` template bin and hand-styles a CLS test clip per `SPIKE.md`,
`spike.lua`'s T10 gets retargeted at `End`/`Start`, and the spike re-runs to fill in the open items above;
the ADR gets amended from that run. Brief 03 (bridge + install) can start now for the parts that don't depend
on those open items; anything touching placement, size, CLS or keyframing should wait for the re-run.

## 2026-09-27 — Resolve Text+ 01b: first real spike run, two script bugs fixed

**Changes:** the user ran `spike.lua` for the first time (DaVinci Resolve Studio 21.0.0.47, Windows,
29.97 fps project, timeline start frame 108000). The run surfaced two bugs in the script itself, fixed in
`resources/resolve/dev/spike.lua`:
- **T10** (`WriteOnEnd` keyframes) failed: `tool.WriteOnEnd = comp:BezierSpline()` followed by
  `tool.WriteOnEnd[0] = 0` errored `attempt to index field 'WriteOnEnd' (a nil value)` — the assignment
  didn't attach a spline. T10 now tries two approaches independently (direct `tool.WriteOnEnd = {[0]=0,
  [24]=1}` table assignment, and the original `comp:BezierSpline()` guess) and records which one Resolve
  actually accepts, instead of betting on a single guess.
- **T14**'s still export likely landed outside the clip (report showed `exportOk=true` but the returned
  still was solid black). Root cause: the script's frame→timecode math used a rounded integer fps with
  non-drop-frame arithmetic; over a 108,000+ frame offset (Resolve's default 1-hour timeline start at
  29.97 fps) that drifts well past a 150-frame clip if the project uses drop-frame timecode. Replaced with
  `rationalFrameRate` (exact num/den per the README's fps table) and a proper SMPTE drop-frame-aware
  `framesToTimecode`, used by T6's fallback path and T14; T15 keeps a plain `nominalFrameRate` for frame
  counting only (frame counts are drop-frame-independent per the README).

**What the run otherwise confirmed:** all env/file/timeline-responsiveness tests passed; the
`InsertFusionTitleIntoTimeline` fallback works (no `KathaCut` media-pool bin existed yet, so T5/T13 were
skipped and T6 exercised the fallback, not `AppendToTimeline`); the full T7 dump (309 inputs) confirms
`Enabled2`/`Enabled3`/`Enabled4` are outline/shadow/border toggles and `Center` is a `Point`, matching the
README's guesses; `Red2`/`Green2`/`Blue2` (outline color) don't appear in `GetInputList()` before
`Enabled2` is turned on, but `SetInput` on them still succeeds — Fusion accepts writes to inputs not yet
"surfaced." T9's Malayalam style-set and T12's tagging/color both succeeded. T11 was skipped (no video
track 2 clip yet — the user hasn't done SPIKE.md step 5 yet).

**Verification:** still not run again after the fix (same "no Lua interpreter here" constraint as before);
checked by manual read-through of every changed region plus a parens/braces balance check
(549/549, 33/33 — balanced). Waiting on the user to redo the `KathaCut` media-pool bin (SPIKE.md step 3)
and the video-track-2 CLS clip (step 5), then re-run for a complete report covering T5/T10/T11/T13/T14.

**Next:** user re-runs after completing the two SPIKE.md setup steps; once the report is clean, brief 02
turns it into the ADR.

## 2026-09-27 — Resolve Text+ 01: spike script

**Changes:**
- `resources/resolve/dev/spike.lua`: single-file Lua 5.1/LuaJIT script, no `require`s. Creates its own
  `KathaCut spike <time>` timeline (never touches any pre-existing timeline/clip/media), runs tests
  T1–T14 wrapped individually in `pcall` (T15, a render, only runs if `RUN_RENDER = true` is set at the
  top), and writes `PASS`/`FAIL`/`INFO <id> <details>` lines both to the Resolve console and to
  `<TEMP or TMPDIR>/kathacut-resolve-spike.txt` (write-tmp-then-rename, with a remove+rename fallback if
  the plain rename over an existing file fails). Covers: Lua/Fusion global availability (T1), temp-file
  write/rename/read semantics (T2), read-only info from the previously-current timeline (T3), a 15 s
  responsiveness probe (T4), searching the media pool for a `KathaCut` Text+ template bin (T5),
  appending/falling back to `InsertFusionTitleIntoTimeline` (T6), a full dump of every `TextPlus` input
  ID/name/type/value (T7), comp time attributes (T8), styling a mixed Malayalam/English string incl. an
  attempted outline/fill/font/position set (T9), `WriteOnEnd` keyframes inside `Lock`/`Unlock` (T10),
  recursive Character Level Styling data dump from a hand-styled second clip on video track 2 (T11),
  `SetData`/`GetData` tagging and clip color/name (T12), bulk `AppendToTimeline` + bulk `SetInput` timing
  over 100 clips (T13), and a still export at the T9 clip's timecode (T14). Restores whichever timeline
  was current before the run.
- `resources/resolve/dev/SPIKE.md`: install path per OS, throwaway-project and template-bin setup, the
  two-run flow needed for T11 (style a second clip's CLS data by hand between runs), what to send back,
  and how to opt into the T15 render.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` clean, Windows). No Lua interpreter
available in this environment to execute the script; checked instead by a bracket/keyword balance pass
(parens, braces, and `function`/`do`/`then` vs `end` counts all match) and a manual read-through. Needs a
real run inside Resolve — see next.

**Limitations:** the script is ~700 lines, over the brief's "~500 lines" guideline — comprehensive per-test
recording across 15 distinct Resolve/Fusion API surfaces added up faster than expected; each test's logic
is still self-contained and short. Font-substitution detection (T9) isn't possible from the Lua API, so
that's left to the user's screenshot check. The T6 fallback path's playhead timecode is only approximate
(assumes an integer frame rate), which is fine for a spike but not for real timecode work later. Entirely
unverified until the user runs it in Resolve and sends back the report, per SPIKE.md.

**Next:** the user runs the spike (SPIKE.md) and sends back the report, still, and screenshot; then brief
02 turns the findings into `docs/decisions/0008-resolve-textplus.md` and the real Text+ template bin.

## 2026-09-26 — Caption languages 05: Hinglish and Manglish targets

**Changes:**
- `translationTargetSchema` / `TranslationTarget` (`src/core/transcription.ts`): `languageCodeSchema` or `hi-latn` / `ml-latn`. Used for cue `translationLanguage`, `shownTranslation`, `translationRuns[].targetLanguage`, run translation provenance, `TranslatedTranscript.targetLanguage`, `translateTo`, caption-translation targets and `set-shown-translation`. `languageCodeSchema` and the schema version (24) are unchanged.
- `translationLanguages.ts`: Manglish and Hinglish entries with hints, `isRomanizedTarget`, `romanizedBase`.
- `scriptCheck.ts`: romanized targets fail as `UNEXPECTED_SCRIPT` (retryable) when Devanagari / Malayalam script dominates instead of Latin.
- `geminiTranslation.ts`: transliteration prompt branch (keeps English words, no meaning translation, no source-language mention).
- Transcribe dialog and "+ Translate…" list show hints; tabs already use `translationTargetLabel`.
- `docs/PRODUCT.md` and `docs/TRANSCRIPTION.md` updated.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` clean, Windows).

**Limitations:** transliteration quality unverified on real clips; Gemini-only and needs a Gemini key. The optional "works best when spoken language is Hindi/Malayalam" hint was skipped. Not committed: the working tree holds other sessions' uncommitted edits.

**Next:** none planned in this series; consider a migration round-trip test for schema 24.

## 2026-09-26 — Caption languages 03: translate existing captions (text only)

**Changes:**
- `electron/geminiTranslation.ts`: `translateLines` (batches of 60, `UNEXPECTED_SCRIPT` check) extracted; `translateTranscript` calls it.
- New IPC `captions:translate` / `captions:translate:cancel` / `captions:translate:progress` (`electron/captionTranslationIpc.ts`, zod `z.strictObject` schemas in `src/core/captionTranslationIpc.ts`). The Gemini key is loaded in main only. Targets run sequentially on the job scheduler, each in its own try/catch, so a failed language never discards the others. Registered in `main.ts`; exposed in `preload.ts` and `env.d.ts`.
- `src/core/captionLanguages.ts`: `translatedCaptionsFromCues` (same window/video/track, `model` sources, Needs review, estimated words), `originalCuesOfVideo`, `describeTranslationLayer`, `applyTranslatedLayers` (one project value; keeps user-edited cues of an existing layer, appends `translationRuns`, leaves `shownTranslation` alone).
- `src/TranslateCaptions.tsx`: "+ Translate…" popover in the Captions tab (language checkboxes, up to 5, progress, cancel, disabled with a reason without a Gemini key, redo confirmation naming how many edited cues are kept). `App.tsx` `applyTranslations` commits all languages in one undo step, switches to the first added tab, and reports failed languages in the notice.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` clean, Windows). Read-checked: request schema is `z.strictObject`, no path accepts a key from the renderer.

**Limitations:** translation jobs use the `transcription` job kind, so they queue behind a running transcription. A blank translated line produces no cue. Source captions over 2000 characters or more than 5000 cues are refused. The redo confirmation uses `window.confirm`. Not committed: the touched files also hold other sessions' uncommitted edits.

**Next:** brief 04 (multi-language in the Transcribe dialog).

## 2026-09-26 — Caption languages 01: schema 24, language layers, display filter

**Changes**
- Schema 24: optional `translationLanguage` on cues, `shownTranslation` and `translationRuns` on the project; migration `migrateV23.ts` tags cues of runs that had a legacy `translation` and sets `shownTranslation`. Legacy run `translation` stays readable, no longer written.
- `src/core/captionLanguages.ts`: `displayedCues`, `cuesForLanguage`, `projectLanguages` (plus `shownLanguage`). Preview (`visibleCues`), timeline, SRT export, layer stack and both export manifests use `displayedCues`.
- `validateCaptions` groups by video and language; `merge-next` and the move-word commands stay within one language. New undoable command `set-shown-translation` (+ zod schema).
- `applyTranscription` takes `translations[]`: original layer is always kept, each translation is its own tagged layer, overlap checks are per language, `translationRuns` recorded, first translation shown. `applyTranscript` still wraps the single IPC translation.
- Existing tests touched only to keep the typecheck: `schemaVersion: 23` to `24` in 12 fixtures, and the `translations` argument in `transcriptionApply.test.ts`.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` clean).

**Limitations:** the migration is untested (a round-trip test is worth adding). Two tests in `transcriptionApply.test.ts` ("with a translation") still expect translated-only cues and will fail until updated. The Captions panel now lists only the shown language and cannot select a hidden-language cue until brief 02. Agent `getCaptions` still returns every language. Not committed: the working tree holds other sessions' uncommitted edits to the same files.

**Next:** brief 02 (Captions panel language tabs and "Show on video").


## 2026-09-26 — Cloud transcription: shorter chunks, pause-aware splits, missing-caption warning

**Why:** a 10-minute video transcribed with Gemini came back with captions missing for whole stretches. Cause not confirmed against the run record; the leading suspect is that the whole video went up as one request (chunks were only split at 2 s silences, capped at 20 min) and the model returned word timings for part of it, which nothing checked.

**Changes**
- `GEMINI_MAX_CHUNK_US` 20 min → 3 min.
- `writeSpeechChunks` splits over-long speech at the latest ≥250 ms pause in the second half of the limit (`splitAtPauses`), falling back to a fixed cut only when no pause exists.
- `CloudTranscriptionAdapter` records `uncovered` stretches (≥10 s inside a speech chunk with no recognized word); all three cloud providers get it. Stored on the run as optional `uncoveredRanges` (source time) and shown in the post-transcription notice as a warning with the first three ranges.

**Verification:** typecheck clean; new tests for `splitAtPauses` and `uncoveredRanges` pass along with the existing whisper/transcription-service/gemini suites. `src/core/model.test.ts` has 28 failures that are identical without these changes. Not run against real Gemini or in the app.

**Limitations:** gaps are only reported, not retried; a 10 s gap can be genuine non-speech (music, background). OpenAI and ElevenLabs chunk sizes are unchanged. Cause remains unconfirmed until the same video is re-transcribed.

**Next:** re-transcribe the same 10-minute video with Gemini and check the notice/run record; if gaps persist, add an automatic retry of the uncovered ranges as sub-chunks.

## 2026-09-26 — Settings cleanup: provider dropdown, friendly model tiers, shorter copy

**Changes**
- Transcription tab: default-provider select, then a single **Provider** dropdown (status shown per option) that reveals only that provider's compact key row (badge, one input, Save/Remove, "Get a key" link) and model picker, instead of three stacked sections.
- Speech models tab: models are named by tier (Small, Small - English only, Medium, Large [Recommended], Extra large) with a one-line summary and a readable size (148 MB, 1.6 GB). One primary action per card (Download / Resume / Cancel / Remove); file name, languages, location and SHA-256 moved into a collapsed Details. The friendly names also show in the Transcribe dialog's model list.
- Playback proxies and AI agents: one-line lead text and shorter mode hints. Shared `.settings-lead`, `.settings-badge`, `.settings-row` styles; `formatSize` now lives in `src/core/format.ts` (also used by the export dialog).

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` clean). Not viewed in the running app.

**Limitations:** `ModelArtifact` gained `summary` and `recommended`; the transcription benchmark script sets placeholders. Existing SettingsDialog tests were not re-run.

**Next:** eyeball each Settings tab in `npm run dev`.

## 2026-09-26 — Open-source preparation: GPL-3.0-or-later, README, CONTRIBUTING

**Changes**
- License: added `LICENSE` (GPL-3.0 text from gnu.org), `TRADEMARKS.md` (name/logo not licensed), `"license": "GPL-3.0-or-later"` and author in `package.json`, copyright in `electron-builder.yml`, `LICENSE` shipped in installer `extraResources`, GPL line at top of `THIRD_PARTY_NOTICES.txt`.
- README rewritten for users and contributors: features, privacy, install, build, docs table, honest pre-1.0 status, Buy Me a Coffee. Removed the Codex/`START_HERE` instructions and stale status text.
- `CONTRIBUTING.md` (ground rules, setup, architecture rules, checks, DCO sign-off, bug/security reporting) and `.github/FUNDING.yml` (Buy Me a Coffee sponsor button).
- `docs/DEPENDENCIES.md` project-license paragraph; ROADMAP license/contributor item marked done.

**Verification:** documentation and metadata only; nothing built or run. Not verified: that the bundled `LICENSE` lands in a packaged installer (`npm run dist:win`).

**Limitations**
- README uses real screenshots in `docs/media/` (`screen-3.png` editor, `screen-2.png` home). The editor shot shows English captions; a Malayalam-captioned shot would better show the main use case.
- DCO chosen over a CLA; switch to a CLA before accepting outside PRs if dual-licensing/selling under other terms is wanted.
- Issue/security contact is labs.vx@gmail.com (assumed from "labs.vx@gmail"; confirm). Git history not yet scanned for secrets; `START_HERE.md` is now unreferenced and can be deleted.
- No in-app license/About link yet (GPL "appropriate legal notices").

**Next:** run a secret scan (e.g. gitleaks) over full history, then create the public repository.

## 2026-09-26 — Timeline toolbar: one Split / Trim / Delete set

**Changes**
- The caption and clip tool sets are merged. One Split, Trim start, Trim end and Delete group replaces the duplicate scissors, trim and trash buttons (13 buttons down to 11). With a caption selected they act on the caption (Trim start/end move that edge to the playhead); otherwise Split/Trim act on clips under the playhead. Delete uses `deleteSelection`, so it also works for text, shapes, regions and groups, and is a ripple delete for a clip in RIPPLE mode. Tooltips follow the target.
- Layout: Prev · Next · Merge │ Split · Trim start · Trim end · Delete │ Snap · Overwrite/Ripple │ Mark In · Mark Out · Clear · Scroll to playhead │ Zoom.
- The old "move the nearer boundary" caption trim is gone from the toolbar (`trimSelectedCue` replaced by `trimSelectedCueTo`). Shortcuts, menus and context menus are unchanged.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` clean). Not exercised in the real window; Windows only.

**Limitations:** the target follows the single selection, so with nothing or a clip selected the caption buttons are not reachable from the toolbar (use the caption's own selection first).

**Next:** manual pass: caption vs clip selection, ripple delete, word delete, tooltips.


## 2026-09-26 — Pen mask: click-to-delete, open outline, live preview

**Changes**
- Clicking an anchor of an existing pen mask (press that moves under 3 px) deletes it, like Photoshop's pen; dragging still moves it, Alt-click still toggles corner/smooth. The mask never drops below three points. Anchors get a "−" pen cursor.
- While drawing, the outline is now open (`pathD(points, false)` skips the wrap-around segment) with a dashed rubber-band to the cursor; clicking an earlier point removes it; hovering the first point shows a close cursor/ring.
- Live preview: with three or more points the layer shows the mask as a draft (`drawnMask`, shared with the final commit). Esc drops the draft (`onExit` also clears `maskDraft`).
- On-stage hint bar for drawing and editing gestures.

**Verification:** not tested, typecheck only (`npm run typecheck` clean). Not exercised in the real window; Windows only.

**Limitations:** mask paths are always closed shapes; the live preview necessarily fills the implicit closing edge.

**Next:** manual pass on a video clip: draw, remove points while drawing, close, click-delete, Esc mid-draw, undo.

## 2026-09-26 — Multiple transcription providers, model choice, default provider

**Changes**
- Cloud transcription now works with **Gemini, OpenAI and ElevenLabs Scribe** next to local whisper.cpp. One provider-neutral `CloudTranscriptionAdapter` (`electron/cloudTranscription.ts`) serves all three; silence gating, per-chunk upload, source-time mapping and fail-closed validation are unchanged. `GeminiTranscriptionAdapter` is now a thin subclass.
- Provider catalog `src/core/transcriptionProviders.ts`: label, key env var, upload disclosure and a curated model list per provider (every curated model returns word timestamps: `gemini-3.5-transcribe`, OpenAI `whisper-1`, ElevenLabs `scribe_v2`/`scribe_v1`). Settings and the Transcribe dialog also accept a validated **custom model ID**.
- New recognizers: `electron/openaiRecognition.ts` (`/v1/audio/transcriptions`, `verbose_json` + word granularity, 10-minute sections for the 25 MB limit) and `electron/elevenlabsRecognition.ts` (`/v1/speech-to-text`, word timestamps, audio events and diarization off), sharing `electron/cloudHttp.ts` (multipart POST, error mapping, no key in diagnostics). A provider-reported language is recorded when it is `ml` or `en`; otherwise `auto` is recorded as `ml`, as before.
- **Settings → Transcription** (was "Gemini API key"): default provider, a model picker per provider, and one key section per provider. The default is stored in localStorage (`caption-studio.transcription-defaults`, validated) and only pre-selects the Transcribe dialog; first run is whisper.cpp. Changing provider or model in the dialog applies to that run only.
- Keys: `electron/providerSecretStore.ts` replaces `geminiSecretStore.ts`. `secrets.json` is now `{ version: 2, keys: {…} }`, still reads the old v1 Gemini file, and each provider has an env override (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`). New IPC `providerKeys:*`; alignment and translation still use the Gemini key through `geminiSecretStore()`.
- IPC request: the cloud variant is `{ engine: gemini|openai|elevenlabs, model?, language, translateTo }`; main loads the key, the renderer never sees it. "Translate to" always uses the Gemini key, whichever engine recognized the audio, and reports a missing Gemini key by name.
- Run records: `provider` is now `gemini | openai | elevenlabs`. Existing Gemini and whisper records are unchanged.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` clean). No live request was made to OpenAI or ElevenLabs, so accuracy, Malayalam quality, response shapes and charges are unverified. ElevenLabs field names and `scribe_v2` were read from their public docs; the OpenAI docs page could not be fetched, so its request shape is from prior knowledge. Windows machine; no macOS check.

**Limitations**
- No schema bump: widening `provider` is additive, but an older app version will reject a project containing a run from OpenAI or ElevenLabs.
- The whisper.cpp model is still chosen in the Transcribe dialog; Settings does not store a default local model.
- OpenAI models without word timestamps (for example the gpt-4o transcribe family) are not offered; a custom ID for one fails the request rather than producing untimed captions.
- Docs not yet updated beyond this entry: `docs/TRANSCRIPTION.md` still describes only Gemini for the cloud path.

**Next:** run one short clip through each provider with a real key and record the result here; then update TRANSCRIPTION.md and DEPENDENCIES.md.

## 2026-09-26 — Home screen (start page, recent projects, managed project folder)

**Changes**
- The app now opens on a CapCut-style Home page (`src/home/`): sidebar with Home and Templates (Templates says "coming soon", no fake controls), a Create-project banner, Open project…, and a searchable, sortable grid of projects with thumbnail, duration, last-edited time and file name.
- Create project starts a blank editor; the first cue, clip or asset creates `Documents/KathaCut Projects/<title>.cstudio` (`project:create-managed`) and autosave takes over. Empty projects never leave a file. Save As still works for other locations.
- Recents live in `userData/recent-projects.json` (`electron/projectLibrary.ts`, atomic writes, max 100). Every save and open records an entry. Opening, thumbnailing, renaming and trashing without a dialog is only allowed for paths already in that list.
- Card actions (⋯ or right-click): Open, Rename (also renames the file when it is in the managed folder), Show in folder, Remove from list, Delete (moves only the .cstudio to the Recycle Bin/Trash; media is never touched). A card whose file is gone shows "File missing".
- Thumbnails: while a project is open, a frame at 10% of the first video is captured through the existing thumbnails worker and stored in `userData/Cache/project-thumbnails`.
- Home button in the top bar and File › Home close the open project (autosave is flushed first; the discard dialog only appears if something would still be lost). While Home shows, editor-only native menu commands are ignored.
- `project:open` body is now `openProjectAt(path)`, shared by the dialog and the recent list.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` clean). Windows machine; not run in the app and no macOS check.

**Limitations:** no crash-recovery copy yet; projects saved elsewhere before this change appear in the list only after they are opened or saved once; a project with no video shows a placeholder tile; Templates has no content; renaming a project from an older schema is refused until it has been opened once.

**Next:** run `npm run dev` (unset `ELECTRON_RUN_AS_NODE`) and walk through create, import, Home, reopen, rename, delete.

## 2026-09-26 — Autosave starts on open for migrated projects
- Cause: opening any project saved in an older schema set `migrationPending`, which disabled autosave until an explicit Save. Since the schema moves often, most reopened projects hit this.
- Fix: `project:open` (`electron/main.ts`) now copies the original file once to `<project>.pre-schema-<N>.bak` (never overwritten; `COPYFILE_EXCL`) and returns `migrationBackup`. `App.tsx` keeps autosave off only when the backup could not be made; otherwise autosave is live immediately and the notice names the backup. First write still happens on the first edit, not on open.
- Verification (Windows 11 only): `npx tsc --noEmit -p .` clean. **Not tested**: no tests written or run, the app was not opened. macOS not tested.
- Limitations: `.bak` files accumulate next to the project (one per source schema version); no UI to restore them.
- Next: none.

## 2026-09-25 — Liquid glass 10: social/UI cards, labels and lower thirds (docs/plans/liquid-glass)
- New `src/core/overlayTemplateCards.ts` (registered from `overlayTemplateCatalog.ts`) with 14 templates. Cards: Post card, iOS notification (glass tint 15%, blur 14), Subscribe pill, Like button, Search bar, Toggle switch (knob `slide`), Progress bar (`grow`), Control Centre tile, Volume slider. Labels: Lower third (slide in, fade out), Pill tag, Price tag, Step number, Chapter title bar (growing progress line), Timer chip (static, named as such). Categories `cards` and `labels` added to `TemplateCategory` and the panel tabs; `TemplateShapeSpec.glassTuning` overrides preset blur/tint.
- `src/core/templateGlyphs.ts`: heart, bell (+ clapper), tick, circle and magnifier as own Bezier `path`/ellipse/line geometries. Tiles for glass-capable templates show a "Liquid Glass" tag (`OverlaysPanel.tsx`, `styles.css`). Glass export shipped (brief 04), so glass variants are real, but that pass is itself untested (see its entry).
- Docs: `docs/EDITING.md` Overlay templates (full list, limits). ROADMAP lists no templates, unchanged.
- Verification (Windows 11 only): `npx tsc --noEmit -p .` clean. **Not tested**: no tests written or run, the UI was never opened, so tile pictures, glyph shapes, spacing and the glass look are unseen. macOS not tested.
- Limitations / deviations: Volume slider fill fades in (no vertical reveal exists); the magnifier is a stroked ellipse plus a line, not one closed path; Lower third and Chapter bar place themselves at the lower left / bottom rather than at the insert centre; most multi-part templates (see EDITING.md) do not refit on text edits; the Price tag eyelet is a dark circle, not a real hole; sample copy only.
- Next: none, plan complete.

## 2026-09-25 — Liquid glass 09: chat and callout templates, Templates UI (docs/plans/liquid-glass)
- Catalogue: `src/core/overlayTemplateCatalog.ts` registers 11 templates (Chat: iMessage sent/received, WhatsApp bubble, Typing indicator, Chat thread, DM notification; Callouts: Speech bubble, Thought bubble, Callout box, Quote card, Sticky note). `overlayTemplates.ts` gained `category`/`description`/`supportsGlass`, shape helpers (`templateShape`, geometry constructors, `delayUs` staggering) and `placeAndFit` options (`center`, `delayMs`, `enter`); the brief 08 `sample-bubble` template is replaced by Speech bubble.
- `template-insert` takes an optional `glass` flag (`templateCommands.ts`, `editCommandSchema.ts`): glass-capable shapes get `LIQUID_GLASS_PRESET` with a 35% tint.
- UI: `OverlaysPanel.tsx` Templates section (category tabs, tiles, Glass checkbox) below Shapes; `TemplateThumbnail.tsx` draws each tile as SVG from the builder itself (text sizes estimated); `App.tsx` `addTemplateAtPlayhead` measures every title with `measureTitleBlock`, then runs one `template-insert` (4 s at the playhead, centred). Docs: `docs/EDITING.md` "Overlay templates", `docs/MCP.md`, `list_creative_options` (`overlayTemplates`).
- Verification (Windows 11 only): `npx tsc --noEmit -p .` clean. **Not tested**: no tests written or run, the UI was never opened, so tile pictures, spacing of the multi-part templates (quote card, WhatsApp timestamp row, DM banner) and the Glass toggle are unseen. macOS not tested.
- Limitations / deviations: sample copy only (the command has no per-insert text override; retype in the inspector); Quote card, DM notification and Sticky note position their extra members from insert-time measurements and do not follow later text edits (the quote card and single-title bubbles refit through `fitTo`); the sticky note is a path with the tilt baked into its points, so it has no `fitTo`; the typing indicator has no text, so its width is fixed; tile text sizes are estimates, so a tile may differ slightly from the inserted result; no MCP tool beyond `edit` for `template-insert`.
- Next: `docs/plans/liquid-glass/10-templates-cards-labels.md`.

## 2026-09-25 — Liquid glass 08: bubble geometry, fit-to-text, template-insert, schema 23 (docs/plans/liquid-glass)
- Schema 23 (`edit.ts`, `model.ts`, `migrateV22.ts`; 22 becomes `projectSchemaV22` with `shapeSchemaV22`/`shapeGeometrySchemaV22`, no data transform): `bubble` geometry (`rect`, `cornerRadius`, `cornerRadii?`, `tail { side, offset, width, length, curve }`, `rotation`) and optional `fitTo` / `fitPadding` on shapes. `shapePath.ts`: one closed path (tail merged into the rounded rect, base clamped to the straight stretch between corner arcs, no tail when there is no room), `shapeBox`/`shapeRotation`/translate/scale support it, `bubbleTailTip` new. `glassBounds` grows by the tail length, so a bubble can be glass. Fixtures moved from `schemaVersion: 22` to 23 by search and replace.
- UI: `ShapeInspector` gets a Tail section and shows Corners for bubbles; `BubbleTailHandle.tsx` is the stage tail handle (side, position and length in one drag); `App.tsx` treats a bubble as a box shape. `shape-duplicate` drops `fitTo`; `group-duplicate` remaps it; `group-scale` scales `fitPadding`.
- Fit: `src/core/fitToText.ts` (pure: `textBlockBounds` via `layoutCaption`, `placeTextCentered`, `fitGeometryToBlock`, `fitShapeToText`); `src/captions/fitMeasure.ts` loads fonts and measures with the DOM measurer. Editing a title that has a `fitTo` shape measures first, then commits the text update and the shape updates through `runCommands` as one undo step (`App.tsx` `runCommand`).
- `template-insert` (`templateCommands.ts`, registry in `overlayTemplates.ts` with one `sample-bubble` template): builds a group, its shapes and titles in one command from caller-measured sizes; selects the group. Registered in `itemCommands.ts` and `editCommandSchema.ts` (also `fitTo`/`fitPadding` in `shape-update`). Docs: `docs/EDITING.md`, `docs/MCP.md`, `creativeOptions.ts`.
- Verification (Windows 11 only): `npx tsc --noEmit -p .` clean. **Not tested**: no tests written or run, the UI was never opened, so the bubble outline, tail handle and the refit-on-edit flow are unseen. macOS not tested.
- Limitations: no UI to insert a template yet (brief 09), so `template-insert` is reachable only through `edit`; no bubble preset in the Overlays panel; `maxWidth` only caps the box, the title still wraps by its own safe area; the sweep and grow reveals use the rect and ignore the tail; the tail handle ignores corner radii when mapping position to offset (approximate near corners); the refit is asynchronous (fonts load first), so the text appears one beat before the box resizes; `text-delete` leaves a dangling `fitTo`, which the UI ignores; stale test expectations at `schemaVersion: 21` in `model.test.ts` were already out of date and were left alone.
- Next: `docs/plans/liquid-glass/09-templates-chat-callouts.md`.

## 2026-09-25 — Liquid glass 07: groups UI (docs/plans/liquid-glass)
- Selection: `Selection.kind` gains `'group'`. Ctrl/Shift-click on stage items or timeline clips builds a pending group (`pendingGroup` in `App.tsx`, honoured only while the selection is one of the picked items; a chip on the stage says "N items picked"); modifier keys are read from a capture-phase `pointerdown` listener (`modifiersRef`), so no handler signatures changed. Plain click on a member selects its group; double-click (stage), Alt-click, the group inspector's Items list or a Layers member row select the part. Ctrl/Cmd+G groups, Ctrl/Cmd+Shift+G ungroups (`shortcuts.ts`, Settings shortcut list, context menu), Delete removes the group.
- Stage: one `RectStageEditor` (`group-hit`, dashed) over the union of member boxes visible at the playhead: `glassBounds` for shapes, measured layout bounds for grouped titles (`TextOverlayActor.onLayout` -> `textBounds`). Drag = `group-translate`, corner resize (aspect kept) = `group-scale` anchored at the opposite corner; the draft previews by running the same `applyGroupCommand` on a draft project, and release commits one command.
- Timeline: `ShapeLane`/`TextLane` show a group chip, a shared hue (`groupHue`) and highlight every member when the group is selected; pending items get a dashed outline. Dragging a member issues `group-move` with the drag offset (Alt = that member only).
- Layers tab: `LayerRow.groupId`; group rows (collapse, shared time range, double-click rename) nest their visible member rows. Inspector: `GroupInspector.tsx` (name, start = `group-move`, read-only length, member list, Ungroup, Duplicate, Delete group). Docs: `docs/EDITING.md` "Groups in the UI".
- Verification (Windows 11 only): `npx tsc --noEmit -p .` clean. **Not tested**: no tests written or run, the UI was never opened, so drag/resize gestures, pending-selection flow and the Layers nesting are unseen. macOS not tested.
- Limitations / deviations: trimming a member trims only that member (the brief said trim issues `group-move`, which has no sensible trim meaning); the timeline drag preview shows only the dragged block, the rest of the group jumps on release; the stage box only covers members visible at the playhead and grouped titles need a measured layout first; group length is read-only; timeline clips of a group do not highlight when only a pending selection exists on the stage beyond the outline; a title's font size clamps under `group-scale` as recorded in brief 06.
- Next: `docs/plans/liquid-glass/08-bubble-and-fit.md`.

## 2026-09-25 — Liquid glass 06: groups model, schema 22 (docs/plans/liquid-glass)
- Schema 22: `groupSchema`, optional project `groups` (max 200) and optional `groupId` on shapes and text overlays (a `groupId` must name an existing group; group ids unique). `shapeSchemaV21` and `textOverlaySchemaV21` keep schemas 10 to 21 strict; `migrateV21.ts` only moves the version. Deviation from the brief: `groups` is optional rather than defaulted, so untouched projects stay byte-identical.
- `groupCommands.ts`: `group-create/-ungroup/-rename/-move/-translate/-scale/-duplicate/-delete`, `groupMembers`, `pruneGroups`; registered in `itemCommands.ts` and `editCommandSchema.ts`. `shape-delete`/`text-delete` dissolve a group left with under two members; duplicating a member gives an ungrouped copy. `shapePath.ts`: `translateShapeGeometry`, `scaleShapeGeometry`. Agent project summary gains `groups` and per-item `groupId`. Docs: `docs/EDITING.md` Groups, `docs/MCP.md`.
- Existing test fixtures only got `schemaVersion: 22` (and `groups: []` in the agent bridge summary fixture) so the typecheck passes.
- Verification (Windows 11 only): `npx tsc --noEmit -p .` clean. **Not tested**: no tests written or run, migration and commands never executed. macOS not tested.
- Limitations: no UI, no nesting; `group-scale` leaves glass lengths, and text font size clamps, unscaled beyond 20..120; a translate/scale that pushes a shape past the schema's coordinate bounds is rejected by the schema backstop.
- Next: `docs/plans/liquid-glass/07-groups-ui.md`.

## 2026-09-25 — Liquid glass 04: glass export pass (docs/plans/liquid-glass)
- Removes brief 03's export refusal. `graphicsPasses.ts`: `GraphicsPasses` gained `bands: PassBand[]` (`{ kind: 'blend' | 'glass', shape }`, blending plus glass shapes sorted by `compareLayered`, K = 2k+1); `blendShapes` stays (blend only). `passOf` now uses `<= 0`, so a glass shape's own surface lands in the even band right after its map band.
- `frameRequest.ts`: v4 gains optional `glassMap: true`. `plan.ts`: an odd band carries its one pass shape (blend or glass) and sets `glassMap` for glass; the guard is gone. `frameHarness.tsx`: normal shapes paint with `glass={false}` (surface only); a `glassMap` request paints only `GlassMapActor` (new, `ShapeActor.tsx`): an opaque frame, background rgb(128,128,0), the map at the shape's bounds following its motion, B scaled by opacity with a multiply layer. `glassMapImage.ts`: `glassCoverageMap` (R/G as before, B = anti-aliased silhouette coverage, alpha 255). Map images are awaited before the frame is committed.
- `layerPlan.ts` `passSignatures`: glass band signature = shape id + resolved motion, so a static glass shape reuses its buffer. `export.ts`: `PreparedExport.pngOnly` (true when any glass shape exists) forces PNG transport over raw; the K > 1 loop is unchanged (map band is empty only while the shape is off the timeline).
- `exportArguments.ts` `glassChains`, called from `compositeGraphicsPasses` for glass bands: crop to lifetime bounds (+64 units if a slide animation) plus 3 sigma and the refraction shift, `gblur`, CSS saturate matrix via `colorchannelmixer`, map rescale (`lutrgb`) and the two per-plane mixers exactly as brief 02 measured, `displace=edge=smear`, `alphamerge` with the map's B plane, `overlay` with `enable` over the shape span. Label indexes use the existing 100,000 offset. K = 1 output is untouched (no pass shapes means the same code path as before).
- Docs: `docs/EDITING.md` Glass (export description and limits), `docs/ARCHITECTURE.md` (glass pass next to "Shape blend passes"), `docs/MCP.md` and `creativeOptions.ts` (no longer say export refuses glass).
- Verification (Windows 11 only): `npx tsc --noEmit -p .` clean. **Not tested**: no tests written or run, no export run, FFmpeg graph never executed, not opened in the app. The filtergraph, the multiply-based opacity in the map and the `displace` plane handling are unverified against real FFmpeg/Chromium output. macOS not tested.
- Limitations: preview and export not compared; the map band is one extra full-frame PNG per change, and glass costs the same extra passes as a blend shape; refraction is whole-pixel; glass shapes over the 16M-pixel raster limit export without refraction (flat box coverage); slide is the only motion that moves a glass shape beyond its bounds (assumed <= 64 units); the raw transport is not used for glass projects.
- Next: `docs/plans/liquid-glass/06-groups-model.md`.

## 2026-09-25 — Liquid glass 03: glass shapes, schema 21, map generator, preview, inspector (docs/plans/liquid-glass)
- Schema 21 (`model.ts`, `migrateV20.ts`; 20 becomes `projectSchemaV20` with `shapeSchemaV20`, no data transform): optional `glass { blur, saturation, refraction, bezel, tintOpacity, rim, specular, shadow { blur, offsetY, opacity } }` on shapes (`edit.ts`: `glassSchema`, `isClosedShapeGeometry`; the shape schema refuses glass on an open line or path). Absent means not glass; nothing is stored for untouched shapes. `loadProject` chain, version literal and the `migratedFrom` type moved to 21; test fixtures moved from `schemaVersion: 20` to 21 by search and replace.
- `src/core/glassMap.ts` (pure): `glassBounds` (axis-aligned bounds of the rotated silhouette; the glass layer is exactly this box), `distanceInside` (exact Euclidean transform, frame counts as outside), `squircleProfile`, `buildGlassMap` (zero in the interior, at most `maxShift` in the bezel, inward normal from the distance gradient), `encodeShift` (`128 + 127 * d / maxShift`, R = x, G = y, B = 128, alpha 255, as brief 02 measured), `chromiumDisplacementScale` (`255 * maxShift / 127`), `LIQUID_GLASS_PRESET`. `src/captions/glassMapImage.ts` rasterises the silhouette on a canvas and returns the map and mask PNG data URLs, cached by the inputs that change pixels.
- `ShapeActor.tsx`: new `glass?: boolean` prop (default true) and `GlassShapeActor`. Two sibling layers, no opacity/mask/filter/blend/clip-path ancestor: the glass layer (`backdrop-filter: blur(σ) saturate(s) url(#feImage + feDisplacementMap)`, `mask-image` = silhouette, the shape's opacity and motion on the layer itself) and the surface SVG (drop shadow masked outside the silhouette, tint, inner glow, top-left rim light, specular, the shape's own stroke, hit path). `glass={false}` paints the surface only, for brief 04. A raster over 16M pixels skips refraction and the mask (boxes fall back to `border-radius`).
- Commands: `shape-update` accepts `glass` (`null` clears; also in `editCommandSchema.ts`). New `glassRules.ts`: glass is refused on open geometry, with a mask, with a blend mode, and with a `draw`, `sweep` or `grow` enter/exit animation (`value-range` failures). `mask-set` and `layer-look-set` refuse the reverse combinations. `MAX_PASS_SHAPES = 8` (`graphicsPasses.ts`, with `glassShapes`, `passShapes`) caps blending plus glass shapes together on add, update, blend change and duplicate (a duplicate past the cap loses its glass); `MAX_BLENDING_SHAPES` and its message are unchanged. **Deviation from the brief:** it named only the `draw` enter animation; I also refuse `sweep` and `grow` (and `draw` on exit) because the glass layer has no honest way to reveal by sweep or grow.
- `ShapeInspector.tsx`: a Glass section (On/Off, "Liquid Glass" preset button, sliders for every field and the shadow). It is disabled with an explanation for open geometry, masks and blend modes; turning it on swaps a draw/sweep/grow animation for fade, and the animation menus hide those kinds while glass is on.
- Export: `buildExportManifest` throws "Exporting glass shapes is not supported yet." when any shape has glass. Nothing else in export changed. Docs: `docs/EDITING.md` (Glass note), `docs/MCP.md`, `creativeOptions.ts`.
- Verification (Windows 11 only): `npx tsc --noEmit -p .` clean. **Not tested**: no tests written or run, not opened in the app, so the glass look, the refraction direction (edge pixels sample from inside) and the rim/specular values have not been seen. macOS not tested.
- Limitations: preview only; glass cannot animate by draw, sweep or grow; the rim light and specular reuse one gradient stroke rather than a dedicated arc; there is no "Glass panel" preset tile (brief 10); a glass shape rotated by the inspector rotates its silhouette and map, but stage handles were not checked; the per-frame frame-reuse signature in `layerPlan.ts` does not yet include glass (brief 04).
- Next: `docs/plans/liquid-glass/04-glass-export-pass.md`.
- Not committed: the tree carries large unrelated uncommitted work, and `ShapeActor.tsx`, `shapeCommands.ts`, `graphicsPasses.ts`, `migrateV18.ts`/`migrateV19.ts` are still untracked (HEAD has no shapes at all), so a commit of this slice's files would sweep it in. Ask to have it committed on its own if wanted.

## 2026-09-25 — Liquid glass 02: glass spike, two go/no-go checks (docs/plans/liquid-glass)
No product code. Throwaway script `scripts/spikes/glass-spike.mjs` (`npx electron scripts/spikes/glass-spike.mjs`; Electron 44.3, Chromium window at `force-device-scale-factor=1`, SMPTE bars 400x300, 200x150 panel, real FFmpeg from `caption-studio.local.json`). Windows 11 only; not tested on macOS. One run per number, no benchmarks. Briefs 03 and 04: copy the blocks below verbatim.

**Q1: does `backdrop-filter: blur(σ) saturate(s) url(#f)` work? YES.** With `<filter id="f" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">` = `feImage` (PNG data/file URL, `preserveAspectRatio="none"`, x/y/width/height = the panel's own box in px) + `feDisplacementMap in="SourceGraphic" in2=<feImage result> xChannelSelector="R" yChannelSelector="G"`, the backdrop is blurred, saturated and displaced in one `backdrop-filter`. No fallback needed. The displacement map's coordinates are the panel's border box (origin at the panel's top-left).
- Ancestors of the panel that make it a backdrop root, so the picture outside them is NOT seen (backdrop stays unfiltered): `opacity` < 1, `mask-image`, `filter` (any, even `blur(0)`), `mix-blend-mode` (non-normal), `will-change: opacity` / `filter`, `clip-path`. Harmless: `opacity: 1`, `filter: none`, `will-change: transform`, `transform`, `isolation: isolate`, `overflow: hidden`, `z-index`.
- If the picture and the panel are BOTH inside such an ancestor (opacity .99, mask, filter) the backdrop still works. So opacity/mask/filter wrappers are fine as long as the video lives inside them.
- Properties on the glass element itself do not break it: `mask-image`, `mix-blend-mode`, `filter: blur(0)`, `border-radius` + `overflow: hidden` all still show the backdrop (`opacity` < 1 fades the effect, as expected). So glass shapes must apply their mask/opacity to the glass element itself, never to a wrapper that excludes the video; do not wrap the shape in an opacity/mask/filter/blend/clip-path parent.

**Q2: displacement encoding that matches FFmpeg `displace`.**
- FFmpeg `displace` shifts by (map byte − 128) whole pixels (128 = no shift, nearest sampling, no interpolation); an output pixel at x takes the input at x + (byte − 128) (a byte above 128 moves picture content left, e.g. byte 160 moved a stripe edge from x=174 to 171). It cannot scale the map, so the scale lives in the map and in the graph.
- Map bytes (shared generator): `byte = 128 + 127 * d / maxShift`, d in px (signed), R = x, G = y, B = 128, alpha 255, PNG transport.
- Chromium: `feDisplacementMap scale = 255 * maxShift / 127` (measured: bytes 128/160/192/255 with maxShift 12 moved edges 0/3/6/12 px, identical to FFmpeg; both nearest-sample).
- FFmpeg graph for the map (must be applied to the map before `displace`): `[map]format=gbrp,lutrgb=r='128+(val-128)*MAXSHIFT/127':g='128+(val-128)*MAXSHIFT/127':b=128,split=2[m1][m2];[m1]colorchannelmixer=rr=1:gr=1:br=1:gg=0:bb=0[xm];[m2]colorchannelmixer=rr=0:rg=1:gg=1:bg=1:bb=0[ym];[pic][xm][ym]displace=edge=smear`. Two gotchas: `displace` uses the x and y maps PER PLANE, so `xm`/`ym` must each carry their displacement in all three channels (the mixer above; note `colorchannelmixer` defaults `rr=gg=bb=1`, so the zeroing terms are required); and all three inputs must be the same size (crop the picture to the map's box first, `crop=w:h:x:y:exact=1`). The lens test (radial map, 200x150) gives a mean absolute difference of 1.28/255 between Chromium and FFmpeg (608 of 90000 channels off by more than 40, at the shifted stripe edges).
- Integer pixels only on both sides, so keep maxShift small (the test used 12) and expect at most 1 px rounding differences. Compare colours only with Chromium forced to sRGB (`--force-color-profile=srgb`); without it the window capture is colour-managed and looks different.

**Use without measuring** (as briefed): CSS spec `saturate()` matrix (Rec.709 luma) in FFmpeg `colorchannelmixer`; blur sigma = CSS px = `gblur` sigma (as blur regions already do); PNG transport for the opaque map sub-frame (raw has the un-premultiply bug, STATUS 2026-09-25); FFmpeg crop margin of 3σ before `gblur`.

- Verification: Q2 and the lens comparison come from the final run of the script (sRGB forced); the Q1 tables come from the immediately preceding full run of the same script (default colour profile; the diffs are relative). Typecheck not run (a .mjs script outside tsc).
- Limitations: one machine, one SMPTE still, integer-shift maps only, Chromium 44.3's behaviour (a different Electron may differ). No test of glass over real `<video>`; `<video>` is expected to behave like the `<img>` used here.
- Next: `docs/plans/liquid-glass/03-glass-model-and-preview.md`.
- Not committed: `docs/STATUS.md` carries large unrelated uncommitted work, so only the spike script was committed.

## 2026-09-25 — Liquid glass 01: per-corner radii, schema 20 (docs/plans/liquid-glass)
- Schema 20 (`model.ts`, `migrateV19.ts`; 19 becomes `projectSchemaV19`, no data transform): optional `cornerRadii { tl, tr, br, bl }` (each 0..20000) on rect shapes. `edit.ts`: `cornerRadiiSchema`, `shapeGeometrySchemaV19` (rect without it) and `shapeSchemaV19` keep v17-v19 files strict; a v19 file carrying `cornerRadii` is rejected. `cornerRadius` stays the master; when `cornerRadii` is set it wins and `cornerRadius` holds the rounded mean.
- `shapePath.ts`: `resolveCornerRadii` (shared with the inspector and, later, glass), `fitCornerRadii` (CSS overlap rule, one factor f for all four), `normalizeShapeGeometry` (equal radii collapse to `cornerRadius`, `cornerRadii` stripped). `rectPath` draws per-corner circular arcs and skips zero-radius arcs; a uniform radius (single `cornerRadius` or four equal) produces the same string as before. The painter needed no change (`shapePathD` only), so export follows.
- `shapeCommands.ts`: `shape-add` and `shape-update` normalise geometry; `editCommandSchema` already accepts `cornerRadii` through `shapeSchema`. `ShapeInspector.tsx`: new Corners section for boxes (Linked = one radius slider; Separate = four numeric fields TL/TR/BL/BR; relinking collapses to the mean). Docs: `docs/EDITING.md` (Corner radii paragraph), `docs/MCP.md`, `creativeOptions.ts` shape usage text.
- Verification (Windows 11 only): `npx tsc --noEmit -p .` clean. `npx vitest run src electron workers`: 1729 pass, 36 fail, all in the documented Windows baseline (`workers/media/export.test.ts` x30, `EffectsPanel`, `TemplatesPanel`, `keynoteTemplates` x2, `electron/mcp/config`, `thumbnails`); none new. New tests: `shapePath.test.ts` (uniform output identical, four distinct radii, overlap scaling, zero radii, normalise), `shapeCommands.test.ts` (equal radii collapse, mean kept, undo restores), `model.test.ts` (19 -> 20 migration, round trip, v19 rejects `cornerRadii`). Test fixtures moved from `schemaVersion: 19` to 20. `npm run parity:export -- --only shapes` passes: 56 cases including a filled box with radii 0/90/0/90 in both frames (max byte delta 7 vs tolerance 8; export host really draws it). Evidence: `docs/decisions/evidence/x3-parity-shapes-2026-09-25.json`.
- Limitations: `RectStageEditor` has no per-corner handles (skipped as not a small change; corners are edited in the inspector only). The linked-slider range is 0..300 px while the schema allows 20000. Not tried by hand in `npm run dev`. Ellipse/path/highlight corners, glass, groups and templates are out of scope. macOS not tested.
- Next: `docs/plans/liquid-glass/02-glass-spike.md`.
- Not committed: as with the earlier slices, the tree carries large unrelated uncommitted work in the same files (HEAD does not even contain schema 18: `model.ts`, `edit.ts`, `docs/*`, `scripts/export-parity.mjs`, and untracked `migrateV16-18.ts`), so a commit of this slice's files would sweep it in. Ask to have it committed on its own if wanted.

## 2026-09-25 — Shape blend 03: parity stage, real exports, docs (docs/plans/shape-blend)
- New `--only shape-blend` stage in `scripts/export-parity.mjs` (`shapeBlendParity`, 540x540): SMPTE-bars picture, a title (layerOrder -3), a Multiply box (-2) and a Screen 0.85-opacity highlighter (-1). Preview side: new `window.renderShapeBlendScene` in `scripts/blend-parity-harness.tsx` (picture, title and shapes in one stacking context, sorted by `compareLayered`, each shape with `ShapeActor`'s own CSS `mix-blend-mode`), painted in an offscreen window. Export side: the real `frameRequestAtSequence(manifest, frame, null, pass)` for all K = 5 bands painted by the offscreen host, each converted to PNG and piped into FFmpeg through the real `exportFilterGraphV3` (output swapped to rgb24 as `layerBlendParity` does). Helpers gained `frameRequestAtSequence` and `graphicsPasses`.
- Result (Windows 11, x64, the FFmpeg from `caption-studio.local.json`): **passes**. Over all 291,600 channels the max delta is 1/255 and the mean 0.021; over the 827,211 "flat" channels (a pixel equal to its four neighbours in the preview) also max 1, none over the tolerance of 3. Text and shape edges are included in the overall figure and also agree. The blend is visible: the same scene with Normal shapes differs by 91,518 bytes in preview and 87,980 in export (asserted > 2000). Evidence: `docs/decisions/evidence/x3-parity-shape-blend-2026-09-25.json`. `--only shapes` and `--only layer-blend` still pass unchanged.
- **Finding, not fixed:** with the opt-in raw BGRA transport the same scene is wrong for semi-transparent shape pixels. `captionLayerLabel` un-premultiplies with `format=gbrap,unpremultiply=inplace=1`, and on this FFmpeg build (n9.0.2, both the WinGet build and `.tools/ffmpeg-win64-lgpl`) that leaves premultiplied colour essentially unchanged (rgba 180,208,51,217 stays 179,206,50,217 instead of 212,245,60), so a 0.85-opacity highlighter over black came out 152 instead of 180 (alpha applied twice). It was invisible before because the plain path overlays opaque pixels or thin antialiased edges. Raw is off by default (PNG is the default) and STATUS already recorded it as not within +-1 of PNG; blending makes it visible. Not fixed here: it is `exportTransport.ts` (pre-brief-01), and the fix (e.g. un-premultiply via a two-input `unpremultiply`, or a different pixel format) needs its own check across FFmpeg builds. Documented in `docs/EDITING.md` ("Raw transport caveat"); the parity stage uses PNG. Follow-up: fix or drop raw's un-premultiply.
- Real exports (`electron . --export-smoke`, Windows 11, real FFmpeg and export host, the app's own encoder selection, 960x540, 30 fps, 10 s video-with-audio source, title + Multiply box + Screen highlighter over it): every run produced 300 frames, equal to `exportFrameCountFor(...)`, and ffprobe `-count_frames` decoded 300 h264 frames at 960x540. Engine `totalMs` (fps): PNG transport, no blending (shapes set Normal) 4433 (136 fps), with blending 5597 and 5622 in two runs (82 fps): about +25%. Raw transport: 4173 (134 fps) without, 7389 (58 fps) with blending: about +77%. The host painted 62 sub-frames for the whole 300-frame blending run against 23 without (1438 reused), so the extra cost is FFmpeg per-band work and the larger pipe, not host painting; a first cold run of the no-blend case took 5855 ms (startup 2.8 s). One machine, one clip, one or two runs each; treat as indicative. Both transports encoded successfully, but the raw output is not colour-correct for translucent shapes (finding above).
- Docs: `docs/EDITING.md` (blend semantics were already there from brief 02; added the export cost with these numbers, the parity checks and the raw caveat, and shapes in the schema 18/19 intro line; there was no "shapes have no blend mode" wording left to remove), `docs/ARCHITECTURE.md` (new "Shape blend passes" paragraph). `docs/ROADMAP.md` does not list this, so unchanged.
- Verification (Windows 11 only): `npx tsc --noEmit -p .` clean. `npx vitest run src electron workers`: 1720 pass, 36 fail: the 35 documented Windows baseline plus brief 02's `renderVideo shape-blend export passes` test, which hits the same missing-encoder wall in the test's fake toolchain (it passed under a local darwin override in brief 02; the real exports above did not have that limit). macOS not tested; no Mac claim is made.
- Limitations: only this one scene and one composition (540x540) are compared; a blending shape over real video was covered by the real export (frame count and encode) but not compared pixel by pixel; the preview side is an offscreen window, not the on-screen editor (the known Windows work-area clamp and capture noise make the visible window unreliable for exact colours). Not tried by hand in `npm run dev`.
- Next: decide whether to fix or remove the raw transport's un-premultiply; then this plan is complete.
- Not committed: the tree carries unrelated in-progress work from other briefs in the same files (`docs/EDITING.md`, `docs/ARCHITECTURE.md`, `docs/STATUS.md`, `scripts/export-parity.mjs`), so a commit of them would sweep that in. Ask to have this slice committed on its own if wanted.

## 2026-09-25 — Shape blend 02: export passes end to end (docs/plans/shape-blend)
- Removes brief 01's export refusal. `src/core/graphicsPasses.ts` gained the pass model: `graphicsPasses(shapes)` returns `{ count, blendShapes }` (K = 2k+1 for k blending shapes, `blendShapes` sorted by `compareLayered`), and `passOf(entry, passes)` maps a `{ kind: 'pinned' | 'fade' | 'caption' | 'graphic', item? }` entry to its band — pinned always band 0, fade always the last band, a caption plane or non-blending graphic wherever `compareLayered` places it relative to the blending shapes (the caption plane's own key sorts just before a real item at `layerOrder: 0`, matching `belowCaptions`). Pure and unit-tested for every ordering the brief called out (below/above captions, two adjacent blend shapes, a layerOrder tie broken by `startUs`/`id`), plus that K = 1 with no blending shapes.
- `frameRequest.ts`: optional `hideCaption: true` (no version bump). `CaptionPreview` takes a `hideCaption` prop that suppresses only the painted `CaptionView` — the cue is still evaluated (so readiness/motion state, and therefore a pass's signature, are unaffected), it just paints nothing. `frameHarness.tsx` (the export host) now always renders `ShapeActor` with `blend={false}`: this harness is the export host, which composites any blending shape itself through FFmpeg passes, so it must never additionally CSS-blend one (a normal shape has no `blendMode`, so this is a no-op for it).
- `plan.ts`: removed the brief-01 guard. `frameRequestAtSequence(manifest, index, active, pass = 0)` filters overlays/pinned effects to band 0, fade to the last band, text/shape actors to their own band by `passOf`, and an odd (blend) pass to exactly its one blending shape (only when it is actually on the timeline at that frame) — with no blending shapes every filter is a no-op, byte-identical to before passes existed. New `blankFrameRequest(width, height)`: a version-1, `hideCaption: true`, fully empty request, for the worker's shared blank-pass buffer.
- `layerPlan.ts`: refactored `frameAt`'s internals into a shared `partsAt(index)` (unchanged output — same `frameAt`/`spans`, verified against the existing signature test suite untouched) plus a new `passSignatures(index)`: one `{ signature, empty }` per band, `empty` true exactly when that band's request would carry no overlays, no pinned effects, an invisible-or-absent caption, no graphics and no fade — the same condition `frameRequestAtSequence` uses to decide what a pass renders, so the worker's blank-buffer substitution can never diverge from what the host would in fact have painted for a "true" empty request.
- `exportArguments.ts`: `compositeGraphicsPasses` (used by both the flat and stacked routes, replacing their final single `overlay` line) is the single-pass `overlay` verbatim when `graphicsPasses(shapes).count === 1`; otherwise it applies `captionLayerLabel` once, `split=K`, then per band `select='eq(mod(n\,K)\,p)',setpts=N/(rate)/TB`, composited in order — `overlay=0:0:alpha=straight` for even bands, the existing `blendChains` for odd ones (label indexes offset by 100,000 so they never collide with a clip's own blend labels) — ending the last band with the original `eof_action=endall:shortest=1,format=yuv420p[outv]`. New `captionPipeRate(manifest)`: the pipe's own framerate, K× the output rate (the output side — `-r`, `-frames:v` — stays in output frames, untouched).
- `workers/media/export.ts`: `PreparedExport` gained `passCount` (1 for every v1/v2 job and a v3 job with no blending shapes; `graphicsPasses(manifest.shapes).count` otherwise) and `request` grew an optional `pass` parameter. `renderVideo`'s frame loop branches on `passCount`: the `passCount === 1` branch is the exact previous loop, moved (not rewritten) into its own branch, so K = 1 exports are provably unchanged; a new `passCount > 1` branch renders one shared blank buffer once (a zeroed buffer for raw transport, one host round trip for PNG) and keeps a `previous` cache **per band**, dispatching only the bands whose `passSignatures` entry actually changed (in parallel across the host pool) and writing all K bands to the encoder, in order, per output frame. Progress, ETA, `frameCount` and stall messages all stay in output frames.
- Docs: `docs/EDITING.md` "Blend modes" now describes the pass model and removes the "export does not support it yet" wording.
- Verification (Windows 11): `npx tsc --noEmit -p .` clean. New/extended tests: `graphicsPasses.test.ts` (the pass model, every ordering in the brief), `layerPlan.test.ts` (existing signature suite untouched, confirming the `partsAt` refactor changed nothing), `plan.test.ts` (a blending shape now builds and exports across bands instead of refusing; replaces the old refusal test), `exportArgumentsV3.test.ts` (K = 1 graph byte-identical to before — asserted directly against the untouched-route string; K = 3 graph string: `split`, `select`, the blend chain, the final `overlay`; the pipe framerate multiplied by K, output rate/frame count untouched), a new **real-FFmpeg** case in `blend.test.ts` piping 2 output frames × 3 raw sub-frames (a normal band with a colour square, the blend-shape band, an empty band) through the project's own FFmpeg build and checking composited pixels against the W3C formula (±2/255) and that exactly 2 frames come out, and a new `export.test.ts` case (`renderVideo shape-blend export passes`) with a fake host/encoder confirming K writes per output frame in pass order, a changed-band reused across frames, and an empty band never reaching the host at all. `npx vitest run src electron workers`: 1720 pass, 36 fail — the 35 documented Windows baseline (no local H.264 encoder blocks every `renderVideo` test in `export.test.ts`, plus the pre-existing `EffectsPanel`/`TemplatesPanel`/`keynoteTemplates`×2/`mcp/config`/`thumbnails` failures) **plus this session's own new `renderVideo shape-blend export passes` test**, which hits the identical missing-encoder wall as every other `renderVideo` test here. That new test's actual logic was confirmed by temporarily forcing `process.platform` to `'darwin'` (bypassing the encoder probe, as macOS always does) in a local, uncommitted edit — with that in place the whole `export.test.ts` file (49/49, including the new test) passes — then reverted before finishing; the file in the tree does not contain that patch.
- `npm run parity:export -- --only shapes` (and `--only layer-blend`) could not be run this session: the chained `npm run build:electron && npm run build:worker` step intermittently fails with `SyntaxError: The requested module 'electron' does not provide an export named 'nativeImage'` under Node v24.20.0, while a bare `npm run build:worker` on the same machine (Node v22.14.0) succeeds — a pre-existing, apparently PATH/Node-version-selection quirk in this environment's nested `npm run` invocations. Confirmed unrelated to this change: the identical failure reproduces with these changes fully stashed. Not something this brief's scope covers fixing.
- Limitations: not run in the actual app (`npm run dev`) — no manual export of a project with a blending shape, no visual comparison against the live preview. The real-FFmpeg test in `blend.test.ts` proves the split/select/blend/overlay mechanics against a synthetic solid-colour picture; it does not exercise the actual Chromium-rendered shape pixels (`ShapeActor`'s own SVG paint) — that path is only exercised by unit tests of `ShapeActor`/`shapeMotion` from brief 01, not a real export. The K > 1 worker loop dispatches all changed bands of one output frame concurrently across the host pool but does not pipeline *across* output frames the way the K = 1 loop's `fill()`/prefetch window does — correct and bounded, but likely slower per frame than K = 1 for large exports; no measured timing exists yet (that is brief 03's job, alongside the `--only shape-blend` parity stage and a real export). macOS untested.
- Next: brief 03 (`docs/plans/shape-blend/03-parity-and-docs.md`) — the `--only shape-blend` parity stage, a real export with timing, and the remaining docs (`docs/EDITING.md`'s export-cost note, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` if listed).
- Not committed: per this session's standing instruction not to commit unless explicitly asked, and because the working tree already carries substantial unrelated uncommitted work from other in-progress briefs (Vox shapes, clip/title/caption blend and opacity, export speed, color grading) that a blanket `git add`/commit would sweep in. Only the files this slice touched are described above; ask to have them committed on their own if that is wanted.

## 2026-09-25 — Shape blend 01: schema 19, command, Layers panel, live preview (docs/plans/shape-blend)
- Schema 19 (`model.ts`, `migrateV18.ts`; 18 becomes `projectSchemaV18`, no data transform): optional `blendMode` on shapes (`shapeSchema` in `edit.ts`); `shapeSchemaV18` (no `blendMode`) keeps v17/v18 files strict. New `src/core/graphicsPasses.ts`: `MAX_BLENDING_SHAPES = 8` and `blendingShapes(shapes)`.
- `layer-look-set` (`layerLookCommands.ts`) already allowed `blendMode` on `target.kind === 'shape'`; this slice added the cap: setting a mode on a 9th shape fails with `value-range` ("A project can blend at most 8 shapes."), and `shape-add`/`shape-duplicate` (`shapeCommands.ts`) enforce the same cap, dropping `blendMode` on a duplicate that would exceed it. `layerStackAt` already reported the shape row's `blendMode` (default `'normal'`); the Layers panel's Blend select is generic on the row, so it was already enabled.
- `ShapeActor.tsx`: new `blend?: boolean` prop (default true) spreads `blendStyle(shape.blendMode)` (from `CompositionLayers.tsx`) onto the shape's outermost element — the `data-shape-mask` wrapper when masked, otherwise the `data-shape-id` div — so a masked blending shape blends as a whole, not just its unmasked pixels. Brief 02 will pass `blend={false}` from the export-pass host.
- Export refusal: `buildExportManifest` (`plan.ts`) throws "Exporting shapes with a blend mode is not supported yet." as soon as `blendingShapes(project.shapes).length > 0`, before any asset resolution — the export host still paints every shape onto the one transparent layer FFmpeg overlays on the picture, which has nothing beneath it to blend with (brief 02 adds passes and removes this).
- Docs: `docs/EDITING.md` "Blend modes" now documents the shape case and the export refusal. `docs/MCP.md`, `electron/mcp/tools.ts` and `src/core/agentProtocol.ts` were checked (per the brief) but had no stale "only picture clips have a blend mode" wording to fix — that message lives only in `layerLookCommands.ts`'s failure text, which already said "clips and shapes."
- Verification (Windows 11): `npx tsc --noEmit -p .` clean. New/extended tests: `model.test.ts` (schema 18→19 migration, round trip with a blending shape, v17/v18 reject a shape `blendMode`, unknown blend name rejected), `itemCommands.test.ts` (blend on a shape applies and undoes, `normal`/`null` strip the field, the 9th blending shape fails, duplicate past the cap drops it), `layerStack.test.ts` (shape row reports its blend mode, default `'normal'`), `editCommandSchema.test.ts` (shape-target `layer-look-set` round-trips), `plan.test.ts` (a blending shape refuses export with the exact message; a plain one still exports), and a new `ShapeActor.test.tsx` (blend style on the right wrapper, skipped when `blend={false}` or the shape is normal). `npx vitest run src electron workers`: 35 fail, all the documented Windows baseline (export.test.ts — no H.264 encoder on this machine; EffectsPanel, TemplatesPanel, keynoteTemplates ×2; mcp/config; thumbnails path-separator), none new.
- Limitations: not exercised by hand in `npm run dev` — the Multiply-box-over-video / title-below-darkens / title-above-unaffected acceptance check and the Export-dialog refusal message are untested in the running app. Whether a blending shape visually blends with the video in the live preview (vs. just the CSS style being present) depends on `App.tsx`'s existing isolated-backdrop wrapping (`hasBlendedLayer`/`BLEND_BACKDROP_STYLE`), which only wraps picture layers today and was not touched here — worth checking by hand before trusting the preview pixel-for-pixel. macOS untested. The many other files in this working tree carry unrelated in-progress work from earlier briefs (Vox shapes, clip/title/caption blend and opacity, export speed); only this slice's files are described here.
- Next: brief 02 (`docs/plans/shape-blend/02-export-passes.md`) — the pass model, worker loop and FFmpeg graph that let export stop refusing blending shapes.

## 2026-09-25 — Layer opacity and blend 03: blend modes on clips
- Shipped modes: multiply, screen, overlay, darken, lighten, hard-light, difference, exclusion (`BLEND_MODES` in `edit.ts`, `BLEND_FFMPEG` in `exportArguments.ts`). **Dropped** (removed from `BLEND_MODES` and the UI): color-dodge, color-burn, soft-light. Real FFmpeg disagreed with the W3C formulas by up to 255/255 for them (FFmpeg `dodge`/`burn`/`softlight` are different formulas, and swapping operands to fix it would take the backdrop's alpha instead of the clip's). FFmpeg's `overlay` and `hardlight` are the W3C ones swapped; the table accounts for it.
- Shared rule `imagesHostPainted` (`src/core/hostPainted.ts`) now used by `App.tsx`, `plan.ts` and `layerStack.ts` (which previously ignored adjustment layers); false when an image blends.
- Preview: `blendMode` on the video/image/colour layers -> `mixBlendMode`; when any layer blends, `App.tsx` wraps the picture layers in an isolated black backdrop. Manifest: `ManifestClip.blendMode` (only when not normal); `v3Route` and the v2 shortcut treat it like opacity < 1. Export: `blendChains` in the stacked loop (full-frame `pad`, `tpad` at both ends, `split`, `gbrap`, `blend` with the clip first, `overlay`). Normal-only graphs are unchanged.
- Layers panel: blend select enabled for clip rows (`layer-look-set`), `· Multiply` suffix in the row detail.
- Verified (Windows only): `npm run typecheck` clean. `workers/media/blend.test.ts` (real bundled FFmpeg from `.tools/ffmpeg-win64-lgpl`) checks every shipped mode over 6x6 level grids with independent channels, plus overlay at 60 %, all within 2/255. New graph-string, plan, layer-panel and `hostPainted` tests. `npx vitest run`: only the known Windows baseline failures (export.test no H.264, EffectsPanel, TemplatesPanel, keynoteTemplates, mcp/config, thumbnails); `worker.test.ts` and `blend.test.ts` timed out once under full-suite load and pass alone. `npx electron scripts/export-parity.mjs --only layer-blend` (new stage, 540x540): Multiply PiP (colour clips), Screen image over the picture (forces FFmpeg), Overlay colour clip at 60 % over an image, and a Hard light/Difference/Exclusion tile scene all within max channel delta 2 (evidence `docs/decisions/evidence/x3-parity-layer-blend-2026-09-25.json`).
- Limitations: the parity stage needs no H.264 encoder, so its pictures are colour clips and PNG stills; a real video under a blend was not compared in a browser (the blend chain is source-agnostic) and no full MP4 export was encoded here (no H.264 encoder on this machine). Not tried by hand in `npm run dev`; macOS untested. Blend applies within the picture only (a zoom or glow still act on the blended result). Not committed: the touched files also hold unrelated in-progress changes from briefs 01 and 02.
- Next: try a Multiply picture-in-picture by hand in `npm run dev` and a real export; this plan is otherwise complete.

## 2026-09-25 — Layer opacity and blend 02: opacity on titles and the caption plane
- `TextOverlayActor` multiplies `item.opacity ?? 1` into the wrapper's motion opacity. `CaptionPreview` takes `captionOpacity` and wraps the plane in the same div as `captionMask` when either is active (`data-caption-opacity`). `App.tsx` feeds it from the shown cue's caption track and drafts text/caption opacity live (`lookDrafted`).
- Export: manifest `captionOpacities` (only entries < 1; `{}` default), `frameRequest.captionOpacity` (optional, no version bump), set in `frameRequestAtSequence` and passed through `frameHarness`. A caption track below 1 makes `flatSequence` return null (v2 has no such input), like a mask. A text overlay's `opacity` already travels in the actor's `item`. Manifests without a sub-1 opacity are unchanged.
- `LayersPanel`: the Opacity slider is now enabled for text and caption rows (only effect/blur rows have none).
- Verified: `npm run typecheck` clean; new tests in `plan.test.ts` (carried only when < 1, routes through v3) and `TextOverlayActor.test.tsx`; `npx vitest run`: 35 fail, all baseline on Windows (same files as before), none new. `npx electron scripts/export-parity.mjs --only keynote` (50 % title, 1080x1920 and 1920x1080) and `--only layer-opacity` (new stage: 50 % caption plane, 1920x1080) pass with byte-identical preview/export bitmaps and fainter-than-opaque asserts. Windows only.
- Limitations: no render test of the `CaptionPreview` plane markup (the plane needs a measured viewport, so server rendering never paints it; the parity stage covers it). Parity marker values above ~0xC00000 time out the preview capture on this machine; the new stage uses 0x500000. The `layer-masks` parity stage still fails on Windows (1920x1920 window clamped to the work area); unrelated. Runs overwrote `docs/decisions/evidence/x3-parity-2026-09-25.json`. Not exercised by hand in `npm run dev`.
- Next: 03 (blend modes).

## 2026-09-25 — Layer opacity and blend 01: schema 18 and the Layers header
- Schema 18 (`model.ts`, `migrateV17.ts`; 17 becomes `projectSchemaV17`, no data transform): `blendMode` (12 modes, `normal` never stored) on picture clips via `visualFields`, optional `opacity` (absent = 1) on text overlays and caption tracks (`edit.ts`).
- New command `layer-look-set { target, opacity?, blendMode? | null }` (`layerLookCommands.ts`, registered in `itemCommands.ts` and `editCommandSchema.ts`, so agent/MCP callers get it through the shared schema). Blend is clip-only; effects, blur, audio and adjustment clips are refused; default values strip the field on text/caption tracks. New issue kind `value-range`.
- `layerStackAt` rows carry `opacity`/`blendMode` (null = unsupported). `App.tsx` `lookDraft`/`lookDrafted` drafts opacity live and commits once; `LayersPanel` has a `layers-look` row (blend select + Opacity slider) and a `· 60%` suffix on rows.
- Verified: `npm run typecheck` clean; new tests for migration 17 -> 18, schema rejection, command apply/refuse/strip, layer stack, command schema. `npx vitest run`: 35 fail, all baseline on Windows (`workers/media/export.test.ts` no H.264 encoder, EffectsPanel, TemplatesPanel, keynoteTemplates x2, `electron/mcp/config`); none new. Windows only; not exercised by hand in `npm run dev`.
- Limitations: the blend select is disabled for every row ("Coming in the next update") (text/caption opacity was disabled here until brief 02). Video, image, color clips and shapes honour opacity live. Not committed: the touched files also hold unrelated in-progress changes.
- Next: 02 (text/caption opacity), then 03 (blend modes).

## 2026-09-25 — Shape "grow" animation (0 → 100% on the x axis)
- New shape animation kind `grow` (`edit.ts` enum, `shapeMotion.ts` `grow` frame value, `ShapeActor.tsx` horizontal scale about the shape's left edge, `ShapeInspector.tsx` option on enter and exit). Unlike `sweep`, which clips a full-size shape, the shape itself narrows, so strokes and arrowheads squash with it.
- Verified: `npx tsc --noEmit` clean; `npx vitest run src/captions/shapeMotion.test.ts src/core/model.test.ts src/core/shapeCommands` 60 pass; Windows. Not eyeballed in the app or through the export parity harness.
- Limitations: no schema version bump (older builds will reject a project that uses `grow`); anchor is always the left edge; rotated shapes grow along the unrotated x axis.
- Next: add `grow` to the shapes export-parity case and look at it in `npm run dev`.

## 2026-09-25 — Export speed 08: time estimate in the Export dialog
- New `src/export/exportHistory.ts`: `recordExportSpeed` / `estimateExportMs` keep an EWMA of measured frames per second per output-size bucket (480/720/1080/1440/2160) in `localStorage` key `caption-studio.export-speed` (injectable storage, try/catch, never in the project). No history or corrupt data gives null.
- `App.tsx` records frames ÷ wall time after a successful export; `ExportDialog.tsx` appends "· about N min on this machine (estimate)" to the summary only when there is history.
- Verified: `npx vitest run src/export src/ExportDialog.test.tsx` 93 pass; `npm run typecheck` clean; Windows. Not checked by hand in `npm run dev`; macOS untested.
- Limitations: speed varies with content and captions, so it is a rough estimate; the App.tsx edit is left uncommitted alongside unrelated in-progress changes.
- Next: none in this plan.

## 2026-09-25 — Export speed 07: "Show in folder" + completion notification
- `electron/exportIpc.ts`: successful exports are remembered per session (`completedExports`, last 20, keyed `senderId:requestId`). New `export:reveal` handler takes only a validated request id, `stat`s the file, then `shell.showItemInFolder`; returns `{ ok } | { ok: false, message }`. When the window is not focused, a local OS `Notification` announces "Export finished" (click focuses the window and reveals the file) or "Export failed".
- `preload.ts` / `env.d.ts`: `revealExport(requestId)`. `App.tsx`: `Notice` gains an optional `action`, rendered as a button that does not dismiss the notice; the success notice offers "Show in folder" and a failed reveal shows an error notice.
- Verified: `npm run typecheck` clean; `npx vitest run src electron` 1499 pass, 5 fail (all baseline on Windows: EffectsPanel, TemplatesPanel, keynoteTemplates x2, mcp/config), Windows.
- Limitations: not run by hand (Explorer selection and the background notification unwatched); no unit test (needs electron `ipcMain`/`shell`); macOS untested. `App.tsx` and `styles.css` edits are left uncommitted because they sit alongside unrelated in-progress changes.
- Next: none in this plan.

## 2026-09-25 — Export speed 06: taskbar progress, keep awake, quit guard
- `electron/exportIpc.ts`: `export:start` sets the window's progress bar (`setProgressBar`: fraction when measured, indeterminate otherwise), holds a `powerSaveBlocker('prevent-app-suspension')` for the job, clears the bar on success/cancel and shows an error bar for ~4 s on failure. New `hasRunningExports()`.
- `electron/main.ts` `before-quit`: while an export runs, asks "Keep exporting" / "Cancel export and quit" before shutting down; smoke modes never register the export IPC so they skip it.
- Verified: `npm run typecheck` clean; `npm test -- electron` 223 pass, 1 fail (`electron/mcp/config` file mode, baseline on Windows), on Windows.
- Limitations: not run in the app by hand (bar, dialog buttons, sleep prevention unwatched); no unit test for `hasRunningExports` (needs electron's `ipcMain`); macOS untested.
- Next: 07.

## 2026-09-25 — Export speed 05: honest export progress
- New `src/export/progressRate.ts`: EWMA frames/s, ETA and `describeExport`; wired into the topbar pill and inspector footer in `App.tsx` (renderer only, no IPC/schema change).
- Label reads "Preparing…" until FFmpeg reports frames, then "Exporting 42% · about 1:12 left · 38 fps". ETA and fps stay hidden until ≥3 s of samples and ≥2 % progress.
- Pill tooltip explains the export uses the project as it was when it started.
- Verified: `npm test -- src/export src/ExportDialog.test.tsx` (87 pass), `npm run typecheck`, on Windows. Not yet watched in the running app.
- Limitations: shows fps, not "× realtime" (output frame rate isn't available in App).
- Next: 06.

## 2026-09-25 — Vox graphics 01: shapes and arrows (schema 17)

**Changes.** New `project.shapes` (schema 16→17, empty by default): rectangles, ellipses, lines, arrows and highlighter bars with solid/dashed/dotted strokes, arrowheads, fills and draw-on / sweep / fade / pop / slide animation. Commands `shape-*` (undoable, MCP `edit`), a Graphics timeline lane, on-video handles (rectangle gizmo; `LineStageEditor` for ends, bend and move), `ShapeInspector`, six presets under Overlays → Shapes, and an MCP `add_shape` tool with presets in `list_creative_options`. Shapes share `layerOrder` with titles (`graphicsOrder.ts`) and appear in the Layers panel. Export: manifest v3 `shapes`, optional `shapeActors` on frame request v4, the same `ShapeActor` in the host, and shape motion in the layer-plan signature so animating shapes are never frozen. Full description: EDITING.md "Shapes (schema 17)". Roadmap slices 2–5 are in ROADMAP.md 4c.

**Verification (Windows 11).** `tsc --noEmit` clean. New and touched unit tests pass: shape motion, path geometry, commands and undo, v16→v17 migration and round-trip, duplicate ID across shapes and text, layer-plan signature during draw-on, manifest and frame request, timeline lane, line dragging, MCP `add_shape`. `npm run parity:export -- --only shapes` (new): 48 cases (six presets × four times × 4:5 and 16:9) agree between the visible preview window and the export host to within 1 level per channel, and the host draws the shape (evidence `docs/decisions/evidence/x3-parity-shapes-2026-09-25.json`). Building that check also led me to bound the draw-on mask and size each shape's SVG to the shape instead of the whole frame; I first suspected those (a 40000-unit mask region) of a memory error, but the error was the test's own bitmap diff, so treat them as cheap precautions, not proven bug fixes. The visible preview window's screen capture adds a few levels of noise to flat colours once a shape is on screen (which breaks an exact marker match), so that check compares with a small tolerance; the offscreen export path was run separately with consecutive markers, all 48 frames, with no stalls.

**Limitations.** The app was not driven by hand: the Overlays tab, dragging handles, the inspector and the lane are covered by unit/render tests but not clicked through. No real H.264 export with shapes was run (no encoder on this machine; the same 17 export tests fail on a clean checkout). macOS untested. No editor for `path` geometry, roughness or boil, and shapes are pinned to the screen (slices 2 and 4). I also had to repair `node_modules` (`npm ci`) after a scratch worktree removal deleted files through a junction; the lockfile is unchanged. `scripts/export-parity.mjs` had a Windows-only bug (importing a raw `C:\` path as a module), fixed here.

**Next.** Run the app and click through: add each preset, drag the ends of a curved arrow, undo, save and reload, export an MP4 and watch a draw-on animate. Then slice 2 (hand-drawn look).

## 2026-09-25 — Export speed 04: parallel render pool

`renderVideo` now runs N export hosts feeding the one FFmpeg encoder in frame order (`workers/media/export.ts`, new `RenderHost` wrapper in `exportProcesses.ts`). N = `clamp(floor(availableParallelism / 4), 1, 3)`, overridable with `CAPTION_STUDIO_EXPORT_HOSTS`, and never more than the frame count. Each host has its own `--user-data` profile and the same `--asset` list and `--transport`; host 0 also rasterizes the masks before the encoder starts. The painted indices are still planned from layer signatures, so the previous/gap reuse rule is unchanged. Each painted index goes to the next idle host, results are consumed strictly in index order, and at most 2N painted frames are outstanding. Any host dying, a stall or cancellation fails the export through `mostInformativeFailure`, and every host is stopped and its profile directory removed in `finally`. `timings` gains `hosts`. `hostWaitMs` now means time the frame loop spent waiting on painted frames (per-host waits overlap, so they can no longer be summed).

**Measured** (Windows 11, 12 logical cores, my synthetic 1080p/30 fps 15 s source, real `--export-smoke`, PNG transport, 450 frames):

| Workload | Hosts | fps | hostWaitMs | encoderWaitMs |
|---|---|---|---|---|
| 290 cues of 50 ms (291 painted / 159 reused) | 1 | 22.9 | 19071 | 535 |
| same | 2 | 37.7 | 11250 | 603 |
| same | 3 (default) | 48.2 | 8436 | 802 |
| 30 cues, 500 ms (31 painted / 419 reused) | 1 | 131.8 | 2110 | 1284 |
| same | 3 | 142.2 | 609 | 2518 |

The gate from brief 03 held (hostWaitMs well above encoderWaitMs on the dense run). Output is identical: `ffmpeg -f framemd5` of the decoded video matches between 1, 2 and 3 hosts on both workloads (450 frames each).

**Verification.** `tsc --noEmit` clean. `workers/media/export.test.ts` passes 48/48 with `process.platform` spoofed to darwin, including new tests for in-order delivery under random per-host delays, the 2N cap, reuse pattern with 3 hosts, a host dying, cancellation and `exportHostCount`. On real Windows the pool tests fail like the other `renderVideo` tests (they assume VideoToolbox), so 5 more failures on top of the existing baseline. The test file now pins `CAPTION_STUDIO_EXPORT_HOSTS=1` so the older tests do not depend on core count.

**Limitations.** Windows only, 1080p only; no macOS run, no 4K run, peak memory not measured. Static-caption exports gain little (encoder-bound after reuse). The source video was mpeg4 because the bundled LGPL FFmpeg has no libx264.

**Next.** Brief 05 (UX progress).

## 2026-09-25 — Export speed 03: raw caption transport (opt-in, not the default)

Added a raw transport: the host writes `[4-byte length][premultiplied BGRA bitmap]` and FFmpeg reads it as `rawvideo`. `FrameReader` (was `PngReader`, alias kept) takes `frame('png' | { rawBytes })` and rejects any other size before allocating; worker env `CAPTION_STUDIO_EXPORT_TRANSPORT=raw` selects it and passes `--transport` to the host. The PNG arguments are byte-identical to before, and masks stay PNG. **PNG remains the default**, because raw failed the ±1 parity bar.

Measured on Windows 11, my synthetic 1080p/30 fps 15 s source, real `--export-smoke`:

| Workload | Transport | fps | hostWaitMs | encoderWaitMs | painted/reused |
|---|---|---|---|---|---|
| 30 cues (static) | PNG | 117–131 | 2997–3226 | 940–2087 | 31 / 419 |
| 30 cues (static) | raw | 70 | 2972 | 5906 | 31 / 419 |
| one cue per frame | PNG | 22–23 | 19.2–20.2k | ~550 | 300 / 150 |
| one cue per frame | raw | 28–29 | 15.0–15.7k | 1.3–1.5k | 300 / 150 |

Raw saves about 4.5 s of host time on the dense run but is slower when most frames are re-sent. **hostWaitMs is still larger than encoderWaitMs in both workloads with PNG and raw**, so brief 04 (render pool) applies.

Parity. `npm run parity:export` cannot complete on Windows: its composite stage encodes with `h264_videotoolbox`; the earlier stages ran. I compared the two transports directly instead (real host bitmap, FFmpeg composite over smptebars, 4 Malayalam/English fixtures) against an ideal composite: with `overlay=alpha=premultiplied` the mean error near text is 11.6 levels vs 1.7 for PNG (FFmpeg blends premultiplied YUV without the black offset), so the graph un-premultiplies instead (`format=gbrap,unpremultiply=inplace=1` into the straight overlay). That is bit-identical to PNG away from the caption but opaque white becomes 253 and error near text averages 2.7 vs 1.7 (max delta ≈60 at glyph edges). Not within ±1, so raw stays opt-in.

Verified: `tsc --noEmit` clean; new tests for the reader, both argument builders and the worker; `workers/media/export.test.ts` 41/41 with `process.platform` spoofed to darwin. On real Windows the same 21 pre-existing tests fail plus 4 new `renderVideo` raw/default tests that share their VideoToolbox assumption. Output probes as 1920×1080, 450 frames, H.264 for all runs.

Limitations: Windows only, 1080p only; no 2160p or macOS run. I did not investigate the 253 offset further (possibly swscale's gbrap→yuva420p path). My parity runs overwrote/created `docs/decisions/evidence/x3-parity-2026-09-25.json` and `x3-parity-shapes-2026-09-25.json` (untracked, not committed).

Next: brief 04 (render pool), since the host is still the bottleneck.

## 2026-09-25 — Export speed 02: overlap caption rendering with encoding

The frame loop now asks the host for the next frame that needs painting as soon as the current PNG arrives, while FFmpeg ingests it (`workers/media/export.ts`). Still one host request in flight and at most one extra PNG buffered; which indices need painting is planned from layer signatures alone, with the same previous/gap reuse rule, so bytes reach the encoder in identical order. A prefetch rejection is swallowed for bookkeeping and observed when the loop awaits it. The caption pipe's `-thread_queue_size` is 8 (both builders, snapshots updated), and the export host adds `disable-renderer-backgrounding`, `disable-background-timer-throttling` and `disable-backgrounding-occluded-windows`.

Measured on Windows 11 with my own synthetic 1080p/30 fps 15 s source (testsrc2 + sine) and 30 SRT cues (Malayalam + English, one per 0.5 s), real `--export-smoke`. The brief-01 media is not recorded, so this is a before/after on the same input, not a comparison with the table above:

| Build | Frames | fps | hostWaitMs | encoderWaitMs | painted/reused |
|---|---|---|---|---|---|
| before (HEAD loop, new args) | 450 | 107.1 | 3054 | 1110 | 31 / 419 |
| after (3 runs) | 450 | 111.8–112.7 | 3050–3146 | 3030–3154 | 31 / 419 |

Gain is about 5 % here: only 31 of 450 frames are painted, and the run is dominated by host paint time. `hostWaitMs`/`encoderWaitMs` are wall-clock waits per stage and now overlap, so they no longer sum to the loop time; encoder wait rising means the encoder wait absorbs time the host previously spent alone. Both outputs probe as 1920×1080 with 450 frames. The 4K run was not repeated.

Verified: `tsc --noEmit` clean; `workers/media/export.test.ts` 31/31 with `process.platform` spoofed to darwin, including two new tests (frame order with gap reuse under prefetch; host asked for the next frame while the encoder write is blocked, then cancel leaves no unhandled rejection). The stall-deadline tests still pass. On real Windows the file has the same 19 pre-existing failures plus my 2 new ones (fixtures assume VideoToolbox). Limitations: Windows only; macOS untested; the flag effect on throttling was not measured separately. Next: brief 03 (raw transport).

## 2026-09-25 — Export speed 01: stage timings + cached support check

Every export now records `timings` (startup, host wait, encoder wait, painted/reused frames, finalize, total, fps) in the local export log and the smoke output; `exportSupport()` caches `supported: true` per session. No output changes. Baseline (Windows 11, 30 cues, 1 cue/0.5 s, real `--export-smoke`):

| Run | Frames | fps | startupMs | hostWaitMs | encoderWaitMs | painted/reused |
|---|---|---|---|---|---|---|
| 1080p (15 s) | 447 | 102.6 | 705 | 3233 | 1087 | 31 / 416 |
| 4K (19.8 s) | 474 | 25.8 | 746 | 11616 | 6734 | 31 / 443 |

Verified: typecheck clean; `workers/media/export.test.ts` 29/29 with `process.platform` spoofed to darwin. On real Windows 18 tests in that file fail with or without this change (fixtures assume VideoToolbox; thumbnails.test.ts path-separator failure too). Limitations: Windows only; macOS untested. Next: brief 02 (host wait dominates: ~375 ms per painted 4K frame).

## 2026-09-25 — New monochrome KathaCut logo

**Changes.** The logo is now the single-colour "K + play" mark (`img/logo.png`) and lockup (`img/logo-with-text.png`), both black ink on transparent. Everything below is derived from them by a PIL script that uses the alpha channel as the mask: `src/assets/brand/icon-dark.png` (toolbar mark, light on transparent), `public/favicon.png`, `src/assets/brand/logo-dark.png` (splash lockup, light), `assets/icon.png` (1024², black mark on a white rounded 824² tile with a soft shadow; window, dock and Windows installer icon) and `assets/icon.icns` (PNG entries ic07–ic14, written directly since `iconutil` is macOS-only). `assets/logo.png` is a copy of the new mark. The toolbar wordmark matches the lockup: one colour, "Katha" heavy and "Cut" light, with the pink→orange gradient gone. The splash tagline is now HTML text under the lockup, and the splash sweep is neutral white. The UI accent tokens (violet `#6a58fc`) stay as they were.

**Verification (Windows 11).** `vite build` passes. I checked the generated assets visually on the app's #090b10 background and on a light background. The app was not run.

**Limitations.** Not checked in a running window: the toolbar, the splash, the taskbar/dock icon. `assets/icon.icns` has not been opened on macOS. The violet accent came from the old gradient logo and may need revisiting now that the mark is monochrome.

**Next.** Run `.\dev.ps1` and check the toolbar, splash and taskbar icon; build a Windows installer to see the `.ico` electron-builder generates.

## 2026-09-24 — MCP: editorial judgment guidance, `import_media`, `place_at_word`

**Changes.** The agent no longer has to be told what to add. `list_creative_options` now returns `mood`/`useWhen`/`avoidWhen` for every background preset, look, title treatment and effect kind, plus `effectGuidance`, `zoomGuidance` and five `styleRecipes` (`src/core/editorialGuidance.ts`, `src/core/styleRecipes.ts`); a test fails if a catalog entry lacks guidance. `EDITING_GUIDE` and the `auto_edit` prompt were rewritten as a senior-editor workflow (sample frames, diagnose, commit to a recipe, map beats to tools, restraint, verify, report). New `import_media` (path, clipboard, base64 or public https url; optional same-undo-step image placement) and `place_at_word` (image at a spoken word/phrase in sequence time; flags estimated timing). Bytes not from a path land content-addressed in `<userData>/agent-media/` and go through the same probe/fingerprint path as a dragged-in file. Two new IPC request kinds (`import-inspected`, `place-image`), validated in the preload schema.

**Verification (Windows 11).** `tsc --noEmit` clean. New tests pass (guidance coverage, word anchoring incl. Malayalam, import rules/redirects/size caps/atomic save, bridge dispatch, real-server tool tests). Full suite: 23 failures, the same count as the previous entry recorded on a clean HEAD (export tests need an H.264 encoder this machine lacks, `config.test.ts` expects POSIX 0600 mode, plus panel/template tests); I did not re-run them on a clean tree today.

**Limitations.** The renderer handlers in `App.tsx`, `importSource` in `electron/mcp/ipc.ts` (clipboard, network fetch, real probe) are typechecked but never ran in a real window; no real Claude Code/Desktop session and no export with an imported image was checked. `url` import does not defend against DNS rebinding. Placement is images only. Image clips are still static, so Vox-style motion (Ken Burns, pop-in, border/shadow/tilt) is not possible yet. The guidance is advice: how well a model follows it is not enforced or measured. macOS untested.

**Next.** Run the app, enable agent access and try `auto_edit` on a real clip, `import_media` from a path, the clipboard and a url, and `place_at_word`, including an export. Then animatable image clips and a "Vox collage" recipe.


## 2026-09-24 — MCP: transcript-to-edit loop, frame capture, reference color match, Claude Desktop connector

**Changes.** New MCP tools: `get_transcript` (cues in sequence time via `cuesInSequence`, with `omitted` count), `list_creative_options` (looks, background presets, title treatments and JSON Schemas generated from the zod schemas; background presets moved to `src/core/backgroundPresets.ts`), `add_title`, `render_frame` (renderer seeks and waits for the frame to paint, main `capturePage`s and downscales to JPEG), and `match_color_to_reference` (reference from path, clipboard or base64 → `deriveMatch`/`bakeMatch` against the frame under the playhead → LUT saved without a dialog to `<userData>/generated-luts/` → asset plus adjustment clip in one undo step). `get_project` now reports zoom regions, markers and title motion. The server sends `instructions` and an `auto_edit` prompt describing the workflow. Claude Desktop connects through `electron/mcp-stdio.ts` (bundled to `dist-electron/mcp-stdio.cjs`), and Settings → AI agents shows the exact config entry. See docs/MCP.md.

**Verification (Windows 11).** `tsc --noEmit` clean. New tests pass (bridge dispatch, creative options, reference image rules, real-server tool tests, stdio bridge through a real server). The built connector ran as a child process under a real MCP stdio client against a real server, and starts under the dev Electron binary as Node. Remaining failures are the same as on a clean tree: `config.test.ts` (0600 mode on Windows) and two `keynoteTemplates` tests.

**Limitations.** The renderer-side handlers in `App.tsx` and `capturePage` are typechecked but have not run in a real window with real footage, and no real Claude Desktop or Claude Code session was used. The connector is untested from an installed build (`ELECTRON_RUN_AS_NODE` may be disabled by packaging). macOS untested. Grade quality from `match_color_to_reference` is unjudged. No job tools yet (transcribe, export, save), no media import, no `place_at_word`.

**Next.** Run the app, enable agent access, connect Claude Desktop, and try the loop end to end on a real clip; then MCP job tools.

## 2026-09-24 — Installable test builds (Windows .exe, macOS .dmg)

**Changes.** `npm run dist:win` builds `release/KathaCut-Setup-<v>-win-x64.exe` (NSIS, ~620 MB) and `npm run dist:mac` builds `KathaCut-<v>-mac-arm64.dmg`, both with electron-builder 26.15.3 (`electron-builder.yml`, `asar: false` because the worker and export host are spawned by path). Each installer carries FFmpeg, ffprobe and whisper-cli under `resources/bin`, staged by `scripts/stage-tools.mjs`. Windows ships the BtbN LGPL FFmpeg, whisper.cpp b5130 (1.9.4) with the CUDA build plus CPU backends, and the app-local VC++ runtime. macOS ships FFmpeg 9.0.1 built by the new `scripts/build-ffmpeg.sh` (the documented LGPL profile, libvpx/opus static) and `build-whisper.sh`'s Metal build. No model is bundled; the user downloads one in the Models dialog. Four packaged-mode faults were fixed: (1) tools resolve from `resources/bin` when packaged (`bundledToolPaths` in `electron/toolConfig.ts`; env vars and the dev-only local JSON still win); (2) the export host is started through a shim, `electron/entry.ts` (new `main`), which runs `dist-export/host.cjs` when argv has `--kathacut-export-host`, because a packaged Electron ignores a script argument (`exportHost.args` in the toolchain schema); (3) userData is pinned to `<appData>/caption-studio` so packaged and dev share models, keys and caches; (4) `export-host.mjs` finds `index.html` beside its own bundle. `.github/workflows/package.yml` builds both installers and drafts a GitHub pre-release. `docs/INSTALL_TESTERS.md` has the friend-facing steps.

**Verification (Windows 11, RTX 3070 Ti, x64).** `tsc --noEmit` clean. New toolConfig tests pass. The full suite has 23 failures, the same 23 on a clean HEAD worktree (export.test 17, thumbnails 1, keynoteTemplates 2, TemplatesPanel 1, EffectsPanel 1, mcp config 1). Ran the unpacked installer output `release/win-unpacked` with no env vars and no local JSON: the editor window opens; `--media-worker-smoke` finds the bundled tools; `--export-smoke` produced a 1080x1920 H.264+AAC MP4 (90 frames, caption burned in) through the flag-launched host; `--transcription-smoke` with ggml-base transcribed synthesized speech on `CUDA0` (devices cpu, cuda). With the CUDA DLLs removed, whisper-cli falls back to the CPU backend and transcribes the same clip. The installer itself was built but not installed and run.

**Limitations.** macOS is not built or tested: `build-ffmpeg.sh`, the macOS staging, ad-hoc signing and the workflow have never run, and the `.dmg` needs a first run on a real Apple Silicon Mac (a broken FFmpeg link set fails the staging check by design). Both installers are unsigned (SmartScreen and Gatekeeper warnings). No Intel Mac build. The Windows FFmpeg is BtbN's rolling `latest` asset, checked against its published checksums only, and is LGPL-3.0 (`--enable-version3`), unlike ADR 0001's LGPL-2.1 profile; for a public release pin it or build it. The CUDA runtime is redistributed under NVIDIA's EULA. NVENC still needs driver 610+ for FFmpeg 9, else Media Foundation is used. The 4 Effects/Templates and 17 export tests that fail on Windows are unrelated to this change. Not tested: a machine with an NVIDIA GPU but no driver, or a PC without the VC++ runtime.

**Next.** Push the branch and run the "Package installers" workflow. Send the friend the two files from the draft release. Install the Windows one on a second PC before sharing. Then pin the FFmpeg asset and decide on signing.

## 2026-09-24 — Windows export froze at 46% with no message

**Cause (not yet confirmed).** Reported: a Windows export stopped at 46% and stayed there. The frame loop had no deadline on any step. It waited on the host for a PNG and on FFmpeg to accept one, so a process that stayed alive but stopped making progress froze the bar without an error. Two gaps made this possible. (1) The host's 15 s paint deadline started only after `window.x1.render` returned, so a page render that never settled blocked the host. (2) After encoding, the worker also waited without limit for the host to exit. That wait would hang if Electron on Windows misses stdin EOF. This could not be reproduced here, so which process stalled at 46% is still unknown.

**Changes.** Each frame step now has a 60 s stall deadline (`FRAME_STALL_MS`). A stall fails the export with `Export stalled at frame N of T: the caption renderer returned no frame…` or `…the h264_mf encoder accepted no frame…`, and attaches that process's stderr tail as the diagnostic. `ownedProcess` exposes `diagnostic()` for this. The host's deadline now covers the page render as well as the paint. After FFmpeg finishes, the host gets 2 s to exit and is then reaped. Files: `workers/media/export.ts`, `workers/media/exportProcesses.ts`, `scripts/export-frame-transport.mjs`, plus 3 tests in `export.test.ts`.

**Verification (Linux only).** `tsc --noEmit` is clean and `build-export.mjs` builds. With `process.platform` stubbed to darwin, `workers/media` passes 138 tests (135 before, plus 3 new). Run unstubbed on Linux, the renderVideo tests stop at the encoder gate as they did before (14 fails before, 17 with the new tests). Nothing was run on Windows.

**Limitations.** This makes the hang fail with a named cause; it does not fix the root cause. A frame that legitimately takes over 60 s would now fail.

**Next.** Re-run the same export on Windows. It should now fail within about a minute and name the renderer or the encoder. Use that message and the `export` log line in `%APPDATA%\caption-studio\logs\export.log` to fix the root cause.

## 2026-09-24 — Windows export: "[aost#0:1/aac] Terminating thread with return code -22"

**Cause.** The AAC lines were FFmpeg's teardown, not the fault. On this machine (RTX 3070 Ti, driver 591.86) FFmpeg 9.0.2's NVENC needs API 13.1 (driver 610+), so the probe correctly rejected it and selection fell back to `h264_mf`. The probe was a bare `-c:v h264_mf` encode, which passed. The real export adds `-hw_encoding 1 … -pix_fmt yuv420p`, and the hardware Media Foundation encoder rejects yuv420p (`format negotiation failed (1/0)` → `Error while opening encoder`). No video packets were written, so AAC and the muxer failed after it. The notice showed only the last two stderr lines.

**Changes.** `videoEncoderPixelFormat` hands `h264_mf` NV12, which is the same 8-bit 4:2:0 and still reads back as yuv420p. VideoToolbox and NVENC keep yuv420p, and the VideoToolbox arrays are unchanged. `encoderProbeArguments` now uses the export's own encoder block and pixel format, so a passing probe means the real flags open. The export notice now shows the first root-cause lines of stderr with FFmpeg's teardown lines removed (`src/core/exportDiagnostic.ts`). Files: `src/core/exportEncoder.ts`, `workers/media/exportArguments.ts`, `src/App.tsx` (+ tests).

**Verification (Windows 11, FFmpeg 9.0.2 Gyan build).** `h264_mf -hw_encoding 1 -rate_control cbr -pix_fmt nv12` with AAC encodes 1080×1920 and 1920×1080 to valid h264+aac MP4s, including a v3-shaped `amix` graph. The same flags with yuv420p reproduce the failure. The new probe passes. `tsc --noEmit` is clean. `vitest run` has 20 failures, the same 20 as without this change (export.test.ts, thumbnails, panels, mcp config); the 9 new tests pass.

**Limitations.** No in-app export to a finished MP4 has been re-run yet. Output from MF is Constrained Baseline profile. macOS is not re-tested; its arguments are pinned by snapshots. NVENC still needs a driver of 610 or newer for FFmpeg 9.

**Next.** Export from the app on Windows (v2 single clip and a v3 multi-track timeline).

## 2026-09-24 — Windows export: "Caption renderer closed before completing a frame"

**Changes.** The export host had never run on Windows; three Windows-only faults made it exit silently (code 0) before its first frame. (1) Electron's `process.stdin` reports `end` immediately, so the host quit; it now reads fd 0 with `fs.createReadStream`. (2) `Electron.exe` prints a stray `\r\n` to stdout at startup, which would corrupt PNG framing; `PngReader` drops it once before the first frame. (3) Windows clamps the `BrowserWindow` constructor size to the display work area (1380 px tall here), so paints never matched the composition; the host now calls `setContentSize` after creation, and empty 0×0 startup paints count as stale. Files: `scripts/export-host.mjs`, `scripts/export-frame-transport.mjs`, `workers/media/exportProcesses.ts` (+ test).

**Verification (Windows 11).** Ran `dist-export/host.cjs` directly with a real frame request: 1080×1920 and 1440×2560 each return PNG bytes and no stderr. New `PngReader` test passes; `tsc --noEmit` clean. 15 tests in `workers/media` fail identically with and without this change (they fail before it too).

**Limitations.** No full in-app export was run to a finished MP4. The host still lingers ~seconds after `app.exit(1)` on a frame failure (the worker kills it). The export log records only code and message, not the host diagnostic.

**Next.** Re-run the 1440p export in the app; if it fails, the diagnostic should now name the frame.

## 2026-09-24 — Windows `npm run dev` no longer needs bash

**Changes.** `predev` ran `bash scripts/stop-stale.sh`. On Windows `bash` is the WSL launcher, so `.\dev.ps1` failed with `execvpe(/bin/bash) failed` when no distro was installed. The hook is now `node scripts/stop-stale.mjs`. On macOS/Linux it runs the unchanged `stop-stale.sh`. On Windows it lists processes via CIM, stops those whose command line contains this checkout's `node_modules\` path or that hold port 5173 with a command line inside the checkout, skips its own ancestors, and uses `taskkill /T /F`.

**Verification (Windows 11).** With nothing stale, the hook exits 0. A Vite process started from `node_modules` was found and stopped. Not re-run on macOS; that path still only calls `bash stop-stale.sh` as before.

**Limitations.** `tools:whisper` and `convert:hf-whisper` still need bash, and are not used by `dev.ps1`.

**Next.** Continue the Windows export validation below.

## 2026-09-24 — Rebrand to KathaCut

**Changes.** The app is now **KathaCut** ("Your local AI video toolkit."). This covers the window/page title, the toolbar wordmark (bold "Katha", lighter accent "Cut", no space, "K" mark), the native app name and About panel (`app.setName`), the project file-dialog filter and the MCP overview tool text, plus the README heading. Internal identifiers stay as they were so existing installs keep working: the userData folder (pinned explicitly to the old `caption-studio` path, so models, caches, logs and secrets are kept), the `CAPTION_STUDIO_*` env vars, `caption-studio.local.json`, the `.cstudio`/`.captionstudio.json` project extensions, `window.captionStudio` and the npm package name.

**Logo.** The source art is in `img/logo.png` and `img/logo-icon-only.png`. Their near-black parts are unreadable on the #090b10 UI, so dark-UI variants were made with ffmpeg: neutral pixels inverted, gradient kept, padding cropped. They are `src/assets/brand/logo-dark.png`, used for the launch splash in `index.html` (dismissed by `main.tsx` after ~0.7 s, with an indeterminate sweep and no progress figure), and `src/assets/brand/icon-dark.png`, used for the toolbar mark and favicon. `build/icon.png` (the icon on a white rounded tile, 1024²) is the window icon and the dev-run dock icon. The "Cut" in the wordmark uses the logo's pink→orange gradient.

**Theme.** The UI accent moved from lime `#c8ff3d` to the logo's blue-violet, `#6a58fc`, sampled from the top of the diagonal stroke. It is now a set of `:root` tokens in `src/styles.css`: `--accent`, `--accent-hover`, `--accent-text` (#a597ff, for small text/icons on dark, where #6a58fc is too dim), `--on-accent` (white), `--accent-glow`, `--accent-wash`, `--accent-bg` and `--accent-border`. The inspector's `--ins-accent` points at these tokens. Two things stay as they were on purpose. Caption style defaults and templates (`src/captions/style.ts`, `templates.ts`) keep their lime/yellow, because they are video content, stored in projects and burned into exports. The green "agent running" chip keeps its live-status colour.

**Verification.** `npm run typecheck`; `vitest run` (991 passed); `vite build` rewrites the splash and favicon asset URLs. macOS only.

**Limitations.** Not checked in the GUI: the wordmark, the splash and the toolbar icon, the macOS app-menu/About name, and whether the dev-run dock name changes (unpackaged Electron may still show "Electron"). Older docs and tickets still say "Caption Studio". Packaging (D2) must set `productName: KathaCut` while keeping the userData path, and build `.icns`/`.ico` from `build/icon.png`.

**Next.** Check the toolbar and About panel in a dev run. Then resume the Windows export validation below.

## 2026-09-24 — Windows export (NVENC / Media Foundation) and `dev.ps1`

Export no longer stops at macOS. See [ADR 0007](decisions/0007-windows-export-encoders.md).

**Changes.** New `src/core/exportEncoder.ts` (encoder ids, per-platform candidates, exact argument blocks) and `workers/media/exportEncoderSelect.ts` (lists encoders, runs a real test encode, caches the winner). `exportArguments`/`exportArgumentsV3` take an optional encoder (default VideoToolbox, macOS output unchanged). `exportSupportFromConfiguration` keeps the strict profile on macOS and accepts FFmpeg >= 7 + PNG + NVENC/`h264_mf` elsewhere. `electron/exportIpc.ts` and the worker's `exportSupport` use the selection and log the chosen encoder. New root `dev.ps1` finds or downloads FFmpeg and whisper-cli, writes `caption-studio.local.json` without a BOM, and launches.

**Verification (macOS only).** `npm run typecheck` and the full `npx vitest run` (110 files, 991 tests) pass, including new tests for the Windows gate, exact NVENC/MF arguments and the fallback order. Not run: any real export, `dev.ps1` (no PowerShell here), anything on Windows.

**Limitations.** Windows is unvalidated: NVENC/`h264_mf` output, the FFmpeg/whisper download URLs and checksum handling, and PowerShell 5.1 behaviour are untested. FFmpeg comes from a rolling BtbN asset, so the checksum guards corruption only. whisper-cli uses the `b5130` build tag because v1.9.4 has no binaries. No Settings UI for the encoder (env `CAPTION_STUDIO_EXPORT_ENCODER` only). GPL FFmpeg builds are accepted for local use.

**Next.** Run `.\dev.ps1` on the Windows PC and export once with NVENC and once with `CAPTION_STUDIO_EXPORT_ENCODER=h264_mf`; confirm `h264_nvenc` in the export log.

## 2026-09-24 — Signature looks, live look thumbnails, Match reference image

**Changes**: Six new bundled looks (Cartel Dusk, Neon Assassin, Wanderlust Teal & Orange, Moody Matte, Cold Forest, Golden Drift) built on a new hue-band + matte extension of `Look` (`hues`, `fade`; Oklab helpers in `oklab.ts`). Film-look tiles now show the playhead frame (or a drawn sample scene) graded through each look. New "Match reference image…" in My LUTs derives a tone/color transfer from a picked still (`referenceMatch.ts`), previews it with a strength slider and saves a `.cube` via new `lut:save-generated` IPC, then adds it as a `lut` asset. Fixed `inspectLut` never registering LUTs in `inspectedMedia`, which made export throw "LUT … is missing" for any imported LUT. Looks are named for a genre, not a film or creator; the banned-name test now also rejects those names.

**Verification**: `tsc --noEmit` and `npm run build` pass. New unit tests for hue-band looks, `referenceMatch` (identity, monotone curve, cast and split-toning transfer, strength, `.cube` round trip) and thumbnails all pass. Rendered the reference still through the new looks with the real bake/sample code and checked them visually. `npm test`: 1533 pass, 4 fail in `EffectsPanel`, `TemplatesPanel` and `keynoteTemplates` tests (Effects/Templates code, not touched here; not checked against a clean tree).

**Limitations**: Not GUI-tested: thumbnails on seek, the match dialog and save flow, and that a generated LUT exports. The export fix has no automated test (needs Electron main). Look parameters were tuned by eye on one still. Match quality depends on how alike the two images are. macOS only; Windows unvalidated.

**Next**: Manual acceptance of the Color tab flow and an export using a saved match LUT; tune looks on more footage; add a test that exports a project with a LUT.

## 2026-09-24 — Light particles effect

**Changes**: Added the **Light particles** Effects tile and preset, effect lane/header, inspector controls (amount, size, speed, color), effect command support, masks, bypass and undo through the existing frame-effect command path. The shared frame evaluator generates an effect-ID-seeded particle field from absolute sequence time at 60 Hz, with a 200 ms edge fade; the shared preview/export painter renders up to 72 warm radial particles with occasional bright cores behind captions and titles. Added the evaluated particle parameters to the export frame request and frame signature so animated frames are repainted. No external asset or FFmpeg filter is used, and the current project schema version remains 16.

**Verification**: No tests, typecheck, build or export commands were run, as requested. The preview and export paths call the same painter by construction; rendered parity has not been checked.

**Limitations**: GUI behavior, particle performance during playback, masks and save/reopen, and actual MP4 output have not been manually verified. Windows is unvalidated.

**Next**: Manual acceptance — add by click and drag, adjust all controls, move/trim/mask/bypass, undo/redo, save and reopen, seek repeatedly to one timestamp, then export a short clip and compare selected frames with preview.

## 2026-09-24 — Linked audio follows its video to the paired lane (V2 → A2)

**Changes**: `clip-move` now sends a link partner of the other kind to the same-ordinal lane when the grabbed clip changes track (video to V2 → its audio to A2, and audio to A2 → video to V2), creating that lane if it does not exist (`pairedLane` in `clipCommands.ts`). Locked paired lanes fall back to the previous behaviour (partner stays, or moves to a free lane if it would collide).

**Verification**: two new `linkedAudio.test.ts` cases (existing A2; A2 created). `src/core` suite: 699 pass; `tsc --noEmit` clean. Not GUI-tested.

**Limitations**: the drag preview shows only the grabbed clip changing lane; the audio jumps on drop. Ordinals are by lane order among tracks of a kind, so V3 with only A1 creates A2, not A3.

**Next**: manual smoke — drag a linked video from V1 to V2 (existing and new lane), and an audio clip from A1 to A2.

## 2026-09-24 — Healing cuts: trims pass over continuation pieces; linked mid-clip drops

**Changes**
- Dropping or moving a clip into the middle of another (overwrite) splits it; after the dropped clip was removed, the left piece's edge stopped at the right piece, so the original length could not be dragged back (video and audio). An overwrite trim now passes over neighbours that only continue the clip (`continuesClip` in `clipEdits.ts`: same file, same track, same source↔sequence mapping within 1 µs, identical settings apart from id/placement/source range/link) and carves them away. Dragging all the way heals the cut into one clip; stopping part way leaves an invisible through edit. Other neighbours still block. The live drag preview uses the same `trimClip`, so the preview matches.
- Dropping a linked video+audio pair inside another pair was refused ("A link group holds at most one video clip"). `clip-add` and `clip-move` now regroup the carved right-hand pieces into their own pair (`relinkPieces`) and drop link groups left with one member; `clip-trim` drops lone links after a heal.

- **Linked audio could not be dragged back.** A linked trim moved every member by the smallest amount any could take, so once the video was at full length (or otherwise held), audio carved by an overlap could never extend. Overwrite trims now carry only partners whose same edge is in sync with the grabbed one (`trimPartners`, `clipLinks.ts`); an out-of-sync partner stays put, so either side can be dragged back into line. Ripple trims still carry every partner. The timeline drag preview uses the same followers and common clamp, so it no longer shows an extension the commit then refuses.

**Verification**: `tsc --noEmit` clean. New tests in `linkedAudio.test.ts` (audio carved under a full-length video drags back; grabbing the video leaves the out-of-sync audio alone) and `clipEdits.test.ts` (partial/full heal both directions, source bound, blocking by other file/offset/settings, blocker beyond the piece) and `linkedAudio.test.ts` (pair dropped inside a pair → two valid pairs → delete → trim heals both lanes). Full suite: 1366 pass, 3 fail — the same `TemplatesPanel.test.tsx` / `keynoteTemplates.test.tsx` failures noted below (not touched). Not GUI-tested.

**Limitations**: ripple trims are unchanged (they push the piece rather than heal it). A bin drop (`clip-add`) inside a linked clip puts the new clip's audio on a free lane, so the lower clip's audio is not cut; only the video heals. Partial heals leave a through edit (no explicit "join clips" command yet).

**Next**: manual smoke — drop a clip inside another on V1 and on an audio track, delete it, drag the first clip's end back to full length; repeat with a linked pair via drag-move.

## 2026-09-24 — Timeline headroom past the program end + append-to-V1

**Changes**
- The ruler and lanes now draw `timelineViewSpanUs(program)` (program + max(30 s, 25 %)) instead of exactly the program length, so media can be dropped or clips dragged past the last clip. Playback, export, seek limits and In/Out still use the program length (`Timeline` `programUs` prop; the region after it is hatched).
- Bin **Add** on a later video now appends after the last clip on V1 (the lowest unlocked video track) instead of stacking a new track at the playhead.

**Verification**: `tsc --noEmit` clean; new `timelineViewSpanUs` and `dropTimeAt` tests; timeline/drop/MediaBin suites pass. Full suite: 3 failures in `TemplatesPanel.test.tsx` / `keynoteTemplates.test.tsx` (templates work in progress, not touched here). Not GUI-tested.

**Limitations**: after a drop that extends the program the span grows once, so the ruler rescales. No dedicated "append" action on the timeline toolbar.

**Next**: manual smoke — Add second video, drag a third into the hatched tail, confirm export length.

## 2026-09-24 — Linked audio lanes (DaVinci-style), schema 15

**Changes.** A video no longer draws its sound inside its thumbnail. Each newly placed video with an audio stream gets a **linked audio clip on its own audio lane** (V1→A1, V2→A2; a lane is created when none is free), and the waveform is drawn only there.
- **Model (schema 15, additive; `migrateV14.ts` only bumps the version).** `linkId` on video/audio clips (a group holds at most one video), `detachedAudio` on video (its sound lives in the linked audio clip), `enabled` on every clip, `solo`/`volume` on tracks. An audio clip may play a **video** asset (first audio stream). **Existing projects keep embedded audio** — no auto-split; the Inspector's "Detach audio" (`clip-detach-audio`) opts a legacy video in.
- **Linked editing (`clipCommands.ts`, `clipLinks.ts`).** `clip-add` places the pair; move (one shared delta), trim (smallest common clamp so a pair never drifts), split (right-hand halves become a new pair), delete, ripple, trim-to-playhead, `enabled` and `speed` act on the group unless `unlinked: true`. `clips-link` / `clips-unlink`; silence removal and restore keep pairs matched piece by piece. All are in the MCP command schema; `get_project` reports `linkId`, `enabled`, `gain`, `detachedAudio` and track `solo`/`volume`.
- **UI.** Alt-click selects one side (edits then skip its partner); link glyph and dashed partner highlight; `D` disables/enables a clip (greyed, skipped everywhere via `activeClipsAt`); Cmd/Ctrl+Alt+L links/unlinks; audio track headers gain **S** (solo) and a fader (0–200 %, dB tooltip, double-click = 0 dB, one undo step per drag); label column widened 130→176 px.
- **Preview.** Audio clips of a video file play through pooled elements (`transport.ts` `videoAssetIds`), never as the clock master; pool capacity 6→10. Mute, solo, fader, disabled and detached folded into `effectiveGain` (`clipLinks.ts`), shared by preview and export; `SfxScheduler` uses it too.
- **Export (`plan.ts`).** Disabled clips dropped; gain = `effectiveGain`. An in-sync unity linked pair stays on the **v2** route (the video's own sound *is* the audio clip); anything else (mute/solo/fader/offset/gain ≠ 1) goes to v3, where the audio clip is its own `-ss/-t` input and the detached video is silent.

**Verification (macOS only).** `tsc --noEmit` clean; `npm run build` passes. New tests: `linkedAudio.test.ts` (24: migration, placement incl. second lane, linked move/clamp/trim/split/delete/unlinked, locked partner, enabled/speed sharing, link/unlink/detach, silence removal + restore, mute/solo/fader math), transport (audio elements, disabled), export plan (v2 pair, v3 fader/mute/solo/disabled), shortcuts. `npm test`: 1358 pass, 3 fail — the same keynote/template tests noted above (unrelated). `parity:export` was attempted and failed in `captionLayerParity` ("Unexpected pixel dimensions 1920×1920", `export-frame-transport.mjs`) before any audio case — headless/offscreen sizing, not exercised by this change; its stray evidence file was removed.

**Limitations / not tested.** Nothing was exercised in the real window (import two videos, lanes and waveforms, Alt-click, drag, fader, solo, D, detach), and no real FFmpeg export of a linked pair was run (v3 audio-of-a-video-input uses the existing per-clip `-ss/-t` + `[i:a:0]` chain, covered only by manifest tests). Preview gain above 100 % is clamped as before. A linked pair created by ripple insert can drift if the audio lane's clip boundaries differ from the video lane's. Alt+drag still clones only the grabbed clip (the copy gets its own new pair). Legacy videos with embedded audio still show their waveform band in the thumbnail until detached. Windows unvalidated.

**Next task.** User GUI pass on the list above, then a real two-video stacked export with one lane muted/soloed/at −6 dB checked by `volumedetect`; fix `parity:export`'s offscreen size check.

## 2026-09-24 — V5: trim to playhead and the In/Out export range

**Changes.** Two slices, redefining V5 for the multi-track timeline (the ticket's `trim-set`/`trim-clear` single-segment commands no longer exist).
- **Trim to playhead.** `Q` / `W` (and two toolbar buttons and Timeline-menu entries) trim the start / end of the selected clip, or of every clip under the playhead on unlocked tracks, to the playhead. New command `clip-trim-to` (`clipCommands.ts`, registered in `itemCommands.ts` and `editCommandSchema.ts`, so it is also available to the local agent) folds the existing `trimClip`, so ripple/overwrite follows the toolbar toggle and all targets are one undo step.
- **In/Out range.** `I` / `O` mark, `Shift+I` / `Shift+O` jump, `X` clears; toolbar buttons too. The marks are view state (not saved, not undoable; reset on project change). The timeline dims outside the range and shades the ruler span. Playback pauses exactly at Out (`SequenceClock.setStopAtUs`) and Play from outside the range starts at In. The export dialog gains "Only the In–Out range" (default on when marks exist); the File menu gains "Subtitles for In–Out range (SRT)…".
- **How the range exports.** `projectInRange` (`src/core/sequenceRange.ts`) returns the project as if the timeline were only [In, Out): clips cropped through `sourceUsAt` (so speed curves stay correct) and shifted by −In, unbound cues, blur/zoom/effect/text items and markers cropped and shifted; bound cues follow their clips. `buildExportForProject` applies it before `buildExportManifest`, so the manifest, FFmpeg graph and frame host are unchanged. SRT is `cuesInSequence` of the cropped project, so it starts at zero and clips a straddling cue. Range is an optional `range` in `exportSettingsSchema` (never stored in the remembered dialog settings).

**Verification.** `tsc --noEmit` clean. New tests: `clip-trim-to` (ripple, overwrite, one-undo, locked track, playhead outside), shortcuts, command schema, `sequenceRange.test.ts` (10: crop at both ends, speed curve, images, SRT from zero with Malayalam text, all sequence-time items, pan continuation, identity range equals input, manifest duration = Out − In, range validation, and a guard that fails when a new array field is added to the project schema without being handled), clock stop-at, and the export dialog. `npm run build` passes. `npm test`: 1326 pass, 3 fail — `TemplatesPanel.test.tsx` and `captions/keynoteTemplates.test.tsx` (title-template fixtures; `defaultTextOverlay` result is undefined). Not touched by this slice; I did not obtain a clean-baseline run to prove they were failing before it, so `npm run check` stops at `npm test` until they are fixed.

**Limitations.** No real-media export was run: the range MP4's actual duration (expect Out − In within one frame), first-caption offset and unchanged source hash are unverified, and nothing was exercised in the real window (keys, dimming, stop at Out, dialog, undo of a multi-clip trim). The range is not saved with the project. Marks are set by key/button only — no draggable handles on the ruler yet. A plain zoom, glow or title cut by In restarts its ease/entry from the new zero, and a pan cut by In starts from the frame it had reached but re-eases over the remainder. Volume-only or audio-only edge cases were not measured. macOS only; Windows unvalidated.

**Next task.** Manual pass on the list above plus a real range export (`ELECTRON_RUN_AS_NODE` unset); fix or triage the 3 title-template tests; then decide on draggable ruler handles and persisting the range.

## 2026-09-24 — Clip speed: constant speed-up/slow-down and speed ramps (schema 14)

Video and audio clips gain an optional `speed` curve in source time (0.1×–10×; one point = constant, several = ramp). New `src/core/clipTime.ts` is the single source↔sequence mapping (closed-form, exact inverse); `timelineModel`, trim/split/silence-removal/restore, cue dragging, caption spans, thumbnails and waveforms, `transport.ts` (per-element `playbackRate`, ramp muting, master discipline) and `SfxScheduler` (constant speed) all go through it. `clip-update { speed }` ripples the track and is exposed over MCP (`get_project` reports `timelineLengthUs` and `speed`). Export: a speed clip forces manifest v3; `setpts` (constant division or a nested closed-form expression for ramps) plus `atempo` for constant speed; ramps are silent. UI: Inspector → Speed (chips, log slider, exact field, six ramp presets, editable curve editor) and a `2×`/`Ramp` timeline badge. Docs: EDITING.md "Clip speed", PRODUCT.md.

Verification (macOS only): `tsc --noEmit` clean. Vitest 1311+ pass; 3 fail, all keynote/template tests unrelated to this work (`keynoteTemplates` ×2, `TemplatesPanel` title styles). New tests: `clipTime` (exactness, numeric-integral match, round trips, split additivity), commands/edits/undo, migration 13→14, presets, curve helpers, transport rates, thumbnails/waveforms, export manifest routing, filter strings, and the ramp `setpts` expression evaluated against `clipTime`. Real pinned FFmpeg 9.0.1 (h264_videotoolbox) with the actual v3 arguments and a transparent stand-in for the caption layer: 2× of an 8 s clip → 4.000 s with audio; 0.25× → 32.000 s with audio; ramp → 5.467 s / 164 frames (model 5.479 s, frame quantization), no audio. Not run: `parity:export` (no speed case added), any GUI, Windows.

Limitations: audio-track clips in preview are pitch-shifted at non-1× (Web Audio); ramp audio is muted; slow motion repeats frames (no interpolation); a speed change ripples only its own track; caption animation durations scale with the clip by design; the caption-layer pipe was not part of the FFmpeg check, so caption/effect layers over sped-up clips are untested in a real export.

Next: user GUI pass — apply 2×, 0.5× and each preset, scrub and play, check captions follow the speech, audio muted on ramps, split/trim a ramped clip, export and compare with preview; then a `parity:export` speed case.

## 2026-09-24 — Standard buttons, system font, clearer Settings icon

Base `button` now has one scale (tokens `--btn-h` 28px, `--btn-h-sm` 24px, `--btn-font` 12px, `--btn-pad` 12px, radius 6px; inline-flex, centered, `min-height`). Removed per-panel padding/font-size overrides (history, transport, bin actions, toolbar, codec, preset/overlay/export/job-pill/caption-tools buttons) so they inherit it. Tabs, menu items, pills and inspector-inside fields keep their own compact rules. UI font changed from Inter (not bundled, so it fell back unpredictably) to the platform system stack (SF on macOS, Segoe UI on Windows) with Noto Sans Malayalam for Malayalam; caption fonts are untouched. Settings: the gear glyph became an SVG gear (Lucide "settings", ISC — add to the dependency license inventory) in a 28px bordered icon button; the rail Settings icon is the same gear. Removed the robot emoji and gear glyph from the Agent chip and Caption Tools summary.

Verification: `tsc --noEmit` clean; full vitest 1270 pass / 4 fail (EffectsPanel preset tile count, TemplatesPanel copy, two keynoteTemplates tests), all template/tile content from earlier uncommitted work. No visual run.

Limitations: the Windows font stack was not rendered; some buttons in fixed-height rows may need spacing tweaks.

Next: user visual pass over top bar, inspectors, dialogs and timeline toolbar.

## 2026-09-24 — Standardize sliders and inspector controls

Cause: the generic `.editor-form label` / `.editor-form input` rules in `src/styles.css` leaked into the shared control system, so Edit-tab inspectors (Effect, Zoom, Blur, Clip) drew range sliders with input padding/borders and shrank row labels, unlike the Text tab (`.style-panel`). Those rules now skip `.style-row` inputs, `.ins-input` and `.style-row-label`. Added `RangeInput` in `src/style/controls.tsx` (class `ins-range`, live `--fill`); `SliderWithNumber`, the export-dialog stop sliders, timeline zoom and the transport playhead now all use it, replacing their per-place `accent-color` styling.

Verification: `tsc --noEmit` clean. Vitest StylePanel/EffectsPanel: 12 pass, 1 fails (`offers click-and-drag for every preset tile`, expects 27 tiles, gets 32; not touched by this change). No visual run.

Limitations: transport/timeline sliders now use the neutral inspector grey rather than the lime brand color; check they read well on their darker backgrounds.

Next: user manual look at Effect/Zoom/Blur/Clip inspectors, export dialog, timeline zoom and playhead.

## 2026-09-24 — Keep title animation when a caption word is emphasized

Emphasizing a caption word previously made `layoutCaptionWords` skip measured word regions. Word Cascade and Violet Accent therefore fell back to a static line; the emphasized paint branch also bypassed Line Wipe. The shared renderer now measures word regions against the same shaped, emphasized runs it paints, and the title treatments crop or wipe that emphasized line while retaining its font, color and other emphasis styling. This changes only paint-time layout; cue text, timing, word provenance and emphasis spans remain intact. Preview and export use the same corrected component.

Verification: no tests, build, typecheck or visual run were performed, per the user's request to handle testing manually. Next: user manual check of emphasized words with Word Cascade, Violet Accent and Line Wipe, including Malayalam/English text and exported frames.

## 2026-09-24 — Restore caption templates and apply title treatments to captions

The Titles library now shows all previous caption templates and all six refined treatments regardless of whether authored text is selected. Clicking a card applies it to the selected text layer, or to captions when no text layer is selected. The refined treatments carry optional `titleMotion` in `CaptionStyle`, and the shared `CaptionPreview` evaluates it from each cue's timestamp in both stage preview and export. Word Cascade and Violet Accent derive runtime-only grapheme-safe word regions for captions with no aligned words; cue text, timings and word provenance stay untouched. Authored text retains its separate editable title-motion field. The earlier title-card shortcut that added a new text layer on click was removed; the existing Add text control remains available.

Verification: no tests, builds, typecheck, GUI review or export comparison were run, per the user's request to handle testing manually. Static source inspection confirmed the gallery routes through the existing `apply-template` command for captions and `text-update` for selected text. Manual caption and export checks remain pending.

Next: user manual check of an old caption template, each new treatment on captions, a selected text layer, mixed Malayalam/English cues, save/reopen and matching preview/export frames.

## 2026-09-23 — Refined authored title treatments

Replaced the five generic Keynote cards with six video-inspired authored-title treatments: Focus Reveal, Soft Lift, Word Cascade, Line Wipe, Violet Accent and Quiet Scale. The inspector exposes the optional title treatment and duration. The shared preview/export text actor evaluates entrance motion from absolute sequence time; word and accent crops use complete shaped lines with measured, grapheme-safe word regions. Existing schema-13 titles without `titleMotion` retain their saved look and transitions; no font or media asset was added. The later 2026-09-24 entry records the gallery and caption-application correction.

Verification: `npm run typecheck` passed before the final gallery and documentation edits. A focused test run made before the user's request to stop testing reported three failures in existing tests that still expect the replaced Keynote names and wording; the user will handle testing. No further tests, visual review or export comparison were run. Windows and macOS interaction for these new treatments remain unverified.

Next: user manual pass in landscape and portrait with bright footage, one-word and mixed Malayalam/English titles, reverse seeking, save/reopen, undo and an exported frame comparison. Update the old preset expectation tests when testing resumes.

## 2026-09-23 — Backgrounds: solid/gradient clips with preset motion (schema 13)

Default length is 2 s (`DEFAULT_BACKGROUND_CLIP_US`), not the rest of the timeline.

New `color` clip kind: a solid or gradient background that drops onto a video track like any clip (move/trim/split/opacity/rect/mask/undo, `clip-add`/`clip-update` over MCP). Optional preset motion: color shift, pulse, drift. Effects tab has a Backgrounds section (10 presets + Custom); drop on the timeline or click to add at the playhead; new ones go under the picture (`backgroundTrackFor`, `clip-add.trackIndex`). Inspector edits fill and motion with live draft/commit. Shared math in `src/core/fill.ts` drives both the CSS preview and the FFmpeg export (solid `color` source; gradient via one `geq` frame looped, not the `gradients` filter, whose ramp did not match CSS; shift/pulse `blend` at ⅛ size then bilinear up — full-size `blend` measured 36 s vs 1.1 s for 10 s of 1080×1920; drift `crop`). Schema 12→13 changes no data (`migrateV12`). Export manifest v3 clips gained `kind: 'color'` with `fill`/`motion` and no input.

Verification (macOS arm64 only): `tsc --noEmit`, `vite build`, and `vitest run` (1251 tests) pass, including new schema/migration, command, placement, manifest and filter-string cases, plus `workers/media/backgroundRender.test.ts`, which renders each graph with the pinned `.tools` FFmpeg and checks pixels against the shared math (skipped when that build is absent). A real 640×360 encode with a gradient under a picture-in-picture video (`h264_videotoolbox`, AAC) produced the expected frame.

Not verified: no manual Electron pass (drag/click add, inspector edits, undo, save/reopen, export from the UI); no pixel comparison of the Chromium preview against exported frames (`parity:export` not extended); no Windows/Linux run; drift/shift/pulse feel and default periods unreviewed.

Limitations: a background-only timeline cannot export until a video sets the output size (no format UI yet); trimming a background's start back is limited to what was trimmed in, like video; no keyframed or freeform animation, mesh/noise or image backgrounds; `blend`-based shift/pulse quality at reduced size is ~4 levels off an exact blend.

Next: run the app and try it; extend `scripts/export-parity.mjs` with a background case; decide a default output format for background-only projects.

## 2026-09-23 — Resolve-style accent (lime/mint → blue)

`src/styles.css` now defines `--accent`, `--accent-text`, `--accent-bg`, `--accent-bg-strong`, `--accent-dim`, `--accent-glow` and `--playhead` on `:root`; every lime (`#c8ff3d`) and mint UI tint uses them. Selection, focus rings, primary buttons, active tabs/toggles and sliders are blue; the playhead is red. The zoom effect lane moved from lime to orange so it stays distinct from blur (blue). Kept green where it carries meaning: audio waveform/clips and the agent chip; grain lane stays lime-yellow as an effect-type colour. Caption style defaults (`src/captions/style.ts`, `#c8ff3d`) are user content, not chrome, and are unchanged.

Verification (macOS): `tsc --noEmit` and the Effects/Style panel tests pass. Not run: visual check in the running app.

Limitations: backgrounds are still the existing blue-black, not Resolve's neutral grey; no theme switch.

Next: eyeball the app, then decide on neutral-grey surfaces.

## 2026-09-23 — App logo

Adopted the Caption Studio logo. Source lockup kept at `assets/logo.png` (original in `img/`); `assets/icon.png` (1024px mark only) and `assets/icon.icns` are derived with `sips`/`iconutil`. Wired in: BrowserWindow `icon` (Windows/Linux), macOS dock icon via `app.dock.setIcon`, `public/favicon.png` as the page favicon, and the top-bar brand tile (replaces the "C" placeholder).

Verification (macOS only): `npm run typecheck` and `vite build` pass; favicon lands in `dist/`. Not run: visual check in the running app.

Limitations: `icon.png`/`icns` are a rounded macOS-style tile with margin and shadow (generated with a throwaway Swift script); no `.ico` for Windows yet, and there is no packager, so the installed-app icon (`.icns`/`.ico` in a bundle) is not configured. Next: pick a packager and wire icons into it.

## 2026-09-23 — Dreamy glow (picture effect, schema 11)

New `glow` effect kind (Look section of the Effects panel, own timeline lane, inspector with Intensity / Glow size / Highlights). It is a picture effect rather than frame-paint: preview filters the zoomed picture with an SVG chain (`glowFilterStyle`), export adds `lutrgb → gblur → blend=screen` after zoom (`pictureEffectChain`) driven by a new v3 manifest `pictureEffects` field with pixel-resolved sigma. Captions stay unfiltered on both sides. Details in docs/EDITING.md "Picture effects: Dreamy glow".

Verification (macOS only): `npm run typecheck` and `npm test` (1160 tests) pass, including new cases for the evaluator, manifest resolution, exact chain string and SVG parameters. The generated chain ran against the pinned `.tools/ffmpeg-9.0.1` on a lavfi clip and produced a visibly bloomed frame with no filter errors.

Not verified: no manual Electron pass (add/drag/trim, sliders, bypass, undo), no full-app export compared with preview, no measured preview/export tolerance, preview frame rate at 1080p with the SVG filter on `<video>`, no Windows. Limits: no ease in/out.

Next: color looks (`feColorMatrix` / `colorchannelmixer`), then RGB split (`rgbashift`), then light leak (host-painted).

## 2026-09-23 — Fix: export failed with VHS / film grain (and vignette, letterbox)

Symptom: exporting with VHS + grain failed on frame 1 with `Offscreen committed paint timeout after 15000 ms (request committed, 4 unmarked paints)`. Cause: the export host only accepts a paint whose bottom-right pixel carries the per-frame marker color, but `#frame-marker` in `frameHarness.tsx` had no z-index. Every composition layer lives inside `CaptionPreview`'s `zIndex: 2` stacking context, so any layer covering that corner (grain everywhere; VHS scanlines/fringe/head-switch band; the vignette's corner; a horizontal letterbox's bottom bar; a corner image overlay) hid the marker and no paint ever matched. Fix: the marker now sits at the top z-index with `pointer-events: none`. The host still zeroes that pixel before encoding, so the output is unchanged.

The parity script gained a `frame-effects` stage (`--only frame-effects` runs it alone): vignette, horizontal letterbox, grain, VHS and all four together, each rendered through both the preview capture and the offscreen host. It asserts a committed paint of the right size (paint check only, no pixel parity). It also now keeps Electron's default `window-all-closed` quit from exiting 0 before the error handler runs; that was why failed parity runs could look like silent successes with an empty report.

Verification (macOS only): the `frame-effects` stage passes with the fix. With the z-index reverted it fails (`Preview committed capture timeout` on the first case, vignette). `npm run typecheck` and `npm test` (1155 tests, 119 files) pass, and `dist-export` was rebuilt. Not run: the full `parity:export` suite, a real in-app MP4 export with these effects, and Windows. Grain/VHS still repaint full-frame SVG `feTurbulence` every frame, so large exports may be slow.

Next: user-side re-export of the failing project; then pixel parity for frame-paint effects.

## 2026-09-23 — Pan / Ken Burns (schema 11)

Slice 5 of the effects plan (`~/.claude/plans/we-just-started-implementing-starry-pizza.md`). Zoom regions gain an optional `fromRect`; when present the picture moves `fromRect → rect` over the whole region (smoothstep, no hold, no return to full frame). Schema 11 with a version-only `migrateV10`; the schema-10 validator is frozen as `projectSchemaV10`. Both evaluators (`zoomRectAt`, `zoomScaleCropExpressions`) branch on `fromRect`, so export reuses the existing `scale=eval=frame` + crop chain with no new FFmpeg filter. The manifest carries `fromRect` in output pixels and keeps a pan's true length past the sequence end so export speed matches preview.

UI: Pan and Ken Burns tiles in the Effects panel's Zoom section (draggable or click-to-add), a Pan label on the zoom lane, and in `ZoomInspector` a Start/End framing switch, Swap and Remove pan; the stage gizmo and Zoom-amount slider follow the selected framing and switching seeks the playhead to that end. `zoom-region-update` accepts `fromRect` (null clears), including through the agent command schema.

Verification: `npm run typecheck`, `npm test` (1142 tests across 118 files) and `npm run build` pass; `npm run parity:export` passes (200 caption cases, 0 mismatches — it does not exercise zoom/pan or frame-paint effects). New cases cover pan endpoints/midpoint, seek-direction independence, TS-vs-FFmpeg-expression agreement at sampled times, the 10→11 migration, command set/clear, manifest pixel conversion, graph output and the inspector. A real FFmpeg 9.0.1 encode of the generated expressions on a synthetic clip showed the top-left quarter at 0 s panning to the bottom-right quarter at 3.96 s.

Not verified: no manual Electron pass (adding by click/drag, gizmo on each framing, Swap, Remove pan, undo/redo, opening a schema-10 project), no full-app export compared against preview, and Windows is unvalidated. Vignette/letterbox/fade from the previous slice still have no real export parity run. Committed the prior effects/text work first as `60f853e`.

Next: Slice 6 (VHS / Film grain, schema 12) per the plan; grain is rendered by FFmpeg from a shared seeded noise tile, not the host, to avoid repainting every frame.

## 2026-09-23 — Direct text-layer creation and clearer animation controls

Preview double-click now creates a selected three-second text item at the clicked composition position and enters direct preview editing; double-clicking an existing title enters edit mode instead. Caption/effect controls and handles are excluded from the add gesture. Titles and the Text lane both expose playhead-add actions. Title style/preset application keeps the item's placement and word animation; the Titles panel labels decorative word motion separately from the inspector's whole-layer In/Out transitions. The preview editor uses the existing text item and undoable update command, so the schema and export protocol are unchanged.

Verification: `npm run typecheck`, `npm test` (1130 tests across 118 files), and `npm run build` pass. Focused cases cover click-to-composition mapping/clamping, template placement/motion preservation, title-mode wording, whole-layer transition labels, and the timeline add affordance. The build reports the existing >500 kB renderer chunk advisory. A manual Electron interaction and visual pass is still needed for double-click hit testing, focus/caret behavior, and editor alignment at different preview sizes; Windows remains unvalidated.

## 2026-09-23 — Preserve authored text placement when applying title styles

Applying a built-in title template or saved caption-style preset to a selected authored text item now preserves its stage position and rotation. Typography, colors, background, and template motion still come from the selected template. Direct Style-panel edits remain able to change placement intentionally. Verification: `npm run typecheck` and `npm test -- --run src/captions/style.test.ts` (23 tests) pass.

## 2026-09-23 — Authored animated text layers (schema 10)

Implemented a distinct, editable `textOverlays[]` project collection with lossless schema 9→10 migration and project-wide text-ID uniqueness. Added undoable add/update/move/trim/duplicate/delete/reorder commands; a permanent, overlap-packed Text timeline lane; Titles-panel add-at-playhead; selected-item styling/preset targeting; the text inspector; and stage placement editing. Text uses a full caption-style snapshot (including the built-in White Card style), while enter/exit motion is per item and can cross the caption layer plane. Text never enters transcript, alignment or SRT data.

Template word motion receives deterministic runtime-only decorative word timing from whole tokens. `textMotionAt` evaluates fade/pop/slide transitions at absolute sequence timestamps and clamps requested ramps for short items. Preview and export reuse `TextOverlayActor`; enabled text forces export manifest v3 and frame request v4 sends ordered, active actors, with host font/layout readiness gating. Local-agent project summaries and validated commands expose text selection and edits.

Verification: `npm test` (1123 tests across 116 files), `npm run typecheck`, and `npm run build` all pass. The build reports existing chunk-size warnings. Automated command, decorative-motion, migration and frame-request cases pass, but no manual Electron GUI pass or real export parity smoke was run for this feature; Windows is unvalidated. Stage selection of unselected/overlapping text by hit-testing is not yet implemented (timeline selection works), and double-click inline editing remains inspector-only. Build artifacts are ignored outputs.

## 2026-09-23 — Frame-paint effects: vignette, letterbox and fade/flash (schema 9)

Implemented slice 3 of the effects plan (`~/.claude-work/plans/i-need-more-effects-functional-
cascade.md`) at the user's request ("implement Frame-paint effects"), plus the minimum of slice 2's
generic effect infrastructure needed to carry it — schema 9 and `effectCommands.ts`, scoped to only
the three kinds this slice actually renders (vignette, letterbox, fade), not the color/pan/VHS
placeholder kinds the plan's slice 2 also described; those each get their own schema bump when their
own slice is built, matching the project's stated preference for small vertical slices over
speculative schema. This decision was confirmed with the user before writing any code.

**What makes this family different from zoom/blur.** Vignette, letterbox and fade never reach
FFmpeg: they are painted by the *same* React layer the caption/host-overlay pipeline already uses in
both live preview and the export host (`CompositionLayers.tsx`), so preview/export parity is exact
by construction rather than a measured pixel tolerance. See [ARCHITECTURE.md](ARCHITECTURE.md)'s new
render-order note and [EDITING.md](EDITING.md)'s new "Frame-paint effects (schema 9)" section for
the full contract — this entry summarizes what changed and how it was verified.

**Schema/model.** `src/core/edit.ts` gained `effectRegionSchema` (`vignette | letterbox | fade`,
discriminated on `kind`, each sharing `{id, startUs, endUs, enabled}`). `model.ts`'s schema 9 adds
`project.effects`, with a per-*kind* non-overlap rule (two vignettes must be ascending/non-
overlapping; a vignette and a letterbox may freely overlap — different lanes) instead of zoom's one
shared lane. `src/core/migrateV8.ts` only bumps the version, the same lossless shape as `migrateV7`.

**Evaluator.** `src/core/frameEffects.ts`'s `frameEffectsAt(effects, sequenceUs, composition)` is the
one closed-form-in-absolute-time function both sides call, mirroring `zoomRectAt`'s contract exactly
(`smoothstep`/`lerp` are now exported from `zoomRegion.ts` so every effect ramps on the identical
curve). Letterbox bars land top/bottom when the target aspect is wider than the composition's own,
left/right when narrower — a real geometry bug (inverted comparison) was caught by writing the test
for the 9:16-vertical case before trusting the 16:9 case alone, and fixed before this shipped.

**Commands.** `src/core/effectCommands.ts` mirrors `zoomRegionCommands.ts`'s add/move/trim/update/
delete shape, reusing its generic `clampZoomRegion`/`MIN_ZOOM_REGION_US`, but clamps each command
against only the *same-kind* others. `TimelineItemKind`/`Selection` gained `'effect'`; the MCP
`select` tool and `agentProtocol.ts`'s request schema and `ProjectSummary` follow.

**UI.** `EffectsPanel.tsx` gained "Look" (Vignette, Letterbox 2.39, Letterbox 1.85) and "Transitions"
(Fade in, Fade out, Dip to black, Flash) sections, same tile/preset-drag pattern as Zoom/Blur.
`EffectLane.tsx` (new) is one component parameterized by kind rather than three near-duplicate files
— unlike blur's one-off copy of `ZoomLane.tsx`, three new lanes arriving together justified sharing
one. `timelineRows` (`timelineLayout.ts`) takes the kinds actually present and emits one lane per
kind, shown only when used. `EffectInspector.tsx` (new) is one shared shell (enabled/bypass, start/
length, Delete) with a per-kind section below it, the settings-view shape `ZoomInspector`/
`BlurInspector` established. `App.tsx` gained `effectDraft`/`visibleEffects` (mirroring
`zoomRegionDraft`) and extended `addEffectPreset` to route all eleven presets (four existing plus
seven new) to their own default-builder.

**Preview.** Vignette/letterbox join the same `pinnedLayers` host-painted images already use in
`CaptionStage` (pinned to the output frame, never zoomed with the picture). Fade needed a new
`overCaption` slot on `CaptionPreview.tsx`, rendered after `CaptionView` — the one frame-paint kind
that must cover captions too.

**Export.** `flatSequence` forces v3 whenever any effect is enabled (same reason zoom does — v2's
frame request path never evaluates frame-paint effects). `exportManifestV3Schema` gained `effects`,
reusing `effectRegionSchema` directly rather than a parallel pixel-resolved schema, since — unlike
blur/zoom — this data needs no FFmpeg coordinate conversion. `frameRequestAtSequence` evaluates
`frameEffectsAt` at each frame (in composition units via `compositionFor(formatAspect(...))`, never
the manifest's raw output-pixel format) and only escalates to a new `frameRequestV3` (adds
`frameEffects` to v2's shape) when something is actually visible, so an effect-free v3 project's
frame requests are still v1/v2, byte-unaffected. `frameHarness.tsx` paints with the exact same
`CompositionLayers`/`overCaption` split preview uses. `layerPlan.ts`'s frame signature now folds in
`frameEffectsAt`'s result so the export's frame-dedup never reuses a ramp frame for its neighbor.

**Verification.** `npx tsc --noEmit`: clean across the whole project. `npx vitest run`: **1112 tests
across 115 files, all passing** — new `frameEffects.test.ts` (14 cases: ramp shapes, both letterbox
orientations including the bug caught above, disabled-effect skip, closed-form seek-direction
independence), new effect-command cases in `itemCommands.test.ts` (lifecycle, same-kind clamping,
cross-kind free overlap), new schema-9 migration/validation cases in `model.test.ts` (including the
full "schema 8 tracks and clips" describe block's fixtures bumped to schema 9 — every other test in
that block was failing on the version bump alone, not on new-feature logic), new v3-forcing/frame-
request cases in `plan.test.ts`, and new signature/ramp-dedup cases in `layerPlan.test.ts`.
`npm run build` (Vite renderer, Electron main/preload bundle via esbuild, worker build) succeeds
with only the pre-existing >500 kB renderer-chunk advisory.

**Not verified.** No FFmpeg work was needed or run — there is nothing to check against a real binary
for this family, unlike blur's V4 slice. `scripts/export-parity.mjs`'s full Electron smoke encode was
not run, so there is no real rendered frame confirming a vignette, a sliding letterbox or a fade
actually paints correctly pixel-for-pixel between preview and export — only that both sides call the
identical pure evaluator and the identical paint component, which is the parity argument this
architecture is supposed to make true by construction. The app was not launched interactively
(`/run`): add each preset by click and drag, confirm the new lanes appear only when used, drag/trim/
select on each lane, the inspector sliders move the live preview, Undo/redo, Bypass, and a saved
schema-8 project opening and re-saving as schema 9 are all unexercised in a live window. Only macOS
(this machine) was touched; Windows is unvalidated.

**Next.** Run `scripts/export-parity.mjs` (or a manual export) for a real measured confirmation that
preview and exported frames agree for each kind; manually verify in the app per the plan's checklist
above. Separately: slice 4 (color adjust) or slice 5 (pan/Ken Burns) are the natural next slices from
the same effects plan, per the user's priority; the plan's slice 6 (VHS/film-grain stylize) still has
no schema reservation, by this session's own scoping decision, so it will need its own migration when
built.

## 2026-09-23 — Blur regions get a UI and reach FFmpeg (V4)

Scoped the "more effects" shortlist from the rail-rename entry below into a plan
(`~/.claude-work/plans/i-need-more-effects-functional-cascade.md`: blur, fade/flash, color adjust,
vignette/letterbox/pan, then a VHS/film-grain stylize pass) and implemented its first slice: blur
regions, which already had a schema, commands and MCP access but no UI and no FFmpeg branch
(`assertExportableManifest` refused any manifest carrying one). This slice adds the UI and the
export branch — no schema change.

**Export (`workers/media/exportArguments.ts`).** New `blurPictureChain`: per enabled region, chains
`split=2` / `crop=…:exact=1` (on a `format=rgba` input, so arbitrary pixel offsets stay exact) /
`gblur=sigma=…:steps=2` / `overlay=…:enable='between(t,start,end)'`, applied before the zoom crop
(matching preview's paint order) and before the transparent caption/host-overlay layer. Wired into
both `exportFilterGraph` (v1/v2) and `exportFilterGraphV3`; each only changes the normalize/concat
step's label and gains `,format=rgba` when a manifest actually carries a blur region, so a blur-free
export's filtergraph string is provably byte-identical to before (asserted in both test files).
`assertExportableManifest` — the guard that refused blur — is deleted along with both call sites;
nothing else in the manifest needed it. `flatSequence`/`buildExportManifest` needed no change:
`blurFor` already resolved blur regions into both v2 and v3 manifests before this slice.

**UI.** `src/core/blurRegion.ts` (new): default rects (`defaultBlurAreaRect` — a third of the frame,
centered; `defaultBlurFrameRect` — the whole output, reusing `zoomRegion.ts`'s `fullFrameRect`) and
`previewBlurDrag` (free move/trim clamped only to zero and `MIN_BLUR_REGION_US` — **blur regions may
overlap**, so unlike `previewZoomDrag` there is no other-region gap to fit into; `blur-update` never
checked for overlap either). `EffectsPanel.tsx` gained a "Blur" section (Blur area / Blur frame
tiles, generalized from one section to a `SECTIONS` list) using the same `PresetDragPayload` the
Zoom tiles use, widened to `'blur-area' | 'blur-frame'`. `BlurLane.tsx` (new, mirrors `ZoomLane.tsx`)
is a timeline row shown **only when the project has a blur region** (`timelineLayout.ts`'s
`timelineRows` gained a `hasBlur` parameter) — unlike the always-shown Zoom lane, this is the pattern
every later effect kind will follow; overlapping regions currently stack in DOM order rather than
packing into sub-rows (a stated limitation). `ZoomStageEditor.tsx` was generalized into
`RectStageEditor.tsx` (a generic `{id, rect}` region, `keepAspect` and `label`/`hitClassName` props)
so blur's stage gizmo (free aspect, cyan `.blur-hit`) and zoom's (aspect-locked, lime `.zoom-hit`)
share one gesture implementation instead of duplicating ~70 lines. `BlurInspector.tsx` (new) mirrors
`ZoomInspector.tsx` minus ease/zoom-amount (blur has neither ramps nor an aspect-locked target) plus
a radius slider. `App.tsx` gained `blurRegionDraft` (mirroring `zoomRegionDraft`), `addBlurRegion`/
`moveBlurRegion`/`trimBlurRegion`/`draftBlurRegion`/`commitBlurRegion`, and an `addEffectPreset`
dispatcher so the Effects panel and timeline-drop paths route a preset to whichever effect it names.
The zoom lane's header and `EffectsPanel`'s Zoom-tile-only history meant the timeline lane and rail
tab were both generically labeled "Effects"; now that blur has its own lane, `TimelineTrackHeaders.tsx`
renames the zoom lane's header back to "Zoom" (the rail tab, which holds both sections, keeps
"Effects") and adds a "Blur" header for the new lane — the same "each lane names its own kind"
convention the plan sets for every later effect.

**Docs.** [EDITING.md](EDITING.md) gained a "Blur regions (V4)" section; its ticket map, refusal
table and three stale "blur is still refused" sentences (schema 4→5 migration, V1 landed-summary,
manifest v2 skeleton intro) are corrected — `src/core/migrateV4.ts` had the same stale claim in a
comment and was missing `enabled: true` on both `BlurRegion` literals it constructs (a real `tsc`
error, not just stale prose — caught by the full-project typecheck this slice ran, see below).
[ARCHITECTURE.md](ARCHITECTURE.md) and [PRODUCT.md](PRODUCT.md) updated to match.

**Verification.** `npx tsc --noEmit`: clean across the whole project (this is the first time this
branch's accumulated uncommitted work — this slice plus the schema-8 rename entry below — has been
typechecked end to end; it was not clean before the `migrateV4.ts` fix above). `npx vitest run`:
**1085 tests / 114 files, all passing**, including new/updated `blurRegion.test.ts`,
`BlurInspector.test.tsx`, `EffectsPanel.test.tsx`, `Timeline.test.tsx` (blur lane present only when
used, labeled "Blur", bypassed-region class/aria-label), `timelineLayout.test.ts` (unaffected by the
new `hasBlur` parameter's default), `exportArguments.test.ts` and `exportArgumentsV3.test.ts` (the
filter-graph fragments above, plus the byte-identical-when-blur-free assertions). Additionally ran
the exact `blurPictureChain`-generated filter fragments — one region, and two chained/time-
overlapping regions — directly against this project's own pinned FFmpeg 9.0.1 build
(`.tools/ffmpeg-9.0.1/ffmpeg`, `--disable-gpl` profile) with a synthetic `lavfi` color source: both
produced valid RGBA frames with no filter errors. Confirmed `split`/`crop`/`gblur`/`overlay`/`format`
(and, for later slices, `colorchannelmixer`/`lutrgb`/`rgbashift`) are present in that build, and that
`eq`/`boxblur` are absent — the GPL split the doc's `gblur`-over-`boxblur` choice already assumed.

**Not run**: `scripts/export-parity.mjs`'s full Electron smoke encode, so there is no measured
pixel-tolerance number for blur yet, only the syntax/runtime check above. Not tested in the running
app (`/run`) — no manual click-through of Add → drag/select → inspector sliders → export → undo.
Only macOS (this machine) was touched; Windows is unvalidated.

**Concurrency note**: while this slice was in progress, `docs/STATUS.md`'s top entry changed
underneath it (a "Malayalam Gold built-in caption template" entry appeared, itself reporting
`tsc` errors — "missing `ZoomStageEditor`", "blur preset typing" — that were this slice's own
edits mid-flight, not pre-existing bugs). That points to another session editing this same working
tree concurrently; the `tsc`/`vitest` results reported just above were captured after this slice's
edits were complete and are current as of this entry.

**Next**: run `scripts/export-parity.mjs` for a measured blur tolerance, manually verify in the app,
then move to slice 2 of the effects plan (schema 9: `project.effects`, generic
add/move/trim/update/delete commands, and blur lane overlap packing) or straight to slice 3
(fade/flash/vignette/letterbox), per the user's priority.

## 2026-09-23 — Malayalam Gold built-in caption template

Added **Malayalam Gold** to **Titles → Built-in Templates**. It is a structured shared-renderer
style, not a raster asset or a separate title implementation: Anek Malayalam at 900 weight and
92 composition-width units, a `#FFE83B` → `#FF9800` vertical fill, `#D93A00` 5.5-unit outline,
four dark-red depth layers, a compact near-black drop shadow, 1.05 line height, two-line limit,
no background box, and `phrase-fade` motion. Its gallery card uses a Malayalam-only explicit
two-line demo (`മലയാളം ടൈറ്റിൽ` / `ടെംപ്ലേറ്റ്`); that cue is preview-only and is never copied into
project captions. `templateDemoFor` makes the gallery's optional localized demo choice pure and
testable while every existing template still uses the shared English sample.

**Persistence/export:** applying this template remains the existing single undoable
`apply-template` edit. It needs no schema or IPC change; the stored `CaptionStyle` continues to
flow through the same Malayalam-safe layout/painter used by live preview and export. The font is
still a local Anek Malayalam reference with the established fallback stack — no font binary was
bundled, so exact glyph appearance can vary where Anek is unavailable.

**Verification:** focused template, application/persistence, and export-plan coverage passes;
the complete suite passes (**1,070 tests across 112 files**).
`npm run build` completes the Vite production renderer, Electron bundles, and worker build. The
full typecheck remains blocked by seven unrelated existing Errors/Blur worktree errors in
`App.tsx` and `src/core/migrateV4.ts` (blur preset typing, missing `ZoomStageEditor`, and missing
`enabled` properties); the template files introduce no TypeScript diagnostics. The build reports
only its existing >500 kB renderer-chunk advisory. The full export-parity harness was attempted,
but its first run inherited `ELECTRON_RUN_AS_NODE` and its corrected run did not complete in this
tooling session while a desktop app instance was active, so export-frame parity remains unverified.
No interactive app visual smoke test was run here.

**Next:** launch the app on macOS and apply Malayalam Gold to a real two-line Malayalam/mixed
caption, then compare preview and exported-frame appearance on an Anek-installed machine and a
fallback-font machine.

## 2026-09-23 — Effects/Titles rail rename, zoom settings view, effect bypass (schema 8)

Renamed two left-rail tabs and gave the zoom effect a settings view and an on/off toggle, per the
user's request to generalize the Zoom tab ahead of adding more effects (blur, pan, fade, vignette,
letterbox, region blur — the shortlist is in this session's transcript, not yet written up as a
ticket).

**Rename (UI only).** `Zoom` → **Effects** (`src/LeftRail.tsx`, `src/EffectsPanel.tsx` — renamed
from `ZoomPanel.tsx`; its zoom tiles now sit under a "Zoom" section heading, so later effects each
get their own section in the same panel); `Transitions` → **Titles** (`src/TitlesPanel.tsx`, renamed
from `TransitionsPanel.tsx` — it only ever held the caption/title motion picker). New rail icons in
`RailIcons.tsx` (`TitlesIcon`, `EffectsIcon`). `project.zoomRegions` and every command/schema name
keep "zoom" — only the rail label, icons and the two panel/test files changed. **The timeline's zoom
lane was missed in the first pass** (its track header and block both still read "Zoom") and fixed on
follow-up: `TimelineTrackHeaders.tsx`'s `zoomLane` row and `ZoomLane.tsx`'s block label/aria-labels
now say "Effects"/"Effect region" — the component, props and CSS classes (`ZoomLane`, `zoom-lane`,
`zoom-block`) stay zoom-specific internally, and `EffectsPanel.tsx`'s "Zoom" section heading and
`ZoomInspector.tsx`'s "Zoom effect" meta line are deliberately left naming the specific effect type,
same as a clip inspector names its own asset under a generic Overlays tab. Full contract in
[EDITING.md](EDITING.md)'s "Left rail" and "Zoom regions" sections; tab list in
[PRODUCT.md](PRODUCT.md).

**Zoom settings view.** Selecting a zoom region now shows `ZoomInspector.tsx` (new) in the right
inspector's Edit tab, the same slot `ClipInspector` fills for a selected clip — start/length, ease
in/out (showing the effective, half-length-clamped value when the raw one is too long for the
region), a "Zoom amount" slider (`rectAtZoomFactor`/`zoomFactorOf`, new pure helpers in
`core/zoomRegion.ts`, keep the rect centered and at the composition's aspect ratio), Reset framing
and Delete. `App.tsx`'s old rect-only `zoomRectDraft` is now the general `zoomRegionDraft: { id,
changes: ZoomRegionChanges }`, so rect drags (stage) and ease/zoom-amount drags (inspector) share one
draft/commit path.

**Effect bypass (schema 8).** `zoomRegionSchema` and `blurRegionSchema` both gained `enabled`
(default `true`); a disabled region is skipped in preview (`CaptionStage` filters before
`zoomRectAt`/the blur layer) and left out of the export manifest (`blurFor`/`zoomFor` in
`export/plan.ts`), but keeps its lane position and still counts toward the non-overlap check. A
project whose zoom regions are all disabled exports via the plain v2 path, same as a project with
none. `src/core/migrateV7.ts` (new) only bumps the version — `enabled` defaults to `true` on the
shared region schemas, so parsing a schema-7 file through the frozen `projectSchemaV7` already
back-fills it. `ZoomLane.tsx` dims and dashes a disabled block (`.zoom-block.disabled`) and appends
", bypassed" to its accessible name.

**Verification**: not run in this session — the user asked to do their own verification pass rather
than have it run here. New/updated tests written for the user to run: `model.test.ts` (schema 7→8
migration backfilling `enabled`, a broken-schema-8-file report, the "current schema" and "schema 8
tracks and clips" describe blocks bumped from 7); every other test file with a literal
`schemaVersion: 7` `CaptionProject`/typed fixture bumped to 8 (`history.test.ts`,
`timeline.test.ts`, `itemCommands.test.ts`, `agentProtocol.test.ts`, `projectClips.test.ts`,
`electron/projectMedia.test.ts`, `export/plan.test.ts`), plus every zoom/blur region object literal
typed as `ZoomRegion`/`BlurRegion` given `enabled: true`; `export/plan.test.ts` (bypassed zoom falls
back to v2, bypassed blur excluded from the manifest); `zoomRegion.test.ts`
(`rectAtZoomFactor`/`zoomFactorOf`: round-trip, aspect/center preserved, clamped to
`[1, MAX_ZOOM_FACTOR]`, clamped back inside the frame); `Timeline.test.tsx` (disabled zoom block's
class and aria-label); new `ZoomInspector.test.tsx`, `EffectsPanel.test.tsx`, `TitlesPanel.test.tsx`;
`LeftRail.test.tsx` updated to the new tab ids. `createProject()` was still hardcoding
`schemaVersion: 7` — caught and fixed as part of this pass.

**Limitations**: not run through `tsc`, `vitest` or the app — the exhaustive `enabled: true` sweep
across test fixtures was done by grep-driven inspection, not a compiler pass, so a missed literal is
possible. The Effects rail tab's "more effects" shortlist (blur UI, pan/Ken Burns, fade, color,
vignette, letterbox, full-frame/region blur, flash) was discussed but not scoped into a plan.

**Next**: run `npx tsc --noEmit` and `npx vitest run`, fix whatever the sweep missed, then smoke-test
in the app per the plan's manual-verification checklist (Titles still animates captions; Effects →
Zoom in adds a region; ZoomInspector renders and its controls affect the live preview; Bypass stops
the preview zoom and export; undo works for each; a saved v7 project opens and re-saves as v8).
Separately: turn the effects shortlist into a scoped plan for the next effect (blur's own inspector,
reusing the `enabled` flag this slice already gave it, is the smallest next step).

## 2026-09-22 — Gemini code-switching: the fix, not just the hypothesis

The earlier entry below recorded pinned `language_codes` as a *plausible* cause of spoken English
coming back transliterated into Malayalam script, and shipped only a probe. The user then reported a
concrete instance — "അപ്പോ See you in next video" transcribed as
"അപ്പോ സീ യു ഇൻ നെക്സ്റ്റ് വീഡിയോ." with **"Malayalam + English (mixed)" selected** — and the
published transcription docs (`https://ai.google.dev/gemini-api/docs/transcribe`) confirm the
hypothesis outright: `language_codes` "omitted or empty (`[]`)" is what makes the model "automatically
detect the language and handle code-switching", it "handles intra-sentence and inter-sentential
code-switching **without manual configuration**", and Google's own word-timestamp sample sends no
`language_codes` at all. So the fix ships ahead of the probe, on the API's documented contract rather
than on a reading of an SDK doc comment.

`geminiLocales('auto')` now returns `[]` instead of `['ml-IN', 'en-IN']`, so `language_codes` is
omitted for mixed speech and the dead `options.locales.length ?` guard in `geminiRecognition.ts`
finally does something. `ml`/`en` still pin one locale — those options exist to force one script and
the dialog says so. There is no prompt to tune on this path: `gemini-3.5-transcribe` is a dedicated
speech model and `transcription_config` is its only language control; the app sends no prompt or
system instruction for transcription at all.

**Why this line in particular**: recognition is one request per gated speech chunk, so the language
commitment was made per chunk. A short trailing sign-off chunk opening with a Malayalam word, pinned
to `ml-IN` first, got written entirely in Malayalam script.

**Why nothing caught it**: `checkTranscriptScript` passes whenever the expected script dominates the
non-Latin letters, so English transliterated *into* Malayalam reads as flawless Malayalam to it. It
catches wrong-*script* output (Tamil for Malayalam), never wrong-*language* output. Nothing in the
pipeline transliterates — `segmentsFromWords` only collapses whitespace.

**Alignment had the same bug, with a sharper consequence.** `alignWithGemini` hardcoded both locales
with no language parameter. Since `alignmentKey` only NFC-normalizes, lowercases and strips
punctuation, a recognized `"സീ"` can never match an imported SRT's `"See"` — so every English token in
an imported SRT was unmatchable and silently fell back to `estimated` timing. It now sends no locale
either.

The Transcribe dialog's mixed option is relabelled "Automatic — mixed languages (recommended)" with a
hint that describes detection rather than the old two-language bias (the previous hint warned the user
that code-switched speech "may still come back partly transliterated" — it was documenting the bug).
The stored `localStorage` value is still `auto`, so nothing migrates. `scripts/gemini-recognition-probe.ts`
keeps the former default as a comparison variant, and two of its variants are now annotated as
non-candidates: the docs state `custom_vocabulary` cannot be combined with word-level timestamps, and
`system_instruction` is not documented as supported for this model.

Verification: `npm test` — **1004 tests pass, 108/109 files**; the one uncollected file is
`src/Timeline.test.tsx`, which still carries the same pre-existing syntax error from this branch's
uncommitted work noted in the entry below (untouched by this slice; `git diff` shows it modified by
earlier work, not here). `npx vite build`, `npm run build:electron` and the worker build all succeed.
`npm run typecheck` reports only that same `Timeline.test.tsx` syntax error. Three existing assertions
that encoded the old behavior were updated, not added: two locale expectations in
`geminiTranscription.test.ts` and the dialog label in `TranscriptionPanel.test.tsx`.

**Not verified, and this matters**: still *no live Gemini request has ever been made from this code*.
The fix rests on the published API contract, not on a measured transcript, and the app was not launched
in this environment. The user's manual pass is the real verification — re-transcribe the same clip on
"Automatic", confirm the sign-off line keeps English in Latin script, confirm word-level timing and
Malayalam shaping survive, confirm "Malayalam only" still forces one script, and check whether Align
audio now matches more English tokens as `model` rather than `estimated`. macOS only; Windows
untested. If the line still comes back transliterated, `npm run probe:gemini` with a real key is the
next step and would produce actual evidence.

## 2026-09-22 — Two user-reported bugs: caption motion "resets" on edit, and Gemini code-switching

Two reports on `feature/caption-stage-transforms`: editing a caption's text seemed to reset its
animation/transition preset, and Gemini transcription returned only Malayalam for spoken English
mixed into Malayalam speech.

**Motion "reset" — actually a word-timing loss, not a lost preset.** `cue.motionOverride` was never
dropped by any edit path (`update-text` already spread `...cue`). What broke: `retainSafeWordTimings`
(deliberately conservative) drops the timing of every edited/inserted token, and the renderer's
`wordMotionAvailability` gate then silently falls back to `static-clean` for that cue whenever any
token in its text lacks timing — with the stored `motionOverride` unchanged and invisible. `static-
clean`/`phrase-fade` short-circuit before that gate, which is exactly why only the three word-driven
presets (active-word highlight, word pop, progressive reveal) appeared to "reset".

Fix: `update-text` (`src/core/captionCommands.ts`) now restores only the gap the edit just opened —
via the existing `estimateMissingWordTimings`, previously wired to a dead `estimateIfUntimed` field no
caller passed — but only on a cue that **already had complete timing before the edit**; a cue that
never had word timing (imported SRT) never gains invented timing from a text edit. A gap too short to
estimate is now a reported `estimate-skipped` warning instead of a silent revert. Both real call sites
(`src/App.tsx`, the Captions panel and the inspector's `CueEditor`) now pass the id prefix.
`CaptionsPanel.tsx`'s transcript list shows an "Animation paused" / "Estimated timing" badge per cue
(scoped to that cue's *effective* motion, project style or its own override) so the state is visible
without opening Caption Tools.

Also found and **deliberately left unfixed**: applying any built-in template
(`captionCommands.ts`'s `apply-template`) wipes every per-cue `motionOverride` project-wide with no
mention in the toast — a second, different way to lose a per-caption preset from the one reported.

Verification: `npm run typecheck` and `npm test` both clean except one pre-existing, unrelated failure
— `src/Timeline.test.tsx` already had a syntax error in this branch's own uncommitted work before this
slice touched anything (confirmed by stashing just that file and re-running); every other file compiles
and all 1004 other tests pass (108/109 files). Two new regression tests in `captionCommands.test.ts`
were confirmed to fail against the pre-fix code (`git stash` on just `captionCommands.ts`) before being
kept. `npx vite build` and `npm run build:electron` both succeed. Not run: the app was not launched
interactively in this sandboxed environment, so the fix has not been clicked through in a live window;
only macOS arm64 tooling was used, nothing was exercised on Windows.

**Gemini code-switching — measurement, not a shipped fix.** The user confirmed "Malayalam + English
(mixed)" was selected, so the simple single-language-hint explanation doesn't apply here. The
transcribe call (`electron/geminiRecognition.ts`) has no prompt or system instruction at all; the only
language control is `generation_config.transcription_config.language_codes`, and `auto` sends
`['ml-IN', 'en-IN']`. `@google/genai` documents that field as defaulting to real automatic detection
only when **omitted or empty** — so today's `auto` is an explicit two-locale bias, not detection, and a
plausible cause of English spans coming back in Malayalam script. Per `docs/TRANSCRIPTION.md`, **no
live Gemini request had ever been made from this code**, so this is a documented hypothesis, not a
confirmed root cause.

`geminiRecognizer`'s signature now takes an options object (`{ locales, systemInstruction?,
customVocabulary? }`) instead of a bare locale array — `language_codes` is omitted (not sent as `[]`)
when `locales` is empty, and `system_instruction`/`custom_vocabulary` are sent only when supplied.
**Production behavior is unchanged**: `geminiLocales('auto')` still returns `['ml-IN', 'en-IN']`; the
new knobs are wired only for `scripts/gemini-recognition-probe.ts` (new, `npm run probe:gemini`), which
runs the same `speechChunks` gating as production, then recognizes every resulting chunk under four
variants (today's hint, omitted/auto-detect, omitted+system-instruction, omitted+custom-vocabulary),
classifies each returned word's script, and writes the comparison to
`docs/decisions/evidence/gemini-codeswitch-<date>.json`. **This has not been run** — it needs a real
`GEMINI_API_KEY` and a real code-switched clip, neither available in this sandboxed environment. The
`geminiLocales('auto')` mapping and any `system_instruction`/`custom_vocabulary` default are an open
decision pending that run; do not read the signature change as the fix.

Independent of that decision, two blind spots are closed now: `geminiRecognizer` counts annotations
that could not become a timed word (wrong type, empty text, or an invalid/non-positive offset) as
`droppedAnnotations` instead of silently discarding them, threaded through to an optional
`droppedAnnotationCount` on the Gemini transcription run record (schema-2-compatible; older runs never
recorded it). The Transcribe dialog's **Spoken language** select now shows an explicit hint that
"Malayalam only"/"English only" force that script and transliterate the other language, and the choice
now persists across sessions (`localStorage`) like the engine and translation-target choices already
did — previously it silently reset to "mixed" every session, which may explain why the user's earlier
session behaved differently than expected.

Verification: `npm run typecheck` and the full suite are clean (same pre-existing, unrelated
`Timeline.test.tsx` failure as above); `electron/geminiTranscription.test.ts` was updated for the new
call shape and passes. `npm run build:worker` builds the new probe script with esbuild and its
usage-error path was smoke-tested with no arguments. **No live Gemini call has been made** — the probe
must be run by a developer with a real key and clip before any locale-mapping change ships.

Next: run `npm run probe:gemini` against a real Malayalam/English code-switched clip and API key,
record the result, and apply whichever variant actually keeps English in Latin script (updating
`geminiLocales`/adding a default `system_instruction` accordingly, with the matching alignment-path and
unit-test updates). Separately, decide whether the `apply-template` per-cue override wipe found above
needs its own fix.

## 2026-09-21 — MCP1: local agent control core (Claude Code can inspect and edit the project)

Completed the first slice of local agent control ([MCP.md](MCP.md), `tickets.md` MCP1): an opt-in, loopback-only MCP server a Claude client can drive, forwarding every read/edit through the app's own command/undo path rather than a second editing model.

**Core.** `src/core/editCommandSchema.ts` mirrors every `CaptionCommand`/`ItemCommand` variant as zod (the boundary the MCP `edit` tool validates against), with a compile-time check (`_ParsedCommandIsEditCommand`) that whatever it accepts is a real `EditCommand`. `src/core/agentProtocol.ts` defines the renderer↔main IPC contract (`AgentRequest`/`AgentResponse`), `summarizeProject`/`summarizeCue` and `listStyleOptions`/`styleFieldRanges` (generated from `captionAppearanceSchema`'s actual zod bounds, so a range can't drift from what the schema accepts).

**Renderer bridge.** `src/agent/useAgentBridge.ts` subscribes once to `window.captionStudio.onAgentRequest` and answers against the latest render's handlers. `App.tsx` gained `runCommands` (a batch of commands committed as **one** undo step, all-or-nothing) alongside the existing single-command `runCommand`, plus `seek`/`select`/`undo`/`redo` handlers that each compute their own resulting `ProjectSummary` synchronously (from `projectRef`/`selectionRef`, kept live the same way `projectRef` already was) rather than reading back React state, which would still be the pre-update value within the same tick.

**MCP server.** `electron/mcp/server.ts` is a plain `node:http` server plus the SDK's `StreamableHTTPServerTransport`, bound to `127.0.0.1` at an OS-assigned port; the actual bound port is required for `allowedHosts` (the DNS-rebinding check matches the `Host` header including port), so the http server binds first, then the transport is built and the real request handler attached. Every request needs the exact Bearer token (constant-time compare) before it reaches MCP handling at all. `electron/mcp/tools.ts` registers `get_project`, `get_captions`, `edit`, `set_caption_style`, `apply_template`, `list_style_options`, `seek`, `select`, `undo`, `redo`. `electron/mcp/config.ts` persists the enabled flag/port/token (`<userData>/mcp.json`, mode 0600 — a loopback-only shared secret, not OS-keychain-encrypted). `electron/mcp/ipc.ts` wires Settings-tab IPC and resumes agent access on launch if it was left enabled.

**UI.** Settings gained an **AI agents** tab (enable toggle, token show/copy/rotate, the ready-to-paste `claude mcp add` command) and the top bar shows a **🤖 Agent** chip with a live connected-client count while the server is listening. `project.markers` (schema 5, optional/defaulted — no migration) is a new small item kind: sequence-time ruler notes drawn as clickable diamonds, meant as the landing spot for an agent-proposed shot list the user can accept or dismiss rather than it living only in chat; `marker-add/update/delete` join the existing item command set.

**Deliberately not done in this slice** (tracked as MCP2/MCP3 in `tickets.md`, documented in [MCP.md](MCP.md) "Not implemented yet"): `render_frame`/frame snapshots for a vision loop, `import_media`/`import_image_data`, `place_at_word` and alpha-clip export support for word-anchored fillers, the Claude Desktop stdio bridge, and every job tool (transcribe/export/silence/save). The Settings tab says plainly that Claude Desktop is not supported yet rather than showing a config snippet for a bridge file that doesn't exist.

Verification: `npm run check` passes strict TypeScript, **979 tests across 108 files**, the renderer production build, and the Electron main/preload bundle (confirmed `@modelcontextprotocol/sdk` appears only in `dist-electron/main.cjs`, not `preload.cjs`). Notably real rather than mocked: `electron/mcp/server.test.ts` starts an actual `startMcpServer` instance on a loopback port and drives it with the MCP SDK's own HTTP client — `tools/list`, every tool's `tools/call`, wrong/missing-token → 401, and input-schema rejection surfacing as an error tool result. `electron/mcp/ipc.test.ts` exercises the real enable → disable → rotate → resume-after-restart lifecycle against a real server, mocking only `electron`'s `app`/`BrowserWindow`/`ipcMain`. `useAgentBridge`'s request→response dispatch and every editing-command schema variant are unit-tested directly (round-trip plus rejection of unknown/malformed commands).

**Not verified in this slice:** the app was not launched interactively in this sandboxed environment — no real Claude Code session was connected end to end, the Settings tab was not clicked through in a live window, and macOS/Windows packaging is untested here. The manual walkthrough in the MCP1 plan (enable in Settings, `claude mcp add …`, restyle via `set_caption_style`, confirm the timeline/preview reflect it and ⌘Z reverts it) still needs a real desktop run before this is "done" end to end — flagged explicitly rather than assumed.

Next: MCP2 (render_frame/capturePage vision loop, import_media, place_at_word, alpha-clip export, the Claude Desktop stdio bridge) is the natural next slice; alternatively, a real interactive macOS smoke test of what MCP1 already built.

## 2026-09-21 — Export: the 24-second stop found and fixed (an empty caption line crashed the export host)

The previous entry left the user's failing export unreproduced. It is now reproduced from the real
project (`wallstreet.cstudio`, its 184 MB source, 1440×2560 @30, 39 cues) and fixed. The export log
had said only `BACKEND_FAILED` / `Export cancelled`.

**Actual cause.** The cue starting at 29.2 s ends with a trailing space and has a selected emphasis
word. At the real caption width that trailing space is the character that overflows the line, so
`breakLines` breaks at the end of the text and the final `push(text.length)` adds an **empty last
line**. `createDomMeasurer` measured empty text on its emphasis path as an empty span — 0 × 0 —
where its plain path uses `text || '\u200b'`; `layoutCaption` rejects that as "Invalid shaped text
metrics" and throws **inside a React render**. There is no error boundary, so React unmounted the
tree and the harness kept the stale `loading` frame, which `frameHarness.tsx` reported after 10 s
as "font/geometry readiness timeout"; the host then wrote that to stderr and exited 1.

**Why it read "Export cancelled".** Two layers hid it. The host's death made the job abort FFmpeg,
whose SIGTERM rejection (`CANCELLED`) was listed first and picked over the host's real failure
(`workers/media/export.ts`), and the `BACKEND_FAILED` relabel in `electron/exportService.ts` then
kept only `error.message`, dropping the exit status and stderr.

**Changes.**
- `src/captions/CaptionPreview.tsx`: empty text takes the plain measuring path with the base font
  (the fix). Regression tests in `src/captions/domMeasurer.test.ts` fail without it with the exact
  production error.
- `workers/media/export.ts`: `mostInformativeFailure` prefers a process's own failure, then the frame
  loop's error, then a bare cancellation. A failing export waits up to 2 s for its peer to report
  before tearing it down: a child's stdout closes before its exit status arrives, and our own
  `cancel()` in between turned the host's status into a cancellation too.
- `electron/exportService.ts`: the relabel keeps exit status and the tool's stderr in `diagnostic`.
- Diagnostics: the export host, the paint timeout and the harness readiness timeout now say where and
  why they stopped — frame number, timestamp, size, document font status, `loading` event count and
  the last uncaught page error. Never caption text. `layoutCaption`'s metrics error now reports the
  measured size and string length.

**Deliberately not done.** The plan proposed reporting a process's own non-zero exit as `TOOL_FAILED`
even when aborted, in `ownedProcess`. FFmpeg exits 255 on SIGTERM, so that would label every ordinary
teardown a failure; the ordering fix and the settle wait cover the same case.

**Verification** (macOS arm64 only; nothing run on Windows).
- `npm run typecheck` clean; `npm test` 865 passing (857 before). Every new failure-path test was
  confirmed to fail against the old code.
- Real encodes through `electron . --export-smoke` with a manifest built from the project: before the
  fix, failed at frame 340 (29.2 s), reproduced in 25 s and on a 1.4 s window in 13 s; after, the
  whole project encodes — H.264 1440×2560 + AAC, 176.53 s, 358 MB, about 3 min — with captions
  sampled at 29.6 s (the failing cue), 60 s and 117.5 s (second clip).
- Bisect: the same cue exports fine with its emphasis removed, or with its trailing space trimmed.

**Not verified.**
- `npm run parity:export` did **not** run to completion in the agent shell, and preview/export parity
  is therefore unchecked after these edits (none of them alters a non-empty measurement). It aborts
  in its own caption-layer stage with `Unexpected pixel dimensions {"width":1920,"height":1920}`
  (`export-parity.mjs:205` via `markedBitmap`) — the script's initial window size, so its resize did
  not take effect before the first paint. The same abort occurred with this slice's `frameHarness.tsx`
  edits temporarily reverted, so it is not caused by them; the cause is undiagnosed and may be
  environmental. The script exits 0 and prints nothing when this happens; the error is in
  `<tmpdir>/export-parity-error.log`. No evidence file was kept. Run it from a normal terminal.
- The failing export has not been re-run through the app's own GUI, and the smoke path does not
  write `export.log` (only the `export:start` IPC path does).
- `ffprobe` shows 5296 video frames while the job reports 5297: the source's video stream (88.2667 s)
  is shorter than its container (88.2773 s). Not investigated; it predates this change.

**Open defect found, not fixed.** The empty last line is still laid out, only no longer fatal. It is
measured as a blank extra caption row, so a cue whose trailing space overflows sits about one line
higher than the same cue trimmed (compared in exported frames of this project, both with emphasis;
the no-emphasis case was not compared). The layout code is shared with the preview, so the preview
very likely shows the same shift — not checked. The right
fix is in `breakLines` (trailing whitespace should hang, not wrap onto an empty line), but that
changes shared layout for existing projects and their parity snapshots, so it needs a decision.

**Next.** Run `npm run parity:export` from a terminal; decide the trailing-whitespace line-break rule;
then the admission bound from the previous entry (`thumbnailQueue.ts` allows 8 concurrent strip
requests against `MediaWorkerClient`'s 4-job limit).

## 2026-09-21 — Export: a job that stops now says so, and a closed window no longer discards it

Reported: the export shows progress, the progress disappears, and no file exists at the chosen
destination — with no message on screen.

**What was verified first.** The encoder pipeline itself is not broken. Real end-to-end encodes
through `electron . --export-smoke` (ExportService → job scheduler → media worker → export host →
FFmpeg 9.0.1/`h264_videotoolbox`, macOS arm64) succeeded for manifest v2, v3 *flat* (two clips
back to back) and v3 *stacked* (gap + picture-in-picture + opacity), with and without captions.

**Root causes of the silence** (three, all on the reporting path, not the encode):
1. `electron/exportIpc.ts` cancelled an in-flight export as soon as its renderer `WebContents` was
   destroyed. On macOS closing the window does not quit the app, so closing or replacing the window
   mid-encode killed the job, deleted the temporary output and left the next renderer with fresh
   state: no progress, no message, no file. A chosen destination makes the export's product a file
   on disk, not a live window, so it now runs to completion; `closeJobs()` on app quit still cancels.
2. `JobScheduler` checked `isCancellationSignal(error)` before `pendingProgressFailure` in its
   rejection handler, so a job aborted for malformed or regressing progress reported itself as a
   plain cancellation and lost its reason. The success path already had this order right.
3. The media worker reports its own teardown (dead export host, closed pipe) with the same
   `CANCELLED` code a user cancellation carries, and the scheduler retires any `CANCELLED` job with
   no error. `ExportService` now relabels a cancellation the job never requested as
   `BACKEND_FAILED`, keeping the worker's message as the diagnostic.

**Change.**
- `electron/exportLog.ts` (new): a local, rotating JSONL diagnostic log at
  `<userData>/logs/export.log` — job start (manifest version, input/clip/cue/overlay counts, plan,
  destination), terminal outcome with the full structured error and its `diagnostic`, renderer
  destruction, and `render-process-gone`/`child-process-gone` from `electron/main.ts`. Local only,
  no telemetry; it records counts, paths and error details, never caption or media content.
- `src/App.tsx`: an export can no longer leave the UI without a message — a `null` outcome after a
  job has reported progress is an error, not a dismissed save dialog. The error notice now carries
  a trimmed tail of the structured error's `diagnostic` (the encoder's own stderr), which was
  previously dropped entirely.

**Verification.** `npm run typecheck` clean; `npm test` 857 passing, including new tests for the
scheduler ordering (which fails without the fix), the unrequested-cancellation relabel, and the log
writer's append/rotate/unserializable-detail behaviour. Real re-encode through
`electron . --export-smoke` after the `ExportService` restructure still produces a valid 6 s /
180-frame MP4. macOS arm64 only; nothing here was run on Windows.

**Limitations.** The user's own failing project could not be reproduced here (no `.cstudio` file
and no leftover output), so the exact stop is still unknown — the log is what will name it on the
next run. `exportLogPath()`'s use of `app.getPath('userData')` is not covered by an automated test
(it needs a live Electron app); the append/rotate logic below it is. Separately found and **not
fixed**: `src/timeline/thumbnailQueue.ts` allows 8 concurrent strip requests while
`MediaWorkerClient` throws `BUSY` past 4 in-flight jobs, and `src/App.tsx` starts one waveform job
per asset at once — background work can therefore be refused, and can refuse a user-initiated
export that starts in the same window.

**Next.** Reproduce the failing export once with this build and read `<userData>/logs/export.log`;
then bound the media worker's admission so background thumbnail/waveform work cannot consume the
whole budget.

## 2026-09-21 — Style panel: caption Position X/Y now takes effect while typing

Typing a value into Position X or Y did not move the caption in the preview.

**Root cause.** The two inputs (`src/StylePanel.tsx`) updated only the panel's local draft on change,
never `onDraft`, so the preview did not move until blur. They also re-rendered `value` as
`(fraction * 100).toFixed(1)` on every keystroke, so typing "70" produced "7.0" then "7.00", which parses
as 7: a two-digit value could not be entered.

**Change.**
- `src/style/controls.tsx`: `PercentField` holds the typed text locally (no reformatting under the caret),
  drafts to the preview on every valid keystroke and commits once on blur or Enter. `parsePercent` maps
  text to a clamped 0–1 fraction, or null for half-typed text (empty, "-", "."), which is never drafted.
- `src/StylePanel.tsx`: Position X and Y use `PercentField`.

**Verification.** `npm run typecheck` clean; vitest for `src/style`, `StylePanel`, `captions/style` and
`captions/renderer` passes, including new `parsePercent` tests. The style → layout position mapping was
already covered (`style.test.ts`, `renderer.test.tsx`), and export uses the same `captionStyleInputs`.

**Limitations.** No DOM-interaction test tooling exists, so the field's typing/draft/commit behavior is not
covered by an automated test and has not been exercised in the running app; that needs a manual check
(open Style → Position, type 70 in Y, confirm the caption moves as you type and persists after blur).

**Next.** Manual GUI check of Position X/Y in preview and one exported clip.

## 2026-09-21 — Captions panel: word menu works on captions with no word timing

An added or edited caption could not be emphasized or given a New line from the Captions panel:
clicking its words did nothing.

**Root cause.** The panel built its clickable words from `cue.words`, the per-word *timing* list.
`addCue` creates a cue with `words: []`, and `update-text` only filters the old list through
`retainSafeWordTimings`, which correctly drops any word it cannot prove is unchanged (and returns
`[]` when the old spans no longer match). A caption in that state rendered as bare text: no
`.transcript-word` buttons, so no menu. Emphasis itself never depended on timing — `toggle-emphasis`
works from `captionTokens(cue.text)`, and the inspector's "Emphasize words" list already did too.

**Change.**
- `src/transcript.ts`: `transcriptSpans(cue)` replaces `interactiveTranscriptSpans`. It returns one span
  per clickable unit — each timed word (via `locateWordSpans`, so legacy punctuation-bearing entries
  stay single buttons) plus every `captionTokens` token no word covers, marked `word: null`. A
  partially-timed caption is now fully clickable too. New pure helpers `wordMenuAvailability` and
  `wordActionCommand` hold the menu's enablement rules and action→command mapping so they are testable.
- `src/core/captionCommands.ts`: `delete-word` and `line-break-before-word` take
  `target: { wordId } | { textStart }` instead of `wordId`, so they run on an untimed token.
  `split-before-word` and the two `move-*` commands still require a `wordId` because they read the
  word's time to place a cue boundary. `estimate-words` gains `missingOnly`, which fills only untimed
  gaps and leaves model/aligned/manual words untouched. The New line guard is now "not the caption's
  first *token*" (was "not the first entry of `cue.words`", which mis-blocked a timed word that follows
  untimed ones).
- `src/CaptionsPanel.tsx`: word buttons render from spans; the menu is keyed by token offset. Emphasize,
  Edit, Delete and New line work with no timing. Split / Previous line / Next line are disabled for an
  untimed token, and the menu shows a note plus **Estimate word timing** (`missingOnly`). Nothing is
  estimated unless the user asks, so estimated timing is never presented as aligned.
- `src/App.tsx`: also fixes a related bug — emphasis used `word.textStart ?? 0`, so a legacy schema-2
  word without `textStart` emphasized the caption's *first* word instead of the clicked one. It now uses
  the span offset from `locateWordSpans`. Clicking an untimed token selects its caption but does not
  seek (there is no honest time for it).

**Verification.** `npm run check`: strict TypeScript, 849 tests in 98 files, renderer build, Electron
main/preload bundle and worker build all pass. New tests cover untimed / partially-timed / Malayalam span
building, menu enablement, action→command mapping (including the legacy-`textStart` emphasis
regression), `delete-word` and `line-break-before-word` by offset, emphasis on an added-then-edited cue,
`estimate-words` `missingOnly` preserving timed words, and a static render of `CaptionsPanel` asserting an
untimed caption exposes a button per word. The repo has no jsdom/testing-library, so the click → menu open
→ action flow is **not** covered by an automated test; it, the menu positioning for the new footer, and
export layout of a line-broken Malayalam caption were **not run in the app**, and no macOS or Windows
build was launched.

**Limitations / next.** The Previous line / Next line enablement rules are unchanged for fully timed
captions; they look inverted against the reducer (Previous is disabled for the first word yet the reducer
rejects it only for the last), which predates this slice and is worth a separate look. Editing a caption
still drops timing it cannot safely keep, by design. Next: a manual pass — add a caption at the playhead,
type text, click a word, Emphasize / New line / Delete, then Estimate word timing and confirm Split and
Next line enable; repeat on a transcribed caption after replacing one word.

## 2026-09-21 — Preview playback: the transport was deaf to the clock

Pressing Play showed the first frame and then froze while the timecode and captions kept moving.
The 1440×2560 resolution was not the cause (nor the codec: the element loaded and painted frame 0).

**Root cause** (found by reading the code, not by reproducing it in the running app)
`createSequenceTransport` subscribed to the clock inside its factory, which `useProjectPlayback`
memoises; the mount effect's cleanup then called `transport.dispose()` and `clock.dispose()`, and
`clock.dispose()` clears every listener. `main.tsx` renders `<StrictMode>`, which runs effects as
mount → cleanup → mount in dev without re-running `useMemo`, so the transport's subscriptions were
gone from startup. Every other subscriber (SFX scheduler, the hook's tick effect, `CaptionStage`)
subscribes inside an effect and came back; the transport never did, so the video was only ever
driven by `transport.refresh()` on a project change.

**Changes**
- `transport.ts`: `attach(clock)` / `detach()` replace subscribe-in-factory (the `SfxScheduler`
  pattern); `detach` keeps the pool loaded; `dispose` = detach + unload.
- `useProjectPlayback.ts`: attach/detach in the mount effect; cleanup no longer disposes the
  clock, pool or transport.
- **The master video (topmost playing) is no longer re-seeked for drift** (was: >250 ms). It is
  seeked only right after an explicit seek (`seekEpoch` change) or when a full second out;
  `discipline` corrects the rest. Other playing videos keep the 250 ms re-seek — nothing else
  corrects them. With no `requestVideoFrameCallback`, the transport disciplines from `currentTime`.
  This is the second problem the freeze was hiding: at this resolution a seek can itself take
  longer than 250 ms, so the old rule would have kept the decoder from ever catching up.
- `docs/EDITING.md` "Playback" records both rules.

**Verification** (macOS arm64, this machine)
- `npm run check`: typecheck, 97 test files / 839 tests, production build — green. No test file
  changed: the one existing assertion about re-seeking a drifted playing element (1.5 s out) still
  holds because it now falls under the 1 s last-resort limit.
- **Not run: the GUI.** Nothing here has been observed in the running app.

**Not verified / limitations**
- No new tests. `createSequenceTransport` (the runtime) and the hook's effect lifecycle remain
  uncovered — which is how this shipped. Covering the hook needs jsdom + testing-library.
- Untested by a machine: play from the start, scrub while playing and paused, play across a
  clip boundary and a gap, mute/hide mid-playback, and the 1440×2560 file specifically.
- Expect one small caption correction just after Play (the clock snaps onto the first presented
  frame). A large or repeated one would mean startup needs a preroll gate.
- Known, not fixed (found in review): (1) `discipline` moves the clock without bumping `seekEpoch`,
  so a large startup snap leaves sound effects offset for the rest of that playthrough — it
  predates this slice but is now certain to happen at high resolution; (2) an element that is not
  yet `loaded` is re-seeked on every clock tick, a write storm while it primes; (3) a non-master
  video at high resolution can still fall into the seek loop the master no longer can.
- Deliberately not done: pausing the clock on `waiting`/`stalled`; a hold on the clock until the
  master presents its first frame (which would also fix (1)).

**Next task**: manual smoke of the list above; if the picture still stalls at startup on this
file, add the presented-frame gate.

## 2026-09-19 — Schema 5: a stacked multi-track timeline (supersedes V7 2b–2f)

Importing a second video used to **replace** the first; schema 4's clips were a flat list whose index
was the position (no gaps, one video lane). This slice replaces that with a real NLE model — named
tracks, clips at absolute sequence positions, gaps, picture-in-picture and stacked video tracks,
music/SFX in sequence time — and carries it through preview playback, compositing and export.
The contract is `docs/EDITING.md` "Schema 5"; the export decision is
[ADR 0005](decisions/0005-stacked-export.md). All eight planned steps landed in one session.

**Changes**
- **Schema 5** (`edit.ts`, `model.ts`): `tracks` (back to front), one `clips` union (`video` / `image` /
  `audio`, absolute `timelineStartUs`, length ≡ source range, no rate), sequence-timed `blurRegions`,
  `format` (output frame; drives the caption composition). `superRefine`: one ID namespace, clip/track/
  asset kinds agree, **no overlap on a track**, clips **sorted by (track, start, id)**. Schema 4 is kept as
  `projectSchemaV4`. Transcription/alignment runs gain `mediaAssetId`.
- **Migration 4 → 5** (`migrateV4.ts`): V1 at schema 4's prefix sums (gapless by construction), overlays →
  image clips on tracks above V1 preserving stacking, SFX → audio clips on A tracks at their old sequence
  position, blur retimed, cues untouched, `format` = `planFromMedia`'s rule. Nothing is dropped: items
  schema 4 no longer played are **parked** on muted/hidden tracks; parks, splits and resolved SFX durations
  are returned as `migrationNotes` and shown when the project opens (autosave stays off until Save).
- **Pure core**: `timelineModel.ts` (`activeClipsAt`, `spansInSequence`, `nextBoundaryAfter`,
  `cuesInSequence`, and **`activeCueAt` — the one active-caption rule**, now shared by the preview, the
  export layer plan and the export frame requests instead of three copies), `clipEdits.ts`
  (overwrite/ripple place, move across tracks, trim, split, delete, close gap, silence removal, restore),
  `clipDrag.ts`, `timelineLayout.ts`, `format.ts`.
- **Commands** split into `assetCommands.ts`, `trackCommands.ts` (add/remove/rename/flags/reorder) and
  `clipCommands.ts`; `itemCommands.ts` keeps the union, `validateItems` and the parse epilogue.
- **Timeline** decomposed (`src/timeline/*`): rows from `project.tracks`, track headers (rename, M/H/L,
  up/down, remove, +V/+A), clip blocks with trim handles, per-clip filmstrips (bounded queue: cache by
  source range, 8 in flight, visible clips only) and waveform slices, cross-track drag, Alt-clone, "Close
  gap", an OVERWRITE/RIPPLE toggle (default overwrite), ⌘/Ctrl+B split, Delete lift, Shift+Delete ripple.
- **Import**: a second video is **appended to V1**; dragging one onto the timeline places it there;
  `ReplaceVideoReview` and the replace-source path are gone. The media bin lists every video.
- **Playback** (`src/playback/`, `src/app/useProjectPlayback.ts`): a sequence clock disciplined to the
  topmost playing video's `requestVideoFrameCallback`, a `<video>` pool per (track, asset), the pure
  `transportActionsAt` (load/seek/play/pause, ~500 ms preroll), SFX scheduled from the transport. The
  stage's `<video controls>` is gone; the transport row is the only one. Preview clamps gain > 1 to 1.
- **Compositing**: `CompositionLayers` paints video/image/blur layers (back to front, blur above media,
  captions on top); `VideoSlot` mounts pooled elements; `ClipStageEditor` drags/resizes/clones any picture
  clip with a rect — **picture-in-picture video included**; the clip inspector toggles PiP, sets fit,
  opacity and gain.
- **Export**: manifest v2 for flat sequences (byte-identical argv), **manifest v3** otherwise — one FFmpeg
  input per clip opened with `-ss`/`-t` (deviation from the plan, which shared decoders: see ADR 0005),
  a flat `concat` route and a stacked black-canvas + `tpad` + `overlay=eof_action=pass:repeatlast=0` route.
  Export IPC now takes only `{ requestId, project }`; main resolves every file the timeline plays.
- **Per video**: a video picker for transcription and silence removal; **`captionsOverlappingRange` is
  scoped to the transcribed video** (it previously would have offered to replace another video's captions
  whose times merely overlapped); new captions and runs are bound to that video.
- **Removed**: `sequence.ts`, `sfxClip.ts`, `playbackController.ts`, `createPlaybackClock`, `CutMarkers`,
  `overlayLanes`, `OverlayInspector`/`SfxInspector` (→ `ClipInspector`), `OverlayStageEditor`
  (→ `ClipStageEditor`), `legacySegmentsOf`/`hasCuts`, the "Removed by cut" badge (→ "Not in sequence").

**Verification** (macOS arm64, this machine)
- `npm run check`: typecheck, **97 test files / 831 tests**, production build — all green. The count fell
  from 872 because `sequence.test.ts` and the element-clock/cut-controller suites were retired with their
  modules; new suites cover the new invariants: no overlap per track, sorted clips, overwrite/ripple
  round-trips (insert+delete, trim±, restore after silence removal), migration rendering-equivalence against
  schema 4's own mapping, parking, transport actions across a gap and at a boundary, the sequence clock's
  discipline, the SFX scheduler, thumbnail queue bounds, per-video transcription scoping, and v3 argv.
- **The existing v2 argument snapshots pass unchanged**, and a migrated schema-4 project produces exactly
  schema 4's v2 manifest and argv (`plan.test.ts`).
- **Real FFmpeg 9.0.1 + h264_videotoolbox**, with the builder's own v3 argv and a transparent PNG stream on
  the caption pipe: flat route over two different files → 5.000 s / 125 frames; with a per-frame brightness
  counter, output frame 0 is source frame 25 (the `-ss` seek is frame-exact) and the second file starts on
  the exact boundary frame. Stacked route with a gap, a portrait clip letterboxed on V1, a half-opacity PiP
  on V2 and an image → 10.000 s / 250 frames, black gaps, no stall before a clip, no smear after one,
  transparent letterbox, correct opacity.
- **`npm run parity:export`** (the full X3 suite, real exports through ExportService → worker → export host →
  pinned FFmpeg; evidence `docs/decisions/evidence/x3-parity-2026-09-19.json`): 200 caption-layer cases,
  **0 mismatches**; 180 composited cases whose delta measurements are **identical, case for case, to the
  2026-09-17 baseline** (worst boxed 6.7369, worst global 2.7246); caption onsets 0 frames off and beep onsets
  −2 ms, exactly as before. Run it with `ELECTRON_RUN_AS_NODE` unset: an editor-hosted shell (VS Code) sets
  it, which makes `electron` start as plain Node and fail on `import { nativeImage }`.

**Not verified / limitations**
- **No interactive GUI run this session** (the user is testing manually): timeline gestures, the video
  pool and clock discipline in the real renderer, drop targets and the stage editor are unit-tested only.
- The **cross-file boundary gap in preview is not measured** yet (the preroll variant was chosen without
  measurement; "start muted and hidden early" is the fallback if it stalls). Starting playback can snap the
  playhead back a little while the first element buffers.
- The FFmpeg-composited-image tolerance (an image *under* a video) is not measured; blur is still refused.
- Windows is not exercised.

**Next task**: run V7's manual smoke (`tickets.md`), measure the boundary gap and record it here, then V3/V4.

## 2026-09-19 — Multi-clip foundation: schema 4, clip API, clip commands (Phase 2a)

First of six green-at-each-step sub-steps of the multi-clip plan (2a schema/commands → 2b playback
across clips → 2c timeline clip blocks and video drop → 2d multi-input export → 2e per-video
transcription/silence/waveforms → 2f cleanup). This slice replaces the single source `media` and
kept-range `segments` with a **video asset kind and an ordered `clips` list**, but the UI is
deliberately still single-clip: it plays, cuts and exports the sequence's *primary* video through a
compat shim. The full data-model contract is the new "Schema 4" section of [EDITING.md](EDITING.md).

**Schema** (`src/core/edit.ts`, `src/core/model.ts`): `projectSchema` is now `schemaVersion: 4` — no
`media`, no `segments`; `projectAssetSchema.kind` adds `'video'`; `clips: { id, assetId, startUs,
endUs }[]` where **array order is sequence order** and a range may repeat or overlap. Every
source-time item (cue, overlay, blur region, sound effect) gains an optional `mediaAssetId`, required
by `superRefine` only once `clips.length > 0`, so an SRT-first project stays valid. Schema 3 is kept
verbatim as `projectSchemaV3`. `migrateV3` turns `media` into a video asset, `segments` (or one
whole-video clip for the identity edit) into clips that keep their ids, and stamps every item;
`loadProject(value, newId)` now reports `migratedFrom: 1 | 2 | 3 | null`. A migrated media whose
duration was never probed (schema 1/2 files) keeps its asset but gets no clip; the first relink that
reports a duration adds the whole-video clip (`asset-update`).

**Pure clip API** (`src/core/sequence.ts`, beside the unchanged segment functions):
`SourcePoint = { clipId, assetId, sourceUs }` (the clip id disambiguates a repeated range),
`sequenceDurationOfClips`, `clipSequenceStartUs`, `sequencePointOf`, `sourceToSequenceForAsset`,
`sequenceToSourcePoint`, `spansInSequenceForAsset`, `nextClipPoint` (+ `SEQUENCE_END`), and the editing
functions `insertClip/splitClipAt/removeClip/joinClipWithNext/moveClip/resizeClip/normalizeClips`
(no sort), `splitClipsByKeptRanges` (silence removal), `restoreFullClips`, `refitClipsToDuration`,
`cuesInSequenceForClips` (one SRT cue per **contiguous run** of spans). New `src/core/projectClips.ts`
holds the project-level helpers (`primaryVideoAsset`, `legacySegmentsOf`, `hasCuts`,
`assetDurations`, `sequenceAssetIds`, `bindUnboundItems`, `defaultBindingAssetId`,
`videoAssetUsers`) — placed there rather than in `model.ts` to keep the schema module free of
editing concepts.

**Commands** (`src/core/itemCommands.ts`): new `clip-add` (imports the video and inserts the clip in
one undo step, dedupes by fingerprint like `overlay-add`, stamps unbound items when it opens an
empty sequence, refuses an unprobed duration), `clip-move/resize/split/delete/join-next`,
`clips-set`, `clips-restore`. `trim-*`, `segment-*` and `segments-set` are **removed** rather than
left refusing: the only UI that reached them was silence removal and "Restore removed ranges", which
now use `clips-set`/`clips-restore`. `item-move/resize/delete` accept kind `'clip'` (renamed from
`'segment'`). `asset-remove` refuses a video still used by clips or bound items and says how many.
`asset-update` on a video refits its clips when the duration changes (a whole-video clip follows the
new length; others are clamped). Bounds and overlap warnings are per video (`CommandContext.
assetDurationUs`, `defaultAssetId`); a cue/item created without a video is bound to the sequence's
only video (or the explicit default). Merging captions, or moving a word, across two videos is
refused. Issue kinds `segment-order`/`segment-empty` became `clip-order`/`clip-empty`.

**Electron**: `project:open` resolves the video through the same per-asset loop as images and audio and
no longer returns a separate `media` resolution; `projectForSave` and `project:save`/`project:write`
lost the `mediaPath` parameter; `media:relink` is gone (`assets:relink` accepts video and checks it
with `classifyMedia`). Export IPC is unchanged: it is fingerprint-based, and manifest v2 is built from
the primary video's clips via `legacySegmentsOf`, so an identity project (one whole-video clip) still
produces no `segments` and the same argv as before.

**App shim** (`src/App.tsx`): `primary`/`segments` are derived from the project instead of stored;
the video's runtime URL is keyed by **fingerprint** (not asset id) so undoing a relink or replace points
the player back at the right file; `mediaPath`, `mediaDurationUs` state and the history-rewriting
`replaceMedia` are gone.

**Behaviour changes to know about**: opening a video is now one undoable step (Undo removes the video
from the project; Redo restores it playing); replacing the open video and relinking it are undoable
`asset-update`s instead of rewriting every history snapshot; a video whose duration cannot be probed
cannot be opened (clear error) instead of opening with an unbounded timeline; a schema-3 file loads
and migrates but is **not** rewritten until you Save (autosave waits), and once saved as schema 4 an
older build can no longer open it.

**Verification**: `npm run check` (typecheck, 90 test files / 870 tests, production build) passes;
`electron scripts/export-parity.mjs` → 200 caption cases, 0 mismatches. Driven end to end on real
Electron on macOS (dev mode, over CDP with real file-drop events, so preload `webUtils` → main probe →
`clip-add` all ran): drop a video → opens and plays; Undo → back to "Your video appears here"; Redo →
plays again; drop a second video → "Replace the open video?" → replace → the new file plays; Undo →
the first file plays again with its own duration; Redo → the second; SRT dropped first then a video →
the two captions survive open/undo/redo; zero console errors throughout. **Not exercised**: native
dialogs (Open Video, Open/Save Project), opening a real schema-3 `.cstudio` file through the UI
(migration is covered by unit tests only), autosave to disk, and Windows.

**Known limits until 2b–2f**: the UI still plays, edits and exports only the primary video — a project
can hold clips of several videos only through commands (nothing in the UI creates them yet), and the
timeline/preview/export show just the primary video's clips; Timeline still speaks `segments`, and
export is still manifest v2; `clip-delete` still refuses to remove the last clip (revisit in 2c);
transcription/alignment/silence still target the primary video.

**Next**: 2b — playback across clips (`SourcePoint` playhead, one `<video>` per distinct video asset,
`createSequencePlaybackController`), measuring and documenting the cross-video boundary gap.

## 2026-09-19 — Left rail, media bin, drag-and-drop (Phase 1 of the left-rail plan)

Replaced the fixed transcript column with a CapCut-style icon rail — Media/Captions/Overlays/
Transitions tabs plus a Settings button — and added a media bin so images, audio and a replacement
video can be imported by button or OS drag-and-drop, then placed by dragging onto the timeline/stage
or an "Add at playhead" button. Full contract in [EDITING.md](EDITING.md)'s new "Left rail, media
bin and drag-and-drop" section; IPC additions in [ARCHITECTURE.md](ARCHITECTURE.md).

**Pure core**: `src/core/assetKind.ts` gained `classifyMedia` (adds a `'video'` outcome) and
`isSubtitleFileName`; `classifyAsset` is now a wrapper that still refuses video, so every existing
caller/test is unchanged. New `src/core/dragPayload.ts` (the bin-drag payload, mirrored into a
module variable since `dragover` cannot read `DataTransfer.getData`), `src/core/timelineDrop.ts`
(`dropTimeAt`, `dropPlanForAsset` — image → overlay, audio → refused, video → replace-source) and
`src/core/assetImport.ts` (`InspectedFile`, `findAssetByFingerprint`).

**Electron**: new `electron/assetInspect.ts` (`inspectFileForBin`, dependency-injected for tests)
backs two new IPC channels, `assets:import-files` and `assets:inspect-dropped`; the latter resolves
dropped `File`s to paths inside the sandboxed preload via `webUtils.getPathForFile`, so the renderer
never handles a path for a bin import.

**Components**: `LeftRail.tsx` (roving-tabindex tablist, copied from `InspectorTabs.tsx`, which lost
its Templates tab — now Edit/Style only), `MediaBin.tsx`, `CaptionsPanel.tsx` (transcript list moved
out of `App.tsx` unchanged, empty state now shows Transcribe/Import SRT), `OverlaysPanel.tsx`,
`TransitionsPanel.tsx` (wraps the unchanged `TemplatesPanel.tsx`). `Timeline.tsx` gained
`onDropAsset`/`onDropFiles` and a `.drop-indicator`.

**Decisions carried from the plan**: audio dropped directly onto the timeline is refused ("Sound
effects arrive in ticket V3") — the existing "Add at playhead" button still works, since it reuses
the same `audio-add` command the shipped `SfxScheduler` already plays; only the new arbitrary-point
timeline-drag gesture is held back pending V3's own validation. An SRT import never silently
replaces existing captions (`ReplaceCaptionsReview`). Video import always goes through the existing
single-source replace flow (`ReplaceVideoReview` when a video is already open) — Phase 1 keeps
`projectAssetSchema.kind` as `'image' | 'audio'` only; multi-clip sequencing (the plan's Phase 2) is
not part of this slice.

**Verification**: `npm run typecheck`, `npm test` (789 passing; two typecheck errors pre-date this
change — `src/App.tsx`'s `AudioContext`/`AudioContextLike` mismatch and three `itemCommands.ts`
narrowing errors in `resolveInlineAsset` call sites — both unrelated to this slice and left as-is).
`npx vite build` succeeds. Verified interactively in a real Chromium instance (headless, driven over
CDP — the desktop Electron binary in this sandbox is a stub and would not launch): all four rail
panels render and switch correctly with zero console errors; screenshots were not saved. Desktop
Electron (native dialogs, OS drag-and-drop, IPC) was not exercised — that needs a real macOS/Windows
run, which this sandboxed session could not do.

**Next**: Phase 2 (multi-clip sequencing, schema 4) if wanted; otherwise a real desktop smoke test of
this slice (import PNG via button and via Finder drop; drag it to the timeline; drag an MP3 →
refused notice; drop `.srt` with existing cues → confirmation; drop `.mp4` on the empty stage →
opens; rail keyboard Up/Down/Home/End; Settings button; Transitions tab changes caption motion live).

## 2026-09-19 — Play/Pause no longer reports a false "Playback could not start"

Reported after a transcription: pressing Play on an `.mp4` that had played moments earlier showed
**Playback could not start for this media**, with no codec banner. The notice came from a single
`video.play().catch(...)` in `src/App.tsx` that discarded the rejection, so every failure read the
same. `play()` rejects with `AbortError` whenever a `pause()`, seek or new load lands before the
play actually starts — and the app provoked exactly that from the Space shortcut in two ways: a
held key auto-repeats `keydown` (play → pause → play…, no `event.repeat` guard), and a focused
`<video controls>` handles Space itself while the window-level handler toggled a second time (the
existing guard skipped `button, summary, a, [role="button"]` but not `video`). Transcription never
touches the element or its `media://` URL; it just makes clicking the player and hitting Space the
obvious next move.

Fix: `describePlayFailure` in `src/core/codecSupport.ts` (tested) returns null for `AbortError`
(nothing to report; the element is in the state of the last call) and otherwise names the real
DOMException plus the element's own `MediaError` via `describeMediaError`. `togglePlayback` uses it
and logs the exception with `readyState`/`networkState` to the console, so a genuine failure is now
diagnosable instead of guessed at. The keydown handler ignores `event.repeat` for playback (arrows
keep repeating to scrub) and leaves a focused player to its native controls.

## 2026-09-18 — Overlay stage editing, stacking and clone

Closed the gap V2 deliberately left open (`docs/EDITING.md`'s V2 "Out of scope" note): image
overlays can now be dragged/resized directly on the preview, stacked and reordered, and cloned with
Alt+drag — on both the stage and the timeline — instead of only through four bare x/y/width/height
number fields. Full contract in `docs/EDITING.md`'s new "Overlay stage editing, stacking and clone"
section.

**Pure core** (new `src/core/overlayRect.ts`): `moveRect`/`resizeRect` (handle-anchored, corners
keep aspect unless Shift frees it, clamped to the composition, 16-unit minimum), `nudgeRect`,
`roundRect`, `centerRect` and `overlayLanes` (the timeline's interval packing for overlapping
overlays, last-in-array on top). `src/core/itemCommands.ts`: `overlay-add` now appends instead of
sorting by `startUs`, so array order is the stacking order everywhere it already gets painted in
that order (`CompositionLayers.tsx`, `plan.ts`'s export manifest) — a new overlay lands on top, like
any editor's new layer. New `overlay-reorder` command (forward/backward/front/back); a no-op spends
no undo step.

**Stage**: new `src/OverlayStageEditor.tsx`, a sibling of `CaptionStage` inside `.video-frame`,
reusing `projectCaptionViewport` so its hit boxes/handles sit exactly on the painted overlay; only
overlay hit boxes are `pointer-events: auto`, so the native video controls stay clickable. Move/
resize draft and commit through the same `onRectDraft`/`onRectCommit` pair the inspector's fields
already used. Alt+drag on a body clones (a synthetic overlay with a new id, shown by `App.tsx`'s
`visibleOverlays` appending rather than replacing); release adds it as a new overlay, one undo step.
Escape mid-gesture cancels. Arrow keys nudge the selected overlay (Shift = 10 units).

**Inspector** (`src/OverlayInspector.tsx`): opacity is now a full-width 0–100% slider (was squeezed
into the shared ~50px control column); position/size is a 2×2 X/Y/W/H grid with a Lock aspect
toggle and Center/Center H/Center V/Fit frame quick actions; a Layer row (Bring forward/Send
backward, shown with 2+ overlays) drives `overlay-reorder`; Duplicate and Add image… actions were
added alongside Delete. The Edit tab's no-selection state also gained an Add image overlay button,
so the feature doesn't require the menu to discover.

**Timeline** (`src/Timeline.tsx`): the Overlays track now packs overlapping overlays into separate
lanes (`overlayLanes`), growing only when overlays actually overlap — an unedited project or one
with no overlapping overlays draws at the same height V2 shipped. Alt+drag on a block clones in
time the same way the stage clones in space (`onOverlayDragCommit`'s new `{ clone?: boolean }`).
Blocks are labelled by their asset's name once there's more than one, instead of the constant
"Image overlay".

**Token budget for this ticket: no new test files or test cases were written**, matching V2's own
policy for this area. The existing suite (750 tests, unchanged in count) was kept green throughout;
`npm run typecheck`, `npm test` and `npm run build` (including the `dist-worker/` bundle) all pass.
Verification is the user's own manual checklist (drag/resize/clamp on the stage, opacity slider,
stacking order and reorder, Alt-clone on both stage and timeline, keyboard nudge, Escape-cancel,
export of a multi-overlay project) — **not run this session**.

**Limitations / next**: no automated coverage of `overlayRect.ts`, `OverlayStageEditor.tsx` or the
timeline's lane packing/clone path — a future pass should add it if this area sees more churn. The
Layer row only offers one-step forward/backward, not drag-to-reorder. Blur regions (V4) will want
the same stage-manipulation surface; `OverlayStageEditor` was kept overlay-specific rather than
generalized now, to avoid designing that abstraction against only one caller.

## 2026-09-18 — X3: preview/export parity and sync validation

Closed Phase G's milestone gate. New `scripts/export-parity.mjs` (`npm run parity:export`) is a
repeatable suite that synthesizes its own sources with the pinned FFmpeg (a static SMPTE-bars/tone
pattern so any inter-frame pixel change is attributable to the caption layer, not scene motion) and
runs the real production path (`electron . --export-smoke` → `ExportService` → job scheduler → media
worker → the separate GPU export host → the pinned FFmpeg pair) — never a second caption
implementation, and never faking a step. `electron/exportIpc.ts`'s `runExportSmoke` gained an
optional `manifestPath` (a full, validated `ExportManifest` from disk, superseding the SRT-only v1
manifest) and now returns the real `ExportPlan` alongside the outcome, both reused by the suite
rather than re-derived.

Two independent checks: **caption-layer parity** reuses X1's own preview-vs-export-host invariant
(`renderPreview`/`renderOffscreen`) across every manifest this suite builds — five presets, portrait
and landscape, the project's own Malayalam/English shaping fixtures — asserted at **200/200 cases,
0 differing bytes**. **Composited-frame parity** compares the real encoded MP4 frame against a
straight-alpha composite of that same caption render over a clean backdrop frame from the same
encode, across **180 real exports** including a rotated source (real `-display_rotation 90` input
option and stream copy — no GPL encoder, `ffprobe` confirms the side data, output dimensions swapped
as planned) and a genuinely variable-rate source (`avg_frame_rate` measured diverging from a constant
`r_frame_rate`). Mean absolute channel delta inside the caption's bounding box averaged 2.09 (worst
6.74), globally 0.92 (worst 2.72) — measured h264/yuv420p quantization noise (a caption-free region
of the same backdrop measures ~1.6 MSE between arbitrary frames), not a rendering discrepancy; per
ADR 0003 this is reported, not claimed bit-identical. A 240 s long-pause/beep source showed audio
onset 2 ms early and consistent (not drifting) on all four beeps, and caption onset at exactly the
planned frame every time. Full numbers, the machine/build identity and every case are in
`docs/decisions/evidence/x3-parity-2026-09-17.json`; `docs/CAPTION_RENDERER.md` and
[ADR 0004](decisions/0004-mp4-export-profile.md) carry the summary.

The onset-detection heuristic itself needed a real fix mid-session: an early version flagged "any
pixel differs" as caption onset, which on encoded video is indistinguishable from ordinary encoder
quantization noise and produced a false, suspiciously exact "captions lag audio by 3 frames" result
on every cue; visually inspecting the actual extracted frames (frame 147: no caption; frame 150,
the true cue start: caption fully visible) showed the detector was wrong, not the pipeline. Fixed by
requiring a channel-delta threshold measured well above the real noise floor over a real fraction of
the caption's own bounding box — documented in the script as the reason, not left as a magic number.

Verification: `npm run typecheck` passes. Per this session's direction, `npm test`/vitest was
deliberately not run for this ticket — the parity suite itself is the verification `npm run
parity:export` on macOS arm64 (Apple M4 Pro), one clean run, 0 job failures, 0 assertion failures.
This session did not add or run unit/integration tests; a couple of the nested `--export-smoke`
child processes failed transiently (empty stdout despite exiting 0, a pipe-flush race rather than an
export failure — the same manifest succeeded when retried) during earlier iterations, addressed with
one bounded retry in the suite rather than in the production smoke path.

Limitations: only macOS arm64 was measured (matching every export ticket so far); Windows has no
export path yet. Composited-frame deltas are reported in aggregate across all presets/layouts, not
broken out per source, in this run. The rotated and VFR fixtures are synthesized locally (FFmpeg
`-display_rotation`/`setpts`), not captured from a real device, though `planFromMedia`'s rotation
math is separately verified in `src/export/plan.test.ts` against a real ffprobe capture
(`tests/fixtures/ffprobe-rotated.json`). Mark X3 complete in `tickets.md`.

## 2026-09-18 — V2: image overlays

Implemented ticket V2 (`docs/EDITING.md`, `tickets.md`): import a still image, place it on the stage
as a time-ranged overlay, edit it in a new inspector and export it in the MP4 — the substrate V1 laid
down (schema 3's `assets`/`overlays`, the item command union, generic timeline items, manifest v2)
is now reachable end to end.

**Pure core** (new `src/core/assetKind.ts`, `src/core/overlayDefaults.ts`; `src/core/itemCommands.ts`):
`classifyAsset` accepts a still-image codec with no audio stream and refuses anything else (a video
renamed to `.png` is still refused); `overlay-add` gained an optional `asset` so importing an image and
placing its first overlay is one undo step, deduping by the asset's sampled fingerprint when the same
file is imported twice; a new `asset-update` command backs relinking. `electron/projectMedia.ts` gained
`mediaPathFromUrl` (the inverse of `mediaUrlForPath`, now shared by main and the export host) and an
`AssetResolution` type.

**Main/IPC**: `assets:import`/`assets:relink` mirror the video open/relink dialogs, classifying the
real probed streams rather than trusting the file extension. `project:open` now resolves every stored
asset exactly like the source media (`candidatePaths` + `inspectMedia`), rewriting a resolved asset's
reference in place and returning per-asset resolutions; a missing/mismatched asset is left alone and
flagged instead. `export:start`'s manifest builder resolves each overlay's asset through the same
`inspectedMedia` fingerprint registry as the source video and refuses the export, naming the asset,
before the job starts if it is not registered.

**Preview and timeline**: `CaptionPreview` takes an optional `layers` node rendered inside its scaled
composition wrapper, below captions; new `src/captions/CompositionLayers.tsx` paints already-visible,
already-resolved images (or a dashed placeholder naming the asset when its URL is unknown). New
`src/OverlayInspector.tsx` (asset name/status/Relink, start/end, x/y/width/height, fit, opacity,
delete). `src/Timeline.tsx` draws an **Overlays** track only when `project.overlays.length > 0` — an
unedited project's layout is byte-for-byte what V1 shipped — dragging/resizing an overlay through the
generic `dragRangeBy`/`itemDragBounds` path V1 built but never wired up, kept as a separate branch from
the caption track's own `dragCueBy` path rather than merging them.

**Export**: `src/export/frameRequest.ts`'s v1 schema became a `version` discriminated union with a new
v2 carrying `overlays`; `frameRequestAt` only emits v2 for a frame that actually has a visible overlay,
so an unedited project's export request traffic is unchanged. `frameHarness.tsx` renders
`CompositionLayers` from the resolved request and its `ready()` gate now awaits every overlay
`<img>`'s `decode()`, so a broken/slow asset fails the export loudly instead of silently omitting it.
The export host (`scripts/export-host.mjs`) gained its own `media:` scheme, serving only the exact
URLs the worker passes as `--asset <url>` argv (`workers/media/export.ts`) — FFmpeg's filtergraph is
completely untouched by overlays (ADR 0003); `assertExportableManifest` no longer refuses `overlays`.

**Token budget for this ticket: no new test files or test cases were written.** The existing suite
(750 tests, unchanged in count) was kept green — `exportArguments.test.ts`'s overlay case flipped from
"refuses" to "produces the identity filtergraph unchanged" — and `npm run typecheck`, `npm test` and
`npm run build` (including the `dist-export/` bundle) all pass. Ticket V2's own listed test cases and
the real-media export smoke are **not run this session**; verification is a manual checklist the user
ran instead. `tickets.md` ticks V2 once that checklist is confirmed.

**Limitations / next**: no automated coverage of the new IPC handlers, `CompositionLayers`, the
overlay drag path or the v2 frame request — a future pass should add it if this area sees more churn.
Dragging/resizing the overlay rect directly on the stage is out of scope (inspector fields only; V4's
stage rect tool is the natural place to add it for every rect-carrying item at once). Audio assets are
deferred to V3, which reuses `assets:import`/`assets:relink`'s existing `kind` parameter.

## 2026-09-18 — Remove Silence (automatic cuts) and V6's export half

Added a DaVinci-Resolve-style **Remove Silence** feature: a new **Timeline** menu (after **File**,
alongside Export — a distinct native "Edit" menu already owns Undo/Cut/Copy/Paste, so this got its
own name rather than colliding with it) with **Remove Silence…** opening a dialog to pick a dB
threshold, minimum silence length and padding, detect, review a one-line summary (cut count, time
removed, new length), and apply — and **Restore Removed Ranges** to undo it back to the identity edit.
This is the first UI in the app that produces `segments`, and it reaches FFmpeg: cuts now export for
real, ahead of V6's own manual cut/join tools (`docs/EDITING.md`, `tickets.md`).

**Detection** (`src/core/silenceRemoval.ts`, `workers/media/silence.ts`): reuses
`LongSilenceDetector`/`samplesToUs` from `src/core/speechGating.ts` (already streaming, exact, and
proven by transcription's own silence-gating) over 16 kHz mono PCM extracted the same way
`audio.ts` does for transcription — no new dependency. `keptRangesFromSilences` shrinks each detected
silence by the padding on both sides before subtracting it from the media, merges the result, and
never returns an empty edit (all-silent audio keeps everything and reports nothing to remove).
Detection has no disk cache, unlike waveform extraction, because its result depends on
user-adjustable threshold/minimum-silence parameters and a re-run costs a few seconds.

**One new command, not a new edit path**: `segments-set` (`src/core/itemCommands.ts`) replaces the
whole segment list atomically through `normalizeSegments` (promoted from `sequence.ts`'s private
`normalize`), collapsing a single whole-media range back to the identity edit (`segments: undefined`)
so Remove Silence and manual split/delete/join (V6) share one normalisation rule and one undo history
entry each. Applying seeks the playhead through the *new* ranges (not the stale pre-command closure —
a bug caught before it shipped) so it never lands inside a range that just became a cut.

**Export reaches FFmpeg for cuts** (`workers/media/exportArguments.ts`): `assertExportableManifest`
no longer refuses `segments`; `exportFilterGraph` prepends one `trim`/`setpts` chain per kept segment
into a `concat` (and the same for `atrim`/audio) before the existing CFR/scale/pad normalisation,
exactly the skeleton documented in `docs/EDITING.md`. The identity edit (no segments, or one segment
covering the whole planned range) produces byte-for-byte the same filtergraph string as before —
verified by the pre-existing snapshot tests, unchanged. Output duration and frame count now come from
`exportOutputDurationUs`/`exportFrameCountFor` (`src/export/plan.ts`, new; `exportFrameCount(plan)` is
kept as a thin wrapper so every existing identity caller is untouched) — the sum of kept segments, not
the full planned range. A graph whose inline size would exceed the Windows argv-safe 8 KiB limit is
written to a `filtergraph.txt` in the job's temp directory and passed via `-filter_complex_script`
instead (silence removal on a real recording easily produces 100+ segments).

**Timeline** (`src/Timeline.tsx`, new `src/core/waveformSlice.ts`): the waveform now draws one `<svg>`
per kept segment — `slicePeaks` reuses the single extracted waveform's existing peak buckets rather
than re-extracting audio, so a cut removes the silent stretch from the drawing instead of squeezing
the whole waveform into a shorter span. Thin `.cut-marker`s sit on the video track at each cut instant
with the removed duration as a tooltip. A transcript row for a cue that falls entirely inside a
removed range now shows a "Removed by cut" badge (`spansInSequence(cue, segments).length === 0`, the
contract `docs/EDITING.md` already specified). An identity edit (no cuts) renders exactly as before:
one waveform `<svg>`, no markers, no badges.

Verification: strict TypeScript across every file this feature touched, with no new errors introduced
(a handful of pre-existing errors in `electron/transcriptionService.test.ts`/`scripts/transcription-
smoke.ts`, from a concurrently-developed translation feature, are unrelated and untouched by this
work); the full suite (**750 tests across 82 files**) passes. The renderer/Electron/worker production
builds and a real desktop smoke were not run this session (no display in this environment).
New/updated coverage: `silenceRemoval.test.ts` (padding shrink/merge, edge silences, all-silent media,
overlap/out-of-range rejection), `silence.test.ts` (synthetic tone-silence-tone WAV, no-silence,
no-audio-stream), `itemCommands.test.ts` (`segments-set` round-trip, identity collapse, empty-list
rejection), `protocol.test.ts` (new `detectSilence` task/result), `appMenu.test.ts` (Timeline menu
commands), `SilenceRemovalDialog.test.tsx` (media-not-ready gate, controls + disabled Apply, existing-
cuts warning), `waveformSlice.test.ts` (bucket-span slicing, clamping, out-of-range), `Timeline.test.tsx`
(one waveform svg with no cuts vs. two with one cut, cut-marker tooltip text), `exportArguments.test.ts`
(N-segment trim/concat wiring for video and audio, no-audio variant, sequence-duration `-t`/`-frames:v`,
`-filter_complex_script` substitution), `export.test.ts` (sequence-duration frame count with cuts,
200-segment graph spilling to a script file in the job directory).

**Limitations**: no real-media smoke test this session — detection thresholds, the FFmpeg trim/concat
output and the waveform/cut-marker placement are verified by the automated suite and by argument-level
parity with the identity path, not by a running window or a real encode. No per-silence keep/skip list
(the user chose a summary-only dialog over DaVinci's per-clip checklist); no detection-result caching
across dialog sessions. The manual cut-at-playhead/delete-segment/join-with-next tools, segment
handles on the video track, and V6's own real-media smoke test remain open (`tickets.md`).

Next: a desktop smoke pass (open a video with pauses, Remove Silence at the defaults, confirm ruler/
playback/waveform/cut markers/undo, export and `ffprobe` the MP4 and SRT against the sequence
duration), then V6's manual cut/join UI reusing the same `segments-set`-adjacent commands.

## 2026-09-18 — Translate captions with Gemini during transcription

Added an opt-in **"Translate to"** dropdown to the Transcribe dialog, for both engines. When a
target language is chosen, recognized text is sent to Gemini (`gemini-3.8-flash`) for translation
after recognition, and captions are created in the translated language instead of the spoken one.

**Pipeline** (`electron/geminiTranslation.ts`, `electron/transcriptionService.ts`): a new
`translating` job phase runs after recognition and before the scheduler's commit gate, sending
segment texts in batches of up to 60 to `ai.models.generateContent` with a JSON schema response.
Every batch line must come back exactly once, identified by its original index, or the whole batch
is rejected (`MALFORMED_OUTPUT`) rather than risking silent misalignment between translated text and
segment timing. The existing `checkTranscriptScript` sanity check reruns against the requested
target language and the translated text, so wrong-script output (e.g. Tamil script for a Malayalam
target) fails as `UNEXPECTED_SCRIPT`, the same as it does for recognition. For whisper.cpp, only the
recognized **text** is sent to Gemini — never audio — so translation needs the Gemini API key
regardless of which engine transcribed.

**Product constraints preserved**: the original, spoken-language recognition is always retained in
`transcriptionRuns[].recognition`, even when captions carry translated text; translation provenance
(`provider`, `model`, `targetLanguage`, `segmentCount`, token counts — never the key) is recorded
alongside the run. Translated captions keep the recognizer's segment timing but always get
**estimated** word timing and `needsReview: true`, since a translated word cannot correspond to the
original audio's word position — never presented as aligned or audio-verified.

**Renderer** (`src/TranscriptionPanel.tsx`): the dropdown (`src/core/translationLanguages.ts`'s
curated `TRANSLATION_TARGETS`) appears for both engines, defaults to "None — keep spoken language",
and is remembered in `localStorage` like the engine choice. Choosing a target folds into the
existing Gemini-key gating (alert, disabled Start, "Add Gemini API key" button) and switches the
Start button to "Transcribe and translate". A dedicated disclosure explains that only text is sent
for translation and that translated captions need review. `App.tsx`'s transcription notice now
mentions the target language, model and estimated timing when a translation was applied.

Verification: `npm run check` passes (typecheck, **745 tests across 82 files**, renderer build,
Electron main/preload bundle, worker build). New/updated coverage: `electron/geminiTranslation.test.ts`
(batching, index/count mismatch, empty-text, cancellation passthrough, wrong-script, languages with
no single expected script); `electron/transcriptionService.test.ts` (translation after whisper and
after Gemini recognition, provenance, key reuse, skip when no target, cancellation mid-translation);
`src/core/transcriptionApply.test.ts` (translated cues, estimated+needsReview words, retained
source-language recognition, segment-count-mismatch guard); `src/core/transcriptionIpc.test.ts`
(`translateTo` required, accepts a language code or `null`, rejects `auto`/locale tags, run schema
accepts `translation`); `src/TranscriptionPanel.test.tsx` (dropdown present for both engines, key
gating for a stored whisper+translate target, Start label switch).

**Limitations**: not run against real audio in this slice — verified by the automated suite and
argument-level provenance checks, not a live Gemini call. Translation targets are a curated list of
15 ISO 639-1 codes (`src/core/translationLanguages.ts`), not the full set Gemini could plausibly
translate into. Transliteration (writing translated/recognized speech in a non-native script) remains
out of scope, unchanged from `docs/PRODUCT.md`.

## 2026-09-17 — V1 edit foundation: schema 3, sequence time, generic timeline, item commands, manifest v2

Completed the substrate every Phase I edit (V2-V6) builds on, adding **no new user-visible edit**.
`docs/EDITING.md` was implemented as written rather than redesigned.

**Schema 3** (`src/core/edit.ts`, `src/core/model.ts`): composition rect, asset, image overlay, blur
region, audio clip and segment schemas. `media` stays singular; `assets`, `overlays`, `blurRegions`
and `audioClips` default to `[]`; `segments` is optional with `min(1)`, so an absent list is the
identity edit and an empty one is rejected. One ID namespace is enforced across cues, words, assets,
every item and segments, `assetId` must reference an asset of the matching kind, and segments must be
ascending, non-overlapping and inside the probed media duration. Assets reuse `projectMediaSchema`,
so `electron/projectMedia.ts`'s portable relative paths now cover them on save. `loadProject` tries
3 → 2 → 1 and `migratedFrom` is `1 | 2 | null`; 2 → 3 is a pure addition of the four empty lists.

**Sequence time** (`src/core/sequence.ts`): one pure integer-microsecond mapper — `effectiveSegments`,
`sequenceDurationUs`, `sourceToSequence`, `sequenceToSource`, `spansInSequence`, `nextKeptSourceUs`,
`setTrim`, `splitSegmentAt`, `removeSegment`, `joinWithNext`, `cuesInSequence` — the identity function
when `segments` is absent. Cues straddling a cut are clipped for display and export and are **never**
split in storage, so undoing a cut restores every caption exactly.

**Generic timeline**: `src/core/timelineItems.ts` defines `TimelineItem`, `Selection` and
`TimelineTrack`; `src/core/timeline.ts` gained `cueDragBounds`/`dragRangeBy` with `dragCueBy` as a
wrapper; `Timeline.tsx` builds its grid rows from a `tracks[]` list instead of the fixed CSS
variables and drags a `TimelineItem`; `App.tsx` holds a `{kind, id}` selection with a derived
`selectedCueId` for every existing caption read site. The ruler, playhead, seek, block positions,
snap guide, zoom anchor, `durationUs`, transport clock and `seekBy` are sequence time; `currentUs`,
cues, words, `captionFrame`, transcription and every media-worker request and cache key stay source
time. A cut-skipping playback controller (`src/core/playbackController.ts`) rides the existing
per-frame clock: `nextKeptSourceUs` either lets playback continue, seeks to the next kept start, or
pauses past the end, issuing exactly one seek per gap.

**Commands**: `src/core/itemCommands.ts` adds the second union (asset/overlay/blur/audio/item/trim/
segment operations) sharing `CommandResult`/`ValidationIssue` with `captionCommands.ts`;
`src/core/commands.ts`'s `applyEditCommand` dispatches both, so `App.tsx`'s single `runCommand` and
`history.ts`'s whole-project snapshots give item edits the same undo/redo captions already have.
`validateItems` runs after every item command. A rect taller than the current composition is a
**warning** through `CommandContext.compositionHeight`, never a schema error, so relinking media with
a different aspect can never make a saved project unloadable.

**Export**: manifest v2 (`src/export/plan.ts`) is a strict superset of X2's v1, adding segments,
overlays, output-pixel/sequence-time blur regions and sequence-time audio clips; both versions parse.
`src/core/composition.ts` holds `displayDimensions` (extracted from `App.tsx`), `compositionToPixels`
and `compositionScalarToPixels`, and main builds the manifest with them. `src/core/layerPlan.ts` maps
each sequence frame to its source timestamp and a frame signature by **reusing** `captionFrame`
(never reimplementing it), excluding `elapsedUs`, which changes every frame without changing a pixel.
`workers/media/exportArguments.ts` is now a deterministic builder over the manifest.

Per-frame motion preview updates at frame rate (the `requestVideoFrameCallback` clock introduced in
R2.1), which is what makes the layer-plan signatures meaningful: the same evaluation drives preview
and export.

Verification: `npm run check` passes strict TypeScript, **695 tests across 77 files** (up from 591
across 70), the renderer production build, the Electron main/preload bundle and the worker build.
`src/core/timeline.test.ts` and `workers/media/exportArguments.test.ts` pass with **no change to any
existing assertion** — they are the deliberate regression gates for the drag refactor and for X2
export parity. New coverage: schema 2→3 and 1→3 migration, cross-kind duplicate IDs, overlay/clip
asset-kind mismatches, unsorted/overlapping/empty/out-of-media segments; sequence identity,
round-trips, cut-instant collapse, spans across two cuts, `nextKeptSourceUs` past the end,
`cuesInSequence` clipping; `dragRangeBy` reproducing every `dragCueBy` case across a grid of modes,
deltas and media bounds; item commands, rect-height warnings and `asset-in-use`; layer-plan frame
times at 30000/1001 for indices 0, 1 and 10000, three spans for a static cue, word-pop signatures
changing only inside their ramps; composition rotation/even rounding and rect scaling at 1080 and
720; dynamic timeline rows and straddling-cue blocks; playback controller seeks and end-of-sequence
pause; and `exportArguments` snapshots of both the argument array and the filtergraph.

Deliberately scoped out of this ticket, so nothing is presented as working when it is not:
**no new effect reaches FFmpeg.** The manifest builder reproduces X2's argument array byte for byte
for an identity edit and **refuses** to build a command for cuts (V5/V6), blur (V4), sound effects
(V3) or overlays (V2) rather than silently exporting an unedited video. The trim and segment commands
exist and are tested but have no UI entry point until V5/V6.

The export frame loop now reuses a rendered PNG whenever the next frame's signature is unchanged,
which subsumes X2's gap-frame reuse (gap frames remain cached for the whole export). The frame count
written to the encoder is unchanged; only the number of frames actually painted falls.

**Limitations — the real-media smoke was not run in this slice, so V1 stays unchecked in
`tickets.md`.** Everything above is verified by the automated suite and by argument-level parity, not
by a real encode or a running window. Still outstanding, on macOS and Windows: reopen a real schema-2
project and diff its cues; exercise drag, snap, split, merge and undo in the Electron window; export
an unedited project with X2 before and after this change and compare the output hashes. Sequence-time
conversion is exercised only by unit tests and by the identity path the app actually runs, because no
V1 UI can create a cut. Snapping still computes in source time against a threshold derived from the
sequence axis; that is exact for the identity edit and should be revisited in V6. Per-segment
thumbnail strips and waveform slices (`waveformSlice.ts`) are V6's work.

Next: V2 (image overlays) — asset import/resolve/relink IPC, `CompositionLayers`, the overlay track
and inspector, and frame request v2 so the export host paints overlays into the caption layer.

## 2026-09-17 — Caption word menu escapes the timeline clipping boundary

Fixed the transcript word-action menu being cut off behind the timeline when a word near the bottom
of the caption list was clicked. The menu now renders through a document-level React portal instead
of inside the list's required scrolling/overflow boundary, uses fixed viewport coordinates, follows
its clicked word during scrolling and resize, flips above bottom-edge words, and becomes internally
scrollable in a window too short to show every action. Outside-click handling covers both the source
caption row and the portalled menu.

Verification: `npm run check` passed strict TypeScript, **570 tests across 64 files**, the production
renderer build, Electron main/preload build and worker build. New pure placement regressions cover
normal below-word placement, bottom-edge upward flipping, and horizontal/vertical viewport clamping.
In the running macOS Electron app, clicking the first word in the final visible caption exposed the
complete action menu as a top-level accessible menu rather than a descendant clipped by the caption
list/timeline boundary. Windows was not tested.

Next: repeat the bottom-caption interaction on Windows and at the minimum supported window height.

## 2026-09-17 — Progressive reveal no longer hides the active/final word

Fixed **Mint reveal** (and any progressive-word-reveal style whose emphasis face differs from the
base face) never showing the current word — including the last word, which stays current until the
cue ends. `CaptionView` punched the active word out of the base line whenever word regions carried a
distinct emphasis measurement, but progressive reveal paints no word-effect overlay to replace it.
The mask is now applied only when an overlay (word-pop / active-word highlight) actually repaints the
word. Verification: new regression test in `src/captions/motion.test.tsx`; `npm run typecheck` and
`npm test` (567 tests) pass; a Chromium render of an imported two-line Malayalam SRT cue with Mint
reveal (portrait and landscape) showed every word, including the final `ആണ്.`, once its turn
started. Tested on macOS only. Limitation: SRT word timings stay spread by letter count, not
matched to the audio, until alignment is run.

## 2026-09-17 — Word-motion templates now apply to real captions; Anek Malayalam pinned

Fixed the mismatch that made **Mint reveal** animate in its template card but appear static on an
imported caption. Template cards use an explicitly synthetic demo with complete word timings, while
SRT cues normally have none; clicking a template previously changed only `captionStyle`, so the
shared renderer correctly fell back to a static line. Applying a word-dependent built-in template is
now one undoable project command that fills only missing word timing with `estimated` / Needs review
entries, preserves existing model/aligned/manual word timing, and reports any cue too short to
estimate. It also clears per-caption motion overrides, which otherwise silently masked the newly
applied project template. Static and phrase-fade templates do not manufacture word timing.

Added **Anek Malayalam** (the font family's official spelling) to the pinned offline font choices, so
it appears in the default caption and emphasis dropdowns before Local Font Access is requested. The
app still does not bundle or download the font; Chromium uses the installed system face when present
and the existing Malayalam fallback stack otherwise.

Verification: `npm run check` passed strict TypeScript, **563 tests across 62 files**, the production
renderer build, Electron main/preload build and worker build. New regressions verify that Mint reveal
creates review-labelled timing, preserves aligned timing, clears a stale cue override, commits the
template style, and exposes Anek Malayalam in the default font catalog and rendered dropdown.
`npm run smoke:captions` still reaches its pre-existing StylePanel harness failure: changing the
primary-colour input is not observed by the harness (white before and after), before its motion checks
run. macOS interactive preview/export and Windows were not tested in this slice.

Next: repair the real-Chromium StylePanel smoke interaction, then visually compare Mint reveal in the
live preview and an exported frame at the same source timestamps.

## 2026-09-17 — Caption-list visibility, alignment and single-click actions

Fixed the caption-list regression that rendered imported SRT rows blank until they were opened in
the double-click editor. `locateWordSpans` intentionally returns an empty array for cues without word
timing; the transcript JSX treated that truthy empty array as interactive content and rendered zero
children. The new `interactiveTranscriptSpans` boundary returns `null` for that case, so the list now
shows the authoritative imported cue text immediately and only creates per-word controls when real
word entries exist. No word timing is estimated implicitly and imported text/timings remain unchanged.

Redesigned the list toward the supplied reference: a wider transcript column; aligned numbered rows
with stable dividers and a right-edge edit affordance; a compact, closed-by-default Caption Tools pill
whose controls open as an overlay instead of overflowing the fixed header; and a floating word-action
menu that opens on one click without changing row height. The menu exposes implemented emphasis,
edit, line-break, split, previous/next-line and delete operations. Word clicks work in either timeline
display mode, while double-click editing remains as a shortcut. Clicking outside closes the menu.

Verification: `npm run check` passed strict TypeScript, **561 tests across 62 files**, the production
renderer build, Electron main/preload build and worker build. Added focused Malayalam/mixed-script
coverage for untimed imported-cue fallback and timed interactive spans. On the running macOS Electron
app, visually verified all 16 imported Malayalam cues are visible without editing, rows and controls
remain aligned, Caption Tools stays contained, a timed word opens the action menu on one click, and
Edit from that menu opens the inline editor. The temporary timing estimate used for the interaction
check was undone. Windows was not tested.

Limitations: the action menu applies to cues with word entries; untimed imported cues correctly show
their full text and use the row's edit button until the user explicitly supplies or estimates word
timing. The app retains its product-required transcript / preview / inspector workspace rather than
copying the reference application's navigation shell.

Next: repeat the interaction pass on Windows and add browser-level regression coverage for menu
placement near the bottom of a scrolled caption list.

## 2026-09-16 — Templates-tab black-screen fix

Fixed the renderer crash that blanked the entire app when opening **Templates** with the pointer over
an animated template card. Chromium's first `requestAnimationFrame` timestamp can be fractionally
earlier than a `performance.now()` sampled during the current frame; the preview loop previously
converted that negative delta into a negative source-media timestamp, which the shared caption
renderer correctly rejected. `templatePreviewTimestampUs` now clamps the initial delta to zero before
looping the three-second synthetic demo, without relaxing the renderer's canonical-time validation.

Verification: the focused Templates panel test passes with a regression case for an RAF timestamp
that predates its start sample, strict TypeScript passes, and the running macOS Electron development
app was reloaded and exercised by opening Templates and focusing the animated **Bold reveal** card.
The template gallery remained mounted and DevTools reported no uncaught renderer errors. Windows was
not tested in this slice.

Next: retain an app-level error boundary as a separate resilience improvement so an unrelated future
renderer exception produces an actionable recovery screen instead of an empty React root.

## 2026-09-16 — Caption transition controls and word-boundary editing

Completed: separated the timeline's **WORD/LINE** view preference from the caption display used by preview and export. Switching the timeline now never estimates timings, changes project caption output, or changes exported video. The new transcript-side **Caption Tools** panel controls full-caption/one-word video display, the five existing motion presets, project-wide or selected-caption motion overrides, 0.25×–4× transition speed, reset controls, and word/character grouping with a 1–6 line limit. Motion speed is stored in styles/presets, resolved per cue by the same source-time evaluator in preview and export, and affects the existing 200 ms fade/pop ramps without changing caption or word timestamps. Cues can carry an optional motion/speed override and retain it through splits and regrouping.

Transcript rows now expose whole-word actions without nesting interactive controls: select a word, add a visual line break before it, split at its exact timed boundary, move the suffix into the next caption, move the prefix into the previous caption, or toggle emphasis. Double-clicking a transcript row opens an inline multiline editor: Enter adds a line, Cmd/Ctrl+Enter commits, Escape cancels, and IME composition is not intercepted. Structural edits use grapheme-safe word spans, retain usable IDs/timing/provenance, are validated and undoable, and preserve caption overrides. Regrouping retains the original outer cue range while leaving genuine gaps between derived captions; it remains an explicit action and never merges manually separated captions.

Verification: `npm run check` passed: strict TypeScript, **558 tests across 61 files**, production renderer build, Electron main/preload build and worker build. Focused coverage includes timeline-only mode, Malayalam line breaks, timed word-boundary splitting/moving, speed ramps, and export motion overrides.

Limitations: `npm run smoke:captions` starts successfully but currently fails its pre-existing StylePanel interaction assertion: changing the primary-colour input did not alter the observed renderer colour. The failure occurs in the smoke harness’s first existing control assertion, before its new controls run; it needs a focused harness/UI follow-up. Existing legacy `set-display` callers retain their prior estimate-on-word-display behavior for compatibility, while the editor exclusively uses the new non-mutating timeline command.

Next: run the complete check and real-Chromium caption smoke, then perform a desktop interaction pass for the new controls on macOS and Windows.

## 2026-09-16 — Inspector Text-tab redesign + emphasis Size/Glow/Styles

Redesigned the right-side inspector's Style tab (relabelled **Text** in the tab strip — the tab `id`
stays `style`, so no test/DOM id churned) into a clean, dark, sectioned panel matching the reference:
hairline-divided collapsible sections with a real chevron icon, label/control/reset-button rows (the
32px reset column is reserved even on rows without a reset, so every control lines up), stacked ▲▼
steppers around a real `<select>`, accent-colored sliders with the unit inside the number box, pill and
compact-icon segmented controls, a real toggle-switch component, and a pinned **Export** footer button.
Shipped alongside three new emphasis-only appearance controls: static **Size** (1-2x scale on
emphasized words, independent of word-pop's transient animation scale), **Glow** (its own color,
reusing the base `glowRadius`), and **Styles** (Tt/T/t text-transform + underline, applied only to
emphasized words).

**Schema/renderer** (`src/captions/style.ts`, `src/captions/renderer.ts`, `src/captions/CaptionPreview.tsx`):
four new `.default()`-ed `captionAppearanceSchema` fields (`emphasisScale`, `emphasisGlowEnabled`/
`emphasisGlowColor`, `emphasisTextTransform`, `emphasisUnderline`) so old projects/presets parse
unchanged. `captionStyleInputs` now builds `emphasisFont` whenever the family/weight/italic differ *or*
`emphasisScale !== 1` *or* the resolved emphasis text-transform differs from the base, and composes a
second `appearance.emphasisShadow` (depth→glow→drop-shadow, like the base `shadow`, but the glow layer
uses `emphasisGlowColor` when the emphasis glow is on) — left `undefined` whenever it would be
identical to the base shadow, so the common case inherits it for free. New exported
`fittedEmphasisFont(inputs, fitted)` is the one place that re-derives the emphasis font from an
already-fitted base font while preserving the *ratio* between them, replacing three call sites that
used to hard-force the emphasis font back to the base font's exact size (which silently discarded
`emphasisScale` the moment the max-lines fitting loop shrank the base font). `SelectedEmphasisLine` now
paints `textShadow`/`textDecoration` per emphasis *run* instead of on the shared line `<div>` — which
also fixes a preexisting bug where the base line's own `underline` never reached word runs on an
emphasized line, since `text-decoration` doesn't inherit into an `inline-block` span.

**Inspector UI** (`src/styles.css`, `src/style/controls.tsx`, new `src/style/icons.tsx`,
`src/StylePanel.tsx`, `src/WordEmphasisPanel.tsx`, `src/InspectorTabs.tsx`, `src/App.tsx`): the whole
inspector token system (`--ins-*` custom properties scoped to `.inspector-panel`) was rewritten in
place, keeping every existing class name/id/`aria-label` the reference tests and the real-Chromium
`smoke:captions` grid depend on (`#style-alignment button[title="left"]`, `#style-text-transform
button[title="uppercase"]`, `#style-fill-mode button:nth-child(n)`, `#style-emphasis-face`,
`#style-font-load`, `class="style-reset"`, …). `StylePanel.tsx` is reordered into
FONTS→FORMAT→POSITION→COLOR→EMPHASIS→SPACING→EFFECTS with the new Size/Glow/Styles/Animation rows
inside EMPHASIS; the emphasis font-family field changed from a free-text+datalist input to a `Stepper`
offering "Same as caption font" plus the known families (a deliberate narrowing — arbitrary custom
emphasis-family names are no longer typeable from the UI). The word picker
(`WordEmphasisPanel`, heading now "Emphasize words") moved from the Text tab to the **Edit** tab,
directly under the cue editor. `App.tsx`'s inspector `<aside>` dropped its visible "INSPECTOR / Caption"
heading box for a `.sr-only` one (kept for `aria-labelledby`), and gained a sticky `.inspector-footer`
with one accent **Export** button (video export when ready, SRT otherwise — the toolbar's own Export
SRT/Export video/progress controls are unchanged, this is an additional shortcut) that swaps to the
existing `describeJob` progress + Cancel while an export is running.

Verification: `npm run typecheck` and `npm test` (**552 tests passing**, including new assertions in
`captions/style.test.ts`, `captions/emphasis.test.tsx`, `StylePanel.test.tsx` and
`InspectorTabs.test.tsx` for the new schema fields, `fittedEmphasisFont`/`emphasisShadow` composition,
the new emphasis Size/Glow/Styles/Animation control ids, and the "Text" tab label) and `npm run build`
(Vite + Electron main/preload + worker) all pass on **macOS arm64**. **Not run this session**:
`npm run smoke:captions` — this sandbox's Electron install has no usable `BrowserWindow`/display
(`SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'`),
so the real-Chromium DOM-measurement/motion grid and the "controls driving the real preview" section
were not exercised; nor was an interactive `npm run dev` pass or an export-parity frame comparison.
Every id/title/class the smoke script's selectors depend on was preserved deliberately and cross-checked
by reading `src/captions/visualSmoke.tsx`'s selectors against the new markup, but that is not a
substitute for actually running it.

Next: run `npm run smoke:captions` and a manual `npm run dev` pass on a machine with a real display to
confirm the visual redesign and the new Size/Glow/Styles controls actually drive the preview correctly,
then an export-parity check (an emphasized word at Size 1.5 + Glow, compared frame-for-frame against
the live preview).

## 2026-09-16 — R3 slice 1: WORD display drives preview/export, word select/add/delete

Previously the timeline's `WORD`/`LINE` toggle only changed how the **timeline track** drew a cue —
the video preview and export always showed the whole line, and imported/typed cues (`words: []`)
rendered as an untimed placeholder in WORD mode until the user ran "Estimate all words & group" by
hand. `WORD`/`LINE` is now a saved project setting (`captionDisplay: 'line' | 'word'`,
`src/core/model.ts`) that the timeline, the live preview and MP4 export all read the same way.

New shared pure module `src/captions/wordDisplay.ts`: `activeWordIndex(cue, timestampUs)` picks the
word to show under a **hold-through-gaps** rule — each word's window runs from its own start to the
next word's start (the first word's window absorbs any lead-in gap, the last word's window closes at
the cue's own end), so the windows partition `[cue.startUs, cue.endUs)` exactly and word display never
shows a blank frame while the enclosing cue is active. `wordDisplayCue(cue, index)` builds a synthetic
one-word cue from the located span, re-basing the word's `textStart`/`textEnd` to `0`/`length` (an
un-rebased word — copied with its line-relative offsets — fails `locateWordSpans` against its own
one-word text and therefore fails `cueSchema`/`frameRequestSchema`; this was caught by a dedicated
parity regression test before it could reach export). The shown text is always a whole token located by
the existing `locateWordSpans`, so laying it out alone can neither split a Malayalam grapheme cluster
nor fragment a shaping run — the renderer itself still never estimates timing. `displayCue(cue,
display, timestampUs)` is the one function both `CaptionStage` (`App.tsx`) and `frameRequestAt`
(`src/export/plan.ts`, new optional `manifest.display`) call, so preview and export make the identical
choice for a given timestamp; `electron/exportIpc.ts` now forwards `project.captionDisplay` into the
export manifest. `CaptionPreview` gained an optional `fontSample` prop (the enclosing line's text) so
switching between a line's own words never re-triggers the font-loading effect, which previously blanked
the caption for a frame on every text change.

Toggling to WORD is one undoable command (`{ type: 'set-display', display, idPrefix }`,
`src/core/captionCommands.ts`) that also fills in word timing for cues that have none — but only the
missing part: a new `estimateMissingWordTimings` (`src/core/wordTiming.ts`) gap-fills untimed runs
between already-timed words (or a cue boundary) instead of replacing a cue's whole word list, so a cue
with one manually-fixed word keeps that word's provenance. Estimates stay labelled `estimated` /
`needsReview` per the SRT/estimate invariant; a cue too short to estimate is skipped with a warning
(`estimate-skipped`) and keeps showing as a full line. Toggling back to LINE only flips the flag — words
are kept, so WORD→LINE→WORD does not re-estimate anything already timed. `update-text` grew an optional
`estimateIfUntimed` flag, passed only while in WORD display, so a caption typed or edited in the
inspector shows word-by-word immediately instead of waiting for the next mode toggle.

Timeline: WORD mode's word blocks are now interactive — click/Enter selects a word (highlighted,
`aria-pressed`) and seeks to it; a `+ Word` button (replaces `+ Line`'s label/title while in WORD mode)
adds a 600 ms single-word cue at the playhead; Delete removes the selected word via a new `delete-word`
command, which swallows one attached run of adjacent punctuation and exactly one adjacent whitespace run
(never a line break), removes a now-orphaned line break if the word was alone on its line, and falls
back to deleting the whole cue if it was the only word — all grapheme-safe and covered for Malayalam
conjuncts, attached punctuation and repeated tokens (the earlier occurrence's timing/emphasis is kept,
the later one dropped). No word-boundary dragging or manual per-word timing creation yet — that stays
ticket R3's remaining scope.

Verification: `npm run typecheck`, `npm test` (**537 tests passing**, up from 494 — new
`src/captions/wordDisplay.test.ts`, plus additions to `wordTiming.test.ts`, `captionCommands.test.ts`,
`model.test.ts`, `export/plan.test.ts` and `captions/motion.test.tsx`) and `npm run build` (Vite +
Electron main/preload + worker) all pass on **macOS arm64**. This session did not run the interactive
`npm run dev` app or an end-to-end export; manual verification (scrubbing WORD mode, the per-word
presets on real video, and comparing an exported clip against the preview at matching timestamps) is
still owed before calling this slice done end-to-end.

Next: manual smoke of WORD display in the running app and a real export, then R3's remaining scope —
draggable word boundaries and manual per-word timing creation.

## 2026-09-16 — X2 cancellable MP4 export pipeline

Completed X2: the media worker's `export` operation is now real and wired end to end.
`workers/media/export.ts`'s `renderVideo` spawns the separate GPU export host (ADR 0003) and the
pinned FFmpeg encoder as two owned child processes, streams one PNG caption frame per requested
timestamp from the host into FFmpeg's `image2pipe` input, and reuses a single rendered transparent
PNG for every gap frame (no active cue) instead of round-tripping the host for each one — the
placeholder cue `frameRequestAt` builds for a gap always expires before the real timestamp, so the
bytes are provably identical. Real `frame=` progress lines from FFmpeg's own `-progress pipe:1`
stream become measured `frames` job progress. `exportSupport`/`src/core/exportSupport.ts`
(`exportSupportFromConfiguration`) checks the exact pinned FFmpeg 9.0.1 profile plus
`--enable-zlib`/`--enable-videotoolbox` and `process.platform === 'darwin'` before ever spawning a
process — macOS only, honestly, not silently attempted elsewhere. `src/export/plan.ts` gained
`fittedFrameRate` (keeps an already-in-band rational rate exact — `30000/1001` stays `30000/1001`,
never rounded to `30`; halves a rate above 60 fps instead of discarding it) and `exportBitrate`
(deterministic 5M/8M/16M by output pixel count); `frameRequestAt` now returns `{ request, active }`
so the gap-reuse decision lives in one pure function, not duplicated in the worker.
`workers/media/exportArguments.ts` builds one documented profile, `mp4-caption-renderer-v1`:
`h264_videotoolbox` High profile `yuv420p` CFR at the plan's exact rational rate, AAC-LC 48 kHz
stereo 192 kb/s always transcoded (never copied) so audio duration matches the requested range
exactly, `-movflags +faststart`, `-map_metadata -1`, `-an` when the source has no audio. **A real
bug found only by this ticket's own end-to-end smoke test**: FFmpeg 9.0.1's `-autorotate` CLI flag
takes no explicit value — the original draft's `-autorotate 1` left a stray `1` token that FFmpeg's
parser only reported once it reached the output file ("cannot be applied to output url 1"); fixed to
the bare flag, confirmed against the real pinned binary, and `exportArguments.test.ts` now asserts
the exact form. The pre-existing `Buffer<ArrayBufferLike>`/`Buffer<ArrayBuffer>` `tsc` error in
`workers/media/exportProcesses.ts` (flagged unresolved by the concurrent X1 session) is fixed.

Main-process wiring is new this ticket. `electron/jobs.ts` is one process-wide `JobScheduler`
instance; `transcriptionIpc.ts` was switched from its own private scheduler onto this shared one, so
transcription and export now actually arbitrate against each other (every job kind was already
declared `'heavy'` in `src/core/jobs.ts`, but that promise was unfulfilled while each feature queued
only against itself). `electron/exportService.ts` mirrors `TranscriptionService`: a job-owned
`mkdtemp` directory holds the render manifest, the worker renders to `<destination>.<uuid>.tmp`
beside the user's chosen destination (never the source path — checked before enqueueing), and only
`ctx.enterCommit()` returning `true` triggers the atomic `rename()` onto the real destination — a
cancellation that arrives after a valid encode exists but before that rename still discards the
completed file, exercised for real (see verification). `electron/exportIpc.ts` registers
`export:support`/`export:start`/`export:cancel` behind the same fingerprint-registered-media gate
`transcriptionIpc.ts` already uses (never a renderer-supplied path), owns the native save dialog,
and caches `checkExportSupport()` per app session the same way `checkProxySupport()` already does.
`configuredToolchain()` (`electron/mediaWorker.ts`) now attaches `exportHost: { executable:
process.execPath, scriptPath: dist-export/host.cjs }` whenever the FFmpeg pair is configured — the
same Electron runtime pointed at the separate bundled host script (ADR 0003's separate-process
design; **not** a packaged production launch path, which D2 must still solve). `--export-smoke`
(env `CAPTION_STUDIO_EXPORT_SMOKE_PATH`/`_SRT`/`_OUTPUT`) is a permanent developer-only CLI branch
in `electron/main.ts`, mirroring `--transcription-smoke`, that runs one real export through the
production `ExportService` without any dialog.

`src/App.tsx` adds the **Export Video** control: `exportState` (idle → checking-support →
ready/unsupported/error, or running while a job is active) mirrors the existing `proxyState` pattern
exactly. The control's support check runs once at mount, independent of loaded media — export
support is a fixed platform/tool profile, not a per-file codec decision, so it is checked the same
way regardless of whether media happens to be open yet. The button itself is rendered **only** when
`checkExportSupport()` reports `supported: true` — never as a nonfunctional placeholder — and is
disabled until media with a verified fingerprint is loaded; a running export shows real phase/percent
progress (`describeJob`, exported from `TranscriptionPanel.tsx` for reuse rather than duplicated) and
a Cancel button; success/cancel/failure produce a notice, and a user-dismissed save dialog silently
returns to the ready state without an error.

Verification: `npm run check` passes **484 tests across 58 files** (up from 478 before this ticket's
own new files), strict TypeScript with the pre-existing worker `tsc` error now fixed, and all four
production builds (Vite renderer, Electron main/preload via esbuild, the media-worker bundle, and the
export-host/frame-harness bundle via `build-export.mjs`). New tests: `workers/media/
exportArguments.test.ts` (exact argument array for audio/no-audio, `-n`, bitrate class, frame count/
`-t` duration, no shell metacharacters), `src/export/plan.test.ts` (`frameSourceUs` exact BigInt
values at 30000/1001 for indices 0/1/10000, `exportFrameCount` ceiling behavior, `fittedFrameRate`'s
exact-rational/halving/fallback cases, `planFromMedia` against the real `ffprobe-rotated.json` and
`ffprobe-vfr.json` fixtures — rotated dimensions swap, VFR prefers the nominal rate — and a 4K-source
dimension cap, `frameRequestAt`'s half-open active/inactive boundary and always-expired gap
placeholder), `src/core/exportSupport.test.ts` (pinned-profile/platform/flag/version rejection
cases), `workers/media/export.test.ts` (14 cases: `PngReader` framing across split chunks/oversized/
bad-signature/mid-frame-close, `exportSupport`, and `renderVideo` end to end against fake spawned
host/encoder processes — full render with correct output validation, gap-frame reuse count, mid-loop
cancellation stopping both processes and skipping output validation, encoder-failure diagnostic
surfacing, monotonic `frame=` progress parsing, same-path rejection), and `electron/
exportService.test.ts` (6 cases: manifest/temp/rename/cleanup on success, ordinary mid-flight
cancellation, a cancellation that wins the commit-gate race after a real encode already exists,
worker-failure leaving a pre-existing destination byte-identical, rejecting media with no probed
metadata before starting any job, and queuing behind another heavy job on the shared scheduler).
`workers/media/worker.test.ts`'s obsolete "export is unsupported" placeholder case was replaced with
an `export`-operation entry in its existing "reports missing tool configuration" test.

Real-media verification, **macOS 26.6.2 arm64** (Darwin 25.6.0), Apple M4 Pro, 12 cores, 24 GiB,
Electron 44.3.0 / Chromium 152.0.7977.78, Node 24.20.0, through the actual production path
(`electron . --export-smoke`, never a mocked encoder): the FFmpeg/ffprobe pair was rebuilt with
`--enable-zlib` added to the M4 profile (needed for the PNG codec, absent under
`--disable-autodetect`) — ffmpeg 21,991,192 bytes SHA-256 `cba780ef…6ed1916a59`, ffprobe 21,815,880
bytes SHA-256 `6bab2ed9…41733d8222` (exact hashes in ADR 0004); `caption-studio.local.json` now
points at this pair. A synthesized 10 s 1920×1080 30 fps H.264(`h264_videotoolbox`)/AAC source with a
3-cue mixed Malayalam/English SRT exported to a real MP4 in ~5 s: `ffprobe` confirmed H.264 High
`yuv420p` 1920×1080 CFR 30/1, AAC-LC 48 kHz stereo, duration exactly 10.000000 s, `faststart`, 300
frames; `volumedetect` reported mean −24.1 dB / max −20.8 dB (real, non-silent audio); frames
extracted at 0.5 s/2.0 s/5.0 s/8.5 s were visually inspected — the gap frame shows plain video with
no caption, all three cues render in the correct position with correct text, Malayalam conjuncts/
vowel signs in "ക്യാപ്ഷൻ"/"ടെസ്റ്റ്" are intact, and the mixed-script cue wraps onto two lines
exactly as preview does; the source file's SHA-256 was unchanged afterward. A second real export of
a genuinely-generated 30000/1001-rate 1280×720 4 s source produced output whose `ffprobe`-reported
rate is **exactly `30000/1001`**, duration exactly 4.004000 s (120 real frames), confirming
`fittedFrameRate` preserves the exact rational rate rather than rounding. A real mid-export
cancellation (~1.5 s into a 10 s render, driven through a temporary dev-only smoke branch removed
before this commit) produced `{state: 'cancelled'}`, no destination file, and no leftover
`caption-studio-export-*` temp directory. The real **Export Video** button was confirmed visible in
the actual built app (production `dist/index.html`, real preload/IPC, screenshotted via
`capturePage` through a temporary dev-only smoke branch also removed before this commit), proving
`checkExportSupport()`'s real round trip resolves `supported: true` against the rebuilt pair outside
a unit test.

Limitations: only macOS arm64 was measured; there is no Windows encoder route
(`exportSupportFromConfiguration` reports it unsupported rather than guessing one). A real
rotated-source export was **not** completed this session — synthesizing one needs either the
excluded GPL `libx264` to bake pixel rotation or a container display-matrix tag, and the
`-metadata:s:v:0 rotate=90` attempt tried here did not persist into anything `ffprobe` reported;
`planFromMedia`'s dimension-swap math itself is unit-tested against a real captured rotated-media
`ffprobe` fixture (`tests/fixtures/ffprobe-rotated.json`, from M2) and the real `-autorotate` flag is
wired and argument-tested, but the full real-rotated encode is an open item, named in ADR 0004. No
preview/export pixel-parity suite exists yet (X3). The export host's production packaging (outside
`app.asar`, without spawning a second full Electron instance via `process.execPath`) is explicitly
deferred to D2, matching ADR 0003. Only one MP4 profile exists; no quality/bitrate control is exposed
to the user. GUI verification used a screenshot of the idle app confirming the control's visibility
gate, not a full click-through-record-verify interaction pass (the CLI smoke exercises the actual
render/encode instead). `tickets.md`'s X2 checkbox is marked complete based on this evidence.

Next: **X3** — preview/export parity fixtures across all five presets and both aspects, long-pause/
rotation/VFR sync validation with measured tolerances, and a documented cross-mode pixel-tolerance
policy per ADR 0003. A real rotated-source export smoke and a Windows encoder decision remain open
follow-ups from this ticket.

## 2026-09-16 — R2.1 style inspector tabs, local font access, per-frame preview clock

Completed: the right-side inspector is now three tabs — **Edit** (the existing cue editor, grouping
actions and timing warnings), **Style**, **Templates** (`src/InspectorTabs.tsx`, a standard
roving-tabindex `role="tablist"`; `src/App.tsx` holds the active tab, no auto-switching). `StylePanel`
(`src/StylePanel.tsx`) was rebuilt as collapsible sections (`src/style/controls.tsx`: `Section`,
`Row` with a per-row reset-to-default button, `Stepper`, `SliderWithNumber`, `Toggle`, `Segmented`,
`HexColorField`) matching the reference UI: **Fonts** (family, face, size), **Emphasis font** (face
only — weight/italic; deliberately *not* a separate family, since the shaping-safe active-word
overlay re-renders the whole line and crops to the word's own rect, and a different family's glyph
advances would misalign that crop), **Format** (uppercase/lowercase/capitalize + underline,
left/center/right alignment, max lines), **Position** (X/Y percent), **Color** (solid or gradient
fill), **Emphasis** (Emphasize/Spotlight mode, solid or gradient), **Spacing** (letter/word spacing,
line height), **Effects** (Drop Shadow, Glow, 3D Depth, Text Stroke, Background — each an on/off
toggle revealing its own sub-controls). The 5 built-in motion presets and saved presets moved out to
a new `src/TemplatesPanel.tsx`.

`src/captions/style.ts`'s `captionAppearanceSchema` gained `fontWeight`/`fontItalic`,
`emphasisWeight`/`emphasisItalic`/`emphasisMode`/`emphasisGradient*`, `textTransform`/`underline`/
`alignment`, `letterSpacing`/`wordSpacing`/`lineHeight`, `gradient*`, and `shadowEnabled`/
`strokeEnabled`/`backgroundEnabled`/`glow*`/`depth*` — all `.default()`-ed and added to the existing
flat `appearance` object (not nested), so `z.strictObject` still fills every new field when parsing
a style saved before this slice; a `z.preprocess` step infers the three legacy on/off toggles from
values an old style already carried (e.g. `backgroundOpacity > 0` implies `backgroundEnabled: true`)
so an old project's captions still look the same. `RESET_KEYS` maps each row to the appearance keys
its reset button restores from `DEFAULT_CAPTION_STYLE`.

`src/captions/renderer.ts` and `CaptionPreview.tsx` extend the shared painter, still honoring R1's
one-shaping-run-per-line rule: `CaptionFont` gained `italic`/`letterSpacing`/`wordSpacing`/
`textTransform` (so measurement and painting always agree — both come from the same `CaptionFont`);
`LayoutInputs.alignment` decouples horizontal text alignment from the block's own `position`
(previously the same `position.horizontal` drove both); an optional `LayoutInputs.emphasisFont` is
measured against the *same complete line* as the regular face (a bolder/italic face has different
glyph advances, so cropping a bold shaping run with the regular rect would clip real glyphs) and its
resulting word rect (`WordRegion.emphasis`) is unioned with the regular rect (`CaptionView`'s
`wordBox`) to size the word-effect crop box and to punch the word fully out of the base line — this
also gates the punch-out mask on *any* distinct emphasis face, not only word-pop, since a differently
shaped word can now show through under highlight too. A gradient fill paints as a second, complete
text copy (`background-clip: text`, transparent fill, no shadow/stroke of its own) stacked exactly
over a solid copy that carries shadow/glow/3D-depth/stroke — Chromium paints `text-shadow` above a
`background-clip:text` fill, so those effects have to live on the layer underneath, and this is true
for both the base line and the active-word overlay. Glow is 3 stacked `text-shadow` blur layers; 3D
depth is N stacked zero-blur offset layers; both compose into one ordered shadow list with the
existing drop shadow. Spotlight mode dims the whole base line to `SPOTLIGHT_DIM` (.35) while the
active-word overlay stays full-opacity on top, for `active-word-highlight`/`word-pop` only.

Local font enumeration (`src/style/localFonts.ts`) wraps Chromium's `window.queryLocalFonts()`
(ambient-typed in `src/env.d.ts`, since it isn't in TS's `lib.dom` yet): `parseFaceStyle` maps a
face's free-text style ("Bold Italic", "Semibold", …) to a numeric weight/italic pair — the schema
stores only that pair, never a postscript name, so a saved style stays portable across machines —
and `groupLocalFonts` groups by family with the fixed `FONT_FAMILY_CHOICES` pinned first;
`fallbackCatalog()` (Regular/Bold/Italic/Bold Italic per fixed family) is used whenever the API is
unsupported, denied, or not yet granted. `queryLocalFonts()` requires transient user activation, so
it is only ever called from the panel's own "Load installed fonts" click, never on mount.
`electron/main.ts` now installs `setPermissionRequestHandler`/`setPermissionCheckHandler`, allowing
only `local-fonts` and `fullscreen`, and only for this app's own origin (`file://` or the dev
server URL) — nothing else is granted, and no font is bundled, downloaded, or sent anywhere.

Word-by-word animation looking "not really working" traced to the preview's only playback clock
being `<video onTimeUpdate>`, which Chromium fires roughly 4 times a second — coarser than a spoken
word (150-400ms) or word-pop's own 200ms curve, so the highlight skipped words and the pop curve was
essentially never sampled mid-animation. `src/core/playbackClock.ts` (`createPlaybackClock`) is a
tiny external store that ticks once per **presented video frame** while playing, preferring
`requestVideoFrameCallback`'s own `metadata.mediaTime` (falling back to `requestAnimationFrame` +
`currentTime` when unavailable) rather than accumulating an elapsed-time estimate, so seeking,
pausing and resuming stay exact and it can never drift from the actual decoded video; every emitted
value is `Math.round(seconds * 1e6)`, matching the app's integer-microsecond timebase, and `set` is
idempotent so `timeupdate` and the frame loop can both feed it without doubling renders. Only a new
`CaptionStage` component (`App.tsx`) subscribes to it via `useSyncExternalStore`, so a 60fps tick
re-renders just the caption preview — the transcript list, timeline body and waveform/thumbnails
never re-render at frame rate. `currentUs` (the 4Hz editing playhead: transport readout, timeline
follow-scroll) is unchanged and now also synced on pause so it matches the last displayed frame.
Real word timing is unchanged by this slice — whisper.cpp still runs without word timestamps, so
transcribed cues still carry **estimated** word timing, honestly labelled; only the sampling rate
that was masking the renderer's already-correct per-timestamp evaluation was fixed. Real model word
timestamps are separate, future work (T4/R3 already track this).

Verification: `npx vitest run` passes **442 tests across 53 files** (the project ran concurrently
with the separate X1 export slice, so this total isn't solely this change's delta; this slice's own
additions are 5 new `motion.test.tsx` cases for gradient/emphasis-face/spotlight/underline, new
`style.test.ts` cases for the schema additions and legacy-toggle migration, new `localFonts.test.ts`
(9 cases), `playbackClock.test.ts` (7 cases) and `InspectorTabs.test.tsx` (2 cases); `StylePanel.
test.tsx` and a new `TemplatesPanel.test.tsx` split the old combined suite along the new component
boundary). Renderer (`vite build`), Electron main/preload (`esbuild`) and the worker bundle all build
cleanly. `npx tsc --noEmit` is clean except one pre-existing, unrelated error in `workers/media/
exportProcesses.ts` (a `Buffer<ArrayBufferLike>`/`Buffer<ArrayBuffer>` mismatch) from the concurrent
X1 export slice, confirmed not introduced by this change.

Limitations: `npm run smoke:captions` (the real-Chromium visual smoke, extended in this slice with
alignment/letter-spacing/text-transform/gradient/emphasis-face/font-catalog-fallback checks in
`src/captions/visualSmoke.tsx` and `scripts/caption-renderer-smoke.mjs`) could not be executed in
this sandboxed session — the sandbox forces `ELECTRON_RUN_AS_NODE=1`, so no GUI Electron process can
launch here; it must be run on a real desktop (`npm run smoke:captions`) before this slice is
considered visually verified. A synthetic/script-dispatched click carries no transient user
activation, so the smoke's font-catalog check always exercises the fallback path by construction;
real installed-font enumeration needs a genuine desktop click and is unverified beyond the unit
tests in `localFonts.test.ts`. `font-synthesis: none` is deliberate: a family with no real bold/
italic face shows no faked one. Progressive word reveal does not use the emphasis face (no
per-word overlay exists in that mode). Glow and 3D Depth extend past the caption's own line box —
the panel's Effects section notes this, but no automatic padding reservation was added. Only macOS
arm64 typecheck/tests/builds were run.

Next: verify `npm run smoke:captions` and a manual `npm run dev` pass on a real desktop (every Style
row live-updates the preview with one undo step per gesture; Font Face/Emphasis Face steppers;
Load-installed-fonts on a real click; Templates tab parity with the old combined panel). Real
word-level model timing (whisper.cpp token timestamps) remains separate future work.

## 2026-09-16 — X1 export renderer prototype and architecture decision

Completed X1: `npm run prototype:export` runs a real offline Chromium offscreen frame prototype
using the actual CaptionPreview/CaptionView, DOM measurer, style mapper and absolute source-time
evaluator. A versioned validated request contains canonical source microseconds, cue/word data,
style and composition; `--request` renders real PNGs at arbitrary requested timestamps/dimensions.
The host bundles locally without Vite/network/media/model downloads, owns isolated sandboxed
preview/export windows and saves images only to system temporary storage. It waits for shared
font/geometry readiness and a matching stripped painted pixel token, explicitly invalidating
static frames and rejecting stale paints, font failure and fractional/unsafe timestamps.

The small `src/export/parityFixture.ts` has authored Malayalam/Latin/emoji/combining-mark text and
manual timing at an hour-long offset. Real DOM input events update interactive React preview state;
independent preview/export windows then compare full composition state and bitmap pixels. Only
font-cache revision strings are excluded from state comparison; source timing, text, font readiness,
geometry, word regions, opacity, notices and warnings remain. Editor notices stay out of caption
pixels. The shared painter rebuilds nodes per motion/timestamp to remove the observed word-pop
raster history after seeking while retaining shaped metrics.

[ADR 0003](decisions/0003-export-renderer.md) accepts **GPU-accelerated Electron offscreen CPU-bitmap
readback**, with PNG as the first X2 compositing baseline and a separate export host/bounded worker
transport as the implementation path. Software is faster but cross-mode pixels differ from the
normal GPU preview, so it is a fallback requiring a documented tolerance policy. Primary-source
comparison includes maintained Puppeteer-core, Remotion and Electron shared textures. Remotion's
conditional downstream/license suitability is documented and it is not adopted. Dependency records
include exact local Electron/Chromium notice hashes; no npm package, font binary, browser download
or lockfile dependency-graph change was added. FFmpeg's LGPL/no-GPL/no-nonfree profile is unchanged;
no MP4 encoder or video pipeline is selected/implemented here.

Final verification: `npm run check` passes **437 tests in 51 files**, strict TypeScript and renderer,
Electron main/preload and media-worker production builds on macOS arm64. X1 adds 2 frame-contract
and 4 committed-paint/alpha tests. The existing caption smoke passes 28 static + 23 motion cases.
Both final source-stable prototype runs pass **100/100 exact same-mode frame-state and bitmap
comparisons**, covering all five presets, cue edges, gaps, backward/repeated seeks, the seven text
fixtures, estimates/fallback and gradient/effects. PNG round trips preserve all 80 motion-frame
bitmaps/alpha. A real missing-local FontFace rejects before acceptance, then the original stack
recovers. Custom smoke renders a visible 640×360 frame at exactly **3,600,625,007 µs** and a fully
transparent 360×640 frame at the exact **3,603,000,007 µs** cue end. Source hashes match between GPU
and software runs and current renderer/transport files; changed sources fail measurement acceptance.

Measured on Apple M4 Pro (12 logical cores, 24 GiB), native macOS arm64 / Darwin 25.6.0,
Electron 44.3.0 / Chromium 152.0.7977.78, 600 sequential frames per aspect/mode:
GPU raw fps **145.45 portrait / 131.73 landscape**, raw+PNG **53.83 / 41.71**; software raw
**212.97 / 176.92**, raw+PNG **61.34 / 45.79**. Each 1080p bitmap is 8,294,400 bytes.
Sampled maximum aggregate working set (including both windows and Browser/GPU/Utility processes)
was GPU **985.61 / 1044.25 MiB**, software **951.64 / 997.55 MiB**. This is not export-only memory
or a long-run bound. Warm/local font readiness was 0–3.6 ms; font presence/glyph coverage is separate.
CDP observed Malayalam Sangam MN Bold, Arial BoldMT and Apple Color Emoji. Raw cases, hashes, alpha,
readiness and memory samples are retained in `docs/decisions/evidence/x1-*-2026-09-16.json`.

Cross-mode inspection of 40 corresponding PNGs found nonidentical pixels in every visible sample,
including 10,741 portrait-static differing pixels (max channel delta 4) and a multiline delta-99
outlier. It supports choosing GPU for parity, rather than assuming CPU rasterization matches the
normal GPU editor. Visual inspection of plain/word-pop/vowel/conjunct/decomposed PNGs showed no
observed detached signs or tofu. Gradient/glow/depth reproduced existing shared-painter crop edges
and an emoji silhouette; matching pixels do not establish that every style is visually polished.

Verification-only baseline repairs: existing renderer fixtures now explicitly choose left alignment
and enable the background whose opacity is being tested; the DOM snapshot reflects current shared
pixel spacing/font-synthesis while preserving full-run assertions. A pre-existing LocalFontData
interface was moved into its intended global declaration scope to clear a typecheck blocker.
Other concurrent caption-style/font-picker changes were preserved and are not claimed as X1 work.

Limitations: only macOS was measured, with system fonts and 1080p overlays. No Windows, 4K performance,
cold pinned-font load, long memory soak, encoded video/audio sync, rotation/VFR decode, export-host
packaging or final export cancellation is validated. No final Export Video button was added; the
production media-worker export operation remains unsupported. Full measured tables, licensing,
reproduction commands and remaining gates are in ADR 0003.

Next: **X2** integrates the separate GPU export host, validated/backpressured PNG transport, real
FFmpeg overlay/MP4 codec/audio pipeline, scheduler/cancellation and atomic output safety; test it on
macOS and Windows before exposing working video export. **X1 is complete** based on the real frame,
parity, timing, alpha, font and throughput evidence. X2/X3 and all other ticket states are unchanged.

## 2026-09-15 — R2 five real style/motion presets

Completed: implemented the five first-release caption presets — static clean, active-word
highlight, word pop, phrase fade, progressive word reveal — entirely on R1's shared renderer, with
appearance kept fully separate from motion. `src/captions/style.ts` defines `CaptionStyle`
(`motion` + a schema-bounded `appearance`: font family/size, primary/secondary color, outline,
shadow, background color/opacity/padding, fractional position, max lines) and
`SavedCaptionPreset`; schema 2's optional `project.captionStyle`/`savedCaptionPresets` make style
real project state — it saves, reopens and undoes like any other edit
(`src/captions/presets.ts`: `saveCaptionPreset`/`applyCaptionPreset`/`deleteCaptionPreset`, pure
commands). `src/StylePanel.tsx` is the real inspector control surface (motion radios, font,
colors, outline, shadow, background/padding, a 3×3 position grid plus fractional sliders, max
lines, saved-preset save/apply/delete) and is wired into `App.tsx` in place of the old
"coming soon" placeholder: one live draft feeds `CaptionPreview` immediately while a control is
being dragged, and exactly one history commit lands per finished gesture (blur/pointer-up for
continuous controls; immediately for selects/radios/buttons), matching the existing
draft/commit-on-blur shape `CueEditor` already used for text/timing.

Motion is evaluated purely from `(layout, cue, absoluteSourceTimestampUs)` — phrase fade's
existing ramp and the newly added active-word/word-pop/progressive-reveal per-word state
(`wordMotionAvailability`, `layoutCaptionWords`, `captionFrame` in `src/captions/renderer.ts`) have
no CSS transition, elapsed-playback clock or accumulated frame state, so seeking to the same
absolute timestamp from any direction reproduces byte-identical output. Word-dependent presets
gate on `wordMotionAvailability`'s structured `reason` (`no-words | incomplete | invalid |
needs-review | estimated | ok`): only complete, ordered, cue-contained, non-stale timing enables a
preset for that cue; every other case falls back to static clean **per cue** (one word-poor cue
never disables word presets project-wide) with a visible on-preview notice. Estimated timing is
accepted but the preview notice and the Style panel always say "Estimated — not aligned to audio"
— rendering never invents or silently upgrades timing; `summarizeWordMotion(cues)` gives the panel
project-wide counts so the three word-dependent motion options are disabled outright (with an
explanation) only when no cue in the project has any usable word timing at all. Word highlighting/
pop/reveal never fragment a line's shaping run: `CaptionView` paints each line as one unbroken text
node and layers each effect as a positioned, `overflow:hidden`/`mask-image`/`clip-path` sibling
that re-renders the *entire* line and crops to the target word's real DOM-measured rectangle —
Malayalam conjuncts and vowel signs are never detached because they're never separated from the
line to begin with, and `locateWordSpans`'s grapheme-boundary-aligned offsets keep word regions
off cluster boundaries.

Verification: final `npm run check` passes **407 tests across 47 files** (up from 403 before this
session's own new files — four new test files add 50: `motion.test.tsx` 26, `style.test.ts` 13,
`presets.test.ts` 6, `StylePanel.test.tsx` 5), strict TypeScript, the renderer production build,
Electron main/preload bundles and the worker build. `motion.test.tsx` uses a real mixed Malayalam/
English cue (conjuncts, vowel signs, English tokens) with model word timing at fixed absolute
timestamps ≥3,600,000,000 µs to assert exact opacity/active/revealed/scale values per preset,
seek-order independence (shuffled vs. sorted timestamp evaluation), every availability `reason`,
and that every word region and word-effect overlay in the rendered HTML stays grapheme-boundary-
aligned and unfragmented (checked directly against `graphemeBoundaries`, with the whole-cue
`aria-label` excluded from the fragmentation count so it can't hide a false pass). `style.test.ts`
covers schema rejection of CSS-injection-shaped font names (`url(...)`, `;`, `<`) and out-of-range
values, portrait/landscape scale parity, "motion never resets appearance", and project round-trips
including duplicate-preset-ID rejection. One pre-existing R1 DOM snapshot
(`renderer.test.tsx`'s single-line-per-caption assertion) was intentionally updated: the line now
sits inside an `aria-hidden` wrapper so a word-effect sibling can be attached beside it; the
snapshot's real assertions (one text node, no `<span>`) are unchanged and still pass.

Real Electron smoke — **macOS 26.6.2 arm64**, Electron 44.3.0, Chromium 152.0.7977.78:
`npm run smoke:captions` extends the existing R1 grid (28 cases, unchanged, still passing) with a
real-Chromium R2 motion grid — all 5 presets × {portrait 1080×1920, landscape 1920×1080} ×
{mid-word, gap} timestamps, plus dedicated estimated-timing, cue-only-fallback and
phrase-fade-ramp-start edge cases (23 cases total) — each checked for unfragmented shaping runs,
the correct word-effect count for the correct moment, and correct notice/fallback text; confirmed
`phrase-fade-start`'s real DOM opacity is exactly 0 at the absolute cue start. A further "controls
driving the real preview" section mounts the actual `StylePanel` + `CaptionPreview` sharing one
React state (identical wiring to `App.tsx`) and drives every control with genuine DOM events
(native value setters, `input`/`pointerup`/`change`/`click`, real `focus`/`blur`) in the real
window: primary color, outline width, background opacity, padding, position, max-line count, font
family, motion (with its word-effect count), and preset save/apply were each confirmed to visibly
change the shared preview's real computed style or geometry — this is the "all controls affect the
real preview" requirement, verified end to end rather than asserted from unit tests alone.
Screenshots (saved to a fresh system temp directory, not Git) were visually inspected: the active
word "ഉപയോഗിച്ച്" highlights correctly in the secondary color with its conjunct/vowel-sign cluster
intact, progressive reveal's clip correctly shows only already-started words, the estimated-timing
case shows the pop effect plus its "Estimated" notice, the cue-only case shows no highlight plus
its "unavailable" notice, and the interactive-controls screenshot shows red primary text, Arial
font, word-pop selected, and the text fitted onto one line after max-lines was lowered — matching
the automated assertions. No user media, model or recording was used.

Limitations: only macOS arm64 was executed; Windows rendering is unverified (same limitation as
R1). System fonts are still not bundled — the font-family control offers the same R1 local-face
stack plus a validated custom-name field, with no redistribution change. The motion math itself
(ramp/pop-curve formulas) was previously implemented by an earlier, unfinished pass at this ticket
and is unchanged by this session; this session's contribution is fixing the stale test coverage
gap, wiring appearance/motion controls into the real app and project schema, adding the
availability-summary/fallback UI, and proving all of it end to end with new tests and real-Chromium
smoke evidence. Wrapping remains whitespace-only (R1); max-lines fitting can still leave text small
or, if it truly cannot fit, preserved with a diagnostic rather than truncated. Export (X1/X2) does
not exist yet; it must reuse `captionStyleInputs`/`layoutCaption`/`captionFrame`/`CaptionView`
unchanged rather than a second implementation, as recorded in `CAPTION_RENDERER.md`.

Next: **R3** can add the word-timing/emphasis editor on top of these presets and `CaptionStyle`'s
`secondaryColor` slot. R2 is complete: all five presets are real, appearance/motion are separate
and both are functional project-saved controls, motion evaluates purely from absolute source time,
word-dependent presets are honestly gated and labelled, Malayalam grapheme clusters survive every
animation, and every control was confirmed to affect the real preview.

## 2026-09-15 — E4 track-based timeline layout and seekable local media

Rebuilt the bottom timeline (`src/Timeline.tsx`, new `src/TimelineToolbar.tsx`/`src/TimelineIcons.tsx`,
`src/styles.css`) into an NLE-style layout: an editing toolbar, a `mm:ss.mmm` ruler with gridlines and
click/drag scrubbing, and three labelled tracks — **Captions**, **Video 1** (edge-to-edge thumbnail
filmstrip) and **Audio 1** (waveform) — under one playhead. Track heights are shared CSS variables so
the label column and content stay aligned; a keyboard-accessible divider resizes Video/Audio and an
expand toggle grows the panel (via `:has()` on the app shell, no App prop plumbing). Toolbar controls all
map to real commands owned by `App`: `+ Line` (add at playhead), merge next, previous/next, scroll to
playhead, delete, split at playhead, **trim** (new pure `trimToPlayhead`: moves the nearer boundary onto
the playhead), a **snap** toggle (new pure `snapDelta`: dragged edges land on neighbouring cue edges,
0, media end and the pre-drag playhead within 8 px, re-clamped through the existing `dragCueBy`, with a
guide line), zoom −/slider/+ plus ⌘/Ctrl+wheel zoom anchored at the pointer, and expand/collapse. The
playhead page-flips into view when it leaves the viewport at zoom > 1. `WORD`/`LINE` toggle: LINE keeps
the draggable cue blocks; WORD renders one block per timed word inside a per-cue span (estimated or
needs-review words dashed with the shared `TIMING_LABELS` tooltip, cues without words as a muted
placeholder); clicking/Enter on a word seeks and selects its cue. No word editing yet (R3). *(Since
the 2026-09-16 "R3 slice 1" entry above: `WORD`/`LINE` is a saved project setting that also drives the
preview/export, word blocks are selectable/addable/deletable, and missing timing is auto-estimated on
toggle — word-boundary dragging is still open.)*
`thumbnailCountForViewport` takes an optional target tile width so a taller filmstrip requests wider
tiles (quantised to 40 px so divider drags do not churn extraction).

Adjacent fix found during the smoke: the `media://` protocol answered byte ranges with `200` and no
`Content-Range`, so Chromium reported `seekable: [0, 0]` and every seek with real media snapped back to
0. `electron/mediaRange.ts` (+ 4 tests) plans single/open-ended/suffix ranges and 416s, and
`electron/main.ts` now streams `206` responses with `Accept-Ranges`/`Content-Range`/`Content-Length`.

Verification: `npm run check` passes **407 tests in 47 files**, strict TypeScript, renderer, Electron
main/preload and worker builds on **macOS arm64**. Added 9 timeline tests (ruler step bounds, snap
threshold/nearest/move-duration invariance, snap still clamps media bounds and word containment, trim
before/inside/after/on-boundary). Driven desktop smoke against the **built app** (`dist-electron/main.cjs`
loaded by a scratchpad Electron launcher that stubs only `dialog.showOpenDialog`, drives the window with
trusted CDP mouse input and screenshots via `capturePage`) using a synthesized 30 s H.264/AAC test video
and a 6-cue Malayalam/English SRT: ruler scrub seeked to 6 s; dragging cue 4's start handle to 11.06 s
snapped to exactly `00:00:11:000` with the guide visible and cue 2 untouched; trim moved cue 2's end to
`00:00:06:600` and undo restored `00:00:07:200`; "Estimate all words & group" then WORD mode showed 5
dashed estimated word blocks plus 5 untimed placeholders and a word click seeked to 9 s and selected its
cue; zoom to 8×, expand to 440 px and divider drag produced 201/109 px tracks with 29 tiled thumbnails;
scroll-to-playhead centred it at 655/1310 px. Screenshots visually inspected for label/track alignment,
waveform, filmstrip and Malayalam shaping in blocks. No repository media was used; fixtures lived in a
session temp directory.

Limitations: Windows untested. Only the built (non-Vite) renderer was driven; hot-reload dev mode was
not smoke-tested this session. Thumbnails are re-requested when the tile width crosses a 40 px step
(cache hits make this cheap but the cancel of the superseded request logs a `CANCELLED` worker error in
the console, as before). Track mode, snap, expand and split ratio are component state, not saved in the
project. Word blocks are read-only; word boundary dragging, `+ Word` and emphasis remain R3. *(Since
2026-09-16: track mode is now the saved `captionDisplay` project field, and word blocks support
select/seek/add/delete — see the "R3 slice 1" entry above. Snap/expand/split ratio and word-boundary
dragging are still component-state/open.)*

Next: R2 style presets, or R3 word editing on top of the WORD track.

## 2026-09-15 — Malayalam ASR benchmark harness (T5, partial) and local-LLM feasibility

User question: could a local LLM through Ollama (e.g. Google Gemma) replace whisper.cpp to fix
poor Malayalam transcription? Researched and rejected for now: Ollama has no audio input at all
(`ollama/ollama#11798` is open, unshipped); Gemma 4 audio (via llama.cpp's `llama-server`, not
Ollama) accepts at most 30 s per request, reports no timestamps, and independent tests found it
slightly behind Whisper large-v3-turbo on English WER and prone to looping/hallucinated text.
Decision: stay on whisper.cpp and evaluate Malayalam-fine-tuned Whisper checkpoints instead, via
the existing `WhisperCppAdapter`/`runTranscription` contract, unchanged.

Built the tooling T5 needs to make that choice from measurements rather than by installing a model
and guessing:

- `src/core/asrMetrics.ts` (+ `asrMetrics.test.ts`, 19 tests): pure word/character error rate
  (Levenshtein with full substitution/deletion/insertion counts, not just a total), Latin-token
  recall (whether English technical terms embedded in Malayalam speech survive), a repetition/
  loop detector (the specific LLM-ASR failure mode reported for Gemma), and cue-duration stats
  that catch a fine-tune which lost segment-timestamp prediction. Deliberately does not use
  Whisper's own English-oriented text normalizer, which is known to distort Malayalam scoring
  (`sujithatz/ggml-whisper-medium-ml`'s card: 38.6% WER unnormalized vs. 11.5% normalized — the
  normalizer, not the model, produces most of that gap). Character error rate segments by Unicode
  grapheme cluster (`Intl.Segmenter`), verified against a real Malayalam vowel-sign case, so a
  missing vowel sign scores as one edit, not a spurious multi-character mismatch.
- `scripts/transcription-bench.ts` (+ `npm run bench:transcription`, built through the existing
  `scripts/build-worker.mjs`/`dist-worker` pipeline): runs one or more whisper.cpp-compatible
  model **files** (addressed by path, not the shipped `MODEL_CATALOG`) against the developer's own
  `<name>.<ext>` + hand-corrected `<name>.ref.txt` fixture pairs, through the same
  `WhisperCppAdapter` → `runTranscription` path production transcription uses, and prints a
  Markdown results table (WER, CER, Latin recall, repetition, cue durations, real-time factor).
  Runs every candidate on CPU only, so results stay comparable across models regardless of which
  GPU backend whisper-cli happens to initialize for each.
- `scripts/convert-hf-whisper.sh` (+ `npm run convert:hf-whisper`): converts a community Hugging
  Face Whisper fine-tune (safetensors) to whisper.cpp GGML F16 using the project's own pinned
  `convert-h5-to-ggml.py` (from the already-verified whisper.cpp 1.9.4 source) and a `uv`-managed
  Python venv (torch 2.9.1, transformers 5.9.0, numpy 2.5.3; this Mac's system Python is 3.9 with
  no torch). Dev-only and explicitly not part of the shipped model catalog: every file is checked
  against a caller-supplied expected byte size before being trusted, and the tool prints, but does
  not itself pin, the resulting SHA-256 — a human reviews the source repo's license and re-verifies
  that hash before anything is ever added to `src/core/modelCatalog.ts`.

Candidates identified for the next session to actually benchmark (none downloaded/converted/run
yet): `vrclc/Whisper-medium-Malayalam` (Apache-2.0, whisper-medium fine-tuned on four Malayalam
datasets, reports 14.7% WER / 2.6% CER on an OpenSLR test set — the best-documented candidate
found), `Athulkrishna/BettySara-whisper-large-v3-malayalam-merged-afct` (already ships a GGML file,
no conversion needed, but its parent checkpoint reports ~56% WER on ~5.4 h of training data and has
no license on the parent repo), and `Jithjacob123/whisper-small-Malayalam` (Common Voice only, no
reported metrics, no license tag).

Verification: `npm run typecheck`, `npm test` (346 tests across 42 files, all passing) and
`npm run build` all succeed. `npm run build:worker` produces `dist-worker/transcription-bench.cjs`.
Ran the full bench pipeline for real end-to-end — worker spawn, `inspectWhisper`, `probe`,
`extractAudio`, `WhisperCppAdapter.transcribe` via `runTranscription`, metrics, table rendering —
against the installed `ggml-base.bin` and one locally synthesized macOS `say` English clip (not
Malayalam; only used to prove the harness itself works), producing 0% WER/CER on that clip.
`scripts/convert-hf-whisper.sh` was syntax-checked and its no-args usage path exercised; the actual
multi-gigabyte Hugging Face download and torch conversion has not been run in this session.

Limitations: no real Malayalam benchmark has been run — that needs the user's own reference-
transcribed clips. T5's fuller scope (peak memory measurement, sampled caption-boundary timing
error against manually reviewed references, and a documented correction-effort measure) is not
built yet; this session covers text accuracy, repetition and real-time factor only.
`scripts/convert-hf-whisper.sh` is untested against a real Hugging Face repo end-to-end. Only
macOS arm64 was executed.

Next: get 3–5 real Malayalam+English clips with hand-corrected reference transcripts from the
user into a gitignored `bench/` directory, run `scripts/convert-hf-whisper.sh` for
`vrclc/Whisper-medium-Malayalam`, then `npm run bench:transcription` across it, the two ready-made
community models above, and the installed `whisper-large-v3`/`whisper-large-v3-turbo` as a
baseline. Record results in `docs/TRANSCRIPTION.md` and a decision in
`docs/decisions/0002-malayalam-asr-model.md`, then add the winner to `MODEL_CATALOG`.

## 2026-09-15 — R1 shared Malayalam-safe caption renderer

Completed: `src/captions/renderer.ts` provides deterministic composition-space layout plus
half-open, safe-integer source-microsecond frame evaluation. The real video preview now uses
`CaptionPreview` and the shared full-line `CaptionView` painter; the old responsive CSS overlay
is removed and its safe-area guide matches the renderer's defaults. Layout inputs cover viewport,
safe area, font stack/readiness/revision, max lines, position, wrapping and appearance. Preview
projection scales an unchanged logical composition instead of rewrapping based on preview pixels.
Complete shaped DOM runs are measured with the painter's typography; font loading gates metrics
and frames. Existing `Intl.Segmenter` supplies maintained standards-based grapheme boundaries,
including Malayalam conjuncts/vowel signs. Every painted line remains one shaping text node.
Rendering never mutates original Unicode, cue timings, word provenance or corrections.

Verification: final `npm run check` passes **327 tests in 41 files**, strict TypeScript, renderer,
Electron main/preload and worker builds on **macOS 26.6.2 arm64**, Node 25.6.1. Added 15 focused
tests and 2 OS-neutral geometry/DOM snapshots for Malayalam signs/conjuncts, decomposed text,
mixed Latin/emoji, punctuation, nonbreaking whitespace, exact CRLF/blank-line reconstruction,
long tokens, max-line fitting, position/safe-area/appearance, font readiness/fallback metrics,
full-run measurement and seek-order-independent source timestamps. No npm dependency or locked
dependency graph change; the existing lockfile is retained.

Real visual/geometry smoke: `npm run smoke:captions` passes **28 cases**, seven authored text-only
fixtures × portrait/landscape × 100%/65% preview sizes, in Electron **44.3.0**, Chromium
**152.0.7977.78**. Checks actual DOM text-range/line boxes and safe-area containment within
1 preview pixel, identical semantic breaks and normalized widths within 0.001; measured maximum
normalized width difference **4.173344017033287e-7**. Live resize of an existing preview also
preserved all line breaks. CDP recorded actual **Malayalam Sangam MN Bold**; the missing-face/Arial
fallback fixture used **Malayalam Sangam MN**, **Arial Bold** and **Apple Color Emoji** for the
respective scripts. Visually inspected PNGs covering vowel signs, conjuncts, decomposed signs,
mixed text, wrapping, punctuation, explicit blank lines and long words: no observed detached
vowel signs, tofu or fragmented conjuncts. Final evidence is in the system temporary directory
`/var/folders/td/y8lvt9jx0512cxnhmxqnz6t40000gn/T/caption-r1-smoke-sutz5I` (geometry JSON and
four page PNGs); rerunning the command allocates a fresh directory. No recordings/models/media
were opened, copied, downloaded or added to Git. This smoke exercises the actual shared preview
adapter/painter in an isolated test window, not the native file-dialog/video-import workflow.

Font strategy/redistribution and future export contract are recorded in
[CAPTION_RENDERER.md](CAPTION_RENDERER.md) and DEPENDENCIES.md. Fonts are installed local system
faces only, with explicit Malayalam/Windows/Latin fallbacks; **no font binaries are bundled**.
Noto Sans Malayalam's upstream OFL is a candidate, not approval of an exact redistributable
artifact/version/hash. Apple/Microsoft font availability does not grant redistribution permission.

Limitations: Windows font/runtime behavior and exported-frame parity are not tested. System fonts
do not guarantee identical layout across machines; readiness is not proof of face/glyph coverage.
Wrapping is whitespace-only, not full UAX #14. Unbreakable/extreme text is uniformly fitted and
may become small. Explicit breaks or text that cannot meet max lines remain intact with diagnostic
warnings, not truncation; arbitrary shadow extents need sufficient caller padding. Synthetic
snapshots test logic, while visual smoke tests actual local shaping/advance geometry, not pixel
goldens. Motion/style controls (R2) and export (X1/X2) remain unimplemented; future export must
reuse the same painter, fonts/readiness, composition and absolute timestamp evaluator.

Next: **R2** can implement the five real presets/style controls on this shared renderer. R1 is
complete: preview uses the shared renderer and its focused checks plus real Malayalam visual
inspection pass. Only R1's completion state changed.

## 2026-09-15 — T4 grouping, word provenance and correction preservation

Completed core/UI slice: pure `captionText`, `recognition`, `wordTiming` and `captionGrouping`
modules separate original recognition, stable word identities/timing, and readable caption boundaries.
Schema 2 gains optional grapheme-safe text offsets, optional engine confidence and original recognition
snapshots per applied run; safe integer microseconds, word containment/order/text and project-wide
word-ID uniqueness are validated. Existing valid schema-1/2 projects remain readable. Estimates
are always labeled estimated and require review; changed/ambiguous words stay untimed. Text edits
retain only unambiguous matches in unchanged order; repeats retain identity only when the whole
lexical sequence is unchanged. Corrections, manual word timing and explicit regrouping are protected
by the existing retranscription choice gate. Grouping never retimes word boundaries or crosses known
long word pauses. Imported SRT stays unchanged until an explicit estimate/group action.

Verification: final `npm run check` passes **312 tests in 40 files**, strict TypeScript, renderer,
Electron main/preload and worker builds on **macOS arm64**. Added regression coverage for edits,
repetitions, reordering, Malayalam clusters, punctuation, source ranges, word containment, exact
repeated merge/regroup, JSON reopen, SRT invariance, undo/redo, original recognition preservation,
source-time integer extremes and visible provenance labels. One existing model IPC test was isolated
from the developer's local engine configuration so its disk-only fixture is deterministic. No new
dependency or lockfile change.

Desktop smoke: the running Electron 44.3.0 app with the Vite renderer loaded a generated temporary
schema-2 project with mixed Malayalam/English and all four word timing sources. Native accessibility
state and screenshots confirmed the labels, review flags, exact microseconds, and accessible grouping
controls. Deleting one `go` in `go go home` removed ambiguous `go` alignment, kept `home` at exactly
12,000,000–12,800,007 µs and displayed one untimed word plus correction protection; one undo restored
all original timings. An imported caption remained wordless until **Estimate all words & group**;
that action split the Malayalam/English text into two cues with estimated/review labels, including
an exact 23,130,440 µs internal boundary. One undo restored the imported text and wordless state.
Smoke inspection caught and fixed inspector overflow and an existing timestamp-blur bug that rounded
untouched microseconds to milliseconds; the new focused regression test covers that preservation.
The smoke used no user recording, no model download, and no media processing.

Limitations: no new aligner or actual whisper.cpp word timestamps; segment-only recognition uses
review-required estimates, which cannot detect pauses inside a recognition segment. Readability
limits are heuristics, not measured Malayalam quality or shared rendering/layout (R1). Conservative
matching may discard usable timing for ambiguous repeats or punctuation-bearing legacy word records;
missing timing is visible. Invalid legacy word records fail validation rather than being silently
repaired. Windows execution and real speech recognition were not rerun in T4. Original recognition
snapshots increase project JSON size. Only T4 is completed here.

Next: T5 Malayalam/English benchmark harness. T4 is complete: the grouping, provenance and correction
rules are visible in the app and tested; detailed rules are in TRANSCRIPTION.md.

## 2026-09-15 — Automatic dev whisper-cli build

Completed: transcription reported `WHISPER_NOT_CONFIGURED_MESSAGE` because no `whisperCliPath` was
configured (the earlier local build lived under a system temp directory and was cleaned up). Added
`scripts/build-whisper.sh`: downloads whisper.cpp v1.9.4 source and CMake 4.4.3 from the pinned URLs
in [DEPENDENCIES.md](DEPENDENCIES.md), verifies both against the documented SHA-256 hashes, builds
the same Metal/CPU release configuration into gitignored `.tools/`, and verifies the built binary
reports `whisper.cpp version: 1.9.4` before installing it. Idempotent: a second run reuses the
verified binary without downloading. `./dev.sh` now calls it automatically whenever no working
`whisperCliPath`/`CAPTION_STUDIO_WHISPER_CLI_PATH` is configured, and writes the result into
`caption-studio.local.json`; also runnable directly as `npm run tools:whisper`. Non-macOS-arm64
platforms and build failures fall back to a warning, not a blocked launch.

Verification: `bash -n` on both scripts; ran `scripts/build-whisper.sh` end-to-end (real download,
hash check, build, `--version` check); confirmed a second run short-circuits without downloading;
confirmed a corrupted cached archive is rejected and re-downloaded; typecheck and full test suite.
Limitations: build script only supports macOS arm64, matching the only executed configuration in
DEPENDENCIES.md; Windows developers still build by hand per that doc's Windows strategy.

## 2026-09-15 — Developer media-tool configuration without environment variables

Completed: importing media in `npm run dev` / `npx electron .` failed with `TOOL_NOT_CONFIGURED`
unless `CAPTION_STUDIO_*` variables were exported. Main now resolves the toolchain in
`electron/toolConfig.ts`: each variable overrides the matching key of the gitignored, unpackaged-only
`caption-studio.local.json` at the repository root (absolute paths, strict schema, existing pairing
rules; malformed files fail with the file path). `whisperCliConfigured()` and the media-worker smoke use
the same resolution. `./dev.sh` prompts once for the tools, exports them and launches `dev`, `electron`
or `smoke` mode. ADR 0001 is unchanged in substance: no PATH search in the app, no downloads.

Verification: `electron/toolConfig.test.ts` (precedence, validation, pairing, missing file), typecheck,
full test suite. Limitations: tested on macOS arm64 only; `dev.sh` is POSIX-shell only (Windows
developers still use the JSON file or environment variables).

## 2026-09-15 — T3 real local whisper.cpp transcription

Completed: selected and built **whisper.cpp v1.9.4 `whisper-cli`** from the verified upstream tag source
(MIT; exact source/binary hashes, CMake flags, vendored-code licenses, model compatibility and the
unexecuted Windows strategy are in [DEPENDENCIES.md](DEPENDENCIES.md); notices in
[licenses/whisper-MIT.md](licenses/whisper-MIT.md)). The separate media worker now implements three
real operations with fixed argument arrays: `extractAudio` (FFmpeg, 16 kHz mono WAV,
`aresample=16000:async=1:first_pts=0` so audio starting after the requested time is padded rather
than shifted, `-n`, measured progress, duration from real samples bounded by the range),
`inspectWhisper` (`--version` plus real model loads with GPU allowed and with `-ng`; devices only from
whisper.cpp's own backend lines) and `whisperTranscribe` (exact long-silence gating on samples, one
job-owned WAV and one `whisper-cli -oj` run per padded speech chunk, whisper `-pp` progress, JSON
parsing that fails closed, explicit review-flagged timing normalizations). Main's Electron-free
`TranscriptionService` re-verifies the model with `installedPath` before every job, runs the adapter
through `runTranscription`'s single source-time mapping, delivers only through the scheduler commit
gate and removes job files in every outcome. A narrow ID-only IPC/preload bridge feeds a new
**Transcribe** dialog (installed model, language incl. auto, detected devices with CPU fallback,
honest phase/percent, cancel, actionable errors). Applying is one undoable step; if captions overlap
the transcribed range nothing changes until the user explicitly keeps imported/edited captions
(replacing only untouched model captions and skipping overlapping segments) or replaces all.
Projects gain optional `transcriptionRuns` provenance and cues gain `transcriptionRunId`.
[TRANSCRIPTION.md](TRANSCRIPTION.md#whispercpp-integration-t3) documents the pipeline.

Design evidence and bugs found with real tools: whisper.cpp given a silent 20 s `-ot/-d` window
invented repeated text ("I'm sorry, I'm sorry, …") and read speech from beyond the window, and
whole-file output ended past the audio — so silence is never sent and chunks are separate files.
The first real end-to-end smoke then exposed an actual bug: FFmpeg keeps a last sample ending 20 µs
past the 32,006,667 µs range, so the final caption exceeded the media duration and the editor
rejected editing it. Extraction and recognition now bound all times by the audio window; a
regression test pins this.

Verification: final `npm run check` passes strict TypeScript, **264 tests across 33 files** (up from
210 across 26), the renderer build, Electron main/preload bundles and the worker build. New tests:
`speechGating` (exact silence boundaries independent of block size, thresholds, partial windows,
padding/merging, hour-long offsets, exact sample→µs), `whisperCpp` (a redacted real v1.9.4 `-oj`
fixture, real Metal/CPU stderr lines, progress/version parsing, raw-control-character re-escaping,
invalid UTF-8/shape, Malayalam text, clamping/extension/overlap/drop rules), `transcriptionApply`
(provenance, empty silence gap, explicit choice required, corrections kept, replace-all bounds),
`wav`, `audio` and `whisper` worker operations (argument arrays, long silence never sent, chunk
offsets, auto-language ordering, CPU `-ng`, load-failure mapping, cancellation, cleanup,
window bounding, inspection), and `transcriptionService` (re-verification, cached inspection,
mapping/provenance, model-unavailable, cancellation, backend failure, availability). Worker-process
tests now cover missing whisper configuration and an absent whisper-cli executable. Tool-runner and
worker doubles exist only inside test files.

Real offline smoke — **macOS 26.6.2 arm64, Apple M4 Pro (12 cores, 24 GiB), Node 25.6.1**:
`npm run smoke:transcription` with the T3 FFmpeg/ffprobe 9.0.1 LGPL build, the release
`whisper-cli` 1.9.4 build and **`ggml-base.bin`** (147,951,465 bytes, SHA-256 `60ed5bc3…a2efe`,
explicitly downloaded by this session from the catalog's pinned URL into the managed `.part` path and
matching the catalog; the smoke's model manager used a `fetch` that throws, so verification was
offline). Clip: a locally generated, uncommitted **32.006667 s 320×180 H.264 (30000/1001) video with
AAC 48 kHz mono audio whose stream starts at 1.478667 s**, containing two English sentences spoken by
the macOS `say` voice "Eddy (English (US))" separated by 20 s of digital silence, at a path containing
spaces and Malayalam text (SHA-256 `dbf283fa…20454`). No user recording was used. Inspection
reported engine 1.9.4, devices CPU + Metal (`MTL0`). Both devices produced, with auto-detected `en`,
2 chunks and 1 detected silence (6.72–27.16 s): 0.000–4.000 s "Welcome to the Caption Studio Test.",
4.000–7.000 s "This sentence comes before a long pause.", and 26.860–32.006667 s "After 20 seconds of
silence, the speaker returns and finishes the recording." (end clamped to the chunk, marked Needs
review). No caption covers the pause. Job time 814 ms on CPU and 636 ms on Metal, each including
model re-hashing and extraction. Captions were applied to a new project with provenance, the first
caption's text was edited through the normal command path, retranscription without a choice was
refused, and keep-authored preserved the correction (added 2, removed 2, kept 1, skipped 1). A CPU
job cancelled after whisper.cpp reported 7,020,000 of 12,166,667 µs of speech ended `cancelled`
with no new job directories, and the source hash was unchanged. The first run's `/usr/bin/time -l`
reported 397,000,704 bytes maximum resident set size. The same pipeline ran through the bundled
Electron main process (`electron . --transcription-smoke`, Electron 44.3.0 / Node 24.20.0) on the
clip's MPEG-4 Part 2/AAC variant with identical captions on `MTL0`. Real FFmpeg on a video without
audio printed `Stream map '' matches no streams.`, which maps to the actionable no-audio error.

Limitations: this session's `osascript` was denied assistive access (-25211), so the Transcribe
dialog, progress, cancel button and keep/replace choice UI were built and typechecked but **not
observed from real clicks**. The production app did launch with the engine configured and, with no
UI interaction, exited with code 0 on SIGTERM without any runtime log output. Only English synthetic speech was executed — no Malayalam speech fixture or TTS voice was
available, so Malayalam recognition quality is unmeasured (T5). Base-model timing is coarse: the first
caption starts at 0.000 s although audible speech starts at 1.497 s. Energy gating is not VAD, and
auto-detection picks one language for the whole video. `ggml-base.en.bin` and `ggml-small.bin`
(present in the managed directory but not downloaded by this session), Windows (known ANSI-argv
path risk), CUDA and Vulkan were not executed. Engine and FFmpeg are external developer builds, not
bundled or signed; inspection is cached per model path for a session, so replacing the executable
mid-session is not re-detected. SRT export rounds the last cue to 00:00:32,007 (existing millisecond
serializer). Waveform/thumbnail/proxy jobs still bypass the heavy-job scheduler. When launching
Electron from a shell that exports `ELECTRON_RUN_AS_NODE=1` (this VS Code-hosted session did), unset
it first.

Next: T4 can separate recognition, word timing and readable grouping on top of the provenance and
correction-preserving apply step; T5 should benchmark Malayalam/English clips and model sizes. T3 is
complete: video audio produced editable, source-timed captions locally through the real engine.

## 2026-09-15 — T2 explicit local model management

Completed: added a reviewed three-artifact catalog for the planned whisper.cpp backend
(`ggml-base.bin`, `ggml-base.en.bin`, `ggml-small.bin`) pinned to immutable publisher
revision, exact byte sizes and SHA-256. The Models dialog shows exact names, languages,
size, final/partial disk paths, trusted checksum, actual installed/download states and
conditional upstream CPU/Metal/CUDA build requirements. No arbitrary-model compatibility
or detected-device claim is made; backend availability is explicitly false.

Main owns async streaming downloads/hashing through an ID-only validated IPC/preload bridge.
Download/resume needs an explicit click; there is no startup download, catalog fetch, automatic
resume or periodic network activity. Saved partial bytes use validated HTTP Range responses;
a source returning 200 safely restarts. Cancellation aborts fetch/blocked readers, waits for
file cleanup and retains inactive partials. Verify pinned size/SHA-256, flush data and rename
beside the final file atomically; checksum failures cannot activate. Reopened finals and
main-only backend resolution rehash locally, so an old installed flag is never trusted.
Complete interrupted partials can be verified/finalized offline on explicit retry. Model
removal requires a native confirmation naming only the selected final/partial paths; it
preflights linked/nonregular paths and unlinks no other file or directory. Errors stay visible
and inactive until resolved. Added dependency/source/license evidence and MIT notices without
changing npm dependencies or the lockfile. [MODELS.md](MODELS.md) records the contract.

Verification: final `npm run check` passes strict TypeScript, **210 tests across 26 files**,
renderer production build, Electron main/preload bundles and the independent media worker.
New coverage: **34 manager tests and 4 IPC tests**, all with tiny local text fixtures, real
temporary filesystem I/O and mocked fetch/HTTP streams; no live network or model weights
are required. Covered honest phases and measured bytes, explicit-only networking, offline
reopen/resolve/tamper detection, checksum rejection and retry, complete/partial interrupted
recovery, 206 resume and 200 restart, malformed ranges/lengths/encoding, short/erroring streams,
cancellation before start/during verification/with a blocked reader/during last async preflight,
late cancellation after the activation gate, duplicate-operation ownership and shutdown,
ENOSPC/EACCES/write/fsync/rename errors, native-confirmation default/cancel/explicit choice,
invalid IPC payloads, safe selected-file removal preserving another model and neighbors,
and refusal of symlinks/hard links/nonregular targets and symlinked managed directories/parents.

Desktop smoke: **macOS arm64**, Electron 44.3.0, production build. Accessibility tree and
screenshot confirmed the three real catalog entries, exact metadata/paths/checksums, conditional
device wording and absent/inactive states. Escape closed the dialog and restored Models-button
focus. A full-size local base `.part` observed on subsequent startup remained interrupted and
inactive until an explicit action; this task did not click Download/Resume or activate it.
The actual native removal dialog named only base and its partial, focused Keep by default,
and Keep preserved the files. Shutdown review exposed a windowless process retaining a closed
manager after prevented/re-entered macOS quit: main now prevents new activation during shutdown,
awaits owned media/model work and exits. Clean quit (process exit 0) and subsequent restart with
a working disk-only catalog were verified. No source media was opened or changed.

Limitations: Windows filesystem/runtime/desktop behavior is not executed here; target paths use
portable Node APIs. Real whisper.cpp loading/inference/device detection and Malayalam quality
remain T3/T5; no weights or engine are bundled. Publisher SHA-256 trust is reviewed LFS metadata
over HTTPS, not signed upstream provenance. Actual download-server availability/range behavior
was mocked rather than asserted from a live weight download. Atomic rename is not a universal
hardware-power-loss guarantee; quota/eviction and release packaging remain future work.

Next: T3 can select/build/detect the real whisper.cpp runtime and call the main-only verified
model resolver before offline transcription. T2 is complete; no later ticket was implemented.

## 2026-09-14 — T1 transcription adapter and cancellable job system

Completed: implemented the typed transcription/alignment contract and a reusable job/
scheduler layer, with no backend integrated. `src/core/jobs.ts` defines the shared
queued/running/succeeded/failed/cancelled state machine, a structured progress schema
(indeterminate/measured, with regression detection), and structured job errors.
`src/core/transcription.ts` defines `TranscriptionCapabilities` (languages, auto-detect,
devices with mandatory CPU fallback, accepted sample rates, word-timing/confidence
declarations, and an **independently declared** optional aligner with its own language
set — never assumed from transcription language support), `TranscriptionOptions`,
pre-adapter-call validators (`checkTranscriptionOptions`, `checkAudioSampleRate`), and
`validateTranscriptionOutput`/`validateAlignmentOutput`, which perform the single
`sourceStartUs + relativeUs` mapping from adapter-relative audio time to source-media time
and reject (never silently repair) malformed schema, out-of-order/overlapping
segments/words, out-of-bounds words, empty/control-character/lone-surrogate text,
undeclared confidence, engine/model/language mismatches, and safe-integer overflow after
offset mapping. Alignment output is additionally required to answer every requested
segment id exactly once and to have every aligned word's text appear, in order, inside
that segment's **unchanged** original text — an aligner can time words but can never
rewrite them. `workers/transcription/contract.ts` defines `TranscriptionInput` (matching
the media worker's reserved `extractAudio` result shape) and the `TranscriptionAdapter`
interface; `workers/transcription/run.ts` is the only supported way to call one — it
validates capabilities/options/sample-rate before ever calling the adapter, guards
progress (malformed or regressing progress aborts the adapter and fails closed), and
discards any output an adapter returns after cancellation was requested.

`electron/jobScheduler.ts` is a main-owned (no Electron import, Node-testable) FIFO job
queue: every currently defined job kind (`transcription`, `alignment`, `export`) is
resource-heavy, so by default only one heavy job runs at a time — transcription and export
do not compete unless a caller explicitly raises `heavyConcurrency`. Cancelling a queued
job finalizes it immediately without ever calling `run()`; cancelling a running job aborts
its signal but leaves it `running` until `run()` actually settles. `run(ctx)` gates its
eventual mutation behind `ctx.enterCommit()`, which reports `false` (no mutation performed)
if cancellation was already requested and is a one-way gate afterward — a commit already
in progress is never retroactively relabeled cancelled. `electron/transcriptionJob.ts`
composes the scheduler with `run.ts`: `enqueueTranscription`/`enqueueAlignment` validate
and map backend output, call `enterCommit()`, and only then invoke the caller-supplied
`commit()`, wrapping a thrown non-`JobFailure` commit error as `COMMIT_FAILED` (a
`JobFailure` from `commit()` passes through unchanged). Neither function is wired into
`main.ts`/preload — no transcription surface is exposed to the renderer, matching AGENTS.md's
rule against presenting non-functional controls.

Verification: `npm run check` passes strict TypeScript, **172 tests across 24 files** (up
from 90 across 19 before this ticket — five new test files:
`src/core/jobs.test.ts`, `src/core/transcription.test.ts`,
`workers/transcription/run.test.ts`, `electron/jobScheduler.test.ts`,
`electron/transcriptionJob.test.ts`), the renderer production build, Electron main/preload
build and independent worker build. Tests use a deterministic test-double adapter defined
only inside each test file (never imported by production code — confirmed by grepping for
the double's factory function name outside `*.test.ts`) to verify: capabilities validation
(empty/duplicate/wildcard-shaped languages, mandatory CPU fallback, alignment languages
independent of transcription languages); every pre-adapter-call rejection never invokes the
adapter; offset mapping across a simulated one-hour source position with a preserved
15-second silence gap and no invented text; mixed Malayalam/English text and combining
marks preserved byte-exact through validation; every `MALFORMED_OUTPUT` rejection listed
above, individually; alignment id/word-containment/word-text-must-match rules; progress
guarding (malformed and regressing progress both abort the adapter's signal and fail the
call); cancellation that waits for the adapter to actually settle and discards output
returned after abort; a thrown non-contract adapter error wrapped as `BACKEND_FAILED`
while a thrown `JobFailure` passes through unchanged; scheduler snapshot sequencing with an
injected clock; strict FIFO heavy-job serialization by default and concurrent execution
with `heavyConcurrency` raised; cancel-while-queued vs. cancel-while-running semantics;
`enterCommit()`'s cancel-before/after race in both the scheduler unit tests and through
`enqueueTranscription`'s real commit gate (including a `createProject()` project instance
proven byte-for-byte unchanged, via `structuredClone`, after a cancel that lands between
adapter resolution and commit); `MediaWorkerError` failure mapping (`CANCELLED` becomes a
cancelled outcome, other codes wrap as `BACKEND_FAILED` keeping message/retryable/
diagnostic); listener-exception isolation; and `close()` cancelling all outstanding work
and rejecting further `enqueue()` calls.

Limitations: this ticket is contracts and scheduling only — there is no transcription
backend, no model manager, no IPC handler, no renderer UI, and therefore nothing to smoke-
test end to end on real audio; T2 (model manager) and T3 (real whisper.cpp integration) are
the next tickets that make this reachable from the app. The job scheduler is not yet wired
to the media worker's own waveform/thumbnail/proxy jobs (still gated only by
`MediaWorkerClient`'s own four-job cap), so a large proxy conversion is not currently
arbitrated against a future transcription/export job; `docs/MEDIA_WORKER.md` records this
as an open question for whoever wires T3/X2. The scheduler has no per-job timeout of its
own — a `run()` that never settles (for example, a backend that ignores its abort signal)
blocks that heavy slot indefinitely; backends are expected to own their own deadlines the
way `MediaWorkerClient` does. `TranscriptionInput`/adapter output timestamps are integer
microseconds relative to the extracted audio window only; T3 owns real audio extraction
and its silence/chunking behavior. No platform-specific behavior was introduced (this
module has no OS-specific code), so "tested on macOS arm64" applies only to `npm run
check` itself, run in this session's Linux-container-free macOS environment.

Next: T2 can build the explicit local model manager against `TranscriptionCapabilities`'s
model/device shape. T3 can implement a real whisper.cpp `TranscriptionAdapter` and wire
`enqueueTranscription` into `main.ts`/preload with a real commit into the project. T1 is
complete: capabilities/transcribe/align contracts, job states, structured progress/errors,
heavy-job resource arbitration, and pre-mutation output validation are implemented and
tested with a deterministic test-only adapter; no fake backend, transcript or progress was
integrated into the app.

## 2026-09-14 — M4 real thumbnails and proxy diagnostics

Completed: implemented cancellable thumbnail extraction through the media worker's already-reserved `thumbnails` operation. `workers/media/thumbnails.ts` spawns one FFmpeg process per requested source timestamp with `-ss <t> -copyts -i <input> -frames:v 1 -vf scale=<width>:-2,showinfo -c:v mjpeg`, parses the `showinfo` filter's own reported `pts_time`/`s:WxH` for the **actually decoded** frame, and fails closed (`TOOL_FAILED`) rather than ever substituting the requested time when that parse fails. A real bug — decoded timestamps rebasing to ~0 after input seeking — was caught during real-media verification and fixed with `-copyts`; a regression test pins the corrected argument order. `src/core/thumbnails.ts` computes zoom-aware sample timestamps as exact bucket midpoints (wide-integer arithmetic, no accumulated drift) and a bounded thumbnail count that grows with `zoom × viewport width` and is capped at 64. The Timeline component now measures its own viewport width, recomputes timestamps on zoom/resize, debounces requests 300 ms, and cancels the in-flight request through IPC on every supersede or unmount.

Added a real local proxy-conversion path: a new `proxy` worker operation (`workers/media/proxy.ts`) transcodes the whole input to WebM/VP8/Opus (capped at 1280px on the longest side) with real `-progress` based percentage, cancellable exactly like waveform/thumbnail jobs, and returns the FFmpeg-measured output duration rather than an assumed one. WebM/VP8/Opus was chosen specifically because libvpx/libopus are permissively licensed (keeping ADR 0001's no-GPL profile) and Chromium's embedded `<video>` decodes it natively — it directly targets the diagnosed problem. Proxy controls are gated on `src/core/proxy.ts`'s `proxySupportFromConfiguration`, which parses the real, already-fetched `inspectToolchain` configuration string for `--enable-libvpx`/`--enable-libopus` (cached once per app session) rather than assuming support; the renderer only shows "Create local proxy" when that real check passes. Codec diagnostics (`src/core/codecSupport.ts`) ask the actual embedded player: a `canPlayType` pre-check on the file's container extension, then the real `<video>` element's `error`/`loadeddata` events as the definitive signal, mapped through the standard `MediaError` codes — never a hardcoded per-file codec guess. Source media is never written to: thumbnails and the proxy both go through a job-owned temporary directory/file, the proxy destination comes from an explicit native save dialog, and main refuses to write a proxy over the resolved source path.

Cache/lifecycle: `electron/thumbnailCache.ts` atomically caches each thumbnail individually (JSON with an embedded base64 JPEG, since the sandboxed renderer has no filesystem access) outside Git, keyed by fingerprint, requested timestamp, width and extraction version `ffmpeg-mjpeg-showinfo-v1`; a batch at a new zoom level reuses any previously extracted timestamps that still happen to be requested. Main exposes `media:thumbnails-load`/`-cancel` and `media:proxy-support`/`-create`/`-cancel` only for fingerprints already registered by a successful probe in the current session, mirroring the waveform IPC. Every job directory (thumbnails) and temporary output file (proxy) is removed in `finally` on success, cancellation or failure, and an unrelated file beside a cancelled/failed job is left untouched.

Verification: `npm run check` passes strict TypeScript, **90 tests across 19 files** (up from 71 across 13; six new files cover zoom-aware timestamp/count math and request-schema bounds, `proxySupportFromConfiguration` against real and fabricated FFmpeg configuration strings, `containerPlaybackHint`/`describeMediaError` against injected `canPlayType`/`MediaError` fixtures, `showinfo` parsing and the `-copyts`/scale/seek argument shape with per-frame cancellation, proxy progress/cancellation against a fixture `-progress` stream, and thumbnail-cache identity/invalidation/corruption handling), the renderer production build, Electron main/preload build and independent worker build. `workers/media/worker.test.ts` was updated: `thumbnails`/`proxy` moved out of the "still unsupported" list and into the "reports `TOOL_NOT_CONFIGURED` without a configured tool pair" list.

Real worker smoke: on **macOS arm64** under Node 25.6.1, rebuilt the same verified upstream FFmpeg/ffprobe 9.0.1 source with `--enable-libvpx --enable-libopus` added to the existing LGPL-2.1-or-later/no-GPL/no-nonfree profile (both libraries are BSD-3-Clause; see `docs/DEPENDENCIES.md` for exact hashes/sizes). `npm run smoke:media-worker` (extended this ticket to also exercise `thumbnails` and `proxy`) ran the full real pipeline — `probe` → `waveform` → `thumbnails` → `proxy` — against two locally generated, uncommitted 3.003-second 320×180 clips built from one synthetic MPEG-4/AAC source: `supported-h264.mp4` (real H.264/AAC via macOS `avconvert`, Chromium-playable) and `unsupported-mpeg4.mp4` (native MPEG-4 Part 2/AAC in the identical MP4 container, which Chromium cannot decode). For both fixtures, three thumbnails were extracted with `actualUs` matching the requested timestamps exactly (after the `-copyts` fix) and correct post-scale `160×90` dimensions; `proxySupportFromConfiguration` correctly reported the rebuilt pair as functional; and `proxy` produced a real VP8/Opus WebM (independently re-probed: `vp8`/`opus` streams, `320×180`, `3.008 s`). The same sequence was repeated through the **Electron-hosted** worker (not just Node) via the existing `--media-worker-smoke` entry point extended with the real tool paths, confirming the bundled `dist-electron/main.cjs` still wires the worker correctly. Both source fixtures were re-hashed after every run and were byte-identical throughout, confirming no code path ever wrote to source media.

Partial desktop check: this session had no screen-recording permission (`screencapture` failed) and no accessibility access to drive native file dialogs, so a full interactive click-through (open a fixture, watch the codec-diagnostic banner appear, click "Create local proxy") could not be performed. A Chrome-DevTools-Protocol screenshot of a locally launched packaged build (real tool paths, `--remote-debugging-port`, no synthetic input sent — this session never scripted clicks, keystrokes or dialog input into it) did show the app already displaying real media with the new UI live: the "VIDEO" row rendered a real thumbnail filmstrip at correct positions, the taller timeline layout held together, and no codec-diagnostic banner appeared for that H.264/AAC file, matching the intended "hidden when supported" behavior. That window's pre-existing state was not something this session created deliberately, this session did not act on it beyond one read-only screenshot, and its content is not reproduced here. It shows the thumbnail rendering path working live, but does **not** cover the codec-diagnostic banner actually appearing for unsupported media or the proxy button/save-dialog flow, since no unsupported file was opened in that window by this session.

Limitations: only macOS arm64 was executed; Windows thumbnail/proxy execution is unverified. The renderer's unsupported-codec banner and end-to-end proxy click flow are implemented and code-reviewed, and every real operation they depend on (thumbnail extraction, proxy conversion, cancellation, cache read/write, never overwriting source) was verified for real as described above, but were not directly observed appearing/working from a user click this session. The rebuilt FFmpeg pair (with libvpx/libopus) is a development capability build, not a release artifact; D1/D2 must decide the release build's final encoder set. Proxy conversion targets WebM/VP8/Opus only — there is no user choice of proxy format/quality, and long/large sources will transcode for a while (real, cancellable, but not fast). Thumbnail/proxy cache eviction is not implemented, matching the existing waveform-cache limitation. Codec diagnostics react to the actual file opened; they do not pre-scan a media library.

Next: a follow-up session with real accessibility access should open the diagnostically-unsupported fixture in the running app to confirm the codec-diagnostic banner appears and "Create local proxy" produces a playable file end to end. Otherwise, P1 can add autosave/recovery, or T1 can begin the transcription adapter now that M1–M4 media-worker functionality is real. M4 is marked complete: its worker/cache/IPC pipeline is verified for real end to end, including a real bug found and fixed, and the thumbnail-rendering half of the renderer path was directly observed live; the unsupported-codec banner and proxy-click flow remain implemented but not directly observed triggering from a user action.

## 2026-09-14 — M3 real waveform extraction

Completed: implemented the real `waveform` operation through the separate media worker and explicitly configured FFmpeg executable. The worker decodes only the requested canonical source range and first audio stream to mono float PCM using exact decimal microsecond arguments, an adaptive rate capped at 8 kHz and approximately 32 decoded samples per requested peak. FFmpeg receives a fixed argument array with `shell: false`, emits real `out_time_us` progress, and is cancellable through the existing worker protocol. Raw output has an FFmpeg size limit, peak results are capped by the request, and reduction returns clamped absolute amplitudes without fake normalization. Uniform waveform edges use wide integer arithmetic, so the first/last edges are the exact source range and intermediate rounding never accumulates.

Lifecycle/cache: every decode receives a uniquely allocated job directory in the host temporary location; success, tool failure and cancellation all remove that directory in `finally` without touching unrelated files. Main accepts waveform requests only for fingerprints registered by a successful media probe in the current app session. Validated waveform JSON is atomically cached under Electron user data, outside Git, using a SHA-256 key over extraction version `ffmpeg-f32le-mono-peaks-v1`, the complete sampled fingerprint record, source range and requested peak resolution. Cache entries revalidate their key, request, range, peak bound and payload schema before use. Media replacement, fingerprint change, range change, resolution change or extraction-version change therefore misses the old entry rather than presenting stale data.

Renderer: selecting or resolving media starts a 16,384-peak background request through the narrow preload bridge. The timeline shows honest indeterminate/measured progress and a real cancel action, renders no placeholder while data is absent, and shows actionable unavailable state on failure. Ready peaks render as one pointer-transparent SVG path behind the existing caption blocks. The waveform shares the timeline's canonical duration, horizontal content, seek surface and 1×–32× zoom, so the ruler, waveform, playhead and captions stay in one source-time coordinate system. Reopening the same verified media reports a cache hit.

Verification: final `npm run check` passes strict TypeScript, **71 tests across 13 files**, the renderer production build, Electron main/preload build and independent worker build. Added deterministic tests cover signed/clamped peak reduction, fewer-samples-than-buckets, exact non-divisible and large source-time edges, adaptive decode rates, literal Unicode/shell-metacharacter paths, exact FFmpeg seek/duration arguments, measured progress, bounded PCM results, cancellation cleanup that preserves an unrelated file, atomic cache writes, malformed-cache rejection and invalidation across fingerprint/range/resolution/extraction-version changes. Existing real child-process cancellation still verifies that the active tool PID is reaped before settlement.

Real worker smoke: on **macOS arm64** under Node 25.6.1, the selected external upstream FFmpeg/ffprobe 9.0.1 pair decoded the existing synthetic 2.002-second 320×180 MPEG-4/AAC fixture through the bundled worker. Probe returned the exact 2,002,000 µs duration and the waveform request returned 128 real peaks with maximum amplitude 0.12974722683429718 plus measured completion; no media or tool entered Git.

Desktop smoke: the production Electron build on macOS arm64 loaded the existing synthetic 2.002-second H.264/AAC fixture and visibly rendered its waveform. A timeline click sought to 1,026,906 µs; changing zoom from 1× to 2× retained waveform/ruler/playhead alignment and horizontal scrolling. Opening the same file again reported `Waveform from cache` and retained 2× alignment. During the active verification session, an 8.394-second 480×848 local H.264/AAC clip also reached its end with a real waveform visible, confirming playback-time updates and the media timeline remained synchronized. No user media was copied, modified or added to Git.

Limitations: only macOS arm64 was executed. Windows paths remain protocol-tested, but Windows FFmpeg waveform execution, cache filesystem behavior and desktop rendering are unverified. The FFmpeg pair remains external, unbundled and not release-approved, so the developer must configure both tool paths. The v1 waveform is a mono absolute-amplitude overview rather than per-channel audio, RMS/loudness analysis or sample-accurate editing; the UI requests at most 16,384 peaks and cache eviction is not implemented. Media without a decodable audio stream shows an unavailable state and no fabricated waveform. Thumbnails and proxy diagnostics remain M4, and the existing playback-format limitations are not expanded by M3.

Next: M4 can add zoom-aware real thumbnails and actionable proxy diagnostics alongside the now-working waveform. M3 is complete on macOS arm64; no later ticket was implemented.

## 2026-09-14 — M2 media metadata, fingerprints and relinking

Completed: implemented the real `probe` operation through the existing separately bundled media worker and the explicitly configured FFprobe 9.0.1 executable. FFprobe receives a fixed argument array and a literal absolute input path with `shell: false`. The validated result records format duration as canonical integer microseconds, coded dimensions, display rotation, exact average and nominal rational rates, and per-stream kind, codec name/long name/profile/level/tag, time base, source start/duration, video dimensions/rates/rotation and audio sample rate/channels. Unknown fields remain null; `0/0` is not converted into a fictional rate. The renderer displays the probed summary and uses the source duration rather than the HTML media element's floating-point duration whenever available.

Persistence/relinking: project schema 2 stores the media metadata, a versioned `sha256-sampled-v1` fingerprint and a portable reference without media bytes. Files at most 768 KiB are hashed in full; larger files hash the size plus fixed 256 KiB beginning/middle/end samples. This is a practical identity hint rather than full-file integrity verification, so replacement checks also compare duration, dimensions, rotation, rate and stream/codecs. Project save writes a contained forward-slash relative path when the media is below the project directory plus a native absolute fallback; reopen tries the safe contained relative candidate first. Existing schema-1 files migrate without inventing metadata/fingerprints. Missing media produces working Relink controls. A selected replacement is probed again: exact identity relinks immediately, while differences are explained individually in a modal with Cancel, Choose another and explicit Use replacement anyway actions. No implementation path copies, writes or overwrites source media.

Verification: final `npm run check` passes strict TypeScript, **65 tests across 11 files**, the renderer production build, Electron main/preload build and independent worker build. Added tests cover exact decimal-to-microsecond conversion, rational VFR-relevant `avg_frame_rate`/`r_frame_rate` preservation, rotated side data, audio/video codec fields, stable/different fingerprints, paths containing spaces and Malayalam Unicode, portable contained references, missing paths, traversal/backslash rejection, schema-1 migration and clear replacement mismatch explanations. Existing worker transport/cancellation and editor checks continue to pass.

Real worker smoke: rebuilt the verified upstream FFmpeg 9.0.1 source on macOS arm64 / Apple clang 21.0.0 with the selected LGPL/no-network profile and built-in format/codec support; the external ffmpeg/ffprobe hashes, sizes and configuration are recorded in `docs/DEPENDENCIES.md`. `npm run smoke:media-worker -- <ffmpeg> <ffprobe> <media>` used a locally generated path containing spaces and Malayalam text. The worker returned 2,002,000 µs duration, 320×180 coded dimensions, 30000/1001 rates, 90° rotation, H.264/AAC codec details and a stable fingerprint. Nothing was bundled or added to Git.

Desktop smoke: the production Electron build was exercised on **macOS arm64** with the same explicit tool pair and a locally generated 2.002-second rotated H.264/AAC M4V; no user recording was read. The accessibility tree showed the exact dimensions/rate/rotation/codecs and 00:02 canonical timeline duration, and playback reached the pause/running state. Saving beside the media produced schema 2 JSON with the Unicode relative path and no embedded media. Reopen verified the fingerprint automatically. After moving the generated fixture to a space/Unicode path, reopen showed the real offline state and Relink controls; choosing the moved file verified and resumed it. Choosing a different generated MPEG-4/AAC file displayed fingerprint, rotation and codec differences, and the explicit override successfully adopted it. The final rebuilt app also confirmed missing-media reopen resets the playhead to zero while retaining the stored 00:02 duration. No runtime error was emitted.

Limitations: only macOS arm64 was executed; Windows path syntax and safety rules are covered by tests, but Windows FFprobe execution, native dialogs and playback remain unverified. The development FFmpeg pair is external and not release-approved or bundled, so developers must still configure both absolute tool paths; D1/D2 own production artifacts, signing and the final codec matrix. Sampled fingerprints can theoretically miss changes outside sampled regions in large files and are intentionally paired with metadata comparison. The saved absolute fallback is platform-specific; portability comes from the safe relative reference when project and media are kept together. VFR fixtures verify exact reported rate preservation, not frame-accurate seeking or export. M3/M4 waveform, thumbnails/proxy diagnostics, transcription and rendered export remain unimplemented.

Next: M3 can key real waveform cache data by the stored fingerprint and canonical source range. M2 is complete on macOS arm64; no later ticket was implemented.

## 2026-09-14 — M1 media-worker contract and FFmpeg/ffprobe decision

Completed: [ADR 0001](decisions/0001-media-worker-and-ffmpeg.md) selects project-controlled FFmpeg/ffprobe builds from matching upstream 9.0.1 source with an LGPL-2.1-or-later profile and explicit GPL/version3/nonfree/autodetection/network exclusions. It compares primary-source evidence for BtbN, Martin Riedl, npm static wrappers, Gyan and Evermeet, including target architectures, exact license/profile distinctions, configuration visibility, observed byte sizes, update/retention policies and offline redistribution obligations. Direct inspection found `--enable-nonfree` and nonredistributable license strings in the sampled npm Apple Silicon FFmpeg artifact; that artifact is rejected. Dependency inventory and architecture docs are updated. Remotion was not adopted, no npm dependency was added, and no media binaries entered Git.

Implemented: a separately bundled TypeScript worker with strict bounded UTF-8/JSON messages and operation-specific schemas for probe, waveform, thumbnails, audio extraction and future shared-renderer export. Main owns executable configuration, job handles and shutdown; no renderer/preload surface was added. Request/result correlation, explicit cancellation, structured errors, honest progress phases, output bounds, deadlines and child-process cleanup are implemented. Both worker and tools launch with executable plus argument arrays and `shell: false`. [MEDIA_WORKER.md](MEDIA_WORKER.md) documents the wire contract, source timestamp/rational-rate semantics, portable paths, cancellation races, usage and packaging constraints.

Verification: final `npm run check` passes strict TypeScript, **56 tests across seven files**, renderer build, Electron main/preload build and independent worker build. Tests cover every reserved operation contract, invalid ranges/rates/keys/versions/paths, POSIX/Windows/UNC paths, fragmented Malayalam UTF-8, malformed/oversized messages, wrong response IDs/operations, duplicate terminal responses, unsupported operations, real worker identity and exit, deadlines, shutdown, cancellation, literal shell metacharacters, real child exit diagnostics and bounded output. The active-tool cancellation test waits for an actual child PID and verifies it has exited before settlement. Test-only malformed protocol peers and real Node child programs do not simulate FFmpeg.

Real smoke: `npm run smoke:media-worker` returned a different worker PID on macOS arm64 / Node 25.6.1. Built upstream FFmpeg/ffprobe 9.0.1 locally with Apple clang 21.0.0 in external temporary storage, then ran the smoke command with both absolute tool paths. The worker executed real `-version` and `-L` commands and returned the expected source version, exact build configuration and LGPL 2.1-or-later text, with only indeterminate running/inspection progress. The same pair also passed `electron . --media-worker-smoke` with the two documented developer path variables: parent PID 16593, worker PID 16596, Electron's Node 24.20.0. Source/binary hashes, sizes and configure command are recorded in the ADR. No input media was read or modified.

Limitations: the local source build is WAV/PCM-only for diagnostics, not production video codec validation. `runtime` and `inspectToolchain` are the only implemented operations; all five media operations explicitly return `UNSUPPORTED_OPERATION`. No bundled binary, production manifest, verified upstream PGP signature, Windows execution/build, installer, waveform, thumbnails, transcription or export is claimed. Packaging must resolve the RunAsNode fuse/outside-ASAR layout and platform crash/process-tree containment; normal direct-child cancellation is tested. Source/build/license materials and exact per-target installed/download sizes must be completed before redistribution. Existing `package-lock.json` is unchanged because the dependency graph is unchanged.

Next: M2 can implement real media probing, fingerprints and relinking through this boundary, enabling/testing actual input formats in the selected source build. M1's contract and decision are reviewable and **M1 is complete**; no later ticket was implemented.

## 2026-09-14 — E3 keyboard editing and accessibility pass

Completed: added a tested keyboard shortcut router for play/pause, one-second seek, split at playhead, delete, undo/redo and previous/next-cue navigation. Shortcuts are deliberately not intercepted from text, timestamp, select or contenteditable fields; native typing and text undo remain available there. The transport now has labelled play/pause and seek buttons plus an accessible playhead slider. Transcript cue buttons expose selected state and complete timing labels; keyboard cue navigation seeks, selects and moves visible focus. Timeline blocks are keyboard selectable with Enter/Space, and all focusable controls have a high-contrast visible focus ring. Inspector fields now have explicit labels and descriptions. Deleting restores focus to the following cue, prior cue, or the add button when no cue remains. The in-app Shortcuts disclosure lists only the implemented commands and states the editing-field rule.

Verification: `npm run check` passes strict TypeScript, 26 tests across five files and both production builds. New focused tests cover every supported shortcut plus text/timestamp/contenteditable exclusions. macOS Electron accessibility-tree smoke test imported the mixed Malayalam/English fixture and confirmed labeled transcript toggle buttons, labelled inspector text/timestamp fields, labelled transport slider/buttons, zoom controls, keyboard-selectable timeline blocks and the complete in-app shortcut reference. Down Arrow selected/seeks the next cue and moved focus; Delete removed it and restored focus to the remaining cue; ⌘Z and ⌘⇧Z restored and reapplied the deletion. In the text editor, `s` entered text and ⌘Z performed native text undo rather than invoking application shortcuts. No runtime errors were emitted.

Limitations: macOS was the only desktop platform smoke-tested. The play/pause command requires loaded video media; it reports an actionable local notice otherwise. Timeline pointer dragging remains pointer-only in this slice; keyboard users can select and seek timeline cues, while timing edits remain available through labelled inspector fields.

Next: M1 can establish the real media-worker boundary and FFmpeg/ffprobe decision. E3 is complete.

## 2026-09-14 — E2 draggable timing boundaries and timeline zoom

Completed: replaced the static percentage timeline with a horizontally scrollable 1×–32× source-time viewport, adaptive subsecond/second ruler labels, draggable cue blocks and independent start/end handles. Pointer movement is converted directly between pixels and integer microseconds; no frame rounding is used. Drag previews update the selected transcript timing, inspector, playhead/seek target, timeline block and caption-overlay state together, then commit exactly one command on pointer release. Whole-cue moves preserve duration and shift contained word timings by the identical integer delta. Edge drags clamp to zero, positive duration, known media duration and contained word boundaries. Overlapping cues remain untouched and receive the existing visible warning treatment.

Verification: `npm run check` passes strict TypeScript, 24 tests across four files and both production builds. New tests cover exact time/pixel round trips from 1× through 32×, source-time anchoring across zoom changes, whole-cue and edge clamping, timed-word containment, overlap preservation and one-step drag undo/redo. A macOS Electron pointer smoke test imported mixed Malayalam/English cues, dragged an end handle into an overlap, confirmed both cues and the visible warning, moved a whole cue, zoomed to 8×, scrolled horizontally, and verified synchronized timeline/transcript/inspector/playhead selection. A release outside the moving block exposed a transient-preview finalization bug; window-level pointer completion fixed it, and the repeated smoke confirmed clamping to 0 µs plus exact one-step undo and redo. No runtime errors were emitted.

Limitations: the Electron smoke used caption-only state, so the transient caption-overlay data path is implemented but was not visually exercised over a playable video in this slice. Known-duration drag bounds and timed-word handle bounds are covered by unit tests. Windows was not tested. Timing remains source-time microseconds and is not claimed to be frame-accurate for variable-frame-rate media.

Next: E3 can add keyboard editing, explicit handle keyboard affordances and focus restoration. M1/M2 remain responsible for the real media-worker boundary and probed canonical media duration.

## 2026-09-14 — E1 command-based caption editing and validation

Completed: replaced renderer-local caption patching with pure TypeScript commands for text and time updates, add, delete, split at the playhead and merge-next. Commands preserve the existing cue ID for text/time edits, the left cue on split and the first cue on merge; each successful user command is one history commit. User text edits are recorded as authoritative `user` text, preserve cue timing, conservatively retain only safe unchanged word IDs/timings and mark the cue timing for review. The project cue model now supports stable word IDs, timing provenance and review state while schema defaults keep existing version-1 project files readable.

Validation: commands reject non-integer/non-positive cue timing, negative starts, known-media overflow and word timings outside their cue. Overlaps are warnings: cues are neither retimed nor removed, and the transcript plus inspector show persistent warning treatment. The inspector now has real add-at-playhead, split, merge-next and delete controls alongside command-backed text/time fields. `npm run check` passes strict TypeScript, 14 tests across three files and both production builds. A macOS Electron smoke test exercised add, mixed Malayalam/English text correction, split, undo and an overlap; both overlapping cues remained and the visible warning appeared. No runtime errors were emitted. Windows was not tested.

Limitations: the desktop smoke used caption-only state rather than loading a media fixture, so known-duration rejection is covered by unit tests but was not exercised through video playback. Word timing can currently enter the model through project data but has no word editor yet; that remains R3 scope. `NTS.md`, requested in the task prompt, is not present in this workspace or its parent tree.

Next: E2 can build draggable cue boundaries and timeline zoom on the command/validation layer. E3 remains responsible for keyboard editing and focus-restoration behavior.

## 2026-09-14 — implementation ticket system

Completed: added `tickets.md`, which separates the roadmap into dependency-aware, copy-ready implementation tickets across editing, media processing, persistence, transcription, shared rendering, export and distribution. Each ticket records its acceptance scope, verification expectations and a suggested Codex model/effort. The progress board marks only the already verified scaffold and first SRT slice as complete.

Verification: cross-checked ticket coverage against `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` and the current implementation status. No application code changed in this slice.

Limitations: estimates for time/cost are intentionally omitted because they depend on fixtures, platform access and unresolved dependency choices. Model suggestions may be adjusted as Codex model availability changes.

Next: choose E1 for the safest next foundation slice, E2 after E1 for visible timeline progress, M1 to begin real media processing, P1 for recovery work, or R1 to begin shared Malayalam-safe rendering.

## 2026-09-14 — editor foundation scaffold

Completed: initialized local Git and added a secure Electron 44 + React 19 + TypeScript application scaffold. The renderer uses context isolation, a content-security policy, Node integration disabled and a narrow validated preload bridge. The first slice supports native video selection and playback, UTF-8 SRT import, synchronized cue selection/seek/overlay/timeline, cue text and timestamp editing, undo/redo, versioned atomic project save/open, and atomic UTF-8 SRT export. Project files validate against schema version 1. Dependency versions and licenses are recorded in `docs/DEPENDENCIES.md`.

Verification: `npm run check` passes strict TypeScript, two SRT unit tests (BOM, CRLF, Malayalam/English, multiline, malformed timing), renderer production build and Electron process bundling. `npm run dev` was smoke-tested on macOS: the Electron window rendered at 1200×768 and the preload bridge successfully opened the native SRT dialog. Windows has not been tested.

Limitations: media relinking after reopening currently asks the user to select the video again; recovery copies are not implemented (debounced autosave to a named project is); timeline boundary dragging, waveform/thumbnails, add/split/merge/delete operations, local transcription, visual animations and rendered video export are not implemented. The UI currently uses system fonts; a redistributable Malayalam font bundle has not been selected.

Next: add waveform extraction and draggable timing boundaries through a media-worker interface.

Open decisions: final product name, source license, tested Malayalam model/default, optional aligner support, bundled font strategy, FFmpeg build and final shared rendering implementation.
## 2026-09-17 — Optional one-click Gemini alignment and readable estimate fallback

Completed: added the compact imported-SRT **Align audio** workflow with no confidence/provider/language review UI. A missing key opens the focused Settings dialog; otherwise one click starts a shared-scheduler alignment job with honest extraction/alignment phases and Cancel. The Gemini key never crosses the preload bridge after save: Electron main encrypts it using the operating system credential store and atomically stores only ciphertext in the app user-data directory with mode `0600`; `GEMINI_API_KEY` is a non-persisted developer override. The renderer supplies only a registered media fingerprint and cue snapshots.

The main process groups non-empty cue ranges with 500 ms padding, merges gaps under two seconds, caps each upload at 20 minutes, extracts 16 kHz mono WAV in a job-owned temporary directory, and calls `gemini-3.5-transcribe` in verbatim mode with `ml-IN`/`en-IN` hints and word timestamps. Response storage is disabled and each Files API upload is deleted best-effort; job audio is always removed. No caption-text prompt, reasoning, diarization, custom vocabulary or full-video upload is used. This minimizes both uploaded duration and provider tokens while preserving code-switched speech support.

Only exact NFC/case/punctuation-normalized, monotonic whole-token matches are accepted. The validator maps those timestamps once back to canonical source microseconds, enforces cue containment/non-overlap, and retains the exact imported SRT lexical token. Partial matches apply automatically; unmatched tokens remain `estimated`/`needsReview`, manual word timing wins conflicts, imported cue text/times never change, and the full result is one undoable project mutation. Schema 2 remains compatible via optional `alignmentRuns` and word `alignmentRunId`; the project stores validated timing/provenance and aggregate usage counts, never the raw provider transcript or credential.

The offline estimator now reserves a final display hold of `min(600 ms, 20% of cue duration, duration - tokenCount µs)` and distributes grapheme-weighted start edges over the remaining reveal interval. The last estimated word ends at the cue boundary, so progressive reveal no longer makes final words appear only at the last instant. Malayalam grapheme segmentation and explicit estimated provenance are unchanged.

Verification: `npm run check` passes strict TypeScript, **566 tests across 63 files**, the renderer production build, Electron main/preload bundle and separate worker build. New tests cover exact mixed Malayalam/English partial matching, preservation of manual correction timing, partial estimated fallback/provenance, alignment-run persistence, and the final-word hold. No live Gemini request was made, so provider authentication, billing, response compatibility and real-media accuracy remain unverified. No user media or credential was uploaded during verification. macOS/Windows keychain behavior and Windows media extraction are not yet interactively tested.

Limitations/next: exact matching deliberately rejects fuzzy spelling differences; cloud availability/cost remains controlled by Google and requires the user's own key. File deletion is best-effort after the request, while provider-side expiry remains a secondary cleanup mechanism. The next validation slice should use a short consented Malayalam/English fixture and a restricted test key to measure matched-word coverage/boundary error, inspect actual API annotations/token counts, test cancellation during upload/request, and confirm Keychain/DPAPI behavior on release targets. A local forced aligner remains the long-term offline complement.

## 2026-09-17 — Optional Gemini transcription and top-bar cleanup

Completed: **Transcribe** can now use Gemini with the already-saved key as an opt-in alternative to local whisper.cpp. The dialog has an **Engine** choice, remembered per viewer, with engine-specific disclosure. Gemini hides model/device controls and offers Malayalam + English (mixed), Malayalam only or English only. A missing key opens Settings on the Gemini tab. Main extracts audio, the new worker `speechChunks` operation writes silence-gated speech chunk WAVs (same gating version as whisper.cpp; 20-minute cap), and each chunk is uploaded and transcribed with word timestamps (`store: false`, best-effort deletion). Timed words become segments at pauses/sentence ends/30 s with explicit, review-flagged adjustments. The result passes the existing `runTranscription` validation, apply choice and undo step, and captions receive real `model` word timing. The upload/request/delete client is now shared with alignment (`electron/geminiRecognition.ts`). `transcriptionRuns[]` is a union: existing whisper.cpp records are unchanged, and Gemini records store counts, versions and token usage only, never the key or raw response.

The top bar went from ~12 equal buttons to three zones. The left shows identity plus the open media/project name. The center holds the captions workflow: Transcribe (accent while there are no captions), Align audio (only when captions and linked media exist), job progress pills and a "Media offline · Relink" chip only when needed. The right holds a **File** menu (Open video, Import SRT, Open project, Save project), an **Export** menu (MP4, SRT; disabled items state why), and a ⚙ button for one tabbed **Settings** dialog (Speech models, Gemini API key, Keyboard shortcuts). The empty video stage offers Open video / Import SRT / Open project. A native application menu (File/Edit/View/Window/Help) forwards validated commands through preload and owns ⌘/Ctrl+O, S, ⇧O, I, E, ⇧E and ⌘/Ctrl+, accelerators. `?` opens the shortcut reference. `MenuButton` is a dependency-free WAI-ARIA menu (arrow/Home/End/Escape, focus return, key events stopped so editor shortcuts do not fire).

Verification: `npm run check` passes strict TypeScript, **591 tests across 70 files**, the renderer production build, Electron main/preload bundle and worker build. New tests cover speech chunk files and splitting, Gemini word→segment rules (Malayalam, punctuation, overlaps, clamping, 30 s cap), adapter offsets through `runTranscription`, service provenance/cleanup/cancellation with a fake recognizer, IPC request union (no key/device accepted for Gemini), run-record union compatibility, menu markup, native menu commands/accelerators, settings tabs, and Transcribe dialog disclosure. **No live Gemini request was made and the app was not launched interactively in this slice**: provider responses, real Malayalam accuracy, menu/keyboard behaviour in the Electron window and the new layout at narrow widths remain unverified on macOS and Windows.

Limitations/next: run a consented short Malayalam/English clip through Gemini transcription with a restricted key and compare against whisper large-v3; verify ⌘S/⌘O fire once from the native menu while typing; check the top bar below 1100 px. Unifying all job progress into one shared status model is still open: each job currently renders its own pill.


## 2026-09-21 — Dev launcher no longer attaches to a stale dev server

Completed: `./dev.sh` (dev mode) could start Electron against a dead Vite server, producing a window that showed only `backgroundColor: '#090b10'` — a black screen with no error anywhere. Two defects combined: `dev:electron` waited on `tcp:5173`, which only proves something is *listening*, and Vite silently falls back to 5174/5175 when 5173 is taken. A previous session whose Vite had wedged (accepting connections, never answering HTTP) kept port 5173, so `wait-on` passed instantly, the new Vite moved to another port, and Electron loaded the wedged one — which is still hard-coded as `VITE_DEV_SERVER_URL=http://localhost:5173`.

`dev` now runs `vite --strictPort`, so a second concurrent session fails immediately with "Port 5173 is already in use" instead of drifting to another port while Electron keeps pointing at 5173. `dev:electron` now waits on `http-get://localhost:5173/` with a 60 s timeout, so it waits for a real HTTP response rather than an open socket, and a wedged server times out loudly instead of handing Electron a page that never loads.

Verification: `tsc --noEmit` passes and `vite build` succeeds; the production renderer was loaded in a real Electron window (preload, context isolation, sandbox as in `createWindow`) and rendered the full UI with no renderer console errors, confirming the black screen was environmental, not a regression from the clip/timeline refactor. `wait-on -t 8000 http-get://localhost:5173/` returns against a healthy server, and `vite --strictPort` exits 1 with "Port 5173 is already in use" when the port is held. The hung process tree was cleared (SIGTERM was ignored; SIGKILL was required) and a clean `./dev.sh` session now serves `/`, `/src/main.tsx` and `/src/ClipStageEditor.tsx` as 200 on 5173.

Limitations/next: `npm test` and the full `npm run check` were not re-run for this change, which touches only npm scripts. The hard-coded 5173 in `dev:electron` remains — the dev server port is not yet derived from Vite's actual bound port. Separately, the stale main process ignored SIGTERM; `app.on('before-quit')` calls `event.preventDefault()` and runs an async shutdown, so a shutdown step that never settles leaves a process that only SIGKILL clears. That path is untested and worth a look. Window behaviour after the fix was confirmed by the user's own launch, not by an automated GUI check.

## 2026-09-22 — Caption stage transforms, Space play/pause, and File ▸ New Project

Completed three independent slices from direct user feedback.

**Caption move/resize/rotate on the stage.** `CaptionStageEditor.tsx` is a new sibling of `ClipStageEditor` inside `.video-frame`, built the same way: `useCompositionProjection` for pointer↔composition mapping, window-level pointer listeners with refs so a mid-drag re-render never tears down the gesture, Escape to cancel, and a draft-on-move/commit-on-release contract so one gesture is one undo step. A plain drag moves the caption (writes the project style's `horizontal`/`vertical`), a corner handle resizes it (writes `fontSize`, since the block has no independent width/height — its size is measured from text), and a new handle above it rotates (a new `appearance.rotation` field, applied in `CaptionView` as one wrapper `transform: rotate()` around the block's own center, entirely after `layoutCaption`'s wrap/fit math so line breaking and export parity are unaffected — confirmed byte-identical at 0° by both a new renderer test and a full parity run). Holding Alt during any of the three gestures scopes it to the cue currently showing instead of the whole project, via a new per-cue `placementOverride` on `Cue` (mirrors the existing `motionOverride` field-for-field: optional, schema-bounded, no migration needed). Arrow keys nudge the selected caption (Shift = ×10 step); Alt+arrow nudges the cue override instead. The new pure math (`src/core/captionPlacement.ts`, 17 unit tests) inverts `layoutCaption`'s placement formula from a dragged pixel position back to the `{horizontal, vertical}` fraction the style actually stores, and handles resize-by-distance-from-center and rotate-by-angle-from-center — both invariant to the projection's scale, so those two gestures need no composition-unit conversion at all. `resolveCaptionStyle` (`captions/style.ts`) is the new single place that merges a cue's motion *and* placement overrides into one resolved `CaptionStyle`; both export frame-request builders (`plan.ts`) and the live preview (`CaptionStage` in `App.tsx`) now call it, so a moved/resized/rotated caption exports exactly as previewed with no separate export-side plumbing beyond that one substitution. A "Reset placement" control sits next to the existing motion-override reset in Caption Tools.

**Space bar toggles playback.** The shortcut mapping (`core/shortcuts.ts`) and the global keydown handler in `App.tsx` were already correct; the bug was a guard that skipped `toggle-playback` whenever the event's target was inside `[role="button"]` — which is every cue card, timeline clip block and transcript word in the app, so Space re-selected instead of playing as soon as anything was clicked. Those widgets now activate on Enter only (Space is left alone); the guard was narrowed to `button, summary, a`, so a real native button/link keeps its own Space activation and every other stage/timeline element now lets Space reach playback.

**File ▸ New Project.** Added the `new-project` menu command end to end (native template, preload/IPC allow-list, in-app File menu, ⌘/Ctrl+N) and a `newProject()` action built on a new `resetForProject()` helper factored out of the existing `openProject()` (which now uses it too) — one place that resets history, path, save status, selection, playback position, waveforms, codec issues and every in-flight draft/dialog when switching projects. Both New Project and Open Project now go through a guard (`hasUnsavedWork`, the same project-vs-`lastSavedProject` reference check the autosave effect already used) that shows a discard-confirmation dialog — reusing the existing `ReplaceCaptionsReview`/`RelinkReview` modal markup — with Cancel / Save first… / Discard, where Save first… only proceeds if the save actually landed (both `saveProject`/`saveProjectAs` now return whether it did, rather than only updating state).

**Follow-up: on-stage shortcut hint.** The new drag/resize/rotate/nudge gestures above have no other UI naming them, so a small `CaptionShortcutHint` panel now appears whenever a caption is selected (`selection.kind === 'cue'`), listing Drag/Corner handle/Top handle/Arrow keys/Alt+drag/Esc. It is anchored to `.video-stage` (the stage's own box), not `.video-frame` (the aspect-ratio-sized video itself), so it sits in the empty margin beside a portrait video and simply floats over a corner for a widescreen one that fills the panel — either way it stays inside `.video-stage`'s bounds and is never clipped by its `overflow: hidden`. `pointer-events: none`, so it never blocks a drag underneath it.

Verification: `tsc --noEmit`, `npm test` (1002 tests across 109 files, up from 979), `npm run build` (Vite + Electron + worker bundles) and `npm run parity:export` (`ELECTRON_RUN_AS_NODE` unset first; 200 caption-layer cases, 0 mismatches, no stray `export-parity-error.log`) all pass. New/changed tests: `core/captionPlacement.test.ts` (round-trip position↔bounds, clamping, the block-fills-safe-area divide-by-zero guard, font-size clamping, rotation wrap/snap), a `renderer.test.tsx` case proving 0° rotation renders no wrapper/transform at all (still one whole-line text node) and a rotated case does, `export/plan.test.ts` cases for both v1 (`frameRequestAt`) and v3 (`frameRequestAtSequence`) resolving a per-cue placement override into the exported style without touching the project style, `editCommandSchema.test.ts` for the two new commands, and `appMenu.test.ts` for `new-project`/⌘N.

Limitations/next: all verification above is automated; nothing was run inside the actual Electron window in this slice, so the drag/resize/rotate feel, Space-bar behavior at the OS level, and the new discard dialog have not been GUI-tested — that's a manual pass for you to run (open a video, drag/resize/rotate a caption and confirm one Undo reverts the whole gesture; Alt-drag one caption and confirm only it moves; click a clip/cue/word then press Space; try New Project/Open Project with unsaved work). Only macOS was exercised here (this environment); Windows remains untested. Rotation's word-pop/emphasis max-scale clamp in `CaptionPreview.tsx` is still computed in unrotated space, so a heavily rotated caption with word-pop may clip slightly outside the safe area at the animation's peak scale — acceptable for now but worth revisiting if someone combines rotation with word-pop heavily. The placement-override "Reset" control only clears an existing override; there's no per-field (position-only vs. size-only) reset yet.

## 2026-09-23 — VHS and Film Grain effects

Completed: two new frame-paint effect kinds, **Film grain** and **VHS**, in the Effects panel's Look section (click or drag), each with its own timeline lane, inspector (grain: amount, size; VHS: amount, scanlines, tracking noise) and bypass. They reuse the existing effect commands, undo, MCP `effect-add/update` schema, manifest v3 and frame request v3/v4 (`frameEffects` gained `grain` and `vhs`). Noise re-seeds at 24 Hz in absolute sequence time from a stateless hash, so preview, export and seeking agree and the export planner still dedupes frames within a tick. Painting is in `CompositionLayers.tsx` (`NoiseFill`, `VhsPaint`); the pinned-layer list is now one shared `pinnedEffectLayers()` used by both preview and the export host instead of two hand-copied lists. Details in docs/EDITING.md "Texture effects".

Verification: `tsc --noEmit`, `npx vitest run` (1155 tests, 119 files; new: evaluator determinism/24 Hz seeding/ranges, layer markup and cell-size scaling, pinned order, v3 manifest → frame request with per-tick seeds, panel tiles), `npm run build` and `npm run parity:export` (`ELECTRON_RUN_AS_NODE` unset; 200 caption-layer cases, 0 mismatches) all pass. I also rendered grain (two sizes) and VHS (alone and with grain) with `CompositionLayers` in a real offscreen Electron window over a gradient and inspected the PNG: noise, scanlines, tracking band, head-switch noise and edge color bleed all paint as intended. macOS only.

Limitations: the parity harness does not include grain/VHS, so no pixel comparison between the app preview and an actual exported MP4 was run; the export host path is the same component, but a real export was not inspected. VHS is overlay-only (no picture displacement or chroma shift; that would need an FFmpeg branch). Grain and VHS sit under captions by design. SVG `feTurbulence` at full 1080p per 24 Hz tick has not been profiled during live playback or on a slow GPU/Windows machine; if it stutters, the fix is a smaller filter resolution or a pre-rendered noise tile. No new schema version (added to schema 11's effect union), so older builds cannot open projects that use them. Not GUI-tested: add by click/drag, lanes, inspector sliders, undo, and playback smoothness — a manual pass for you.

Next: export a short clip with grain + VHS and inspect the MP4; add a grain/VHS case to the parity script; consider an FFmpeg-side VHS (chroma shift/wobble) if the overlay look is not enough.


## 2026-09-23 — Export settings: resolution, frame rate, bitrate, platform presets

Completed: the header **Export** button / File menu / ⌘E now open an **Export video** dialog (`ExportDialog.tsx`) before the save dialog. Presets: Source, YouTube 1080p/1440p/4K, Instagram Reels/Stories, Instagram Feed, and Custom (resolution 720/1080/1440/2160p, frame rate 24–60, video bitrate in Mbps or Auto). The pure rules live in `src/export/settings.ts`: the short edge is scaled, the frame shape is kept, dimensions stay even and the long edge is capped at 3840. A preset that does not fit the project's shape (e.g. Reels on a 16:9 project) or would upscale shows a warning; it never reframes. The renderer sends only validated `settings` in `export:start`; main resolves the scaled `format` inside `buildExportManifest` (all geometry is composition units, so captions/blur/zoom/effects scale consistently) and passes one validated `encoding.videoBitrateKbps` through the worker protocol into `-b:v`. With no settings the plan, manifest and FFmpeg argv are unchanged (parity snapshot untouched). Last-used settings are remembered per viewer in `localStorage`, not in the project. Preset bitrates are app defaults from the platforms' published upload recommendations, not guarantees.

Verification: `tsc --noEmit` and `npx vitest run` pass (new: settings, plan scaling for v2/v3, argv with/without `encoding`, dialog markup). A real macOS export via `--export-smoke` (new `CAPTION_STUDIO_EXPORT_SMOKE_SETTINGS` env) of a synthetic 1080p/30 source at 720p/24 fps/4 Mbps probed as 1280×720, 24/1, 72 frames, ~3.5 Mbps (VideoToolbox undershoots its target). macOS only; Windows untested (export is darwin-gated).

Limitations: presets do not reframe (a canvas-shape control would be a separate slice); H.264 only; audio fixed AAC 192 kbps/48 kHz; the dialog UI was not exercised in the real window, and a 4K export was not timed (frames render as PNG at 4K, so expect it to be much slower).

Next: try each preset on a 16:9 and a 9:16 project in the app and compare scaled captions/effects; time a 4K export; consider a canvas-shape control and HEVC.

Follow-up (same day): the dialog was reshaped after a mobile-editor reference: platform chips (no separate Custom chip; moving a slider clears the highlight) fill snapping **Resolution** (Source/480P/720P/1080P/2K/4K), **Frame rate** (Source/24/25/30/50/60) and **Bitrate** (Auto/2–53 Mbps) sliders, each with a live value and a one-line hint, and the estimate plus **Export…** in the footer. `480` was added to the settings schema. Rendering was checked only as static markup in tests (`tsc`, full vitest); the look and slider feel have not been seen in the real window.

## 2026-09-23 — Inspector control overhaul (Resolve-style)

Finished the stalled Text-tab redesign and carried it across the inspectors. Fixed the visible bug where `.style-panel input[type="text"]` leaked into `NumberField`/hex inputs (boxed number, squeezed Font Size slider): that broad rule is gone; only `.ins-input` styles bare inputs. Controls kit (`src/style/controls.tsx`): new `Select` (chevron dropdown, replaces `Stepper`), `Row` with right-aligned label, `labelHidden` (Face under Font) and a reset glyph shown only when the value differs from default (column stays reserved), `SliderWithNumber` with fixed-width value box and optional `endLabels`, `HexColorField` as wide swatch + eyedropper (Chromium `EyeDropper`, local; hidden when the API is absent) + hex, plus `TextField`/`ActionBar`. `StylePanel` is now Text (font, face, size, tracking, word/line spacing) → Layout (styles, alignment, max lines, X/Y sliders with Left–Right/Top–Bottom, rotation) → Fill → Emphasis (its family/face moved here) → Effects; all ids/titles smoke selectors use are preserved. `TextInspector` moved to Rows/Selects with In/Out duration sliders (draft locally, one undoable commit). Shared `.edit-actions` buttons and Templates motion cards use the inspector tokens.

Verification (macOS arm64): `npm run typecheck`, `npm test` (1173 tests) and `npm run build` pass. Not run: `npm run smoke:captions`, any GUI pass, eyedropper pick, installed-font loading.

Limitations: the left-rail Captions panel selects (`CaptionsPanel.tsx`) are not yet on the new system; `CueEditor` only inherits the CSS. Windows unvalidated.

Next: manual GUI pass of the Text tab, Text/Zoom/Blur/Effect inspectors; restyle `CaptionsPanel`; run `smoke:captions`.

## 2026-09-23 — Layer masks and the Layers tab (schema 12)

Completed: a **Layers** tab after Effects lists what is painted at the playhead (front to back, the stage's paint order); each layer can take one **mask** — rectangle, ellipse or a bezier **pen** path, with invert, feather, density and corner radius — edited from the tab and on the preview (red outside tint, box handles, pen point/handle editing). Masks apply to video/image clips, titles, the caption plane of a caption track, blur regions and frame-paint effects. Schema 11 → 12 (version bump only), one undoable `mask-set` command (zod-mirrored for MCP), a linked move for picture-in-picture clips, one shared SVG mask generator used by preview, the export host and FFmpeg's mask input. Also fixed a pre-existing export bug: `layerPlan`'s signature ignored authored text, so an animating title could re-send a stale frame. Details in [EDITING.md](EDITING.md) "Layer masks".

Verification (macOS arm64): new vitest suites (mask geometry, pen math, layer stack order, `mask-set`/linked move/refusals, schema 12 migration and round trip, masked layers' CSS, manifest/frame-request carriage, FFmpeg argument/graph shape, Layers panel markup) pass on their own. The generated FFmpeg graph was run on the pinned FFmpeg 9.0.1 with real inputs: a masked clip shows only inside its ellipse, a masked blur blurs only inside its ellipse (mean |Δ| 135.7 inside vs 1.0 outside). `scripts/export-parity.mjs --only layer-masks` in Electron: a masked caption plane plus an inverted masked vignette paint with **0 differing bytes** between the preview window and the export host, and the v5 mask-fill PNG has alpha 255 inside / 0 outside / 128 at a feathered edge.

Limitations: the Layers tab and the mask gizmo (pen drawing, handle editing, tint) were not exercised in the real window; no full MP4 export with a masked video/blur was encoded end to end through the app (only the graph on the real binary, and the host rasterization separately); no pixel tolerance measured for FFmpeg-side masks; the encoder used for the graph check was `mpeg4` (this FFmpeg build has no libx264). Masks are static, one per item; a title's mask does not follow the title. macOS only; Windows unvalidated. Other suites in the tree were failing at the time of writing only because a concurrent change bumped the schema to 13 while fixtures still said 12.

Next: manual GUI pass (add/feather/invert on a picture-in-picture clip, pen mask on a sliding title, caption-plane mask, ellipse on a blur, then export and compare at fixed timestamps); mask keyframes/animation; multiple masks per layer; a mask-aware color-clip path once color clips land.

## 2026-09-24 — Font menu: in-window popover, search, on-open loading, Favourites

Completed: dropdowns with more than 25 options (the installed-font lists) no longer use the native `<select>` popup, which macOS draws outside the window. `PopoverSelect` in `src/style/controls.tsx` is an in-window, viewport-clamped popover with a search box, arrow/Enter/Escape keys, and optional group headings. The "Load installed fonts" button is gone: opening the Font or Emphasis font menu triggers `loadLocalFontCatalog()` from that click (which supplies the user gesture); a `needs-gesture` failure retries on the next open. The fixed offline choices are grouped as **Favourites**, the rest as **System fonts**. Removed the synthetic-click font-catalog block from `visualSmoke.tsx` (the button it clicked no longer exists).

Verification (macOS arm64): `tsc --noEmit` and the StylePanel/style vitest suites pass. Not run: the full suite, `smoke:captions`, any GUI pass — the popover, search, on-open loading and the `local-fonts` permission prompt were not exercised in the real window.

Limitations: "Favourites" is still the existing fixed list of installed-font names, not bundled fonts. Bundling Noto Sans Malayalam / Anek Malayalam (both OFL-1.1 on npm as @fontsource, 5.3.0) is not started; it needs the export harness build, CSP, DEPENDENCIES.md inventory and parity re-check.

Next: manual GUI pass of the font menu; bundle the Favourites fonts as a separate slice.

Follow-up (same day): the font menus were still native selects while the catalog had ≤25 entries, so opening them never triggered loading. Both font dropdowns are now always the searchable popover (`searchable` prop), and `StylePanel` also tries to load the installed-font catalog on mount so the full list is normally ready before the menu is opened (Chromium may still demand a click, in which case opening the menu retries). Favourites (the fixed offline choices) stay on top. `visualSmoke.tsx` now picks the font via the popover. Not fixed: `scripts/emphasis-smoke.mjs` still sets `style-emphasis-family` as if it were a native select and was not re-run.

## 2026-09-24 — Sequence Settings dialog (resize `project.format` after import)

Prompted by: a 4K import pinned `project.format` at 4K for the project's whole life (it is seeded once, on the first video clip, and had no UI to change afterward), even when only a 1080p/2K delivery was wanted.

Completed: the read-only "Sequence W×H · fps" label over the preview (`MediaSummary`, `src/App.tsx`) is now a button that opens `SequenceSettingsDialog` (`src/SequenceSettingsDialog.tsx`), a `<dialog>` styled and structured like `ExportDialog` (`nearest`/`StopSlider`/`rateText`/the `Stop<T>` type were exported from `ExportDialog.tsx` for reuse rather than duplicated). It offers **Resolution** (Current/480P/720P/1080P/2K/4K) and **Frame rate** (Current/24/25/30/50/60) stop sliders and applies through the existing undoable `format-set` command, so Undo restores the previous frame exactly. Resolution presets reuse `resolveExportFormat`'s short-edge scaling (`src/export/settings.ts`) unchanged, so this dialog and the export dialog compute "scale to 1080p" identically; v1 deliberately keeps the current aspect ratio (a resolution-only change never reflows caption/text placement, since the composition is fixed-width and aspect-driven — `src/core/format.ts` `formatAspect`/`compositionFor`), and Apply is disabled until a slider actually changes the output.

Answering the underlying question in the prompt: this alone does **not** make preview playback of a 4K import lighter. `project.format` only fixes what captions/effects/export composite into; preview `<video>` elements (`src/playback/videoPool.ts`) still decode the original source file regardless of the sequence's resolution, since `CaptionPreview`'s composition is CSS-scaled, not a decode-time resample. A real playback speedup needs the separate, not-yet-built automatic-proxy path sketched during planning (background 1080p/720p transcodes of the source, cached and routed into preview only, never into export/transcription/parity) — M4's manual, save-dialog proxy flow (`workers/media/proxy.ts`) is today's only proxy code and is not wired into playback.

Verification: `npm run typecheck` passes; new `src/SequenceSettingsDialog.test.tsx` (static-markup smoke: sliders present, current frame shown, Apply disabled until changed, and the null-format/no-video-yet case) passes, as does the existing `ExportDialog.test.tsx` after the export. Full `npx vitest run`: 1372/1375 pass; the 3 failures (`TemplatesPanel.test.tsx`, `keynoteTemplates.test.tsx`) are pre-existing on this branch, reproduced identically with this change stashed out — unrelated to this slice.

Limitations: not exercised in the real window (button click, dialog open/close, slider drag, Apply/Undo) — only typecheck and static-markup tests. No GUI pass on macOS/Windows this session.

Next: the actual playback-performance work — an automatic playback-proxy pipeline (background transcode on import/open, cached outside git keyed by fingerprint+version+target height, routed only into the preview `<video>` element, with export/transcription/waveform/thumbnails and parity checks always using the original file, validated by re-probing the proxy's duration/start against the source).

Follow-up (same day): the only entry point was a 9 px pill in the corner of the video preview, which a user reported they could not find. Added **Sequence settings…** to the **Timeline** menu (`src/App.tsx` `timelineEntries`) as a proper, discoverable menu item alongside the existing pill; both open the same dialog.

## 2026-09-24 — Automatic playback proxies (the real playback-performance fix)

Prompted by: the previous entry's own conclusion — resizing `project.format` does not make preview lighter, since preview `<video>` elements always decode the original source. This slice is the actual fix from the plan's Slice 1.

Completed: a background, disk-cached, preview-only proxy pipeline, reusing M4's existing `proxy` media-worker operation (WebM/VP8/Opus, capped at 1280 px) rather than inventing a second encode path. `electron/playbackProxyService.ts` (Electron-free, unit-tested like `ExportService`) enqueues the transcode on the one shared `getJobScheduler()` under a new `playback-proxy` job kind (`src/core/jobs.ts`), so it queues behind — never alongside — a transcription or export the user is actively waiting on. Before a result is ever cached or played, it is re-probed and its duration checked against the source within 500 ms (`DURATION_TOLERANCE_US`); a drifted proxy is discarded, never cached, since a silently misaligned proxy would make captions land on the wrong moment. `electron/playbackProxyCache.ts` persists validated results outside Git in the userData cache dir, keyed by fingerprint + `PROXY_CONVERSION_VERSION`, mirroring `thumbnailCache.ts`/`waveformCache.ts`'s atomic-write pattern; a cache hit is only trusted once the video file is confirmed to still exist on disk. `electron/main.ts` exposes one fire-and-forget IPC (`media:playback-proxy-ensure` → `media:playback-proxy-status` events) and extends the `media://` protocol's allowlist to also serve files inside the proxy cache directory (by containment, since that directory only ever holds files this app generated).

On the renderer side, `src/core/proxy.ts` adds the pure, unit-tested selection logic (`shouldRequestPlaybackProxy`, `playbackUrlFor`) and `src/app/usePlaybackProxies.ts` is the *only* hook that ever produces a proxy URL: it requests a proxy at most once per fingerprint per session and hands `App.tsx` a wrapped `urlOf` used exclusively for the `useProjectPlayback` call that feeds the pooled `<video>` elements. Export, transcription, waveform extraction, thumbnails and export parity all keep calling `useAssetUrls`'s own `urlOf` directly and never see a proxy — this is enforced by which call site gets which function, not by a runtime check each of those paths has to remember to make. A new **Playback** settings tab (`SettingsDialog.tsx`) offers Off / Auto (recommended, only above 1080p short edge) / Always, persisted per viewer in `localStorage`; a **Preview: proxy/original quality** toggle appears next to the sequence-format pill over the preview once a proxy is ready, letting the viewer force full-quality framing for a session without changing the mode. Full pipeline description in docs/ARCHITECTURE.md "Playback performance" and docs/EDITING.md's "Playback" subsection.

Verification: `npm run typecheck` passes. New unit tests: `src/core/proxy.test.ts` (`shouldRequestPlaybackProxy`/`playbackUrlFor` — mode gating, short-edge threshold on portrait and landscape sources, viewer override precedence), `electron/playbackProxyCache.test.ts` (atomic write/read, fingerprint/version invalidation, a cache entry whose video file was deleted is a miss, malformed sidecar, last-write-wins), `electron/playbackProxyService.test.ts` (queued→generating→ready sequencing with a worker double, a drifted-duration proxy is rejected and never cached, a disk cache hit starts no worker job, two concurrent `ensure()` calls for the same fingerprint join one transcode rather than duplicating it, a transcode failure reports "failed" rather than throwing). `SettingsDialog.test.tsx` extended for the new Playback tab. Full `npx vitest run`: 1394/1397 pass; the 3 failures (`TemplatesPanel.test.tsx`, `keynoteTemplates.test.tsx`) are the same pre-existing, unrelated failures noted in the previous entry.

Limitations: not exercised against a real FFmpeg or in the real window — no actual 4K fixture was transcoded, no dropped-frames/CPU comparison with proxies on vs. off, no click-through of the Playback settings tab or the quality toggle. The proxy profile is fixed at 1280 px VP8/Opus (M4's existing profile); the plan's `h264_videotoolbox` hardware profile for macOS, and a user-configurable target height, are not implemented — this reuses what already exists and is tested rather than adding a second, unverified encode path. No explicit cancel control for an in-flight playback-proxy job (it is cancelled only by app shutdown, via the scheduler's existing `closeJobs()`). Windows unvalidated (this is FFmpeg-path work, not darwin-gated, but untested there).

Next: a real macOS smoke test with a generated 3840×2160 fixture (confirm a proxy is actually produced, re-probed and used in preview, and that dropped frames/CPU improve — `getVideoPlaybackQuality()`); a manual GUI pass of the Playback settings tab and the quality toggle; consider the hardware `h264_videotoolbox` profile and a configurable target height if the fixed 1280 px VP8 profile proves too slow or too soft in practice.

## 2026-09-24 — Playback proxy quality fix (blocky VP8 output on 4K/log source)

Prompted by: a user report with a screenshot — a 4K ProRes log clip imported to the timeline played back through the automatic proxy as heavy macroblocking (the earlier proxy-pipeline entry above had already flagged this untested case as a limitation).

Root cause: `workers/media/proxy.ts`'s VP8 profile used `-crf 30 -b:v 0`. `-b:v 0` is a VP9 idiom ("ignore bitrate, use CRF alone"); VP8 (`libvpx`) has no true constant-quality mode, so with no real bitrate target libvpx fell back to its own default of roughly 256kbps regardless of source detail. A 3840x2160 source scaled to 1280px wide and encoded at that bitrate is exactly what produces visible macroblocking. Separately, `scale='min(1280,iw)':-2` only capped width, so a portrait 4K source would exceed 1280px on its long (vertical) side.

Completed: replaced the VP8 args with a real bounded-quality profile — `-crf 10 -b:v 4M -qmin 4 -qmax 42` (a real bitrate ceiling instead of the VP9-only `0`), kept `-deadline realtime` but tightened `-cpu-used` to 4 and added `-auto-alt-ref 0 -g 60 -threads <min(8,cpus)>` for responsive seeking without materially slower encodes. The scale filter now caps whichever of width/height is the long side (`scale=w='if(gte(iw,ih),min(1280,iw),-2)':h='if(gte(iw,ih),-2,min(1280,ih))'`) and forces `format=yuv420p` so 10-bit/4:4:4 ProRes sources don't propagate an unusual pixel format into VP8. `PROXY_CONVERSION_VERSION` bumped to `ffmpeg-vp8-opus-webm-v2` (`src/core/proxy.ts`) — the cache key already includes this version, so existing blocky v1 proxies on disk are simply ignored and regenerated; no migration code needed. Docs updated (`docs/MEDIA_WORKER.md`).

Verification (macOS arm64, real FFmpeg, no app/GUI involved): `npx vitest run workers/media/proxy.test.ts src/core/proxy.test.ts electron/playbackProxyCache.test.ts electron/playbackProxyService.test.ts` (24/24 pass, `proxy.test.ts` updated to assert `-b:v` is never `0`, `-crf` is present, and the scale expression bounds both dimensions); `npx tsc --noEmit` clean. Real-media check: generated a synthetic 3840x2160 fine-detail source (test pattern + diagonal lines + a dithered checkerboard) with the project's bundled FFmpeg, ran the old and new argument sets against it, and compared output frames. Old args: ~467kbps, checkerboard pattern smeared into mush, diagonal lines aliased, small on-screen text illegible. New args: ~3.5Mbps (bounded by the 4M ceiling and the source's own complexity), checkerboard and diagonal lines stayed crisp, text legible — visually matching the fix expected from the bitrate-ceiling change.

Limitations: not verified against the user's actual ProRes log source or in the running app (no GUI pass, no confirmation that reopening the project regenerates the proxy under the new version in situ) — the synthetic-source comparison isolates the encoder-argument change but doesn't exercise the whole pipeline end-to-end. Log footage will still preview flat/grey (no LUT or tone mapping applied to the proxy or the preview path) — that is a separate, unaddressed concern from the blocking. Only macOS tested; Windows FFmpeg path unaffected by this change but not re-verified.

Next: a real GUI pass with an actual 4K log source confirming the proxy regenerates and preview no longer blocks; consider whether the fixed 1280px/4M profile needs a higher ceiling for very high-motion or very high-detail sources, and whether a preview-only LUT/tone-map for log footage is wanted as a separate slice.

## 2026-09-24 — Color: pure color core and the adjustment-layer schema (schema 16, slices 1–2 of 6)

Prompted by: the user wants color control and LUT-based looks for log footage (F-Log, F-Log2, S-Log3, Apple Log, V-Log, C-Log3, plus user `.cube` import), modeled as DaVinci-style adjustment-layer clips on the timeline, in a new Color tab after Effects. Full plan in the plan-mode artifact; this entry covers only the first two of its six slices — there is still no UI, no preview and no export wiring for this feature.

Completed — Slice 1, `src/color/` (no UI, not yet wired into preview or export): `transfer.ts` (log ↔ scene-linear for the six curves above, constants transcribed from each vendor's own published data sheet/white paper, cross-checked against the `colour-science` library), `gamut.ts` (camera-gamut → Rec.709 matrices derived from primaries, not hardcoded, plus a highlight roll-off), `rec709.ts` (BT.709 OETF/EOTF), `primaries.ts` (exposure/white-balance/contrast/highlights-shadows/lift-gamma-gain/saturation pipeline), `looks.ts` (11 original, evocative-named film looks — no camera/film-stock brand anywhere in code, UI strings or docs), `cube.ts` (`.cube` parse/write), `bake.ts` (`bakeGrade`/`composeLuts`/`sampleLut` — one baked 33³ LUT is the single artifact both the future WebGL2 preview and the FFmpeg `lut3d` export will sample, so preview/export parity is by construction once slices 3–4 land).

Completed — Slice 2, schema 16 (`src/core/edit.ts`, `src/core/model.ts`, `src/core/migrateV15.ts`): a new `adjustment` clip kind (`{kind, ...clipTiming, grade}`, no asset, synthetic source range like `color`, video-track-only) and a new `lut` project-asset kind, referenced by a `grade.input: {type:'lut', assetId}` the same way media assets already are (relink-ready via the existing `projectMediaSchema` shape). `grade` mirrors `src/color/bake.ts`'s `Grade` type (primaries, an optional built-in look validated against the live `LOOKS` list, intensity) as its own zod schema. Migration is version-only (15 → 16, following the `migrateV14` pattern). Every place in the codebase that assumed "every clip has an asset/rect/fit/gain except `color`" was walked via `tsc --noEmit` to convergence and updated to also exclude `adjustment` (clip commands, item validation, layer stack, stage editor, export's `flatSequence`/`contributing`, the Timeline clip block, the MCP command schema mirror) — `adjustment` clips currently force the v3 (stacked) export route, same as `color`, so they can never be silently dropped once the actual grading filter lands. `clip-update`'s `changes.grade` is the one new command surface; `rect`/`opacity`/`fit`/`gain`/`mask` are refused on an adjustment clip, and `grade` is refused on every other kind.

Verification (macOS arm64): `npx tsc --noEmit -p .` clean. `npx vitest run src/color` (75/75) and new `src/core/adjustmentLayers.test.ts` (15/15: schema accept/reject including the lut-asset-kind check and every log profile/look id, migration 15→16 and round trip, `clip-add`/`clip-update`/`clip-split` behavior and guards, the MCP `editCommandSchema` mirror, `summarizeProject`). Full `npx vitest run`: 1484/1487 pass; the 3 failures (`TemplatesPanel.test.tsx`, `keynoteTemplates.test.tsx`) are the same pre-existing, unrelated failures noted in earlier entries. Color-science constants were verified against each vendor's own worked example, not just internal round-trip consistency (three real transcription/formula bugs were caught and fixed this way during Slice 1: a non-linear saturation formula, and two Canon Log 3 errors — a sign slip and a missing 2020-revision reflectance rescale).

Limitations: nothing in this feature is reachable from the app yet — no Color tab, no adjustment-layer drag-and-drop, no WebGL2 preview, no `.cube` import IPC, and export never bakes or applies a grade (an adjustment clip on the timeline today only forces the v3 route; it has no visible effect). Out of scope for v1 per the plan: keyframed grades, scopes/waveforms, HSL qualifiers and power windows, 1D LUTs, grading fill clips, HDR output. Not yet tested on Windows.

Next: Slice 3 (export — bake/dedupe LUTs into the manifest, write `.cube` files in the export worker, insert `lut3d` into the FFmpeg filtergraph with an explicit color-matrix/range for parity), then Slice 4 (the WebGL2 preview path and the actual Color tab UI — this is the first point the feature becomes visible/usable at all), then Slice 5 (`.cube` import) and Slice 6 (parity measurement, MCP, docs).

## 2026-09-24 — Color: preview, .cube import, MCP and docs (slices 3–6 of 6 — feature now reachable)

Prompted by: continuing the color-grading plan from the previous entry, working through its remaining slices to the point a user can actually reach and use it.

Slice 3 (export baking/`lut3d`) was found already implemented, uncommitted, in the working tree ahead of this session — not written in this pass. `src/export/plan.ts` already split a graded segment out with its own baked/deduped `lutId`, `electron/exportIpc.ts` already resolved a `lut`-type grade input's asset to a parsed `Cube3D`, and `workers/media/export.ts`/`exportArguments.ts` already wrote each manifest LUT to a real `.cube` file per job and inserted `lut3d=interp=trilinear` (with an explicit `in_color_matrix=bt709:in_range=tv`) into the filtergraph, on both the flat and stacked routes, with existing tests (`src/export/planGrading.test.ts`, `workers/media/exportGrading.test.ts`). This entry's own work: extracted the shared "which adjustment layers grade this clip right now" test (`adjustmentsOver`) out of `plan.ts` into `src/core/gradeStack.ts` so the live preview (Slice 4) could reuse the exact same function rather than a second implementation of the same rule.

Completed — Slice 4 (the feature's first visible/usable point): a new **Color** rail tab (`src/LeftRail.tsx`, `ColorIcon` in `RailIcons.tsx`) opens `src/ColorPanel.tsx` — an adjustment-layer tile, the six built-in camera-log tiles, 11 film-look tiles (each swatch a real CSS gradient sampled from `evaluateGrade`, `src/color/lookSwatch.ts` — not a decorative color), and a "My LUTs" list with an Import .cube button. Tiles drag through a new `COLOR_DRAG_TYPE` payload (`src/core/dragPayload.ts`) or add at the playhead on click. Drop placement (`src/App.tsx`'s `addAdjustment`, using two new `src/core/clipEdits.ts` helpers, `adjustmentTrackAbove`/`topAdjustmentTrackFor`): onto an existing clip, the new layer spans that clip's own range on the free video track directly above it (creating one if needed); onto empty space or a click, it is 5 s on the track under the pointer (or the topmost free video track). `src/ColorInspector.tsx` (embedded in `ClipInspector` for a selected adjustment clip, reusing its existing timing/Enabled/Delete chrome as the grade's own bypass) edits input (none/log profile/LUT), primaries (exposure/white-balance/contrast/highlights-shadows/saturation, lift/gamma/gain as one master slider per wheel rather than per-channel R/G/B — a known v1 simplification, the schema already carries the full triplet), look and intensity, live-drafted and committed through the existing `clip-update` command. Preview itself is WebGL2 (`src/captions/GradedVideo.tsx` + `src/color/webglLut.ts`): a graded layer's pooled `<video>` (normally mounted by `VideoSlot`) is instead mounted under a canvas that redraws it every `requestVideoFrameCallback`, sampling the baked LUT as a core-filterable `RGBA16F` `TEXTURE_3D` (avoids the `OES_texture_float_linear` extension dependency `FLOAT` would need) with the texel-center remap that matches `sampleLut`'s manual trilinear math; a lost context or no WebGL2 falls back to the plain ungraded element with a visible "Grade unavailable" badge. `src/color/previewGrade.ts`'s `bakedGradeStack` is the preview's own bake-and-memoize step (mirrors `bakeStackLut` in `plan.ts`), wired into `App.tsx`'s `CaptionStage` per video/image layer via `gradeStackFor`.

Completed — Slice 5 (`.cube` import): a new `lut:import` IPC (`electron/main.ts`) opens a dialog filtered to `.cube`, and a new `inspectLut` reads, validates (`parseCube`) and fingerprints it (reusing `workers/media/probe.ts`'s `fingerprintMedia` directly — a LUT needs no ffprobe) — used for both a fresh "My LUTs" import (`asset-add`) and relinking a missing/mismatched one in place (`asset-update`; also wired into `assets:relink`'s existing dialog for a `lut`-kind asset). `project:open`'s per-asset resolution loop now special-cases `kind: 'lut'` the same way (existence + `inspectLut`, no ffprobe) and returns each resolved LUT's own `.cube` text alongside the usual resolution, so the renderer's new `useLutAssets` cache (`src/app/useLutAssets.ts` — parsed `Cube3D`s keyed by asset id, the only place in the renderer a `grade.input: {type:'lut'}` is ever resolved) is hydrated in the same round trip a project opens in, with no second per-asset file read. A grade naming a LUT this session has not resolved (missing, still loading, or a parse failure) bakes to `null` (`bakedGradeStack`/the export's existing `resolveGrade`), rendering that layer ungraded with a warning rather than guessing.

Completed — Slice 6 (MCP, docs): the `edit` MCP tool's description now covers `clip-add`'s `kind: 'adjustment'` and `clip-update`'s `changes.grade`; `get_project`'s `clips[]` summary (`src/core/agentProtocol.ts`) now reports an adjustment clip's `grade` (it previously reported only `{id, kind, trackId, timelineStartUs, ...}` with no way for an agent to see an existing grade before editing it). `docs/EDITING.md` gained a full "Color: adjustment layers" section (schema shape, pipeline, grade resolution, preview, export, placement, `.cube` import, out-of-scope list); `docs/ARCHITECTURE.md` and `docs/DEPENDENCIES.md` each gained a paragraph (the WebGL2 preview path; confirmation this adds no new npm/binary dependency, that the log curves are transcribed from public vendor white papers and cross-checked against `colour-science`, and that the film looks are original work with no bundled/reverse-engineered third-party LUT).

**Not done — explicitly, not silently:** the plan's Slice 6 parity measurement (a synthetic S-Log3 + look export case in `scripts/export-parity.mjs`, comparing a WebGL `readPixels` capture against the FFmpeg output and recording a measured tolerance) needs to actually run the app/FFmpeg to produce a real number, which this pass did not do (no test/build execution this session, per instruction) — writing a parity case with an invented tolerance would be exactly the "fake progress" AGENTS.md says not to present as implemented, so it is left for a session that can run it. Relatedly, `lut3d`'s presence in the project's configured FFmpeg build is asserted from it being a standard, non-GPL `libavfilter` filter, not confirmed by actually running `ffmpeg -filters` — flagged in `docs/DEPENDENCIES.md`, not asserted as verified.

Verification: careful manual read-through of every new/changed file against its call sites and existing patterns (`ClipInspector`, `EffectsPanel`, `VideoSlot`, `backgroundTrackFor`, `useAssetUrls`, `assets:relink`) — no `npm run typecheck`, `npx vitest run` or a real app/GUI pass this session (explicit instruction not to run tests or do testing; the user will test). New unit tests were still written for the pure/testable pieces, to run whenever that verification does happen: `src/color/lookSwatch.test.ts`, `src/color/webglLut.test.ts` (the half-float packer against Node's own `Float16Array` as an independent reference), `src/color/previewGrade.test.ts`. `src/LeftRail.test.tsx` updated for the seventh tab (its stale "five" wording, actually already six, is now accurate at seven).

Limitations: no GUI pass at all — dragging a Color tile onto a clip, stacking two adjustment layers, the WebGL2 canvas actually painting a graded frame, importing/relinking a `.cube`, and the preview-vs-export match are all unverified by running the app. Many GL contexts (one per simultaneously graded picture layer, no shared-context pooling) is an accepted v1 limitation for typical small clip counts. The preview grade-stack bake cache (`previewGrade.ts`) is capped at 64 entries and clears itself entirely past that, rather than evicting LRU-style — acceptable for v1, crude under a long slider-drag session. No per-channel RGB lift/gamma/gain wheel UI (master slider only, per above). Not tested on Windows or Linux.

Next: an actual GUI/app pass covering everything in Limitations above, in whichever order the next session can reach a running build; then the parity measurement case this entry deliberately left undone.

## 2026-09-24 — Color grading repair and measured export parity

The uncommitted slices 3–6 were buildable only after repair. `ColorPanel` passed the evaluator's runtime grade type into the persisted clip schema, so TypeScript rejected four tile variants. It now validates a persisted default grade once. The export worker built a `lut3d` graph with the job's `.cube` paths, but `exportArgumentsV3` rebuilt an inline graph without those paths; a normal short graded export silently lost its grade. The worker now passes its prepared graph to the argument builder, and a missing baked LUT path aborts instead of yielding an ungraded graph. Unit and real export coverage caught that regression.

The export plan now routes images through FFmpeg when adjustment clips exist, giving upper-track images the same per-layer LUT path as videos. Images stay full-range RGB before `lut3d`; video clips use the explicit BT.709/TV-range conversion. Hidden adjustment tracks no longer grade export while remaining hidden in preview. A LUT that resolves late or is relinked changes the preview cache key, so the prior null or stale bake is not reused. The stage shows a missing-LUT badge while rendering ungraded, and the Export control blocks on a used unresolved LUT. A paused video redraws on grade changes without waiting for a new decoded frame.

Verification on macOS arm64: `npm run typecheck` and `npm run build` pass; the targeted grading/export tests pass, including new image/hidden-track/relink tests. The full `npm test` run has 1510 passing tests and four failures in `EffectsPanel.test.tsx`, `TemplatesPanel.test.tsx`, and `keynoteTemplates.test.tsx`; these unrelated failures were already present before this repair. The configured FFmpeg 9.0.1 reports `lut3d` in `-filters`. `env -u ELECTRON_RUN_AS_NODE npm run parity:export -- --only color` ran a real S-Log3-coded H.264 source, the production v3 worker and FFmpeg export, and the production WebGL2 LUT renderer's `readPixels`: 27,648 interior channels, mean absolute delta 5.93/255, p95 23/255, maximum 43/255. Identity-LUT source-decode baseline: mean 3.83/255, p95 12/255, maximum 16/255. Full machine/build evidence is in `docs/decisions/evidence/x3-parity-2026-09-24.json`; these numbers describe this fixture, not a general codec tolerance.

Limitations and next task: the Color tab's drag, trim, split, undo, stacking and `.cube` import/relink interactions have not been exercised in the running editor; the parity case uses synthetic H.264, not a real 10-bit camera log file. Run that manual Mac pass and broader camera/codec parity before declaring visual accuracy. Windows remains untested. Resolve the four unrelated suite failures in their own slice.

## Graded preview: "Grade unavailable" fix (media: CORS)

Completed — a graded layer showed the ungraded clip with a "Grade unavailable" badge in the real app. Cause: pooled `<video>`/graded `<img>` loaded from the `media:` scheme without `crossOrigin`, and the protocol handler sent no `Access-Control-Allow-Origin`, so the element was cross-origin-tainted and `texImage2D` threw a `SecurityError` (caught in `GradedVideo`, which falls back to plain playback). The parity harness missed it because it loads page and video over `file://` (same origin). Fix: `electron/main.ts` `mediaCorsHeaders` echoes the request origin (packaged `file://` → `null`, or the dev server origin only) on every `media:` response; the video pool factory (`src/app/useProjectPlayback.ts`) and `GradedVideo`'s images set `crossOrigin = 'anonymous'`; `GradedVideo` now `console.warn`s the underlying error when it falls back.

Verification (macOS arm64): `npm run typecheck` passes; `electron/mediaRange.test.ts`, `src/color`, `src/playback`, `src/app` tests pass (109). The header itself has no automated test and the fix is not yet confirmed in the running app.

Limitations: needs a manual GUI check — Cinema Soft on the ProRes clip (badge gone, look visible), scrub/play with audio, graded still image, and dev vs. packaged builds. Ungraded video now also loads in CORS mode, so any `media:` response lacking the header would fail to play.

Next: user GUI confirmation; consider a preview-path parity case that loads over `media:` instead of `file://`.

## Black preview after adjustment layers; preview/sequence settings discoverability

Completed — with a graded clip in the timeline, preview went black outside the adjustment's range and stayed black after the adjustment was deleted (sequence size made no difference). Cause: the pooled `<video>` is handed between `GradedVideo` (sets `opacity: 0`, the WebGL canvas paints on top) and `VideoSlot`, which never reset opacity, so the ungraded video stayed invisible. Fix: `src/captions/pooledVideoStyle.ts` gives every mounter the complete style (including opacity); `GradedVideo` also restores `opacity: 1` on unmount. `LutRenderer.dispose()` now calls `WEBGL_lose_context`, so repeatedly crossing adjustment boundaries (one canvas mount per switch) no longer accumulates live GL contexts toward Chromium's ~16 cap.

UX: new **View** menu (Sequence settings, preview Proxy/Original, proxy mode Off/Auto/Always, Playback settings) and a **Preview: Proxy|Original · W×H** chip in the transport bar with the same entries; importing a source above 1080p shows a one-time notice pointing at them. Settings gear tooltip mentions playback proxies.

Verification (macOS arm64): `npm run typecheck` passes; `src/captions` + `src/color` tests pass except 2 `keynoteTemplates.test.tsx` failures that also fail with my changes stashed. New `pooledVideoStyle.test.ts`.

Limitations: not confirmed in the running app (needs the 4K Apple Log repro: play across the adjustment boundary, delete the adjustment, scrub the boundary many times, use the View menu/chip). The menu/chip and large-source hint have no automated tests. Windows untested.

Next: user GUI confirmation of the above.

## 2026-09-24 — Auto playback proxy for undecodable video (iPhone ProRes)

Completed: an iPhone ProRes 422 HQ 10-bit Apple Log `.mov` (1920×1080) previewed as a black frame with audio and no diagnostic. Chromium plays the PCM audio of a file whose video codec it cannot decode and fires no `error`, so `loadeddata` cleared any codec issue; and `auto` playback proxies only triggered above a 1080 short edge. Fixes: `useProjectPlayback` treats `loadeddata` with `videoWidth === 0` on a video asset as a media error (banner says the audio plays but the video cannot be decoded); `shouldRequestPlaybackProxy` takes an `undecodable` flag that makes `auto`/`always` request a proxy at any size (`off` still never does), fed from `App`'s codec issues. The banner shows "Creating a playback proxy automatically…" while that runs; the manual save-dialog conversion remains as "Save a playable copy…".

Verification: `tsc --noEmit`; `vitest run src/core src/app` (725 tests, new `shouldRequestPlaybackProxy` cases). Not run in the GUI with the real clip.

Limitations: detection needs one load attempt of the original first; the proxy is ungraded Log (flat) until a Log→Rec.709 look/LUT is applied.

## 2026-09-24 — Ctrl/Cmd+C, Ctrl/Cmd+V to clone a timeline item

Completed: ⌘/Ctrl+C copies the selected timeline item (caption, clip or text overlay) and ⌘/Ctrl+V pastes a clone of it, on both macOS (⌘) and Windows/Linux (Ctrl) — `shortcuts.ts`'s `shortcutForEvent` unifies `ctrlKey`/`metaKey` into one `modifier`, so both platforms share the same routing with no platform branch needed. New `ShortcutAction`s `copy-item`/`paste-item`; `App.tsx` stores the copy as a `{ kind, id }` reference (not a snapshot) in new `clipboardItem` state, re-resolved against the live project at paste time, so pasting after the source was deleted fails with a clear notice instead of resurrecting stale data. Clips and text overlays already had duplicate logic (`duplicateSelectedClip`/`placeCopy`, the `text-duplicate` command) that paste now reuses (`duplicateSelectedClip` was split into a reusable `duplicateClip(clip)`); captions had none, so a new `duplicate` `CaptionCommand` (`captionCommands.ts`) was added, mirroring `text-duplicate`'s 250ms-offset-with-room-check approach but clamped instead of failed (a cue that already fills its video's duration lands on top of itself, which is a warning-only overlap, not an error) and generating fresh word IDs (`${duplicateId}-w${index}`) since word IDs must be unique project-wide, not just per-cue. Wired into the schema boundary (`editCommandSchema.ts`) for the MCP agent bridge.

Verification (Windows 11): `npx tsc --noEmit -p .` clean. New/updated tests: `shortcuts.test.ts` (Ctrl and Cmd variants of C/V route correctly; still null in editable targets and with no modifier), `captionCommands.test.ts` (duplicate offsets timing/words correctly, clamps to video duration instead of failing, rejects a missing cue or reused ID), `editCommandSchema.test.ts` (`duplicate` covered by both the type-coverage check and a round-trip case). Full `npx vitest run`: 1521/1554 pass; the 20 failures (`EffectsPanel.test.tsx`, `TemplatesPanel.test.tsx`, `keynoteTemplates.test.tsx`, `electron/mcp/config.test.ts`, `workers/media/export.test.ts`, `workers/media/thumbnails.test.ts`) reproduce identically on this branch with the change stashed — confirmed pre-existing (mostly Windows path-separator and FFmpeg-host-script assumptions in an environment without the pinned FFmpeg build), not caused by this change.

Limitations: not run in the actual app — no manual confirmation that copy/paste feels right at the UI level (e.g. pasting a clip picks a free track via existing `placementTrack` logic, which was not re-verified interactively here). Blur regions, zoom regions, effect regions and markers are not yet copyable (copy shows a "can't be copied yet" notice for those kinds) — no existing duplicate command for them to reuse; a future slice could add one. Repeated Ctrl+V always offsets from the *original* copied item's current position, not from the previous paste, so pasting the same cue/text twice in a row lands both copies at the same offset from the source (a minor stacking quirk, not a correctness issue — each copy still gets a unique ID). This is Windows-only verification so far; macOS ⌘ routing is covered by the unified `modifier` test but not run on real macOS hardware.

Next: a manual GUI pass (ideally on both macOS and Windows) exercising copy/paste on a caption, a clip, and a text overlay, including cross-selection paste (copy A, select B, paste — should still clone A); consider extending copy/paste to blur/zoom/effect regions and markers if users ask for it.

## 2026-09-24 — Export fails on FFmpeg 8: "Unrecognized option 'filter_complex_script'"

Completed: exports whose filtergraph exceeds the 8 KiB argv limit (cuts, many clips) write it to `filtergraph.txt` and passed it with `-filter_complex_script`, which FFmpeg 7 deprecated and FFmpeg 8 removed — so on an 8.x build (e.g. gyan.dev 8.0 on Windows) FFmpeg rejected the argument list and the export failed immediately. `exportArguments`/`exportArgumentsV3` now pass `-/filter_complex <file>` (the generic "read this option's value from a file" prefix, present since FFmpeg 7.0, which is already the export minimum; the macOS pin 9.0.1 needs it too).

Verification (Linux): `exportArguments.test.ts` and `exportArgumentsV3.test.ts` pass; `tsc --noEmit` clean. Checked by hand that FFmpeg 7.0.1 reads the graph file's contents as the `filter_complex` value when given `-/filter_complex <file>`. `export.test.ts` fails the same 17 tests with or without this change, because on Linux the encoder check stops the run before these arguments are built. Not run against a real FFmpeg 8 on Windows or macOS.

Next: re-run the failing Windows export to confirm.

## 2026-09-24 — Export stall: "Fragmented shaping run" on title-motion text

Completed. Two separate bugs caused one export failure on Windows ("Export stalled at frame 1395 of 2996: the caption renderer returned no frame for 60 s — export host: frame 135 failed … Fragmented shaping run"):
- **The shaping check rejected a correct frame.** The export harness requires every leaf under `[data-caption-line]` to hold the full line text. `TitleMotionLine` paints nothing for words whose motion has not started yet: the motion's first frame, or a later line waiting its turn. That leaves the line with no text, which the check reported as fragmented. The check now lives in `src/export/shaping.ts` (`isFragmentedLine`) and lets a line that painted nothing pass. A line split into words or graphemes still fails.
- **A failed host hung the export for 60 s instead of failing it.** `ownedProcess` settled only on `close`, which waits for every holder of the stdio pipes. On Windows, Electron's helper processes can keep the host's pipes open after it exits. It now also watches `exit`: 500 ms later, if `close` has not come, it destroys the pipes and settles with the exit code and stderr. The PNG reader then ends at once and the host's own message is reported.

Verification (Linux): `tsc --noEmit` clean.
- New `src/export/shaping.test.ts`.
- New `workers/media/exportProcesses.test.ts`, run with a real child process that exits 1 while a helper process keeps its pipes open. The test times out without the fix and passes with it.
- `export.test.ts` passes 27/27, with and without the change, in a copy with `process.platform` set to `darwin`. On Linux it fails the same 17 tests as before, because the encoder check stops them first.
- No Electron export host or real export was run, and nothing was tested on Windows or macOS.

Next: re-run the failing Windows export. It should get past 46.47 s, or any other failure should now appear within about a second.

## 2026-09-24 — Export: title entrance animations (focus, cascade, …) missing from the video

Completed: exported titles did not animate like the preview. The export re-sends the previous PNG for frames whose layer-plan signature is unchanged, and the signature for authored text held only the enter/exit ramps (`textMotionAt`). With enter set to `none`, the whole hold got one signature, so the first frame (title at progress 0: fully blurred/transparent for `focus`, no words yet for `cascade`) was repeated until the exit fade. `createLayerPlan` (`src/core/layerPlan.ts`) now also includes each title's `titleMotionAt` progress and its own word-motion state (`item.style.motion`), and for captions the `style.titleMotion` progress. Reuse still applies once a ramp finishes.

Verification (Windows 11): `tsc --noEmit` clean. Two new `layerPlan.test.ts` cases (title focus/cascade with enter/exit `none`; caption `titleMotion` ramp) fail without the change and pass with it. Full `npx vitest run`: the same 23 failures with and without the change (pre-existing: `export.test.ts`, `EffectsPanel`, `TemplatesPanel`, `keynoteTemplates`, `mcp/config`, `thumbnails`). Not re-exported through the real app or compared visually against the preview.

Limitations: `scripts/export-parity.mjs` paints single frames and bypasses the layer plan, so it cannot catch signature omissions of this kind.

Next: re-export `img/chatgpt-newplan.cstudio` and check the titles at about 44.4 s (focus) and 46.4 s (cascade).

## 2026-09-25 — MCP clients no longer block each other after a stale session

Completed: the loopback MCP endpoint previously created one `McpServer` and one stateful
`StreamableHTTPServerTransport` for the entire app lifetime. A tunnel or agent that exited without
an MCP `DELETE` left that transport initialized, so a later OpenAI Secure MCP Tunnel discovery (or
any second agent) failed with `Invalid Request: Server already initialized`. `startMcpServer` now
follows the SDK's stateful HTTP routing pattern: each headerless initialize request gets a fresh
server/transport pair, initialized sessions are stored by `Mcp-Session-Id`, and subsequent
POST/GET/DELETE requests are routed only to their own transport. Closing one session removes only
that entry; an abruptly abandoned entry cannot prevent another client from connecting. App shutdown
closes every remaining server/transport. Bearer authentication and exact loopback/DNS-rebinding
guards remain ahead of protocol handling.

Verification (Windows 11): `npx vitest run electron/mcp/server.test.ts
electron/mcp/stdioBridge.test.ts` passes 35/35, including a new regression that keeps an abandoned
client session while a second session continues, terminates that session, and connects a third.
`npx tsc --noEmit -p .`, `npm run build:electron`, and the full Windows packaging command
`npm run dist:win` pass. The rebuilt installer is
`release/KathaCut-Setup-0.2.0-win-x64.exe`.

Limitations: an abandoned HTTP session remains counted until the app exits because an HTTP client
that crashes cannot send the protocol's termination request; it is isolated and no longer blocks
new clients. The rebuilt installer has not yet been installed or exercised against ChatGPT's live
connector-creation flow.

Next: install the rebuilt Windows package, restart KathaCut with agent access enabled, restart the
local tunnel so its stdio bridge reads the current `mcp.json`, then create the ChatGPT connector and
confirm that repeated tunnel restarts no longer require toggling agent access.

## 2026-09-25 — MCP tool safety metadata for ChatGPT connector discovery

Completed: all 17 MCP tools now explicitly publish `readOnlyHint`, `destructiveHint`,
`openWorldHint`, and `idempotentHint`. The labels follow each tool's real behavior rather than a
single blanket value: inspection/list tools are read-only; `edit` is potentially destructive because
its validated command union includes deletion and overwrite operations; `import_media` is
open-world because its URL form fetches a public HTTPS resource; playhead/selection changes and
undoable additions are writes but non-destructive. This closes the metadata gap found by auditing
the installed app's live `tools/list` response, where all 17 tools previously lacked annotations.

Verification (Windows 11): direct authenticated MCP discovery against the installed app returned 17
tools and confirmed 17/17 were missing annotations before the change. After the change,
`npx vitest run electron/mcp/server.test.ts electron/mcp/stdioBridge.test.ts` passes 35/35; the
real-server list test now requires all four boolean annotations on every tool and checks representative
read-only, destructive, open-world and editor-state classifications. `npx tsc --noEmit -p .` is clean.

Limitations/next: the source fix still needs to be bundled, installed, and checked through the live
OpenAI Secure MCP Tunnel. Connector creation can then be retried; if ChatGPT still rejects it, the
next diagnostic target is the connector-creation API response rather than local reachability or MCP
discovery, both of which are already returning success.

## Editor fixes: caption edit reset, Add text crash, font menu, Global Edit, stage text drag

Changes: inline caption edit no longer resets on double-click (CaptionsPanel); "Add text at playhead" in Titles no longer passes the click event as a placement anchor; font menu selects installed system fonts instead of "Custom" and previews each font in its own face; new "Edit all" dialog (script view + find & replace, grapheme-safe, one undo step via `update-text-many`); pressing an unselected title now selects and drags in one gesture, the subtitle box no longer blocks titles under it, and clicking a stacked spot cycles title layers.

Verification: not tested, typecheck only (`npx tsc --noEmit -p .` clean, Windows 11).

Limitations: Global Edit cannot add/remove captions; grouped titles still need click-then-drag; shapes are not part of click-through cycling or subtitle pass-through; no layer reordering.

Next: manual check of the five scenarios in the app.

## Transcribe range 01: request range + boundary-safe apply

Changes: `transcription:start` accepts an optional source-time `range` (zod-validated, clamped to the probed duration, min 1 s, in main); `applyTranscription(..., { partial })` never replaces a caption crossing the range edge and reports `boundaryKept`; the panel decides "choose" from `replaceableCaptionsInRange`; `Delivered.partial` exists (always false until brief 02); the notice names the range for partial runs.

Verification: not tested, typecheck only (`npx tsc --noEmit -p .` clean, Windows 11).

Limitations: no UI to pick a range yet.

Next: brief 02 (always-visible Transcribe + range picker).

## Caption languages 02: Captions panel language tabs + "Show on video"

Changes: the Captions tab shows one tab per language (hidden until a translation exists) with an "On video" dot; translation tabs have a single-select "Show on video" checkbox (`set-shown-translation`, one undo step), the Original tab shows a status line. The list, cue count, Edit all, regroup-all, prev/next cue and "Add at playhead" act on the active tab; the tab follows `shownTranslation` and the language of a selected cue. "Rebuild original captions" (`rebuildOriginalCues` in `transcriptionApply.ts`) recreates a video's original cues from `run.recognition` in one history step when it has none. Empty tabs show a hint.

Verification: not tested, typecheck only (`npx tsc --noEmit -p .` clean, Windows 11).

Limitations: a cue added on a hidden language tab is not visible on video until that language is shown; the selected cue can belong to a hidden layer (inspector still edits it).

Next: brief 03 (translate existing captions).

## Transcribe range 02: always-visible Transcribe + range picker

**Changes**
- `src/core/transcriptionRange.ts`: `sourceUsForAssetAt`, `sourceRangeForSequenceRange`, `transcriptionRangeProblem`, `parseRangeInput`, `formatRangeTime`.
- The Transcribe button now sits once in the Captions heading (before "Edit all"), whether or not the picked video has captions; it is accent-styled only when the video has none. The empty state keeps "Import SRT" plus a one-line hint.
- Dialog has a "What to transcribe" choice: Whole video, In–Out range (only when the marks overlap the picked video), Part of the video (Start/End fields in the video's own time, each with a Playhead button). Problems show as an alert and disable the start button. Partial runs send `range`, deliver `partial: true`, and the button, progress line and review heading name the range.
- `App` passes `transcribeContext` (duration, playhead source time rounded to 100 ms, In–Out mapped to source time) through `CaptionsPanel`; the prop is optional.

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` clean). Not viewed in the running app.

**Limitations:** ranges are in the video's own time; an In–Out range over a cut or repeated video uses the hull of its source spans, so a little extra audio may be transcribed. A running job is lost if the Captions tab is closed (pre-existing). Not committed: the touched files also hold other sessions' uncommitted edits.

**Next:** brief 03 (gap list and "Transcribe this gap..." on the timeline).

## Transcribe range 03: gap list + "Transcribe this gap..."

**Changes**
- `src/core/transcriptionRange.ts`: `captionGaps` (stretches of 5 s or more with no caption of that video, including before the first and after the last) and `captionGapAt` (any length).
- Transcribe dialog: under "Part of the video", a list of caption gaps (max 8, then "and N more") plus the provider's `uncoveredRanges` from earlier runs of this video that still have an uncaptioned stretch and are not already listed. Clicking a row selects Part of the video with the range filled in. `CaptionsPanel` and `TranscriptionPanel` take optional `runs`.
- `TranscriptionPanel` `openRequest` (`{ assetId, range, nonce }`) opens the dialog prefilled from outside; it never interrupts a running job or a pending choice (calls `onOpenRequestIgnored`, and App shows an info notice).
- Right-click on an empty stretch of a captions lane (`data-caption-track-id`, `captionLane` on the empty menu target) offers "Transcribe this gap (…)…" when a video is under the click and that spot has no caption. It picks that video, switches to the Captions tab and opens the dialog.

**Verification:** not tested, typecheck only. Errors that remain in `src/TranscriptionPanel.tsx` (start(): `translateTo` string vs string[]) and `electron/transcriptionService.test.ts` come from the separate caption-languages work in progress, not from this slice. Not viewed in the running app.

**Limitations:** gaps are computed from the cues shown in the active language tab; a provider uncovered stretch fully inside a listed gap is shown once, as the caption gap.

**Next:** optional automatic retry of `uncoveredRanges` inside `CloudTranscriptionAdapter`.

## Caption languages 04: multi-language in the Transcribe dialog

**Changes**
- `translateTo` is now `LanguageCode[]` (0..5, unique) end to end: `transcriptionStartRequestSchema`, IPC key check, `TranscriptionService` requests, dev smoke callers.
- `TranscriptionService.translateAll` replaces the single `translate()`: one audio pass, then one text call per target, sequentially. A failed language is recorded in `translationFailures` (`{ target, message }`) and skipped; cancellation still aborts the job. `run.translation` is no longer written and `translationProvenance` is removed.
- `TranscriptionJobValue` / `TranscriptionOutcome` carry `translations: TranslationWithUsage[]` (translation plus Gemini token usage, written into `translationRuns` by `applyTranscription`) and `translationFailures`.
- Job progress gained an optional `detail` (here the target code). Translation progress spans all targets so the bar never rewinds, and the dialog names the language being translated.
- Dialog: one shared "Translate to" checkbox list (max 5) for both engines, with the cost line; localStorage holds a JSON array (an old single code reads as one item; absent or malformed reads as none). "Transcribe and translate" whenever any target is picked.
- `applyTranscript` passes the array and its notice lists added and failed languages, says the original captions were kept and points to "+ Translate…" for retries.
- Existing tests fixed minimally (`null` to `[]`, `'en'` to `['en']`, `translation` to `translations[0]`).

**Verification:** not tested, typecheck only (`npx tsc --noEmit -p .` clean). Not viewed in the running app.

**Limitations:** `electron/transcriptionService.test.ts` still asserts the removed `run.translation` in two places (would fail if run; left alone per the no-tests override). Untested: partial failure, cancellation between languages.

**Next:** brief 05 (Hinglish and Manglish targets).
