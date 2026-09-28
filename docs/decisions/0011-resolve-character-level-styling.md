# ADR 0011 — Resolve Character Level Styling (CLS) spike findings

Date: 2026-09-28. Status: **Unblocked for brief 17.** The data shape, the property ids for colour, size,
underline and style, and the counting unit are **confirmed** from a hand-styled clip. A working script **write**
is confirmed by brief 19 run 2: export the clip's Fusion comp, add the CLS tool in the file, and import it again
(method D, below). Keyframing is still **no data**, so brief 18 uses split clips.

Source: two runs of `resources/resolve/dev/cls-spike.lua` (brief 15) in **DaVinci Resolve Studio 21.0.0.47 on
Windows**.
- Run 1 had no hand prep: `evidence/resolve-cls-spike-2026-09-28.txt` and `…-R0.setting`.
- Run 2 had a hand-styled Text+ on V3 of Timeline 1: `evidence/resolve-cls-spike-2026-09-28-run2.txt` and
  `…-R1-1.setting`.

Stills (`kathacut-cls-W1b/W2/W3-frame5/W3-frame15.png`, 6,232,017 bytes each) are over the 2 MB evidence
limit and weren't copied. In both runs, all four show the same plain white caption with no styling.

## Data shape (confirmed, R1-1.setting)

The CLS modifier is a separate tool feeding the Text+ `StyledText` input. The styled ranges live in the
modifier's `CharacterLevelStyling` input, as a `StyledText` value:

```lua
Template = TextPlus { Inputs = {
  StyledText = Input { Source = "StyledText", SourceOp = "CharacterLevelStyling1" },
  Font = Input { Value = "Anek Malayalam" }, Style = Input { Value = "Bold" }, Size = Input { Value = 0.0411522633744856 }, … } },
CharacterLevelStyling1 = StyledTextCLS { Inputs = {
  CharacterLevelStyling = Input { Value = StyledText {
    Array = {
      { 2401, 21, 31, Value = 1 },          -- red   = 1
      { 2402, 21, 31 },                     -- green = 0 (Value omitted)
      { 2403, 21, 31 },                     -- blue  = 0 (Value omitted)
      { 102, 21, 31, Value = 0.08 },        -- size (absolute)
      { 1002, 1, 17 }, { 1002, 18, 18 }, { 1002, 19, 19 },   -- unknown, see below
      { 105, 17, 19, Value = 1 },           -- underline on
      { 109, 55, 60, String = "Bold" },     -- font style
    },
    Value = "" } },
  Text = Input { Value = "പ്രൈം മിനിസ്റ്റർ Sam ആൾട്ട്മാനെ ഡയറക്റ്റ് വിളിച്ചിട്ട് പറഞ്ഞത്" },
  TransformRotation = Input { Value = 1 }, Softness = Input { Value = 1 } } },
```

- Each entry is `{ propId, start, end, Value = number }` or `{ propId, start, end, String = string }`. A
  numeric entry with no `Value` means **0**: red is `2401 = 1` with `2402` and `2403` present but valueless.
  That gives (1, 0, 0), which is the red the user applied. Alpha (`2404`) isn't listed, so it stays at its
  default.
- The ranges sit on the modifier. The Text+ tool's own inputs (`Font`, `Style`, `Size`, …) hold the base style
  that the ranges override.
- The Text+ `StyledText` input is linked with `SourceOp = "CharacterLevelStyling1", Source = "StyledText"`. That
  is the same link `tool.StyledText:ConnectTo(mod.StyledText)` makes (`PASS R0b`).

## Reading CLS back (confirmed)

**`GetInput("CharacterLevelStyling")` returns `""` even on the hand-styled clip.** In run 2's `R1-1` line,
`modifierInputs` shows `CharacterLevelStyling=""` while the `.setting` holds nine ranges. The scripting bridge
doesn't pass `StyledText` values through `GetInput`. So:
- Read CLS only via `comp:CopySettings()` (+ `bmd.writestring`), never `GetInput`.
- Run 1's empty `W1b-readback` doesn't prove the write failed. Only the unchanged stills do.
- `comp:CopySettings()` with no argument dumped only the selected tool in R0 (the new modifier). In R1 it
  dumped both tools. Pass the tools explicitly, or select them first, when a full dump is needed.

## Property ids (confirmed from the hand-styled ranges)

Numeric ids, not input names. That explains why run 1's writes did nothing: they used `Red1`, `Size`, and so on.

