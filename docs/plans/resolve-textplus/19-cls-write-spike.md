# 19 — Spike 5: Character Level Styling write method

## Goal
`docs/decisions/0011-resolve-character-level-styling.md` confirmed the CLS data shape, the property ids for
colour/size/underline/style, and the counting unit (0-based code points, end inclusive), from a hand-styled clip.
But **every write brief 15 tried used the old guessed ids, shape and unit** (byte offsets, `Red1`/`Size` names, a
plain Lua table), so none of them tested whether a script can actually write CLS at all. ADR 0011 says: "Briefs 17
and 18 need one more short write spike before they can send anything."

This spike writes CLS using ADR 0011's **confirmed** shape and ids, tries the three methods the ADR lists, and
re-measures keyframing and timing once (if) one works. This session writes the script and its instructions, then
stops. The user runs it and reports back; update ADR 0011's "Write method" section with the result (append, don't
rewrite the confirmed sections above it), and only then do briefs 17 and 18 unblock.

Read `docs/decisions/0011-resolve-character-level-styling.md` in full first, especially "Data shape", "Property
ids", "Counting unit" and "Write method: not confirmed" (its numbered "Next to try" list is exactly what this
spike implements). Read `docs/plans/resolve-textplus/README.md` ("Testing override", "Architecture") too.

## Read only
- `resources/resolve/dev/cls-spike.lua`: reuse its structure (`log`/`record`, `serialize`, `test(id, fn)`,
  `tryCall`, the scratch-timeline setup, `textPlusTool`, `findModifierTool`, `tryConnect`, the still-export
  helpers, `utf8Length`/`codepointOffsetAtByte`, `TEST_STRING`/`MARKED_WORDS`). Don't edit it.
- `docs/decisions/evidence/resolve-cls-spike-2026-09-28-R1-1.setting`: the exact `.setting` text shape to build a
  parseable snippet from (the `{ Tools = ordered() { ... } }` wrapper, `Input { Value = ... }`, `StyledText {
  Array = {...}, Value = "" }`).

## Background (from ADR 0011; don't re-derive)
- Shape: a `StyledTextCLS` tool (`CharacterLevelStyling1`) feeds the Text+ tool's `StyledText` input. Its own
  `CharacterLevelStyling` input holds a `StyledText { Array = { {propId, start, end, Value=...|String=...}, ... },
  Value = "" }` value.
- Confirmed property ids: `2401`/`2402`/`2403` = fill R/G/B (0-1, omit for 0); `102` = size, **absolute** in the
  Text+ `Size` unit (not a multiplier); `105` = underline on/off; `109` = font style name (`String`). `2404`
  (alpha) is a guess.
- Unit: 0-based Unicode **code points**, `end` **inclusive**. `\n` counting is no data; the test string below has
  no line break in it for this reason (keep it that way unless testing that specifically).
- `GetInput("CharacterLevelStyling")` returns `""` even when styling is present. **Verify with
  `comp:CopySettings()` + `bmd.writestring`, never `GetInput`.**
