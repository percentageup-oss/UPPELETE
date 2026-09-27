# ADR 0009 — Resolve timeline edit read/write (edit spike findings)

Date: 2026-09-27. Status: **Accepted** for brief 11 (import the edit), with the unconfirmed items below treated
conservatively: anything the import can't classify with confidence goes to the render fallback.

Source: two runs of `resources/resolve/dev/edit-spike.lua` (brief 09) in **DaVinci Resolve Studio 21.0.0.47 on
Windows**. Run 2's report is `docs/decisions/evidence/resolve-edit-spike-2026-09-27.txt`. Run 1's E1–E3 lines
are quoted below; its report was overwritten by run 2, and its E5/E6 crashed on a script bug (`pairs` over
`GetSubFolderList()`, fixed with `ipairs` in the spike and in `bridge.lua`).

Neither run's timeline had a **trimmed** clip from a real edit or a **retimed** clip, and E10 (CLS) and the
E11 reopen check were never run. Those gaps are listed under "Unconfirmed".

## Test timelines
- Run 1: timeline 24 fps, start frame 86400. Video 1 held one untrimmed file
  (`chatgpt-newplan.mp4`, 30 fps, 1440×2560, **Start TC 01:00:00:00**, 2995 frames); video 2 a Text+ clip; audio 1
  the file's embedded audio.
- Run 2: the same timeline shape with video 1 = **Compound Clip 1** followed by an untrimmed file
  (`captions-short-captions.mp4`, 30 fps, Start TC 00:00:00:00, 3791 frames).

## Read API (E1) — confirmed
Every one of these exists on a timeline item and returned a value: `GetName`, `GetStart`, `GetEnd`,
`GetDuration`, `GetLeftOffset`, `GetRightOffset`, `GetSourceStartFrame`, `GetSourceEndFrame`,
`GetSourceStartTime`, `GetMediaPoolItem`, `GetFusionCompCount`, `GetProperty()` (table). On the media pool item,
`GetClipProperty(key)` works for `File Path`, `FPS`, `Start TC`, `Frames`, `Type`, `Video Codec`, `Resolution`
and `Duration`.

- **`GetEnd()` is exclusive:** `end = start + duration` on every item in both runs (e.g. 86400 + 2020 = 88420,
  and the next clip starts at 88420).
- **Record frames are absolute timeline frames** including the timeline start frame (86400 = 01:00:00:00 at
  24 fps). Sequence time = `(recordFrame − timeline:GetStartFrame())` at the timeline's fps.
- **Source frames count from the file's first frame, not from its timecode.** Run 1: Start TC `01:00:00:00`
  (108000 frames at 30 fps) but `GetSourceStartFrame() = 0`. `GetSourceStartTime()` is different: it
  returned `3600` (seconds) for that item, i.e. it **includes** the start TC; don't use it for offsets.
- **Source frames are in the source file's own fps.** Both files are 30 fps on a 24 fps timeline and report
  source frames in 30 fps units (3791-frame file → `GetSourceEndFrame() = 3790`). E6 confirms the same for
  placement (below).
- **`GetSourceEndFrame()` is only accurate to about ±1 frame.** Run 1: 2396 record frames at 24 fps =
  99.833 s = 2995 source frames, but source end = 2993 (2994 frames if inclusive). Run 2: 3032 at 24 fps =
  126.333 s = 3790 source frames and source end = 3790. E6's read-back source start was 9 for a requested 10.
  **Rule:** a clip's source duration comes from its record duration (exact on the timeline grid);
  `GetSourceStartFrame` gives the source in-point; `GetSourceEndFrame` is used only for the retime check.
- `GetMediaPoolItem()` returns **nil** for a Text+ title placed on the timeline.
- Speed: `GetProperty()` has **no speed key**. It holds `RetimeProcess` (the interpolation mode, 0 here),
  `MotionEstimation`, zoom/pan/crop/etc. So speed can't be read directly (see classification).
- Read time: E1–E2 on 5 items was instant; no paging needed for the ~2 s command budget at the sizes a short-form
  editor uses. The bridge still caps at 5000 items.

## Classification (E2) — rules for brief 11
In order, per video-track item:

| Signal | Kind | Confirmed? |
|---|---|---|
| `GetMediaPoolItem()` is nil and `GetFusionCompCount() ≥ 1` | `title` | Yes (Text+ in both runs) |
| `GetMediaPoolItem()` is nil, no Fusion comp | `generator` | Guess (no generator in either run) |
| media pool `Type` = `Compound` | `compound` | Yes (run 2; `File Path` was empty) |
| `Type` contains `Multicam` | `multicam` | Guess |
| `Type` contains `Fusion`, `Title` or `Generator` | `fusion` / `title` / `generator` | Guess (the media-pool template reported `Type = Fusion Title` in spike 1, T5) |
| `File Path` empty | `unknown` | — |
| file-backed but `GetFusionCompCount() ≥ 1` | `fusion` (a Fusion effect on the clip) | Guess |
| file-backed and the source span differs from the record span by more than 2 frames | `retimed` | **Guess** (no retimed clip was tested) |
| otherwise | `file` | Yes (`Type = Video + Audio`) |