| id | Meaning | Value | Evidence |
|----|---------|-------|----------|
| 2401 / 2402 / 2403 | Fill colour R / G / B (0-1) | `Value`, omitted = 0 | red on ആൾട്ട്മാനെ |
| 2404 | Fill alpha (**guess**, by sequence) | — | not in the dump |
| 102 | Size, absolute in the Text+ `Size` unit (base 0.0412 → 0.08 here) | `Value` | same range as red |
| 105 | Underline on/off | `Value = 1` | exactly `Sam` |
| 109 | Font style name | `String = "Bold"` | on പറഞ്ഞത് |
| 1002 | **Unknown.** Valueless (0), covering characters 1-17, 18 and 19 | — | not asked for in the hand prep; see "Open questions" |

Emphasis scale therefore goes in as `102` = `baseSize × emphasisScale`. It's absolute, not a multiplier.

## Counting unit (confirmed): 0-based code points, end inclusive

In the hand-styled text, `Sam` is code points 17, 18 and 19 (0-based). Range `105` is `{17, 19}`. The other
units put `Sam` somewhere else: UTF-8 bytes at 47-49, graphemes at 7-9. The 1-based alternative, `{18, 20}`,
isn't what Resolve wrote. So:

- **Unit: Unicode code points.** UTF-16 is identical here because Malayalam is all in the BMP. The two differ
  only for astral characters (emoji), which no range in this run covered. KathaCut should count code points,
  i.e. iterate with `[...text]`, not `.length`.
- **Start is 0-based and `end` is inclusive.** `{17, 19}` = "Sam" exactly.
- `\n` wasn't in the hand-styled string (the user typed it on one line), so how a newline counts is **no data**.
  It's most likely one code point. Brief 17 must strip or handle this before relying on it for multi-line cues.

The other two ranges fit the same rule, but each is slightly off the word itself:
- `{21, 31}` = `ആൾട്ട്മാനെ` (21-30) **plus the following space** (31).
- `{55, 60}` = `പറഞ്ഞത` without the final virama `്` (61). That ends inside the grapheme `ത്`.

Both look like where the user's drag in the viewer started and ended, not a different counting rule. It needs
the user's confirmation (open questions).

## Grapheme safety

KathaCut computes ranges from grapheme and word boundaries and converts them to code-point offsets, so it never
sends a boundary inside a cluster (AGENTS.md). Resolve itself will accept a range that ends mid-cluster (the
`{55, 60}` range above). The bold rendering of that word hasn't been checked in a still yet. KathaCut must not
rely on Resolve to fix bad boundaries.

## Write method: not confirmed

- W1a (`Paste` of an edited `CopySettings()` table) was skipped in both runs, because R0's dump had no
  `CharacterLevelStyling` key yet.
- W1b (`mod:SetInput("CharacterLevelStyling", { Array = …, Value = "" })`) returned `ok=true`, but the still
  was unchanged in both runs. It used the wrong ids (`Red1`…/`Size`), UTF-8 byte offsets and an exclusive end.
  It also passed a plain Lua table, not a `StyledText` value, and `SetInput` may not accept one at all.
- **Next to try** (a small follow-up spike): build the value from a `.setting` string with `bmd.readstring`, so
  it carries the `StyledText` constructor. Then try, in order:
  1. `comp:Paste()` of a `StyledTextCLS` tool block, then connect it;
  2. `mod:LoadSettings(...)`;
  3. `mod:SetInput("CharacterLevelStyling", parsedValue)`.

  Verify with `CopySettings` and a still, not `GetInput`.

### Write spike result (brief 19, 2026-09-28): all three methods failed

Source: `cls-write-spike.lua`, Resolve Studio 21.0.0.47, Windows
(`evidence/resolve-cls-write-spike-2026-09-28.txt`, `…-A/B/C.setting`). The three stills (6,232,017 bytes each,
not copied) all show the same plain white caption. Nothing is red or bigger. The ranges used the confirmed unit:
`ആൾട്ട്മാൻ` = `{21, 29}` and `Sam` = `{17, 19}` (`PARSE-snippet`).

- **`bmd.readstring` works (confirmed).** It returns plain tables tagged with `__ctor = "StyledTextCLS"`,
  `"Input"` and `"StyledText"`, plus `__flags` (`PASS PARSE`). So the constructor is kept as data. It isn't a
  live object.
