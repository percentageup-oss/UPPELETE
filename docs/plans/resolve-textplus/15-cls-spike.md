# 15 — Spike 4: Character Level Styling (CLS)

## Goal
Emphasis, and active-word highlight / word pop in full-line display, don't reach Resolve. `planTextPlus`
(`src/resolve/textPlusPlan.ts`) reports them as `not-sent`, and `styleRanges` is always `[]`. They need Text+
**Character Level Styling**: styling a character range inside one Text+ clip. Nobody knows how Resolve stores that.
Spike 1 (T11) and spike 2 (E10) both returned **no data**, because the hand-styled clip they depended on was never
prepared (ADR 0008 "Character Level Styling (T11)", ADR 0009 L102).

This spike must produce data **even if the user skips the hand prep**. It adds a CLS modifier to its **own**
scratch clip and dumps it. The hand-styled clip is a second source, found by scanning, not by name.

This session writes the script and its instructions, then stops. A findings session (brief 16) turns the user's
report into ADR 0011. Briefs 17 (emphasis) and 18 (full-line word motion) build on that ADR.

Read `docs/plans/resolve-textplus/README.md` ("Testing override", "Architecture") and
`docs/decisions/0008-resolve-textplus.md` ("Text+ input IDs", "Character Level Styling (T11)") first.

## Read only
- `resources/resolve/dev/edit-spike.lua`: reuse its structure, not its code paths. Specifically `log`/`record`,
  `serialize`, the `test(id, fn)` `pcall` wrapper, the scratch timeline (`mediaPool:CreateEmptyTimeline`, ~L477),
  and still export (`SetCurrentTimecode` + `project:ExportCurrentFrameAsStill`, ~L696-704). Its E10 (~L738-805)
  is the earlier CLS attempt; it read `tool:GetInput("StyledTextCLS")`, which is probably the wrong place. Don't
  edit it.
- `resources/resolve/dev/SPIKE2.md`: the "copy into Scripts/Utility and run" instructions to mirror.
- `resources/resolve/bridge.lua`: `textPlusTool(item)`, `applyKeyframe`, `applySpec` (how Text+ is written today).
- `src/resolve/charUnits.ts`: the `CharUnit` candidates and `offsetInUnit`.

## Background (unverified; the dump is ground truth)
In Fusion, CLS is a **modifier** connected to the Text+ `StyledText` input. In `.setting` files it looks roughly
like this:
```
Template = TextPlus { Inputs = { StyledText = Input { SourceOp = "CharacterLevelStyling1", Source = "StyledText" }, … } },
CharacterLevelStyling1 = StyledTextCLS { Inputs = {
  CharacterLevelStyling = Input { Value = StyledText { Array = { { <propId>, <start>, <end>, Value = <v> }, … }, Value = "" } },
  Text = Input { Value = "…" } } }
```
In the UI, it's the Fusion page: right-click the Text+ **Styled Text** field → **Character Level Styling**. Then,
with the Text+ selected, drag across characters in the viewer, and change them in the Inspector's **Modifiers**
tab.

