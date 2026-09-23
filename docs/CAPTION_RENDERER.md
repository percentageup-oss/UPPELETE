# Shared caption renderer (R1)

`src/captions/renderer.ts` is the deterministic composition-space layout and absolute-source-time
evaluator. `CaptionPreview.tsx` supplies font readiness, shaped DOM metrics, preview projection and
the shared `CaptionView` painter. The actual video preview in `App.tsx` now uses this adapter;
the old CSS overlay/wrapping implementation is removed. No motion presets or export controls are
implemented by R1.

## Inputs and behavior

`LayoutInputs` defines a stable viewport/composition, fractional safe-area insets, explicit font
stack/size/weight/line height/readiness/revision, max lines, fractional horizontal/vertical position,
whitespace or explicit-only wrapping, color/outline/shadow/background/padding. The app uses a
1080-unit composition width and the player's display aspect ratio (probed rotation-aware fallback).
Changing preview pixels **does not change this composition**. `projectCaptionViewport` performs
uniform letterboxed scaling; `CaptionView` never delegates wrapping to responsive CSS.
Changing composition aspect, text, font metrics or typography is an intentional layout change.

`layoutCaption(text, inputs, measure)` has no clock, frames, filesystem, React or DOM dependency.
The supplied measurer must measure **complete shaped runs**, not add isolated cluster advances.
The DOM adapter measures with the painter's identical typography and a bounded metric cache.
`captionFrame(layout, cue, timestampUs)` validates safe integer source microseconds and uses
half-open cue ranges `[startUs, endUs)`. Seeking backward/forward to a timestamp returns the same
frame; R1 opacity is static 0/1. No timing estimates, frame rounding or accumulated elapsed time
are involved. Layout is memoized separately from frame evaluation in preview.