Retime check: `|(sourceEnd − sourceStart + 1) / sourceFps − duration / timelineFps| > 2 / min(sourceFps,
timelineFps)`. The ±1-frame read-back noise above is well inside that tolerance for a 100 % clip. A clip at
e.g. 50 % or 200 % differs by half its length, so it trips the check.

## Build API (E4–E6) — for brief 12
- `mediaPool:CreateEmptyTimeline(name)` works. On the new timeline, `SetSetting("useCustomSettings", "1")`,
  `timelineFrameRate` and `timelineResolutionWidth/Height` all return true. The still exported from it was
  **1280×720** as requested.
- **Timeline resolution must be read from the timeline, not the project.** The E4 read-back via
  `project:GetSetting("timelineResolutionWidth")` returned the project's 1920×1080 while the timeline was
  1280×720. `bridge.lua`'s `timelineInfo` and `renderProxyStart` now read `timeline:GetSetting(...)` first and
  fall back to the project setting.
- `mediaPool:ImportMedia({ path })` into a bin returns one item. Importing the same path again **does not
  duplicate** it. Find an existing item by walking the bin's `GetClipList()` and comparing `File Path`.
- `AppendToTimeline({ { mediaPoolItem, startFrame, endFrame, recordFrame, trackIndex } })`: `recordFrame` and
  `trackIndex` are honoured, and returned items come back in request order. **`startFrame`/`endFrame` are in
  the source's fps** (30 fps source 10..59 → 41 frames on a 25 fps timeline = 1.64 s ≈ 50/30 s). Whether
  `endFrame` is inclusive can't be told apart at this precision (50 vs. 49 source frames both round to 41).
- **Audio:** `E6-audio` logged nothing. Whether `AppendToTimeline` without `mediaType` also places the
  embedded audio is **unconfirmed**; brief 12 must check the audio tracks after placement.

## Text+ open items from ADR 0008 (E7–E11)
- **Bulk timing (E7 + spike 1 T13):** 20 Text+ clips placed in 0.31–0.38 s CPU and styled in 0.23 s; 100
  placed in 0.35 s and styled in 0.95 s. `INSERT_BATCH` in `electron/resolve/sync.ts` goes from 20 to **50**
  (≈ 0.7 s per command, well inside the ~2 s budget).
- **`Center` y points up (E8):** `Center = {0.5, 0.2}` put the text's middle at 0.80 of the frame height from the
  top, horizontally centred. `centerFor`'s `1 − vFraction` flip is correct.
- **`Size` is the em size as a fraction of frame height (E8):** at `Size = 0.08` the "H" measured 42 px tall on
  the 720 px still (cap height 0.0583 h). With the template font's cap height of ~0.714 em (Open Sans), the em is
  0.0817 h, which matches 0.08. `textPlusSize` (`px → output px / timeline height`) already does this. One data
  point, on a 16:9 landscape timeline; a portrait timeline is unmeasured.
- **Horizontal justification (E8): unresolved.** The three stills for `HorizontalJustificationNew` 0/1/2 are
  byte-identical: a single line stays centred on `Center` whatever the value. It can only affect multi-line
  text, which the spike didn't test. `horizontalJustificationFor` stays a placeholder.
- **Malayalam in the template font:** the still shows **tofu boxes** after "H". The template's font has no
  Malayalam glyphs, so every clip must set `Font` explicitly (sync already does). This isn't a shaping failure.
- **Write-on keyframes (E9):** `tool.End = comp:BezierSpline()`, `tool.End[0] = 0`, `tool.End[24] = 1` inside
  `Lock/Unlock`, then `GetInput("End", 12)` = **0.5**. Keyframes on `End` work (read back, not seen rendered).
- **Character Level Styling (E10): no data.** Skipped in both runs (no `CLS` clip on video track 2).
- **Tag persistence (E11): unknown.** Tagging worked in-session; the save/close/reopen check wasn't run.

## Unconfirmed (to re-check when convenient)
- Trimmed clips from a real edit: `GetSourceStartFrame` on a clip whose in-point isn't the file's first frame
  (E6's placed clips point to ±1 frame accuracy, but those weren't user trims).
- Retimed, multicam, generator and Fusion-clip signals (guessed rules above).
- `endFrame` inclusivity in `AppendToTimeline`; audio placement.
- CLS format and character unit; tag persistence across reopen; justification enum; portrait size calibration.