## Steps
1. **`resources/resolve/dev/cls-spike.lua`** (new; `dev/` isn't packaged). A menu script with `Resolve()`/`bmd`
   as its own globals. Log one `ID key=value …` line per fact to the console **and** to
   `<temp>/kathacut-cls-spike.txt`. Wrap every test in `pcall`; log `missing` for an absent method. It creates
   and edits only its **own** timeline, `KathaCut CLS spike <time>`, and never touches existing items.
   - **S0:** log product and version (`resolve:GetProductName()`, `resolve:GetVersionString()`).
   - **R0 (no hand prep needed):** on the scratch timeline, `InsertFusionTitleIntoTimeline("Text+")`. Set `Font`
     to `Anek Malayalam`, and set `StyledText` to the **test string** below. Then try each of these, logging the
     result:
     a. `comp:AddTool("StyledTextCLS")`, and dump its `GetInputList()` (ID, name, `INPIDT_DataType`, default
        value via `GetInput`);
     b. connect it: `tool.StyledText:ConnectTo(mod.StyledText)`, `tool:ConnectInput("StyledText", mod)`, or
        `mod.Text` ← the text. Log which call succeeded and what `tool.StyledText:GetConnectedOutput()` returns;
     c. `serialize(comp:CopySettings(), 8)` and `bmd.writestring(comp:CopySettings())` → write the full text to
        `<temp>/kathacut-cls-R0.setting`.
   - **R1 (hand-styled clip, optional):** scan **every** video track of the timeline that was current when the
     script started. For each Text+ whose `StyledText` input has a connected output, dump the modifier's tool
     ID, every input's value (depth 8), and `bmd.writestring(comp:CopySettings())` to
     `<temp>/kathacut-cls-R1-<n>.setting`. Stop after 5 clips. If there are none, log `INFO R1 skipped`.
   - **R2 (unit):** for the test string, print each marked word's `[start, end)` in **UTF-16 units, code points,
     UTF-8 bytes and graphemes**. For graphemes, count Malayalam clusters: a consonant plus any virama +
     consonant chains, followed by vowel signs, virama, anusvara or chillu. Hard-code the expected grapheme
     offsets, computed by the session with `graphemes()` from `src/core/captionText.ts`. The findings session
     compares these with R1's start/end values.
   - **W1 (write):** on a second scratch clip, write a CLS range with **each** method that R0 showed exists,
     taking the property ids from R1 if present, otherwise from R0's defaults. Colour `ആൾട്ട്മാൻ` red and set
     `Sam` to 150 % size. Methods:
     (a) edit R0's `CopySettings()` table and `comp:Paste()` it back;
     (b) `mod:SetInput("CharacterLevelStyling", <table>)` with a Lua table shaped like the dump.
     Read back with `GetInput` and export a still (`<temp>/kathacut-cls-W1<a|b>.png`).
   - **W2 (clear):** on the W1 clip, remove the styling: disconnect the modifier (`tool.StyledText` back to a
     plain value), or set an empty `Array`. Read back, export a still, and confirm the text still reads
     correctly.
   - **W3 (keyframe):** on a third scratch clip, try to animate the CLS value. Attach `comp:BezierSpline()` (or
     the step-spline type the dump shows) to the CLS input, and set styling A (word 1 red) at frame 0 and B
     (word 2 red) at frame 10. Export stills at frames 5 and 15. Log whether the two stills differ in the
     expected way. The user confirms by eye.
   - **W4 (timing):** apply the W1 method to 50 fresh scratch Text+ clips. Log the `os.clock()` CPU time.
   - Print `DONE` and the output folder.
   - **Test string** (also typed by the user in R1): `പ്രൈം മിനിസ്റ്റർ Sam ആൾട്ട്മാൻ` + newline +
     `വിളിച്ചിട്ട് പറഞ്ഞത്`. Marked words: `Sam`, `ആൾട്ട്മാൻ` (after conjuncts), `പറഞ്ഞത്` (after the line
     break).
2. **`resources/resolve/dev/SPIKE4.md`** (new): step-by-step for the user.
   - Copy the script into Resolve's Scripts → Utility folder (as `SPIKE2.md` says).
   - **Optional hand prep (strongly recommended; it's the only way to see how Resolve itself stores CLS):** on the
     current timeline's V2, add a Text+ and set the font to Anek Malayalam. Paste the test string. On the
     Fusion page, enable Character Level Styling (see Background), then style: `ആൾട്ട്മാൻ` red at 150 % size;
     `Sam` underlined; `പറഞ്ഞത്` in a different font weight. Screenshots of each step go into the doc. Write
     down exactly which characters each style covers.
   - Run from Workspace → Scripts with the console open.
   - **Send back:** `kathacut-cls-spike.txt`, every `.setting` and `.png` in the temp folder, a screenshot of the
     hand-styled clip, and the notes. Say which W3 still looked like what.
3. **Commit** only the two new files: `Add Resolve Character Level Styling spike (brief 15)`. Add a
   `docs/STATUS.md` entry: "not tested, typecheck only; the user runs the spike".

## Out of scope
Any change to `bridge.lua`, the planner or the app. The findings and ADR (brief 16).

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes (nothing in TS should change).
- [ ] The script writes only to its own scratch timeline and the temp folder; every test is `pcall`-wrapped.
- [ ] R0 runs with no hand prep.
- [ ] `docs/STATUS.md` entry.