Segmentation reuses `captionText.ts`'s standards-based `Intl.Segmenter('und', {granularity:
'grapheme'})`, provided by the locked Electron/Chromium ICU runtime. It follows extended grapheme
segmentation; no new npm segmentation package or outdated hand-maintained split regex is added.
See [ECMA-402 Segmenter](https://tc39.es/ecma402/#sec-intl.segmenter) and
[Unicode UAX #29](https://www.unicode.org/reports/tr29/). Conjunct/vowel, decomposed signs,
ZWJ chillu, emoji and combining-accent fixtures guard runtime changes. String offsets address
whole clusters in unchanged original text; they are not animation units. **Each DOM line is one
shaping text node**. Future word effects must preserve shaped runs; wrapping or animating separate
raw code units or even separate per-grapheme DOM spans is not an acceptable shaping strategy.

Soft wrapping is deliberately whitespace-only, not a full Unicode line-break implementation.
NBSP/NNBSP and punctuation-bearing words stay together. CRLF/LF/CR, blank lines, trailing spaces
and original Unicode are retained; `line.text + line.separator` concatenation reconstructs input
exactly. Readable line fitting tries fixed composition-space font sizes (95% through 50%) only
when the explicit line count can meet max lines. If it cannot meet the target, all lines remain and
`max-lines-exceeded` is reported in the layout/painter diagnostics, not silently truncated.
Unbreakable tokens or tall blocks receive one uniform fit transform. Imported/project text and
cue times are never rewritten by rendering. Extreme text can therefore become small; R2 can
surface fitting diagnostics alongside its style controls. Arbitrary shadow extents are not included
in line geometry; callers must reserve sufficient padding for their effects.

## Font readiness and redistribution

Offline default stack: `Noto Sans Malayalam`, `Malayalam Sangam MN`, `Kartika`, `Nirmala UI`,
`Arial`, `sans-serif`. These are **local installed fonts only**; no font URLs, downloads or bundled
font binaries. No assumption that a named face exists: Chromium may use different local fonts
for different scripts. `document.fonts.load` for the actual text and `document.fonts.ready` gate
metrics/rendering; loading events invalidate readiness and metric revision. Failure displays a
font error, not a frame with stale metrics. `FontFaceSet` readiness is not proof of font presence
or glyph coverage. Unknown system fallback/missing glyphs remain a release validation risk.
The readiness behavior uses the [CSS Font Loading standard](https://drafts.csswg.org/css-font-loading/#fontfaceset-ready).

Redistribution inventory/evidence checked 2026-09-15:

| Face | R1 status | Redistribution status |
| --- | --- | --- |
| Noto Sans Malayalam | Preferred if already installed; not bundled/tested as a font artifact | Upstream [OFL 1.1](https://github.com/notofonts/malayalam/blob/main/OFL.txt) allows redistribution subject to its conditions, notices and reserved-name restrictions. Candidate for pinned cross-platform release assets, **not yet an approved exact binary/version/hash**. |
| Malayalam Sangam MN | Actual macOS Malayalam fallback observed | Apple lists it in its [macOS font inventory](https://support.apple.com/en-us/103197). System use only; no redistribution rights assumed, no Apple font copied into the project. |
| Kartika / Nirmala UI | Windows local fallback candidates, not executed here | [Microsoft Kartika](https://learn.microsoft.com/en-us/typography/font-list/kartika), [Nirmala UI](https://learn.microsoft.com/en-us/typography/font-list/nirmala-ui): Microsoft fonts; no redistribution approval or bundle. |
| Arial / generic sans-serif / emoji | Local Latin/last-resort fallback; actual Arial and Apple Color Emoji observed on macOS | OS-provided; no redistribution approval or copied binaries. |

An eventual export must await the same font readiness, reuse the same composition, metrics and
`CaptionView`, and pin the same runtime/font artifacts. R1 is designed for Chromium export, not
an export implementation or parity claim. Identical geometry across **different machines** is not
promised with system fonts. D1/D2 must pin a redistributable Malayalam and Latin font set, archive
licenses/notices, exact source/artifact versions and hashes, and validate glyph coverage on both
targets. Do not redistribute Apple's/Microsoft's system fonts on the strength of local availability.

## Verification

`npm run check`: core cluster/text/geometry/readiness/source-time tests and OS-neutral geometry/DOM
snapshots use explicitly synthetic metrics; those snapshots do **not** assert actual font shaping.
`npm run smoke:captions`: uses the installed Electron to launch a separate isolated test window and
owned Vite server (strict loopback port 5187); requires no media, FFmpeg, model or font download.
Tests 7 authored mixed-script fixtures in portrait/landscape at 100%/65% sizes, actual DOM Range
advance/line boxes and safe-area containment (1 preview-pixel tolerance), identical semantic breaks,
normalized width tolerance 0.001, and live resizing of an existing preview. The fallback fixtures
put a nonexistent face then Arial before the Malayalam stack, exercising real per-script fallback.
CDP records actual platform font names, and screenshots/geometry are saved to a newly allocated
system temporary directory printed by the command, never Git. Visually inspect the page PNGs after
runtime/font changes; automated advances alone cannot prove good Malayalam glyph shaping.

These are preview tests, not exported-frame pixel goldens, speech-quality tests or Windows validation.

## Motion presets (R2)

Five presets on the same renderer, appearance kept fully separate from motion:

- **Static clean** — always available; no per-word state, opacity 0/1 only (R1 behavior, unchanged).
- **Phrase fade** — `captionFrame`'s existing ramp: `min(200ms, cueDuration/2)` in and out from the
  cue's own absolute `startUs`/`endUs`. No word timing required.
- **Active-word highlight**, **word pop**, **progressive word reveal** — require complete, valid,
  non-stale word timing (see availability below). Word pop scales the active word by
  `1 + .12·sin(π·min(1, phase))` where `phase = elapsed / min(200ms, wordDuration)`, peaking at the
  word's own midpoint and rendering `1` outside its half-open `[startUs, endUs)` window.

All three word presets are evaluated purely as `f(layout, cue, absoluteTimestampUs)` — no CSS
`transition`/`animation`, no elapsed-playback clock, no accumulated frame state. Seeking to the same
absolute timestamp from any direction produces byte-identical frame output (`motion.test.tsx` proves
this for every preset by comparing shuffled vs. sorted timestamp evaluation).

### Shaping preservation for word effects

Word highlighting/pop/reveal never split a line's shaping run into per-word or per-grapheme DOM
nodes. `layoutCaptionWords` measures word rectangles from the **already-laid-out complete line**
using real DOM `Range` geometry (`measureRange`), then `CaptionView` paints each line as one
unbroken text node and layers the word effect as a positioned, `overflow:hidden` sibling that
**re-renders the entire line's text again**, clipped to the target word's rectangle (`mask-image`
for word pop's per-word color swap; `clip-path` for progressive reveal's whole-line wipe). This
means a highlighted/popped word is a visual crop of the same shaping run, not a different text
node — Malayalam conjuncts and vowel signs are never detached, because they are never separated
from their line in the first place. `wordMotionAvailability`'s span lookup (`locateWordSpans`)
only ever returns grapheme-boundary-aligned offsets, so a word region can't land mid-cluster either.
`npm run smoke:captions`'s motion grid (below) checks this for real in Chromium: every
`[data-caption-line]` has zero child elements, and every word-effect overlay's own child is the
complete, unsplit line text.

### Availability and honest fallback

`wordMotionAvailability(cue)` (`src/captions/renderer.ts`) is the single gate a word preset must
pass, with a machine-readable `reason` (`no-words | incomplete | invalid | needs-review | estimated
| ok`) plus a human `explanation`:

- **no-words** — the cue has no word list at all.
- **incomplete** — the word list doesn't cover every token in the cue's text (`captionTokens`
  vs. `locateWordSpans`).
- **invalid** — words are out of order, overlap, or fall outside the cue's own time range.
- **needs-review** — a non-estimated word is flagged `needsReview`; stale alignment is never
  silently trusted for animation.
- **estimated** — every word has usable, ordered, contained timing, but the source is
  `estimated`. The preset **is enabled** (an estimate is still real timing data), but the panel and
  the live preview's `timingNotice` always say "Estimated — not aligned to audio", both when the
  preset is picked and for as long as the cue is on screen. Estimated timing is never mislabeled or
  silently upgraded to look aligned.

Only `ok` and `estimated` enable the preset for that cue; every other reason falls back to
**static clean** for that cue specifically (`captionFrame` does this per frame — one word-poor cue
never disables word presets project-wide) and surfaces the `explanation` as a visible on-preview
notice. `summarizeWordMotion(cues)` gives the Style panel project-wide counts (`complete`,
`estimated`, `unavailable`) so `StylePanel.tsx` can disable the three word-dependent radio options
outright when **no** cue in the project could ever use them, and otherwise show the counts plus the
selected cue's own reason. Rendering itself never estimates word timing — that stays an explicit,
opt-in user action in the inspector (`estimateWordTimings`, T4); the renderer only ever consumes
timing that already exists and labels it honestly.

Editing a cue's text used to break this silently: `retainSafeWordTimings` (deliberately
conservative — it drops any edited/inserted/reordered token's timing) left the cue `incomplete`,
so a word-driven preset a cue was explicitly set to fell back to static-clean with the *stored*
preset unchanged and no visible reason. `update-text` (`src/core/captionCommands.ts`) now restores
only the gap this edit just opened — via the same `estimateMissingWordTimings` used elsewhere — but
**only on a cue that already had complete timing before the edit**; a cue that never had word
timing (imported SRT) never gains invented timing from a text edit. `CaptionsPanel.tsx`'s transcript
list shows an "Animation paused" / "Estimated timing" badge (`wordMotionAvailability`, scoped to
that cue's *effective* motion) so the state is visible without opening Caption Tools.

### Word display (R3, slice 1)

`WORD`/`LINE` (the timeline toolbar toggle) is the saved project field `project.captionDisplay:
'line' | 'word'`, not a view-only concern — in `'word'` display, the preview and export each show
**one word at a time** for the active cue, with the chosen motion preset applied per word, instead of
the whole line. Both `CaptionStage` (`App.tsx`) and `frameRequestAt` (`src/export/plan.ts`) make this
choice through the same pure helper, `src/captions/wordDisplay.ts`, so preview and export can never
disagree for a given timestamp:

- `activeWordIndex(cue, timestampUs)` — which word to show, under a **hold-through-gaps** rule: each
  word's window runs `[word.startUs, nextWord.startUs)`, the first word's window absorbs any lead-in
  gap (starts at `cue.startUs`), and the last word's window closes at `cue.endUs`. The windows
  therefore partition `[cue.startUs, cue.endUs)` exactly, so word display never shows a blank frame
  while the line cue itself is active — a gap between two timed words holds the earlier word rather
  than showing nothing. Gated by `wordMotionAvailability(cue).enabled`, the same gate the per-word
  motion presets use; when it is not enabled, the caller shows the full line and the `explanation` as
  a notice instead ("Showing the full caption: …").
- `wordDisplayCue(cue, index)` — the synthetic one-word cue for that index. Its text is the word's
  span from `locateWordSpans`, always a whole token on grapheme boundaries, so showing it alone can
  neither split a Malayalam conjunct/vowel-sign cluster nor fragment a shaping run. Its one word's
  own `startUs`/`endUs` are **overwritten to the held window**, not the word's original narrow
  duration — so a motion preset like word pop or active-word-highlight sees one word spanning the
  whole time it is on screen, including any trailing gap it is held through. Offsets are re-based to
  `0`/`text.length`: `locateWordSpans` treats an explicit `textStart`/`textEnd` as authoritative, so a
  word copied with its original line-relative offsets would fail to locate against its own one-word
  text and the cue would fail `cueSchema`/`frameRequestSchema` — a real bug caught by a parity
  regression test (`src/export/plan.test.ts`) before this shipped.
- `displayCue(cue, display, timestampUs)` — the convenience both call sites use: the line cue
  unchanged in `'line'` display, for a null cue, or when word display is unavailable.

Rendering still never estimates word timing on its own. Missing timing is filled in only by an
explicit user action — toggling to WORD runs the `set-display` command
(`src/core/captionCommands.ts`), which gap-fills (`estimateMissingWordTimings`,
`src/core/wordTiming.ts`) only the cues and only the token runs that have no timing yet, leaving
already-timed words (and their provenance) untouched; the results are labelled `estimated` /
`needsReview` like any other estimate. `CaptionPreview` takes an optional `fontSample` (the enclosing
line's text) so switching between a line's own words never re-triggers the font-loading effect, which
keyed on `cue.text` and would otherwise blank the caption for a frame at every word boundary.

### Appearance controls and saved presets

`src/captions/style.ts` defines `CaptionStyle = { motion, appearance }` and the schema that bounds
every appearance field (hex colors; clamped numeric ranges; a font-family regex that accepts local
font names but rejects CSS-injection-shaped strings like `url(...)`, `;`, or `<`/`>`) — only
structured data crosses the project/IPC boundary, never arbitrary CSS. `captionStyleInputs(style,
viewport)` maps it into `LayoutInputs`, scaling font size/outline/shadow/padding by
`viewport.width / 1080` so the same style renders proportionally identical at portrait and
landscape composition widths; switching `motion` alone never touches `appearance` (`style.test.ts`
pins this). Controls: font family (installed system faces only, matching the R1 stack, plus a
validated custom-name field) and size, primary/secondary color, outline color/width, shadow
color/blur/offset, background color/opacity/padding, fractional position (plus a 3×3 quick-position
grid), and max lines.

`project.captionStyle` (schema 2, optional) is the live style; `project.savedCaptionPresets` is a
named list of complete `{motion, appearance}` snapshots (`src/captions/presets.ts`:
`saveCaptionPreset`/`applyCaptionPreset`/`deleteCaptionPreset`, each a pure `CaptionProject ->
CaptionProject` command). Style is therefore project state: it saves, reopens and undoes like any
other edit. `App.tsx` holds one live draft (`styleDraft`) that feeds the preview immediately while a
control is being dragged, and commits exactly one history step when the gesture finishes (control
blur/pointer-up for continuous inputs; immediately for selects, radios and buttons) — the same
draft/commit-on-blur shape `CueEditor` already uses for text/timing fields.

### Export obligation

A future export pipeline (X1/X2) must render frames by calling `captionStyleInputs` +
`layoutCaption`/`layoutCaptionWords`/`captionFrame` with the project's stored `captionStyle` and
each frame's absolute source timestamp — the same functions and the same `CaptionView` painter the
preview uses. It must not reimplement motion math or word-effect painting a second time.

### Verification

`motion.test.tsx` (26 tests): fixed-timestamp tables for every preset built from a real mixed
Malayalam/English cue with model word timing (conjuncts, vowel signs, English tokens), asserting
exact opacity/active/revealed/scale values at chosen absolute timestamps, seek-order independence,
every `wordMotionAvailability` reason, and that every word region — and every word-effect
overlay — stays grapheme-boundary-aligned and unfragmented in the rendered HTML. `style.test.ts`
(13 tests) covers schema rejection of CSS-injection-shaped font names and out-of-range values,
portrait/landscape scale parity, motion-never-resets-appearance, and project round-tripping
including duplicate-preset-ID rejection. `presets.test.ts` (6 tests) and `StylePanel.test.tsx`
(5 tests) cover the preset commands and the panel's accessible labels/disabled-state wiring.

`npm run smoke:captions` extends the R1 fixture grid with a real-Chromium R2 motion grid: all 5
presets × {portrait, landscape} × {mid-word, gap} timestamps, plus dedicated estimated-timing,
cue-only-fallback and phrase-fade-ramp-start edge cases (23 cases total), each checked for
unfragmented shaping runs, the right word-effect count for the right moment, and correct
notice/fallback text. A further "controls driving the real preview" section mounts the actual
`StylePanel` + `CaptionPreview` sharing one React state (the same wiring `App.tsx` uses) and drives
every control with genuine DOM events (native value setters, `input`/`pointerup`/`change`/`click`,
real `focus`/`blur`) in the real window, asserting the shared preview's computed style/geometry
actually changed for color, outline width, background opacity, padding-driven bounds, position,
max-line collapsing, font family, motion (plus its word-effect count), and preset save/apply.

## Typography, alignment, fills and effects (R2.1)

Style controls beyond R2's original set, all still flowing through `captionStyleInputs` →
`LayoutInputs`/`CaptionAppearance` → `CaptionView`, never as raw CSS strings:

- **Typography lives in `CaptionFont`.** `weight`/`italic`/`letterSpacing`/`wordSpacing`/
  `textTransform`/`lineHeight` are fields on the same `CaptionFont` object the DOM measurer and the
  painter both read (`captionTypography(font)`), so a control can never change what's painted
  without also changing what's measured, or vice versa. Every CSS length in `captionTypography` is
  an explicit `px` string — `Object.assign(span.style, …)` silently ignores a bare number, which
  would desync measurement from paint.
- **Alignment is decoupled from position.** `LayoutInputs.alignment` (`'left' | 'center' | 'right'`)
  sets each line's own `x` inside the caption block; `position.horizontal/vertical` still only place
  the block itself within the safe area. Before this slice the two were the same value.
- **The emphasis (active-word) face is measured, not just painted, distinctly.** An optional
  `LayoutInputs.emphasisFont` (weight/italic only — deliberately never a different family, see
  `StylePanel.tsx`'s hint) is measured against the *same complete line* as the regular face
  (`layoutCaptionWords`), because a bolder/italic face has different glyph advances; cropping a bold
  shaping run with the regular-face rect would clip real glyphs. `WordRegion.emphasis` records that
  face's own rect, resized to the layout's already-fitted font size. `CaptionView`'s `wordBox` unions
  the regular and emphasis rects (plus stroke bleed) so both the punch-out mask and the crop box
  fully cover whichever face is wider — and the punch-out now triggers for `active-word-highlight`
  too, not only `word-pop`, whenever a region carries a distinct emphasis face.
- **A gradient fill is a second complete text copy.** `CaptionAppearance.fill`/`secondaryFill`
  (`{from, to, angle}`) paint as an extra `background-clip: text; -webkit-text-fill-color:
  transparent` copy stacked exactly over a solid copy that carries shadow/glow/3D-depth/stroke.
  Chromium paints `text-shadow` *above* a `background-clip:text` background, so those effects must
  live on the layer underneath, never on the gradient layer itself — true for both the base line and
  the active-word overlay. Both copies remain whole, unbroken shaping runs (no per-word/per-grapheme
  split); the gradient copy is only emitted when a fill is actually set, so the default (no-fill)
  path renders exactly as before.
- **Glow and 3D depth are `text-shadow` layers, composed with the existing drop shadow into one
  ordered list** (`captionStyleInputs`): 3D depth pushes `depthAmount` zero-blur offset layers
  (`i·scale px, i·scale px`), glow pushes three same-color blur layers (a single `text-shadow`
  entry does not read as a soft glow), and the drop shadow — if enabled — goes last. Each of
  Background/Shadow/Stroke/Glow/3D-Depth has its own on/off toggle (`backgroundEnabled`/
  `shadowEnabled`/`strokeEnabled`/`glowEnabled`/`depthEnabled`); an old saved style with no toggle
  field infers `backgroundEnabled` from whether its `backgroundOpacity` was already above 0, and
  `shadowEnabled`/`strokeEnabled` default `true`, so a style saved before this slice still renders
  the same (`z.preprocess` in `captionStyleSchema`). Glow and 3D depth extend past the caption's own
  line box — same caveat as arbitrary shadow extents in R1: reserve padding for them.
- **Emphasis Size/Glow/Styles are per-word paint overrides, layered on the same emphasis face.**
  `emphasisScale` (1-2) is a *static* multiplier on the emphasized word's font size — independent of
  word-pop's own transient `scale` animation — applied to the unfitted `emphasisFont.size` in
  `captionStyleInputs` (`a.fontSize * a.emphasisScale * scale`) so it still shrinks proportionally
  when the max-lines fitting loop shrinks the base font. `fittedEmphasisFont(inputs, fitted)`
  (`renderer.ts`) is the one place that re-derives the fitted emphasis font from a fitted base font,
  preserving the *ratio* `emphasisFont.size / font.size` rather than re-forcing equality to the base
  size — `layoutCaption`'s per-step measurement, `layoutCaptionWords`, and `SelectedEmphasisLine`
  all call it, so a 1.5x emphasis word never collapses back to 1x after fitting. `emphasisGlowEnabled`/
  `emphasisGlowColor` add a *second*, independently-composed shadow list (`appearance.emphasisShadow`
  in `captionStyleInputs`) built by the same depth→glow→drop-shadow ordering as the base `shadow`,
  but substituting `emphasisGlowColor` for the glow layer's color when the emphasis glow is on (or
  reusing the base glow when only the base glow is on); emphasis glow always reuses the base
  `glowRadius` rather than exposing a second radius control. `emphasisShadow` is left `undefined`
  whenever it would be identical to `shadow`, so an emphasized word inherits the base line's shadow
  in the common case instead of painting a redundant duplicate. `emphasisTextTransform` (`'none'`
  follows the base `textTransform`) and `emphasisUnderline` (OR-ed with the base `underline` into
  `appearance.emphasisUnderline`) are painted per emphasis run in `SelectedEmphasisLine`, not on the
  line `<div>` — `text-decoration` does not inherit into an `inline-block` word span, so painting the
  base `underline` on the line wrapper never actually reached word runs on an emphasized line either;
  moving both to per-run styles fixed that pre-existing gap along with adding the emphasis-only case.
- **Spotlight** (`Emphasis` → mode) dims the whole base line to `SPOTLIGHT_DIM` (`.35`) while the
  active-word overlay paints at full opacity on top, for `active-word-highlight`/`word-pop` only —
  progressive reveal has no per-word overlay to contrast against, so spotlight does not apply there.
- **`textTransform`/`underline` are paint-time CSS only.** `text-transform` never rewrites the
  stored cue text (AGENTS.md); Malayalam is unaffected by upper/lowercasing. `letter-spacing`
  applies between shaped grapheme clusters — Indic conjunct formation is mandatory shaping, not an
  optional ligature, so conjuncts and vowel signs stay attached even with wide letter-spacing.

### Installed-font enumeration

`src/style/localFonts.ts` wraps Chromium's Local Font Access API (`window.queryLocalFonts()`,
ambient-typed in `env.d.ts` since it isn't in TS's `lib.dom` yet). It requires transient user
activation, so it is only ever invoked from the Style panel's own "Load installed fonts" click —
never automatically on mount — and `electron/main.ts`'s `setPermissionRequestHandler`/
`setPermissionCheckHandler` grant only `local-fonts` and `fullscreen`, and only to this app's own
origin. Faces are mapped to a numeric `weight`/`italic` pair (never a postscript name, so a saved
style stays portable across machines) and grouped by family with `FONT_FAMILY_CHOICES` pinned
first. `fallbackCatalog()` (four generic faces per fixed family) covers unsupported/denied/
not-yet-granted; no font is bundled, downloaded, or sent anywhere.

### Per-frame preview clock

The preview's only playback clock used to be `<video onTimeUpdate>`, which Chromium fires roughly 4
times a second — coarser than a spoken word (150-400ms) or word-pop's own 200ms curve, which is why
word-by-word motion looked broken even though `captionFrame` was already correct at any given
timestamp: it was simply being *evaluated* too rarely during playback. `src/core/playbackClock.ts`
ticks once per **presented video frame**, using `requestVideoFrameCallback`'s own `metadata.
mediaTime` (falling back to `requestAnimationFrame` + `currentTime`) rather than an accumulated
elapsed-time estimate, so seeking/pausing/resuming stay exact and the clock can never drift from the
actually decoded frame. Every value is `Math.round(seconds * 1e6)`, matching the app's integer-
microsecond timebase; `set` is idempotent (no notify on an unchanged value). Only `App.tsx`'s
`CaptionStage` subscribes to it (`useSyncExternalStore`), so a 60fps tick re-renders just the
caption preview, not the transcript list, timeline body or waveform/thumbnails.

## Export frame prototype (X1)

`npm run prototype:export -- --frames 600` bundles and runs the same CaptionPreview/CaptionView,
style mapper, font-ready DOM measurer and absolute source-time evaluator in independent interactive
and offscreen windows. `src/export/parityFixture.ts` supplies one small authored mixed-script/manual-
timing state; real input events change the live preview state before export. CaptionPreview exposes
an optional evaluated-frame observer and a diagnostics toggle; exported pixels omit editor notices
while returned state retains them. The shared painter rebuilds paint nodes per motion/timestamp
with memoized metrics to remove observed word-pop raster history when seeking.

[ADR 0003](decisions/0003-export-renderer.md) records 100 exact same-mode state/pixel comparisons,
600-frame-per-aspect GPU/software throughput and memory, alpha/PNG checks, font failure/recovery,
custom source timestamps/dimensions, cross-mode pixel differences, primary-source alternatives and
redistribution. GPU offscreen bitmap mode is selected to match the normal GPU preview; faster
software rasterization does not have byte-identical GPU preview pixels. The local system-font and
cross-platform limitations above remain. The prototype renders caption PNGs only; the production
video encode/mux/export path and final Export Video control remain X2 work.

## Preview/export parity and sync tolerance (X3)

`npm run parity:export` (`scripts/export-parity.mjs`) is the milestone-gate suite: it synthesizes its
own sources with the pinned FFmpeg (a static SMPTE-bars/tone pattern, so any inter-frame pixel change
is attributable to the caption layer, never scene motion) and runs the **real** production path —
`electron . --export-smoke` through `ExportService`/the job scheduler/the media worker/the separate
GPU export host/the pinned FFmpeg pair — never a second caption implementation. Two checks:

- **Caption-layer parity**: the same `FrameRequest` rendered by the on-screen preview window and the
  offscreen export host, at fixed offsets (one frame before/at cue start, a mid-word boundary, one
  frame before/at cue end) for every one of the five motion presets, portrait and landscape layouts,
  and the project's own Malayalam/English shaping fixtures (`src/captions/fixtures.ts`). This is
  X1's own invariant (ADR 0003), asserted, not just measured: **200/200 cases, 0 differing bytes**.
- **Composited-frame parity**: the same fixed offsets, but comparing the *real encoded MP4 frame*
  against a straight-alpha composite of that same caption-host render over a clean backdrop frame
  taken from the same encode (frame 0, before any cue). Measured on 2026-09-17, macOS arm64 (Apple
  M4 Pro), Electron 44.3.0/Chromium 152.0.7977.78, pinned FFmpeg 9.0.1, **180 real-encode cases**
  across all five presets on landscape (1920×1080) and portrait (1080×1920), plus a rotated source
  (real `-display_rotation 90` display-matrix input, not a re-encode — `ffprobe`'s
  `stream_side_data.rotation` confirmed applied, and the plan's output dimensions came out swapped
  as expected) and a genuinely variable-rate source (`avg_frame_rate` measured `80/3` against a
  constant `r_frame_rate` of `30/1`, the earlier NTSC-only case's sibling). Mean absolute channel
  delta inside the caption's own bounding box averaged **2.09** (worst case **6.74**) and globally
  averaged **0.92** (worst case **2.72**) — this is real h264/yuv420p quantization noise (a
  genuinely caption-free region of this same backdrop measures ~1.6 MSE, max channel delta under 10,
  between two arbitrary frames), not a rendering discrepancy; per ADR 0003's policy, this is not
  claimed as bit-identical. No case showed a systematic shift (no per-preset or per-layout outlier).
- **Long-form sync**: a 240 s source with silent stretches and audible beeps at 5 s/90 s/175 s/230 s.
  Beep audio onset landed **2 ms early** of its authored time on all four beeps (a small, consistent
  AAC pipeline offset, not drift — it does not grow with elapsed time). Caption onset (detected by a
  channel-delta threshold well above that quantization noise floor, restricted to the caption's own
  predicted bounding box) landed at **exactly the planned frame, every time (0 frames off)**.

Reproduce with `npm run parity:export` (needs the pinned FFmpeg/ffprobe configured, same as any other
export smoke, and `npm run build:electron` beforehand); pass `--only landscape,portrait,ntsc,rotated,
vfr,longform` (comma list) to scope a run. Nothing it generates is checked into Git; the evidence
file (machine, versions, every case's measurements) lands at
`docs/decisions/evidence/x3-parity-<date>.json`.

## Authored text actors

`TextOverlayActor` wraps the same `CaptionPreview`/shaped text painter used for captions, so font readiness, Malayalam shaping, whole-token emphasis, backgrounds and template motion stay shared. Its cue is built on demand from `captionTokens` with deterministic `timingSource: 'decorative'` boundaries across the item's hold duration; these timings are not persisted or represented as audio alignment. Enter/exit transforms are composed outside that painter from absolute sequence time by `textMotionAt`, keeping seeking and frame rendering deterministic. The export host waits for every active actor's ready layout before acknowledging a frame request v4.
