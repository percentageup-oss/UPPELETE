# 18 — Full-line active-word highlight and word pop in Resolve

## Goal
In full-line display (`captionDisplay !== 'word'`), **active-word highlight** and **word pop** colour, and for
pop enlarge, the word being spoken as the line plays. Today both are `not-sent` in that mode (`computeMotion`,
`src/resolve/textPlusMotion.ts`, the `!p.isWordDraft` branch). Brief 17 added Character Level Styling ranges;
this brief moves them word by word.

**Follow ADR 0011** (`docs/decisions/0011-resolve-character-level-styling.md`), "Keyframing (W3)":
- **W3 confirmed:** one clip per cue, with stepped CLS keyframes.
- **Otherwise** (the user's decision, 2026-09-27): **split clips**. One Text+ clip per word step, back to back.
  Each clip keeps the **full line text** with only that word styled, so the layout never shifts.

Brief 17 must be done first. Read `docs/plans/resolve-textplus/README.md` ("Testing override") and ADR 0011.

## Findings (verified 2026-09-27; search by symbol)
- `draftsForCue` (`src/resolve/textPlusPlan.ts`) returns one draft per cue in line mode, or one per word (key
  `${cue.id}#w${index}`, `wordDisplayCue`) in word mode. The spec loop then clamps each draft's end frame to the
  next draft's start (`usToTimelineFrame`, `nextStartFrame`), so back-to-back drafts never overlap.
- `computeMotion` gets `isWordDraft`, `cue` (with `words`), `text` (the final spec text), `startFrame`/`endFrame`,
  `secondaryFill`, `emphasisScale` and `baseSize`, and returns `inputOverrides`, `keyframes` and a support
  `outcome`. `wordMotionAvailability(cue)` gates everything on word timing; `availability.estimated` marks
  estimated timing.
- `progressiveRevealKeyframes` is the model for stepping at word starts: `wordRanges` + `usToClipFrame` +
  `dedupe`.
- Brief 17's `src/resolve/textPlusStyleRanges.ts` builds CLS ranges with `wordRanges` + `offsetInUnit`. Reuse it
  for "this one word in `secondaryColor`, scaled by `emphasisScale`".
- Sync diff (`src/resolve/syncDiff.ts`) matches clips by `key`. New keys insert, missing keys delete, so moving
  between modes cleans up after itself.

## Steps
1. **A helper for "the active word's range":** in `textPlusStyleRanges.ts`, add `activeWordRange(text, words,
   index, transform, fill, scale | undefined)`. It returns one `TextPlusStyleRange` or null when the word isn't
   located. Merge it with the cue's own emphasis ranges from brief 17; the active word wins where they overlap.
2. **If ADR 0011 confirmed keyframing (one clip):** in `computeMotion`'s `!p.isWordDraft` branch, return
   CLS keyframes: at each located word's start frame (`usToClipFrame`), the range set with that word active. The
   first keyframe (frame 0) is the plain or emphasis-only set. Add a `styleKeyframes` field to `MotionResult` and
   `TextPlusClipSpec`, include it in the hash, and send it in the bridge spec. Extend `applySpec` in `bridge.lua`
   to write them with the ADR's keyframe method, whitelisted like brief 17's ranges.
3. **Otherwise (split clips):** in `draftsForCue`, when not in word mode, the motion is `active-word-highlight`
   or `word-pop`, and `wordMotionAvailability(cue).enabled`:
   - emit a draft `${cue.id}#a0` for any lead-in from the cue start to the first word's start (no active word),
     then one draft `${cue.id}#a${i + 1}` per word, from that word's `startUs` to the next word's `startUs`, and
     the last one to the cue's `endUs`;
   - every draft's `motionCue` keeps the **full cue text, words and emphasis**, with only `startUs`/`endUs`
     narrowed. Add an `activeWordIndex?: number` to `Draft`;
   - in the spec loop, skip a draft that rounds to zero frames (the existing "shorter than one frame" path), and
     add the active-word range to `styleRanges` (step 1) instead of calling `computeMotion`'s coloured-clip path.
   - Word pop scales the active word by `emphasisScale` (static). The sine pop isn't sent.
4. **Support report:** replace the not-sent reason with the new behaviour: stepped keyframes or split clips (say
   which), static pop, word timing required, and approximated when timing is estimated.
5. Update `docs/RESOLVE.md` and `docs/STATUS.md` ("not tested, typecheck only"). Commit only this brief's files:
   `Send full-line active-word highlight and word pop to Resolve`.

## Out of scope
The animated sine pop. Per-word glow or gradient. Reading word styling back from Resolve.

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes.
- [ ] Split clips (if used) are contiguous and non-overlapping, and each carries the identical full text, so the
      layout never shifts between steps.
- [ ] No word timing → no motion clips; the report says "word timings missing" (no invented timing, AGENTS.md).
- [ ] `docs/STATUS.md` entry.

## Manual check for the user
1. Pick full-line display with **active-word highlight**, then Sync. In Resolve, play the caption: the highlight
   steps word by word, in time with the audio, and the line never moves.
2. Switch to **word pop** and Sync. The active word is also larger.
3. Switch back to static and Sync. The extra clips are removed, leaving one clip per caption.
Windows only; Mac is unverified.
