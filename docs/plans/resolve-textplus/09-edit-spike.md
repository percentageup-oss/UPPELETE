# 09 — Spike 2: timeline edit read/write + the open Text+ items

## Goal
Write a second spike script that the **user runs once** in Resolve. It answers everything briefs 10–12 and 07
would otherwise guess:
- how to read a timeline's cuts back to the original files (Resolve → KathaCut, brief 11);
- how to build a timeline from files (KathaCut → Resolve, brief 12);
- ADR 0008's open Text+ items (size, position, alignment, bulk timing, Character Level Styling (CLS), write-on).

This session writes the script and its instructions, then stops. A later **findings session** turns the user's
report into ADR 0009 (step 5).

Read `docs/plans/resolve-textplus/README.md` and `docs/decisions/0008-resolve-textplus.md` first.

## Read only
- `resources/resolve/dev/spike.lua` and `resources/resolve/dev/SPIKE.md`: reuse their structure, logging helper
  and timeline setup. Don't rewrite them.
- `resources/resolve/bridge.lua`: the `requireTimeline`, `findTemplate` and `textPlusTool` helpers, to copy
  patterns from.
- `resources/resolve/kathacut-captions.drb`: the Text+ template (bin `KathaCut`, clip `Fusion Title`).
- `electron/resolve/install.ts` `generateLauncherContent`: **how scripts must start.** A Resolve menu script's
  globals are **not** visible to a file it loads (ADR 0008 addendum). The spike runs directly as a menu script,
  so it uses `Resolve()`, `bmd` and `fu` as its own globals and never `dofile`s code that needs them.