- **Paste (A): failed (confirmed).** `comp:Paste(parsed)` returned `false`, and no modifier tool existed
  afterwards (`A-paste-connect skipped`). The A dump is empty because `CopySettings()` with no argument copies only
  the selected tools, and nothing was selected. The still and the missing tool are the evidence.
- **LoadSettings with a table (B): failed (confirmed).** `mod:LoadSettings(parsed.Tools.CharacterLevelStyling1)`
  returned `false`. The B dump has the connected modifier with `Text`, `Softness` and `TransformRotation`, but no
  `CharacterLevelStyling` input.
- **SetInput with the parsed value (C): failed (confirmed).** `mod:SetInput("CharacterLevelStyling", value)`
  returned `nil` without an error. The C dump is the same as B's, with no `CharacterLevelStyling`. This dump is
  valid evidence: the R1-1 dump shows that a `CopySettings()` of a styled modifier does include that input.
- Connecting is still confirmed (`tool.StyledText:ConnectTo(mod.StyledText) ok=true`, B and C).
- W2, W3 and W4 were skipped, so clear, keyframing and timing are still **no data**.

**Conclusion:** a `StyledText` value can't be pushed into a live tool through `SetInput`, `LoadSettings(table)`
or `Paste(table)`. The next candidates go through a **file** that Resolve parses itself, just as the hand-styled
clip was stored:
1. `item:ExportFusionComp(path, 1)`, then add the `CharacterLevelStyling1` tool to the exported comp and link
   `StyledText` to it, then `item:ImportFusionComp(path)` and `item:LoadFusionCompByName(name)`.
2. `mod:SaveSettings(path)`, then add the `CharacterLevelStyling` input to that file, then
   `mod:LoadSettings(path)` (a path, not a table).

Verify with `ExportFusionComp`, which dumps the whole comp whatever is selected, and a still. `cls-write-spike.lua`
run 2 tries both (attempts D and E).

### Write spike run 2 (brief 19, 2026-09-28): comp file round trip works

Source: `evidence/resolve-cls-write-spike-2026-09-28-run2.txt`, `…-run2-D.comp` (the file imported),
`…-run2-D-after.comp` (the comp read back), `…-run2-E.setting` and `…-run2-E-after.comp`. Local paths in the
`.comp` files are redacted. Stills weren't copied (6.2 MB each). Session checked them by eye. A-C failed again,
as in run 1.

