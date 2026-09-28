# ADR 0011 — Resolve Character Level Styling (CLS) spike findings

Date: 2026-09-28. Status: **Blocked** for briefs 17 (send emphasis) and 18 (word motion). This run confirms the
modifier's shape and connection call, but has **no data** on the one fact those briefs need first: the character
counting unit. It also shows the one write attempt made so far did not visibly apply.

Source: one run of `resources/resolve/dev/cls-spike.lua` (brief 15) in **DaVinci Resolve Studio 21.0.0.47 on
Windows** (S0/C1). The user skipped the optional hand prep (no styled clip was prepared before running the
script), so R1 — the only test that reads Resolve's own stored CLS data — produced no data.

Evidence: `docs/decisions/evidence/resolve-cls-spike-2026-09-28.txt` (full console report) and
`resolve-cls-spike-2026-09-28-R0.setting` (R0's `CopySettings()` dump). The four stills
(`kathacut-cls-W1b.png`, `-W2.png`, `-W3-frame5.png`, `-W3-frame15.png`) are each 6,232,017 bytes — over the 2 MB
evidence limit, so they weren't copied in. All four were viewed directly for this ADR: all four show the same
plain white two-line caption (`പ്രൈം മിനിസ്റ്റർ Sam ആൾട്ട്മാൻ` / `വിളിച്ചിട്ട് പറഞ്ഞത്`) with no red, no
underline, no size change and no visible difference between any of them — consistent with their identical file
size (`W3-coarse-diff sizesDiffer=false`), which the spike itself flagged as only a coarse signal.

## Data shape

**Confirmed, partially.** `comp:AddTool("StyledTextCLS")` creates a tool named `CharacterLevelStyling1` of type
`StyledTextCLS` (R0-setup, R0c). `tool.StyledText:ConnectTo(mod.StyledText)` — the modifier's `StyledText` output
into the Text+ tool's `StyledText` input — returned `ok=true` every time it was tried (R0b, W1b-connect,
W3-connect), and `GetConnectedOutput()` returned a real `Output` object (R0b), so this is the confirmed connection
call and direction.

**Not confirmed:** the literal `.setting` shape from the "Background" section of brief 15 —
`CharacterLevelStyling = Input { Value = StyledText { Array = { {propId, start, end, Value}, … }, Value = "" } }`
— has still never been observed in an actual dump. R0c's `CopySettings()` output is:

```lua
{ Tools = ordered() {
  CharacterLevelStyling1 = StyledTextCLS { CtrlWZoom = false, Inputs = {
    Softness = Input { Value = 1 },
    Text = Input { Value = "പ്രൈം മിനിസ്റ്റർ Sam ആൾട്ട്മാൻ\nവിളിച്ചിട്ട് പറഞ്ഞത്" },
    TransformRotation = Input { Value = 1 }
  } }
} }
```

Two things to note about this dump, not obvious from the log alone:
- **It has no `CharacterLevelStyling` key at all**, only `Softness`, `Text` and `TransformRotation` — the three
  inputs whose value differs from tool default at the moment of the dump (R0c ran right after connecting, before
  any styling write). `CopySettings()` only serializes non-default inputs, so this is expected and is *not*
  evidence the array shape doesn't exist — W1a's log line ("no 'CharacterLevelStyling' key anywhere in R0's dump")
  correctly reports this, but the reason is timing, not absence of the feature.