## Steps
1. **`resources/resolve/dev/edit-spike.lua`** (new; the `dev/` folder is excluded from packaging). Keep the log
   format of `spike.lua`: one `TNN key=value …` line per fact, printed to the console **and** appended to
   `<temp>/kathacut-edit-spike.txt`. Wrap every test in `pcall` so one failure never stops the run. Tests:
   - **E1: read the current timeline.** For every video and audio track and every item on it, log:
     - track type, index and name;
     - `GetName`, `GetStart`, `GetEnd`, `GetDuration`, `GetLeftOffset`, `GetRightOffset`;
     - `GetSourceStartFrame` and `GetSourceEndFrame`, logging `missing` if the method doesn't exist;
     - `GetSourceStartTime` if present;
     - the media pool item's `GetClipProperty` for `File Path`, `FPS`, `Start TC`, `Frames`, `Type`,
       `Video Codec`, `Resolution` and `Duration`;
     - `GetMediaPoolItem()` returning nil (log it);
     - `GetFusionCompCount`;
     - `GetProperty()` keys that mention speed, retime or zoom (dump the whole table once for the first item);
     - `GetClipColor`.
     Stop after 200 items.
   - **E2: classify.** For each E1 item, log a guessed kind: plain file, title/generator (no file path), Fusion
     clip, compound (Type = "Compound" or similar), multicam, retimed. Log the raw values the guess used, so the
     findings session can correct the rules.
   - **E3: source frame origin.** For the first file-backed item, compare the source start frame with its
     `Start TC` converted to frames. Log whether source frames count from 0 or from the file's start timecode.
   - **E4: create a timeline.** Create `KathaCut edit spike <time>` with `CreateEmptyTimeline`. Before adding
     anything, try `SetSetting("useCustomSettings", "1")`, then `timelineFrameRate` = `"25"`,
     `timelineResolutionWidth` = `"1280"` and `timelineResolutionHeight` = `"720"`. Log each call's return value
     and the value read back.
   - **E5: import media.** Find the first file path from E1, or skip with a message if there is none. Create or
     find a bin `KathaCut Media` and `ImportMedia({ path })` into it. Log the returned items and their
     `File Path`. Import the same path again and log whether Resolve makes a duplicate. Also log how an existing
     item with the same `File Path` can be found.
   - **E6: place clips with source ranges.** On the E4 timeline, `AppendToTimeline` two ranges of the E5 item:
     - `{ mediaPoolItem, startFrame = 10, endFrame = 59, recordFrame = <timeline start>, trackIndex = 1 }`
     - `{ …, startFrame = 100, endFrame = 149, recordFrame = <timeline start> + 50, trackIndex = 1 }`
     Then read each back (start, end, source start/end). Log whether `endFrame` is inclusive, whether
     `recordFrame` and `trackIndex` are honoured, the returned item order, and whether video and audio both came
     in (log the audio tracks' items). If the source fps differs from the timeline's 25, log the source frames
     Resolve reports. That tells brief 12 which fps `startFrame`/`endFrame` use.
   - **E7: bulk Text+ timing** (ADR 0008's T13). Place 20 Text+ clips from the template in one `AppendToTimeline`
     call on a new video track of the E4 timeline. Then set `StyledText`, `Size` and `Center` on each. Log the
     elapsed seconds for placement and for the input writes, using `os.clock` and `os.time`.
   - **E8: Text+ calibration still.** On one Text+ clip set `StyledText` = `"H മലയാളം"`, `Size` = `0.08`,
     `Center` = `{0.5, 0.2}` and `HorizontalJustificationNew` = `0`. Move the playhead into the clip, print "Switch
     to the Edit page now" and `bmd.wait(8)`. Then `ExportCurrentFrameAsStill` to
     `<temp>/kathacut-edit-spike-still.png`, logging the path. Repeat with justification `1` and `2` (three
     stills). The user reports where the text sits and how tall the "H" is in pixels.
   - **E9: write-on keyframes.** On one Text+ clip, do `tool.End = comp:BezierSpline()`, then `tool.End[0] = 0`
     and `tool.End[24] = 1` inside `comp:Lock()`/`Unlock()`. Read back `tool:GetInput("End", 12)`. Log it. Also
     fix `spike.lua`'s T10, which uses the wrong id `WriteOnEnd`: change it to `End`/`Start`.
   - **E10: Character Level Styling.** Find a Text+ clip on video track 2 whose name or text contains `CLS`
     (the user styles one word by hand first, see `SPIKE2.md`). Dump `tool:GetInput("StyledTextCLS")`, or the
     modifier's inputs if it's a modifier, with a recursive table printer (depth ≤ 4). Log the character
     offsets of the styled word and whether they count code points, UTF-8 bytes or graphemes.
   - **E11: tag persistence.** `comp:SetData("KathaCut.key", "persist-test")` on one E7 clip and log its unique
     id. `SPIKE2.md` asks the user to save, close and reopen the project, then run the script with
     `MODE = "check"`, which only reads the tag back.
   - At the end, print `DONE` and the report path.
2. **`resources/resolve/dev/SPIKE2.md`** (new): step-by-step for the user.
   - Copy the script into Resolve's Scripts folder, Utility sub-folder, as SPIKE.md does.
   - **Prepare:** open a real, *cut* timeline with several clips, ideally including one retimed clip, one
     title and one compound clip, plus separate audio on an audio track if there is any. Style one word of a
     Text+ clip on video track 2 via the Inspector's Character Level Styling and put `CLS` in its text.
   - Run from Workspace → Scripts with the console open. Switch to the Edit page when told to.
   - Afterwards: save, close and reopen the project, set `MODE = "check"` at the top, and run again.
   - **Send back:** the text file, the three stills, and the pixel height/position of the "H" in each still.
3. Don't touch `bridge.lua`, app code or schemas.
4. **Commit** only the two new files plus the `spike.lua` T10 fix: `Add Resolve edit spike (brief 09)`.
5. **Findings (a second session, after the user's report).** Write `docs/decisions/0009-resolve-edit-roundtrip.md`:
   - the read/write API facts from E1–E6;
   - classification rules;
   - source frame origin and which fps the source frames use;
   - the batch size recommendation from E7.
   Then amend ADR 0008's "Open items" with E7–E11: the size formula, `Center` Y direction, the justification
   enum, write-on and CLS format, and tag persistence. Update the constants they settle:
   - `textPlusSize`, `centerFor` and `horizontalJustificationFor` in `src/resolve/textPlusInputs.ts`;
   - `INSERT_BATCH` in `electron/resolve/sync.ts`.
   Add a `docs/STATUS.md` entry and commit: `Record Resolve edit spike findings (ADR 0009)`.

## Out of scope
Any app feature, IPC or schema change. Rendering (T15) stays unrun.

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes (no TS changes are expected).
- [ ] Every test is `pcall`-wrapped and logs `missing` rather than failing on an absent API.
- [ ] The script only creates its own timeline, bin and clips; it never deletes or edits the user's items.
- [ ] `docs/STATUS.md` entry: "not tested, typecheck only; the user runs the spike".

## Manual check for the user
Follow `resources/resolve/dev/SPIKE2.md` and send back the report file, the three stills, and the "H" height
and position.
