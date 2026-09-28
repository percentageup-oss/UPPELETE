# 17 — Send emphasis to Resolve (Character Level Styling)

## Goal
When a user emphasises words in KathaCut, Sync sends them to Resolve. Only those words get the emphasis colour,
size, font/weight and underline, and spotlight mode dims the rest. Today emphasis is `not-sent`, and an
emphasis-only edit shows **Nothing to sync**, because `styleRanges` is always `[]`, so the spec hash doesn't
change.

**Follow `docs/decisions/0011-resolve-character-level-styling.md`** for the data shape, property ids, counting
unit, and write/clear calls. If this brief and the ADR disagree, the ADR wins; note the difference in STATUS. If
the ADR says the unit is **no data**, stop and tell the user.

Read `docs/plans/resolve-textplus/README.md` ("Testing override", "Architecture") and ADR 0011 first.

## Findings (verified 2026-09-27; line numbers drift, so search by symbol)
- `cue.emphasized`: an ordered list of unique whole words, `{ text, textStart, textEnd }`, UTF-16 offsets into
  `cue.text` (`src/core/model.ts` ~L65, `superRefine` ~L88).
- Emphasis style fields (`src/captions/style.ts` ~L46-57): `emphasisFontFamily` ('' = same font),
  `emphasisWeight`, `emphasisItalic`, `emphasisMode` (`emphasize` | `spotlight`), `emphasisScale` (1-2),
  `emphasisUnderline`, `emphasisTextTransform` ('none' = inherit `textTransform`), `emphasisGlow*`,
  `emphasisGradient*`. The emphasis colour is `secondaryColor`.
- How the preview applies it: `captionStyleInputs` (`style.ts` ~L173) builds `emphasisFont` (size
  `fontSize × emphasisScale`, weight, italic, transform). `layoutCaption` measures emphasised spans with that
  font, so **line wraps depend on emphasis** (`renderer.ts` ~L209, `sliceEmphasis`, `fittedEmphasisFont`).
  Spotlight: non-emphasised runs are drawn at `SPOTLIGHT_DIM` (0.35) opacity (`CaptionPreview.tsx` ~L185-199).
- `planTextPlus` (`src/resolve/textPlusPlan.ts`): `layoutInputs` is built **without** `emphasized`, so Resolve's
  line breaks can differ from the preview's. `TextPlusStyleRange` (top of the file) is already typed.
  `styleRanges: []` is hard-coded in `draftSpec`, and `hash` covers the whole spec, so filling `styleRanges`
  makes emphasis edits syncable with no diff changes.
- `src/resolve/charUnits.ts`: `CharUnit`, `offsetInUnit(text, utf16Index, unit)`, `isGraphemeBoundary`,
  `wordRanges(words, specText, transform)` (in-order match, drops anything off a grapheme boundary). Reuse
  these; don't write a new matcher.
- `resources/resolve/bridge.lua` `applySpec`: writes whitelisted inputs, then `StyledText`, then keyframes.
  The comment there says CLS isn't applied. `INPUT_WHITELIST` is the pattern for a property-id whitelist.
- `src/resolve/ResolveSync.tsx` (~L171): the button reads **Nothing to sync** whenever `nothingToDo`. The support
  list ("What Resolve gets") renders below it.

## Steps
1. **`src/resolve/charUnits.ts`:** export `TEXT_PLUS_CHAR_UNIT: CharUnit` set to the ADR's unit, with a comment
   citing ADR 0011. Add `'utf16'` to `CharUnit` if the ADR found UTF-16. Update the header comment: the unit
   is now confirmed.
2. **`src/resolve/textPlusPlan.ts`:**
   - Pass `emphasized: draft.motionCue.emphasized` into `layoutInputs`, so wraps match the preview. Only do this
     when the whole-text transform kept the length (`transformedText.length === draft.motionCue.text.length`);
     otherwise omit it (the offsets would be wrong).
   - After layout, build `styleRanges` with a new pure helper `emphasisStyleRanges(spec text, emphasized,
     appearance, unit)`, in a new file `src/resolve/textPlusStyleRanges.ts`:
     - locate each emphasised word in the final text with `wordRanges(emphasized, text, word =>
       applyTextTransform(word, resolvedEmphasisTransform))`, and drop what it drops;
     - apply `emphasisTextTransform` to those ranges **in the sent text**, if the transform keeps each
       grapheme's length; otherwise skip the transform for that word;
     - per range: `color` = `secondaryColor`; `sizeScale` = `emphasisScale` (omit if 1); `font` =
       `emphasisFontFamily` (omit if '' or equal); `style` = `styleNameFor(emphasisWeight, emphasisItalic)` (omit
       if equal to the base style); `underline` = `emphasisUnderline` (omit if false);
     - spotlight mode: add a range covering each **non**-emphasised stretch with `alpha: SPOTLIGHT_DIM` (import it
       from `src/captions/renderer.ts`). Never cover a `\n` if the ADR says line breaks count differently;
     - convert every `[start, end)` with `offsetInUnit(text, i, TEXT_PLUS_CHAR_UNIT)`, using the ADR's inclusive
       or exclusive end rule.
   - Extend `TextPlusStyleRange` with `alpha?: number` and whatever else the ADR needs. Drop its "not sent yet"
     comment.
   - Support report: Emphasis colour/size/font/underline become `sent` or `approximated` (approximated when the
     ADR marks a property id as a guess). Emphasis glow and gradient stay `not-sent`. Emphasis pop motion is
     `approximated`: static size only. Update the Text note, which currently says `StyledText` is only
     round-tripped.
3. **`resources/resolve/bridge.lua` `applySpec`:** after `StyledText` is set, if `spec.styleRanges` has entries,
   write them with the ADR's write method. Map each range field to its property id through a new
   `CLS_PROPERTY_WHITELIST`: only numbers and strings, never code. If it's empty, **clear** CLS with the ADR's
   clear method, so removing emphasis syncs. Keep everything inside the existing `comp:Lock()` / `pcall`. Replace
   the old "CLS ranges aren't applied" comment.
4. **`src/resolve/ResolveSync.tsx`:** when `nothingToDo` and the support list has any `not-sent` item, show a note
   above the actions: "Nothing to sync. Some styling can't be sent to Resolve; see 'What Resolve gets' below."
5. If ADR 0011's timing needs smaller batches, lower `UPDATE_BATCH` / `INSERT_BATCH` in
   `electron/resolve/sync.ts` to the ADR's numbers.
6. Update `docs/RESOLVE.md` (feature table) and `docs/STATUS.md` ("not tested, typecheck only"). Commit only this
   brief's files: `Send caption emphasis to Resolve with Character Level Styling`.

## Out of scope
Full-line active-word highlight / word pop (brief 18). Emphasis glow, gradient, pop animation. Reading CLS back
from Resolve during the edit import.

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes.
- [ ] No range boundary lands inside a grapheme cluster; any word that can't be located is dropped, not split.
- [ ] Removing all emphasis clears CLS on the clip (the hash changes, and `applySpec` clears).
- [ ] Lua writes only whitelisted property ids with number or string values.
- [ ] `docs/STATUS.md` entry.

## Manual check for the user
1. Emphasise one Malayalam word (with a conjunct) and one English word, then open **Sync to Resolve**. The dialog
   counts them as updates. After Sync, only those words are coloured and scaled in Resolve, and the Malayalam
   word renders intact.
2. Switch Emphasis mode to spotlight and Sync. The other words are dimmed.
3. Remove the emphasis and Sync. The words render plain again.
Windows only; Mac is unverified.