**D, the working write method (confirmed).**
1. `item:ExportFusionComp(path, 1)` writes the clip's comp, with the `Template` TextPlus and `MediaOut1`.
2. Parse it with `bmd.readstring`. Add `Tools.CharacterLevelStyling1 = StyledTextCLS { Inputs = {
   CharacterLevelStyling = Input { Value = StyledText { Array = …, Value = "" } }, Text = Input { Value = <text> }
   } }`. Replace the Template's `StyledText` input with `Input { SourceOp = "CharacterLevelStyling1", Source =
   "StyledText" }`. Write it back with `bmd.writestring`.
3. `item:ImportFusionComp(path)` returns a `Composition` object.

The read-back `D-after.comp` holds the four ranges exactly as written (`{2401, 21, 29, Value = 1}`, `2402`,
`2403`, `{102, 17, 19, Value = 0.08}`) and the link. The still `kathacut-cls-write-D.png` shows **`ആൾട്ട്മാൻ`
red with its conjuncts shaped correctly**, and `Sam` visibly **smaller**. The clip's base `Size` was 0.09, so 0.08
shrinks it (`Sam` is ~157 px wide against ~175 px in the plain stills, ≈ 0.89 ≈ 0.08 / 0.09). This confirms that
`102` is an **absolute** size, not a multiplier. Every other Template input in the exported file survives the
round trip (`Font`, `Style`, `Size`, justification).

Details of D that need handling in the bridge:
- After the import, `GetFusionCompNameList()` returned only `{ "Composition 1" }` and `GetFusionCompCount()`
  returned 1, yet the imported (styled) comp is what renders. So on a Text+ title, the import appears to
  **replace** the comp rather than add one (**guess**; the name list may be stale). The spike's
  `LoadFusionCompByName` call was passed the list's `__flags` number by mistake (`LoadFusionCompByName(4194304)
  → nil`), so it did nothing. The styling rendered without it. The bridge should skip non-string entries in the
  name list, load the newest comp by name if there is more than one, and delete older KathaCut comps
  (`DeleteFusionCompByName`) so repeated syncs don't pile comps up on the clip.
- `comp:SetData(...)` tags set before the import may not survive. The tag has to be written on the comp that
  `ImportFusionComp` returns.
- The file is written to disk and read back by Resolve. Write it under KathaCut's own cache or temp directory,
  never next to the user's media.

**E, `SaveSettings` → edit → `LoadSettings(path)`: failed (confirmed).** `LoadSettings(path)` returned `true`,
and the file had the ranges (`…-run2-E.setting`). But `E-after.comp` has the connected modifier with **no**
`CharacterLevelStyling` input, and the still is plain. `LoadSettings` drops the value, as `SetInput` does.

## Clear method (W2)

Partly confirmed: setting `StyledText` to a plain value and emptying the array both return `ok=true`, and the
text still reads correctly. Whether this removes real styling is unconfirmed, because no write ever applied
any. The simplest clear is likely to delete the modifier tool, or not create one for clips without emphasis.

**Run 2 update:** `tool:SetInput("StyledText", <plain text>)` on the D clip's Text+ tool returned `ok=true`,
but the clear still (`kathacut-cls-write-clear.png`) is **still styled**, so it does **not** clear (confirmed).
It's possible that the tool handle from `ImportFusionComp`'s returned comp isn't the live one. Either way,
`SetInput` isn't a usable clear. The clear to use is the same round trip as the write: export the comp, remove
`CharacterLevelStyling1` and put back `StyledText = Input { Value = <text> }`, then import. That is **guess**
(untested), but it only uses calls D confirmed.

## Keyframing (W3)

No data. W3 used the same broken write. Brief 18 stays on the user's fallback, **split clips** (one clip per
word step with the full line text), unless the follow-up spike shows an animated CLS value changing between
two stills.

## Timing (W4)

~500 ms of CPU time per clip for insert + AddTool + connect + SetInput (`cpuSeconds=25.003` and `24.995` for
50 clips). That's far over the ~2 s budget for one command at `INSERT_BATCH` (50) or `UPDATE_BATCH` (20). Bulk
CLS writes must use start + poll. Re-measure once the real write method is known.

**Run 2 (method D):** `cpuSeconds=24.937` for 50 clips, each doing insert + `ExportFusionComp` + parse/edit +
`ImportFusionComp`. That's the same ~500 ms per clip. The insert seems to dominate, and the file round trip adds
little. This is `os.clock()` CPU time, not wall time, which includes disk I/O. So a styled clip costs ≈ 0.5 s or
more. Brief 17 should run the CLS round trip for **at most 3 clips per bridge command** (≈ 1.5 s), or run it as a
start + poll command. Keep `UPDATE_BATCH`/`INSERT_BATCH` as they are for clips with no styling (**guess**; measure
wall time in the real sync).

## Consequences for 17/18

- 17: CLS entries are `{ id, cpStart, cpEndInclusive, Value | String }` with the ids above. Emphasis colour =
  2401-2403, scale = 102 (absolute) and underline = 105. Word ranges come from grapheme/word boundaries,
  converted to code points. Write with **method D**: `ExportFusionComp` → add the CLS tool and link →
  `ImportFusionComp`. Clear by the same round trip without the tool. `SetInput`, `LoadSettings` (table or path)
  and `Paste` don't work. Size `102` = `baseSize × emphasisScale`, absolute. Re-tag the imported comp.
- 18: **split clips** (the user's fallback). Keyframed CLS is still no data, since W3 never ran with a working
  write.
- Both: at most ~3 styled clips per bridge command, or start + poll.

## Open questions (for the user)

1. On `ആൾട്ട്മാനെ`, did your red/size selection include the space after the word?
2. On `പറഞ്ഞത്`, did Bold look like it covered the whole word, including the final ്?
3. What size did you set on the red word? The dump says 0.08, about 194 % of the base 0.0412.
4. Did you do anything to the first 20 characters besides underlining `Sam`, such as click, drag or touch
   another setting? That would explain id `1002`.

## Unconfirmed

- Keyframing, and the round-trip clear (a **guess** built from confirmed calls).
- Whether `ImportFusionComp` replaces or adds a comp on a Text+ title.
- `\n` counting, and astral characters (UTF-16 vs code points).
- The meaning of `1002`, and alpha `2404`.
- Resolve Free and Mac.
