# ADR 0011 — Resolve Character Level Styling (CLS) spike findings

Date: 2026-09-28. Status: **Partly unblocked.** The data shape, the property ids for colour, size, underline
and style, and the counting unit are now **confirmed** from a hand-styled clip. **Writing** CLS from a script
is still unconfirmed. Every write this spike tried used the old guessed ids and shape, so none of them tested
the real format. Briefs 17 and 18 need one more short write spike before they can send anything (see the end
of this ADR).

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

## Clear method (W2)

Partly confirmed: setting `StyledText` to a plain value and emptying the array both return `ok=true`, and the
text still reads correctly. Whether this removes real styling is unconfirmed, because no write ever applied
any. The simplest clear is likely to delete the modifier tool, or not create one for clips without emphasis.

## Keyframing (W3)

No data. W3 used the same broken write. Brief 18 stays on the user's fallback, **split clips** (one clip per
word step with the full line text), unless the follow-up spike shows an animated CLS value changing between
two stills.

## Timing (W4)

~500 ms of CPU time per clip for insert + AddTool + connect + SetInput (`cpuSeconds=25.003` and `24.995` for
50 clips). That's far over the ~2 s budget for one command at `INSERT_BATCH` (50) or `UPDATE_BATCH` (20). Bulk
CLS writes must use start + poll. Re-measure once the real write method is known.

## Consequences for 17/18

- 17: CLS entries are `{ id, cpStart, cpEndInclusive, Value | String }` with the ids above. Emphasis colour =
  2401-2403, scale = 102 (absolute) and underline = 105. Word ranges come from grapheme/word boundaries,
  converted to code points. **Blocked** until the write spike confirms one write call.
- 18: split clips (the fallback) unless the write spike shows keyframed CLS working.
- Both: bulk writes use start + poll.

## Open questions (for the user)

1. On `ആൾട്ട്മാനെ`, did your red/size selection include the space after the word?
2. On `പറഞ്ഞത്`, did Bold look like it covered the whole word, including the final ്?
3. What size did you set on the red word? The dump says 0.08, about 194 % of the base 0.0412.
4. Did you do anything to the first 20 characters besides underlining `Sam`, such as click, drag or touch
   another setting? That would explain id `1002`.

## Unconfirmed

- A working script write, and keyframing.
- `\n` counting, and astral characters (UTF-16 vs code points).
- The meaning of `1002`, and alpha `2404`.
- Resolve Free and Mac.
