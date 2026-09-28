# 01 — Spike script for DaVinci Resolve

## Goal
Write one Lua script that the **user** runs from Resolve (Workspace → Scripts). It checks every assumption the
later briefs rely on and writes a plain-text report. It must be safe to run: it works only in a new, empty timeline
that it creates, and it never modifies existing timelines, clips or media. This session writes the script and
the user instructions, then stops. You can't run Resolve here.

Read `docs/plans/resolve-textplus/README.md` first (architecture, Resolve API reference, rules).

## Read only
- `docs/plans/resolve-textplus/README.md`
- Nothing else in `src/` or `electron/`: this brief touches no app code.

## Deliverables
1. `resources/resolve/dev/spike.lua`: a single self-contained Lua 5.1 (LuaJIT) script with no `require`s.
2. `resources/resolve/dev/SPIKE.md`: user instructions (below).

## Script requirements
General:
- Wrap every test in `pcall`, so one failure never stops the run. Each test records
  `PASS/FAIL/INFO <test id> <details>`.
- Write the report to `<os temp>/kathacut-resolve-spike.txt`. Use `os.getenv("TEMP")` or `os.getenv("TMPDIR")`,
  and fall back to `/tmp`. Also `print` each line, so it shows in Workspace → Console.
- Record `resolve:GetProductName()`, `resolve:GetVersionString()`, `_VERSION`, `jit and jit.version`, and the OS
  (`package.config:sub(1,1)` gives the path separator).
- Setup: take the current project. Create a new timeline named `KathaCut spike <os.time()>` with
  `mediaPool:CreateEmptyTimeline(name)`, and make it current. **All clip tests happen only in this timeline.**
  Record whether the project already had a timeline open, then restore it at the end with
  `project:SetCurrentTimeline(previous)`.

Tests (IDs are used in the report):
- **T1 env**: availability of the globals and functions `bmd`, `bmd.wait`, `bmd.readdir`, `fu`/`fusion`, `io.open`,
  `os.rename`, `os.remove`, `os.time`, `os.clock`, `os.execute` and `io.popen` (type check only; don't call
  `os.execute` or `io.popen`).
- **T2 files**: write, rename and read back a JSON-ish file in the temp dir with `io.open` + `os.rename`. Check
  whether `os.rename` over an existing file works on this OS (it may fail on Windows; if so, test
  `os.remove` + `os.rename`). Record the results.
- **T3 timeline info**: from the *previously current* timeline (read only): name, `GetUniqueId`,
  `GetStartFrame`, `GetEndFrame`, `GetSetting("timelineFrameRate")`, `GetSetting("timelineDropFrameTimecode")`,
  and the project resolution settings. Record the exact returned values and their Lua types.
- **T4 loop**: loop for 15 s with `bmd.wait(0.15)`, touching a file each iteration. Record the iteration count and
  the elapsed `os.time()`. **Print before it starts:** "For the next 15 s, try scrubbing the timeline and clicking
  around in Resolve; note whether Resolve stays responsive."
- **T5 template**: look in the media pool (recursively, via `GetRootFolder`, `GetSubFolderList`,
  `GetClipList`) for a folder named `KathaCut` containing a clip whose `GetClipProperty("Type")` or name shows a
  Fusion title. The user creates it by hand beforehand (see SPIKE.md). Record the clip name and all
  `GetClipProperty()` keys and values.
- **T6 append**: if T5 found a template, append **one** clip at `recordFrame = startFrame + 24`, duration 48, to
  track 1 of the spike timeline with `AppendToTimeline`. Record the returned item, `GetStart`, `GetEnd`,
  `GetUniqueId` and `GetFusionCompCount`. If T5 found none, try `timeline:InsertFusionTitleIntoTimeline("Text+")`
  instead and record the result.
- **T7 inputs**: on that clip, `comp = item:GetFusionCompByIndex(1)` and
  `tool = comp:FindToolByID("TextPlus")`. If that returns nil, list all tools via
  `comp:GetToolList(false)` with their `GetAttrs().TOOLS_RegID`. Dump **every input**: for each value in
  `tool:GetInputList()`, the `GetAttrs()` fields `INPS_ID`, `INPS_Name`, `INPS_DataType`, and the current value
  from `tool:GetInput(id)` (tables serialised shallowly). This is the ground truth for input IDs.
- **T8 comp time**: record `comp:GetAttrs()` fields `COMPN_GlobalStart`, `COMPN_GlobalEnd`, `COMPN_RenderStart`,
  `COMPN_RenderEnd` and `COMPN_CurrentTime`. This tells whether frame 0 is the clip's first frame.