- **`comp:CopySettings()` with no arguments captured only the newly-added `CharacterLevelStyling1` tool**, not the
  `TextPlus1` tool it's connected to. AddTool leaves the new tool selected, and `CopySettings()` appears to copy
  only the selected tool(s), not the whole comp. Any future spike that wants a full comp dump (to see how the
  Text+ tool's `StyledText` input references the modifier) needs to select both tools first, or use a different
  call.

## Property ids

**Guess, refined but still unconfirmed.** R0a is `GetInputList()` on the `StyledTextCLS` tool itself — the full
list of every input the modifier can carry (reproduced in the evidence `.txt`). Two facts from that real dump,
not from prior guesswork:

- The data input is literally named **`CharacterLevelStyling`**, default value `""` (an empty string, not an
  empty array or table) — so an unwritten modifier serializes to plain text, matching the R0c dump above.
  Two adjacent buttons, `ClearSelectedStyling` and `ClearAllStyling` (both default `0`), are presumably momentary
  triggers for the Fusion-page UI action, not something a script needs to press to clear a range (W2 clears by
  disconnecting/emptying the array directly instead, see below).
- The list has **two separate RGBA quads**, not one: `Red1/Green1/Blue1/Alpha1` (default `1,1,1,1`) immediately
  followed by `Red/Green/Blue/Alpha` (also default `1,1,1,1`), with an `OverrideColor` toggle (default `0`) and a
  `MappingSpacer` marker just before the first quad. ADR 0008 already confirmed `Red1/Green1/Blue1/Alpha1` as the
  base Text+ element's **own** fill color. The plain `Red/Green/Blue/Alpha` quad, gated by `OverrideColor`, reads
  much more like the **per-range color override** — this is a new, better-supported guess than W1's fallback, but
  still a guess: nothing in this run exercised it.
- Size has the same pattern: a single `Size` input (default `0.08`, the whole element's font size as a fraction of
  frame height — this is what W1's guess used) versus `SizeX`/`SizeY` (default `1,1`, a multiplier) under the
  `ElementSize` section. A per-character 150% size override is more likely `SizeX`/`SizeY` = `1.5` than
  `Size` = `0.12`.

**W1's guess used the wrong pair on both counts** — `colorPropIds={Red1, Green1, Blue1, Alpha1}` (the base fill,
not the override quad) and `sizePropId=Size` (the absolute font size, not the `SizeX`/`SizeY` multiplier) — which
is a plausible reason (not the only possible one) the write below had no visible effect.

## Counting unit

**No data. This blocks briefs 17 and 18.** R2's UTF-16/code point/UTF-8-byte/grapheme offsets for the three
marked words are hard-coded from `graphemes()` in `src/core/captionText.ts`, exactly as brief 15 intended — they
are TypeScript's answer, not Resolve's. Comparing them to R1's real `start`/`end` values was the only way this
spike could confirm the unit, and R1 was skipped (no hand-styled clip was prepared): `INFO R1 skipped: no clip on
the original timeline has a connected StyledText input`. W1's operative choice of UTF-8 byte offsets for its
write attempt (per the brief-15 STATUS entry) is unconfirmed and, per the next section, wasn't validated by its
result either.

Also unconfirmed: whether `end` is inclusive or exclusive, and how `\n` counts — both need the same R1 data.

## Grapheme safety

**Not exercised.** No range was written across or adjacent to a Malayalam conjunct in this run (the write attempt
below produced no visible styling at all, so the conjunct word `ആൾട്ട്മാൻ` can't be checked for correct rendering
under a real CLS range). AGENTS.md's no-split-grapheme rule for KathaCut's own range math is unaffected either way
— it constrains what KathaCut sends, not what Resolve does with it — but whether Resolve *itself* renders a
correctly-bounded conjunct range without corruption remains to be seen once a working write exists.

## Write method

**No working method found in this run.** Method (a), editing `CopySettings()`'s table and `comp:Paste()`-ing it
back, was **never attempted**: `INFO W1a skipped: no 'CharacterLevelStyling' key anywhere in R0's CopySettings()
dump` (see "Data shape" above for why the key was absent at that point — R0c ran before any write, so there was
nothing yet to edit). Method (a) is untested, not disproven.

Method (b), `mod:SetInput("CharacterLevelStyling", <table>)`, is what actually ran: `PASS W1b-connect ok=true`,
`PASS W1b-setinput ok=true`. But:
- The immediate readback, `tool:GetInput("CharacterLevelStyling")`, came back **empty**: `INFO W1b-readback ""`.
- The exported still (`kathacut-cls-W1b.png`) shows no red on `ആൾട്ട്മാൻ`, no size change on `Sam`, and is
  byte-identical in size to the unstyled baseline stills (W2, W3-frame5, W3-frame15).

`SetInput` returning `ok=true` is **not** proof Resolve accepted the value — Fusion's Lua bridge is known to accept
a value of the wrong shape without erroring and simply not apply it. Combined with the empty readback and the
unchanged still, the more likely reading is that this run's guessed table shape for `mod:SetInput("CharacterLevel
Styling", …)` did not match what Resolve expects, not that CLS can't be scripted at all. The corrected property-id
guesses above (`Red/Green/Blue/Alpha` + `OverrideColor`, `SizeX/SizeY`) and the literal `{ Array = {...}, Value =
"" }` wrapper from brief 15's "Background" section are the next things to try, but neither is confirmed — only a
hand-prepared R1 dump (or a follow-up write-test against the R1 property ids) can confirm the write path.

## Clear method (W2)

**Partially confirmed.** `PASS W2-disconnect-via-plain-value ok=true` and `PASS W2-empty-array ok=true`; the
readback still reports `stillConnected=true` and the plain styled text unchanged, and the still
(`kathacut-cls-W2.png`) reads correctly. This confirms disconnecting/emptying **does not corrupt the underlying
text or leave the modifier in a broken state**. It does **not** confirm the clear path actually removes an applied
per-character override, because W1b never visibly applied one to begin with — there was nothing real to clear.

## Keyframing (W3)

**No data (same caveat as the write method).** `PASS W3-connect ok=true`, `PASS W3-keyframe splineType=
BezierSpline ok=true` — the API calls for attaching a `BezierSpline()` to the CLS input and keyframing it at
frames 0 and 10 ran without error. But the two exported stills, frame 5 and frame 15, are byte-identical to each
other and to the unstyled baseline (`sizesDiffer=false`; both viewed directly here show plain white text, same as
W1b/W2). Since the underlying static write (W1) never visibly took effect, this keyframe test inherited the same
failure and answers nothing about whether CLS **can** be animated in one clip. **Brief 18's one-clip-vs-split-
clips decision is still open** and must default to the user's chosen fallback (split clips, one per word step)
until a working single-clip write is confirmed.

## Timing (W4)

**Confirmed, and usable regardless of the blocked items above.** `PASS W4 appended=50 cpuSeconds=25.003` for
`InsertFusionTitleIntoTimeline` + `AddTool` + connect + `SetInput`, method (b), per clip — **~500 ms/clip** of CPU
time (measured with `os.clock`, so a lower bound on wall time, per ADR 0010's caveat about the same clock call).
At `INSERT_BATCH = 50` (`electron/resolve/sync.ts`), a batch of new CLS clips would take on the order of 25 s,
far over the ~2 s single-command budget. **Any brief 17/18 command that creates or rewrites CLS clips in bulk
must use the existing start + poll pattern (like `renderProxyStart`/`renderStatus`), not a single synchronous
command**, even once the write method itself is confirmed. A smaller batch size doesn't fix this on its own,
since even `UPDATE_BATCH` (20) is ~10 s.

## Consequences for 17/18

- **Brief 17 (send emphasis) and brief 18 (word motion) cannot start.** The character counting unit — the one
  fact every range boundary they send depends on — has no data. A follow-up run of `cls-spike.lua` with the hand
  prep completed (a real R1 dump) is required before either brief can proceed.
- When that follow-up runs, also re-test the write path with the corrected property-id guesses above
  (`Red/Green/Blue/Alpha` + `OverrideColor` for color, `SizeX/SizeY` for size) sourced from R1's real dump rather
  than R0's defaults, since this run's guesses are now the leading candidates to try, not confirmed answers.
- Brief 18's one-clip-with-keyframes-vs-split-clips choice stays at the user's fallback (split clips) until a
  working single-clip write can be keyframed and actually observed to change between frames.
- Any bulk CLS command in 17/18 must be start + poll, per the W4 timing above, independent of the other findings.

## Unconfirmed / blocked

- The character counting unit, `end` inclusivity, and `\n` counting (needs R1).
- Whether the corrected `Red/Green/Blue/Alpha`/`OverrideColor`/`SizeX`/`SizeY` guesses are the right property ids
  (needs R1, or a follow-up write test against them).
- Whether `mod:SetInput("CharacterLevelStyling", …)` (method b) or `comp:Paste()` (method a, never attempted) is
  the working write call, and the exact table shape either expects.
- Whether CLS can be keyframed in one clip (W3 inherited the write failure).
- Grapheme-boundary rendering of a real per-character range across a Malayalam conjunct.
- Resolve Free (only Studio was run) and Mac.