- The three untried write methods, in order: (1) `comp:Paste()` of a parsed `StyledTextCLS` tool block; (2)
  `mod:LoadSettings(...)` with a parsed tool-settings table; (3) `mod:SetInput("CharacterLevelStyling",
  parsedValue)` with a parsed `StyledText{...}` value. All three need the value built **from a `.setting` string
  via `bmd.readstring`**, not a plain Lua table (brief 15's W1b passed a plain table and nothing applied).

## Steps
1. **`resources/resolve/dev/cls-write-spike.lua`** (new; `dev/` isn't packaged). Menu script, `Resolve()`/`bmd`
   own globals, same report format as `cls-spike.lua` (console + `<temp>/kathacut-cls-write-spike.txt`). Creates
   and edits only its own scratch timeline (`KathaCut CLS write spike <time>`).
   - **S0:** product and version.
   - **Test data:** reuse `TEST_STRING`/`MARKED_WORDS` from `cls-spike.lua`, but compute each marked word's
     **0-based code-point, end-inclusive** range (not UTF-8 bytes): `[codepointOffsetAtByte(s, byteStart),
     codepointOffsetAtByte(s, byteEnd) - 1]`.
   - **Build one parsed snippet.** Format a `.setting`-shaped string with `ആൾട്ട്മാൻ` red (ids `2401`-`2403`) and
     `Sam` at absolute size `0.08` (id `102`), using the real Text+ tool's own `Size` input as the base if easy to
     read, otherwise hard-code `0.08` and note that it assumes the same base size as ADR 0011's sample clip.
     Parse it once with `bmd.readstring(text)`; log `serialize(parsed, 8)` and whether the call errored. If
     `bmd.readstring` is missing or errors, log `FAIL` for every method below (they all depend on it) and stop
     this script's write attempts, still running S0-only.
   - **Attempt 1 — Paste** (new scratch clip A): `InsertFusionTitleIntoTimeline("Text+")`, set `Font`/`StyledText`
     as before. `compA:Paste(parsed)` (the whole parsed table, matching how `CopySettings()`/`Paste()` round-trip
     in brief 15's W1a). Then find the modifier with `findModifierTool` and connect it with `tryConnect`. Dump
     `compA:CopySettings()` via `bmd.writestring` to `<temp>/kathacut-cls-write-A.setting` and export a still to
     `<temp>/kathacut-cls-write-A.png`.
   - **Attempt 2 — LoadSettings** (new scratch clip B): same setup, but this time create the modifier the known
     way (`compB:AddTool("StyledTextCLS")`, `tryConnect`), then call `modB:LoadSettings(parsed.Tools
     .CharacterLevelStyling1)` (the inner tool-settings table, no outer `Tools=` wrapper). Dump and export the
     same way (`kathacut-cls-write-B.setting` / `.png`).
   - **Attempt 3 — SetInput** (new scratch clip C): same setup as attempt 2, but call `modC:SetInput(
     "CharacterLevelStyling", parsed.Tools.CharacterLevelStyling1.Inputs.CharacterLevelStyling.Value)` (just the
     parsed `StyledText{...}` value). Dump and export (`kathacut-cls-write-C.setting` / `.png`).
   - **Auto-check (a hint only, not proof):** for each dump, log whether the written text contains `"2401"` and
     does **not** contain an empty `Array = {}`, as `INFO <id>-hint`. The user's still and their read of the
     `.setting` file are what actually confirm it, per the ADR's `GetInput` warning above.
   - **Clear retry (W2):** on whichever of A/B/C's dump shows real `2401`/`102` entries (first one found, in
     A/B/C order), set its `StyledText` input back to a plain value (disconnect) and export a still
     (`kathacut-cls-write-clear.png`). If none show real entries, log `INFO W2 skipped: no working write method`.
   - **Keyframe retry (W3):** only if attempt 3 (SetInput) produced real entries — keyframing needs a bare value
     per frame, which is what SetInput uses. New scratch clip D, same setup, `comp:Lock()`, `mod.
     CharacterLevelStyling = comp:BezierSpline()`, `mod.CharacterLevelStyling[0] = <Sam-styled parsed value>`,
     `mod.CharacterLevelStyling[10] = <ആൾട്ട്മാൻ-styled parsed value>`, `comp:Unlock()`. Export stills at frames 5
     and 15 (`kathacut-cls-write-D-frame5.png` / `-frame15.png`). Otherwise log `INFO W3 skipped`.
   - **Timing retry (W4):** only if a method worked — repeat it on 50 fresh scratch clips, log `os.clock()` CPU
     time, same as brief 15's W4.
   - Print `DONE` and the output folder.
2. **`resources/resolve/dev/SPIKE5.md`** (new): install/run/send-back instructions, mirroring `SPIKE4.md`. No hand
   prep needed this time — everything runs on the script's own scratch clips. Ask the user to say, for each of
   the three `.setting` files, whether the still shows `ആൾട്ട്മാൻ` red and `Sam` visibly larger, and for the W3
   stills, which word is red in each.
3. Update `docs/plans/resolve-textplus/README.md`: add row 19 to the table (depends on 16, before 17), and one
   sentence in the "Emphasis and per-word styling" section: run order is now 15 → (user) → 16 → 19 → (user) → ADR
   0011 update → 17 → 18.
4. **Commit** only the new files plus the README edit: `Add Resolve Character Level Styling write-method spike
   (brief 19)`. `docs/STATUS.md` entry: "not tested, typecheck only; the user runs the spike".

## Out of scope
Any change to `bridge.lua`, the planner, ADR 0011's confirmed sections, or briefs 17/18. Updating ADR 0011 with
the result is a separate, short findings step after the user's report (extend ADR 0011's "Write method" section;
don't renumber it).

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes (nothing in TS changes).
- [ ] The script writes only to its own scratch timeline and the temp folder; every test is `pcall`-wrapped.
- [ ] Every offset the script writes is 0-based code points, end inclusive, computed from `MARKED_WORDS`, never
      UTF-8 bytes.
- [ ] `docs/STATUS.md` entry.