- **T9 style**: set `StyledText` to `"മലയാളം ക്യാപ്ഷൻ Caption ശ്രീ"` (mixed Malayalam and English, with
  conjuncts). Set `Font` to `"Noto Sans Malayalam"` (if that isn't installed, `"Manjari"`; record which one),
  `Style` to `"Bold"`, `Size` 0.08, fill `Red1=1, Green1=0.84, Blue1=0` (gold), outline `Enabled2=1` with black,
  `Center={0.5,0.2}`. Record each `SetInput` return value, and read each input back.
- **T10 keyframes**: inside `comp:Lock()` … `comp:Unlock()`: `tool.WriteOnEnd = comp:BezierSpline()`, then
  `tool.WriteOnEnd[0] = 0`, `tool.WriteOnEnd[24] = 1`. Read back `tool:GetInput("WriteOnEnd", 12)`. Wrap the
  whole block in `pcall`, and record the exact error text if it fails.
- **T11 CLS read**: look for a **second** spike clip that the user styled by hand (see SPIKE.md step 4): the
  first clip on track 2 of the spike timeline. If none exists, record INFO "skipped". Dump every tool in its comp
  and every input of any tool whose RegID contains `CLS` or `Styled`, with full table serialisation (recursive,
  depth 6). This reveals the Character Level Styling data format and whether its character indices are code
  points, UTF-8 bytes or graphemes.
- **T12 tagging**: `comp:SetData("KathaCut.cueId", "cue-123")`, then `comp:GetData("KathaCut.cueId")`. Also
  `item:SetClipColor("Teal")` / `GetClipColor()` and `item:GetName()`.
- **T13 bulk speed**: if T6 worked, append 100 clips in **one** `AppendToTimeline` call (each 24 frames, 2-frame
  gaps, track 1, starting after the first clip). Time it with `os.clock()`. Then set `StyledText` on all 100 and
  time that too. Record both durations.
- **T14 still**: move the playhead onto the T9 clip (`timeline:SetCurrentTimecode`, computed from the start
  frame; record the timecode string used). Call `project:ExportCurrentFrameAsStill(<temp>/kathacut-spike-still.png)`
  and record the return value. (Resolve must be on the Edit or Color page for stills; print a hint.)
- **T15 render**: **only if the user set `RUN_RENDER = true` at the top of the script** (default false). Render the
  spike timeline's first 5 s as mp4/H264 at 1280×720 (or 720×1280 for vertical) with audio, to
  `<temp>/kathacut-spike-proxy`. Use the README's render calls, with `MarkIn`/`MarkOut` limited to 5 s. Poll
  every 0.5 s with `bmd.wait`, record the job status, duration and output path, then `DeleteRenderJob`. Record
  whether `LoadRenderPreset`, `SetCurrentRenderMode` and `SetCurrentRenderFormatAndCodec` return true, plus
  `project:GetRenderFormats()` and `project:GetRenderCodecs("mp4")`.
- **Cleanup**: leave the spike timeline in place, so the user can look at it and delete it. Restore the
  previously current timeline. Print "Done, report at <path>".

Coding notes:
- Resolve's Lua is 5.1 (no `goto` if not LuaJIT; no integer division `//`; use `math.floor`).
- `tool:GetInput(id)` returns Fusion points and colours as tables; serialise with a small recursive function that
  guards against cycles.
- Keep it one file, under ~500 lines, and comment each test with its ID.

## SPIKE.md contents (for the user)
1. Copy `resources/resolve/dev/spike.lua` to the Resolve Scripts folder:
   - Windows: `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility\`
   - macOS: `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/`
2. Open a **throwaway** Resolve project with a short timeline that has audio.
3. Make the template: on any timeline, add Effects → Titles → **Text+**, drag that clip from the timeline into
   the Media Pool, and put it in a new bin named **`KathaCut`**. (If Resolve won't let you drag a title into the
   Media Pool, note that. The script then falls back to `InsertFusionTitleIntoTimeline`.)
4. After a first run (which creates the `KathaCut spike …` timeline), style the first Malayalam word of a Text+
   clip placed on **video track 2** of that spike timeline **by hand**. In the Inspector, use Text+ → Character
   Level Styling (select the characters in the viewer with the text tool) and make that word red. Then run the
   script again, so T11 can read the format back.
5. Run from **Workspace → Scripts → spike**. Open Workspace → Console to watch the output.
6. Send back:
   - the report file (`%TEMP%\kathacut-resolve-spike.txt`, or `$TMPDIR` on macOS)
   - `kathacut-spike-still.png`
   - a screenshot of the Malayalam Text+ clip in the viewer, stating whether the Malayalam text is shaped correctly
     (conjuncts joined, vowel signs in the right place, not dotted circles)
   - whether Resolve stayed responsive during T4
   - Resolve edition and version, and your OS
7. Copy the report into `docs/decisions/evidence/resolve-spike-<date>.txt`, and the still and screenshot next to
   it, then start brief 02.

## Out of scope
Any app code, the bridge, packaging and installation.

## Done checklist
- [ ] `resources/resolve/dev/spike.lua` and `SPIKE.md` exist.
- [ ] The script only creates and modifies its own spike timeline. It never deletes anything, and renders only
      when `RUN_RENDER = true`.
- [ ] `npx tsc --noEmit -p .` still passes (no TS changes expected).
- [ ] `docs/STATUS.md` entry: "Resolve spike script written; awaiting user run. Not tested (needs Resolve)."
- [ ] Commit only these files: `Add DaVinci Resolve spike script`.
