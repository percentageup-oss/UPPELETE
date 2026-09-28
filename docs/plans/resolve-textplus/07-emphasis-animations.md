# 07 — Emphasis + word animations in Text+

> **Now runs after 09 (spike 2 findings, ADR 0009) and 10 (sequence-time mapping).** ADR 0009 and ADR 0008's
> amended open items settle CLS format, write-on (`Start`/`End`, not `WriteOnStart`/`WriteOnEnd`) and keyframing.
> Planner input is now sequence-time cues (brief 10).

## Goal
Extend the Text+ planner and the Lua `applySpec`, so that synced clips carry:
- **Emphasis**: the cue's `emphasized[]` spans in the emphasis style (secondary colour, emphasis weight or font,
  scale), via Character Level Styling ranges.
- **Caption motions**, mapped as closely as Text+ allows:
  - `phrase-fade`: opacity keyframes, with ramps of 200 ms / `motionSpeed` (the same constant as
    `captionFrame` in `src/captions/renderer.ts`).
  - `progressive-word-reveal`: write-on keyframes, stepped at each word's start, **only at word boundaries**.
  - `active-word-highlight`: the active word in the secondary colour. Use keyframed CLS if the ADR says CLS can be
    keyed; otherwise emit one sub-clip per word interval (keys `${cueId}#h${i}`), each with a static CLS range on
    word i.
  - `word-pop`: approximated as `active-word-highlight` plus the emphasis scale on the active word, without the
    sine pop. Report it as `approximated`.
  - `static-clean`: nothing extra.

Update the support report so it reflects exactly what was sent.

Read `docs/plans/resolve-textplus/README.md` and **`docs/decisions/0008-resolve-textplus.md`** (the CLS data format,
the character counting unit, keyframe syntax, the comp frame origin, and the opacity input) first. If the ADR says
CLS cannot be written from a script, send emphasis as `not-sent` and use the sub-clip fallback only where it
doesn't need CLS (e.g. highlight by splitting the text is **not** allowed, because it changes layout); report
honestly.

## Read only
- ADR 0008, `src/resolve/textPlusPlan.ts`, `textPlusInputs.ts`, `resources/resolve/bridge.lua` (`applySpec`),
  `src/core/resolveIpc.ts` (the spec schema).
- `src/captions/renderer.ts` (`captionFrame`, `wordMotionAvailability`, `layoutCaptionWords`),
  `src/captions/style.ts` (`MOTIONS`, the emphasis fields), `src/core/emphasis.ts`, and `src/core/model.ts` (word
  `timingSource`, `textStart`/`textEnd`, `emphasized`).

## Steps
1. **Character offsets.** `src/resolve/charUnits.ts`: `offsetInUnit(text, utf16Index, unit)`, where `unit` is the
   ADR's counting unit (code points, UTF-8 bytes or graphemes via `Intl.Segmenter`). Also
   `wordRanges(cue, spec.text)`: map each word to a `[start, end)` range in the **final spec text**, which includes
   the inserted `'\n'` and any text transform. Use `words[].textStart/textEnd` where present; otherwise walk the
   words in order. Assert that every range starts and ends on a grapheme boundary (`Intl.Segmenter`); if not, drop
   that range and add a support note. **Never split a grapheme cluster.**
2. **Spec types.** Replace `styleRanges: unknown[]` with a typed
   `{ start, end, color?, sizeScale?, font?, style?, underline? }[]` (in ADR units). Add `atFrame?`/keyframing only
   if the ADR confirms CLS keying. Update the zod schema in `src/core/resolveIpc.ts`, with limits.
3. **Planner.**
   - Emphasis spans → `styleRanges`.
   - Motions → `keyframes` (clip-relative frames, using the ADR's comp-origin formula) or sub-clips as described
     above.
   - Word timing: gate with `wordMotionAvailability`. If word timing isn't available, send static captions and
     add the support note "word timings missing".
   - If any used word has `timingSource === 'estimated'`, add the support note "N captions animate on estimated
     word timings" (AGENTS.md: estimated timing must not pass as aligned).
   - Hashes change automatically, so the existing incremental sync resends the affected clips.
4. **Lua `applySpec`.** Apply `styleRanges` in the ADR's CLS format, and keyframes with the confirmed syntax
   (clear old animation on those inputs first). Keep the input whitelist; the CLS modifier gets its own
   whitelisted path.
5. The sync dialog's support list now shows emphasis and motions as sent / approximated / not sent, per clip set.

## Out of scope
Title motions, text overlays, shapes, the sine-accurate pop, glow, gradient, 3D, and spotlight emphasis. List
these as `not-sent`.

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes.
- [ ] Ranges and write-on steps fall only on word boundaries, in the ADR's unit. Malayalam graphemes stay intact.
- [ ] `docs/STATUS.md` entry, "not tested, typecheck only", with the mapping table of motion → Text+ technique.
- [ ] Commit only the files this brief changed: `Send caption emphasis and word animations to Resolve Text+`.

## Manual check for the user
Sync a Malayalam + English project that uses emphasis and each motion. In Resolve, check that the emphasized
words are coloured, that highlight and reveal follow speech, and that there are no broken conjuncts or detached
vowel signs.
