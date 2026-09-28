# 16 — CLS spike findings → ADR 0011

## Goal
Turn the user's brief 15 report into `docs/decisions/0011-resolve-character-level-styling.md`. Briefs 17 and 18
implement against this ADR, so every fact they need must be in it, stated as **confirmed**, **guess** or **no
data**.

Read `docs/plans/resolve-textplus/15-cls-spike.md` (what each test did) and the "Character Level Styling"
sections of ADR 0008 and 0009 first.

## Inputs
The user's files: `kathacut-cls-spike.txt`, `kathacut-cls-*.setting`, `kathacut-cls-*.png`, screenshots and
notes. If any are missing, ask the user; don't guess.

## Steps
1. Copy the evidence into `docs/decisions/evidence/`, named `resolve-cls-spike-<date>.*`. Keep the stills small;
   skip any file over 2 MB and note that.
2. Write ADR 0011, answering:
   - **Data shape:** where CLS lives (modifier tool ID, input ID, value type), shown as a literal Lua table
     copied from a `.setting` dump.
   - **Property ids:** a table of id → meaning (colour R/G/B/A, size, font, style, underline, tracking,
     baseline, …), with each id's value type and default. Mark the ids that only R0's defaults showed, not a
     real styled range, as **guess**.
   - **Counting unit:** compare R1's start/end values with R2's four offsets. State the unit (UTF-16, code
     points, UTF-8 bytes or graphemes), and whether `end` is inclusive or exclusive. Include how `\n` counts.
     If R1 has no data, write **no data** and stop the ADR at a Go/No-go of "blocked: needs the hand-styled
     clip". Briefs 17 and 18 can't run without the unit.
   - **Grapheme safety:** KathaCut never sends a range boundary inside a Malayalam grapheme cluster (AGENTS.md).
     Note whether Resolve accepted and rendered the conjunct word correctly (W1 still).
   - **Write method:** which of W1 (a) Paste or (b) SetInput worked, with the exact calls, including how the
     modifier gets connected.
   - **Clear method (W2):** the exact calls that return a clip to plain text.
   - **Keyframing (W3):** can CLS be animated in one clip, and how? This decides brief 18: **one clip** with
     stepped CLS keyframes, or **split clips**, one per word step (the user's chosen fallback, 2026-09-27).
   - **Timing (W4):** ms per clip. Is it inside the ~2 s bridge command budget at `UPDATE_BATCH` (20) and
     `INSERT_BATCH` (50), in `electron/resolve/sync.ts`? If not, give the batch size to use.
   - **Consequences for 17/18,** one line each.
3. Add a one-paragraph addendum to ADR 0008's "Character Level Styling (T11)" section pointing to ADR 0011.
4. `docs/STATUS.md` entry (findings only; no code). Commit: `Record Character Level Styling spike findings
   (ADR 0011)`.

## Out of scope
Any code change.

## Done checklist
- [ ] Every claim in ADR 0011 cites a log line, a `.setting` file or a still.
- [ ] The unit, write, clear and keyframe answers are each **confirmed**, **guess** or **no data**.
- [ ] `docs/STATUS.md` entry.
