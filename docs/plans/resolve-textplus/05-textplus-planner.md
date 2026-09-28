# 05 — Text+ planner (pure TypeScript)

## Goal
Add a pure module that turns a linked project's captions into **Text+ clip specs**: plain JSON that the Lua bridge
applies without further logic. It also returns a **support report**: which style features are sent, approximated
or not sent. This brief adds no UI and no Resolve calls; brief 06 consumes it. Static styling only. Emphasis and
word animation are brief 07; leave clear extension points for them.

Read `docs/plans/resolve-textplus/README.md` (time mapping, rules) and **`docs/decisions/0008-resolve-textplus.md`**
(confirmed input IDs, size calibration, y direction, comp frame origin) first. If the ADR is missing or marked
Blocked, stop.

## Read only
- `docs/decisions/0008-resolve-textplus.md`, `src/resolve/frames.ts` (from 03)
- `src/core/model.ts` (the cue/word schemas L33-105, `resolveLinkSchema` from 04)
- `src/captions/style.ts` (`captionAppearanceSchema`, `resolveCaptionStyle`, `captionStyleInputs`),
  `src/captions/renderer.ts` (`layoutCaption`, the `CaptionLayoutInputs`/measure types),
  `src/captions/wordDisplay.ts` (`displayCue`), `src/captions/CaptionPreview.tsx` (only `createDomMeasurer`, and
  how the preview resolves a cue's style: follow `resolveCaptionStyle` call sites in
  `src/captions/CompositionLayers.tsx`)
- `src/core/timelineModel.ts` (`cuesInSequence`, `activeCueAt`) and `src/core/captionLanguages.ts` (which cues are
  shown for `shownTranslation`)

## Steps
1. `src/resolve/frames.ts`: add `usToTimelineFrame(us, link)` = `link.startFrame + Math.round(us * num / (den *
   1e6))`. Use integer-safe math: compute in `bigint`, or with `Math.round` on `us * num / den / 1e6` only while
   the values stay below 2^53. Document the choice. Also add `timelineFrameToUs(frame, link)` for the inverse
   (used by `jumpTo`).
2. `src/resolve/textPlusInputs.ts`: constants copied from the ADR:
   - input IDs
   - value types
   - the size calibration function `textPlusSize(px, compositionWidth, timelineWidth, timelineHeight)`
   - the y flip, `centerFor(hFraction, vFraction)`
   - `colorToRgba01(css)`, which accepts the colour formats that `style.ts` actually stores (check the schema)
   - `LUA_INPUT_WHITELIST: readonly string[]`, used by 06 in both the TS schema and the Lua table
3. `src/resolve/specHash.ts`: `stableStringify(value)` (sorted keys) and `fnv1a32Hex(text)`. The spec hash is the
   hash of the spec without its `hash` field.
4. `src/resolve/textPlusPlan.ts`:
   ```ts
   export type TextPlusClipSpec = {
     key: string            // cue id, or `${cueId}#w${index}` in word-at-a-time display mode
     cueId: string
     startFrame: number     // absolute Resolve record frame (inclusive)
     endFrame: number       // exclusive
     text: string           // with '\n' at KathaCut's line breaks
     inputs: Record<string, number | string | { x: number; y: number }>
     keyframes: { input: string; points: [frame: number, value: number][] }[]   // clip-relative frames; 07
     styleRanges: unknown[] // Character Level Styling ranges; 07 defines the type
     hash: string
   }
   export type SupportLevel = 'sent' | 'approximated' | 'not-sent'
   export type TextPlusPlan = { specs: TextPlusClipSpec[]; support: { feature: string; level: SupportLevel; note?: string }[]; skipped: { cueId: string; reason: string }[] }
   export function planTextPlus(project: CaptionProject, measure: Measure): TextPlusPlan
   ```
   - **Which cues:** only when `project.resolveLink` is set. Include the cues whose `mediaAssetId ===
     link.proxyAssetId`, on the caption tracks and in the language layer the preview shows (reuse the existing
     selectors; don't re-implement the filtering), sorted by start. Skip empty text and record it in `skipped`.
   - **Time:** cue source µs on the proxy is the timeline offset (README). Start = `usToTimelineFrame(cue.startUs)`
     and end = `usToTimelineFrame(cue.endUs)`, then clamp end ≤ the next spec's start. If `end <= start`, extend to
     `start + 1` when there's room; otherwise skip with the reason "shorter than one frame".
   - **Word-at-a-time display mode:** when `displayCue` splits a cue into single words, emit one spec per shown
     word (key `${cueId}#w${i}`), using that word's timing. If word timings are missing, fall back to the whole cue
     and add a support note.
   - **Style:** resolve the cue's effective style exactly as the preview does, then map it: font family, weight →
     `Style` (per the ADR; e.g. "Bold"), italic, size (calibrated), primary colour, outline (enable, colour,
     thickness), shadow, background box, position (center, with the y flip), rotation, line spacing, letter
     spacing, alignment, and text transform (apply uppercase/lowercase to the text itself, with `toLocale*` and
     grapheme-safe handling).
   - **Line breaks:** run `layoutCaption(text, captionStyleInputs(style…), measure)` and join its lines with
     `'\n'`, so Text+ wraps where KathaCut does. Set Text+'s own wrapping/layout width per the ADR, so it doesn't
     rewrap. Never insert a break inside a word.
   - **Support report**, one entry per style feature used by this project's captions:
     - `sent`: font, size, colours, outline, shadow, box, position, rotation, alignment, spacing, line breaks.
     - `not-sent`: gradient fill, glow, 3D depth, and anything else with no ADR mapping. Emphasis and caption
       motions are listed as `not-sent` with the note "coming in a later update". Brief 07 changes this, so don't
       show UI for them.
     - `approximated`: anything you map loosely. Say how.
   - `hash` is computed last.
5. Keep the module free of DOM and Electron imports. `measure` is injected; the renderer passes
   `createDomMeasurer()`.

## Out of scope
IPC, Lua, UI (06); emphasis and animation (07); titles, shapes and overlays.

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes.
- [ ] No grapheme cluster is split: line breaks come from `layoutCaption`, and text transforms are grapheme-safe.
- [ ] `docs/STATUS.md` entry: the mapping table summary, "not tested, typecheck only". Offer the user a small unit
      test for `usToTimelineFrame` (the 29.97/23.976 rounding cases).
- [ ] Commit only the files this brief changed: `Add Text+ clip planner for DaVinci Resolve sync`.
