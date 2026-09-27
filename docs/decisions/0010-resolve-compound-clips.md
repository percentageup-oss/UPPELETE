# ADR 0010 — Reading a Resolve compound clip's inner edit (compound spike findings)

Date: 2026-09-27. Status: **Accepted** for brief 14 (unpack compound clips on import), with the gaps under
"Unconfirmed" handled conservatively: anything brief 14 can't classify with confidence is listed as skipped,
never guessed.

Source: one run of `resources/resolve/dev/compound-spike.lua` (brief 13) in **DaVinci Resolve Studio
21.0.0.47 on Windows**. Evidence: `docs/decisions/evidence/resolve-compound-spike-2026-09-27.{txt,otio,fcpxml}`.

## Test timeline (what was actually run)
The run used a simpler timeline than `SPIKE3.md` asked for, and no hand notes came back. Ground truth comes
from cross-checking the two export formats against each other and against the C2 read-back.

- Timeline 1: 24 fps, start frame 86400 (01:00:00:00). Items on V1:
  1. `chatgpt-newplan.mp4` (30 fps, 1440×2560, **Start TC 01:00:00:00**, 2995 frames), record 86400–87509, with
     the tail trimmed.
  2. **Compound Clip 2**, record 87509–88420 (911 frames), **not trimmed** on the outer timeline. Inside it, on a
     24 fps inner timeline: two trimmed pieces of `chatgpt-newplan.mp4` on inner V1, and a gap + **Text+** + gap on
     inner V2. Audio 1 holds the matching embedded audio.
  3. `captions-short-captions.mp4` (30 fps, Start TC 00:00:00:00), untrimmed.
- V2: one Text+ (86712–86838). A1: the embedded audio of V1, including the compound.

**Not in this run:** an outer trim on a compound, an inner clip at a different fps from the other inner clips,
a retimed clip, a nested compound and a nested timeline.

## Which format carries the inner edit? OTIO.
Both formats carry the compound's inner file clips. **Use OTIO**: it's JSON (no new dependency), it keeps
titles and gaps, and it carries Resolve metadata that identifies compounds.

| | OTIO (`EXPORT_OTIO` = 15) | FCPXML 1.10 (`EXPORT_FCPXML_1_10` = 6) |
|---|---|---|
| Inner file clips | Yes, as a nested `Stack` | Yes, as `<media><sequence><spine>` behind a `ref-clip` |
| Titles (Text+) | Yes, a `Clip` with a `MissingReference` | **Dropped** (outer and inner Text+ are both missing) |
| Gaps | Explicit `Gap` items | Implicit (from `offset`) |
| Source time precision | **Quantised to the sequence rate** (see below) | Exact rational seconds |
| Output | One file | A **directory** named `…fcpxml` holding `Info.fcpxml` (so C1's size read failed) |
| Parser | `JSON.parse` + zod | Needs an XML parser dependency |

`timeline:Export(path, resolve.EXPORT_OTIO, resolve.EXPORT_NONE)` returned `true`. `EXPORT_NONE` exists.

## Export time
The OTIO export took 0.009 s and the FCPXML export 0.006 s, both measured with `os.clock()` on a 3-item
timeline. `os.clock` counts CPU time, not wall time, so this is a lower bound. It's far below the ~2 s command
budget, so **one synchronous bridge command is fine**. The bridge should still log the wall time. If a long
timeline gets close to the budget, switch to start + poll.

## OTIO structure (Resolve's flavour)
```
Timeline.1  global_start_time = 86400@24          (= timeline:GetStartFrame())
  Stack.1 (tracks)
    Track.1 "Video 1"  kind=Video
      Clip.2  "chatgpt-newplan.mp4"   source_range 86400@24 + 1109@24
      Stack.1 "Compound Clip 2"       source_range 0@24 + 911@24
                                      metadata.Resolve_OTIO = { "Sequence Type": "Compound Clip",
                                        "Sequence Fps": 24, "Sequence ID": "{34a2…}", "Link Group ID": 4 }
        Track.1 "Video 1" kind=Video
          Clip.2 "chatgpt-newplan.mp4" source_range 87885@24 + 416@24
          Clip.2 "chatgpt-newplan.mp4" source_range 88301@24 + 495@24
        Track.1 "Video 2" kind=Video
          Gap.1 416 · Clip.2 "Text+" 120 · Gap.1 375
        Track.1 "Audio 1" kind=Audio   (same two clips)
      Clip.2  "captions-short-captions.mp4" source_range 0@24 + 3032@24
    Track.1 "Video 2"  kind=Video   Gap 312 · Text+ 126 · Gap 4614
    Track.1 "Audio 1"  kind=Audio   (mirrors Video 1, including a second copy of the compound Stack)
```

- **Schema is `Clip.2`, not `Clip.1`.** The media reference is `media_references[active_media_reference_key]`
  (key `"DEFAULT_MEDIA"`), **not** `media_reference`. Brief 14's zod subset must read this form. Accepting
  `media_reference` as well does no harm.
- File clip reference: `ExternalReference.1` with `target_url` and `available_range`. Title reference:
  `MissingReference.1` (no URL, `available_range: null`).
- `effects`: every clip has about 12 `Effect.1` entries with `effect_name: "Resolve Effect"` and the real name in
  `metadata.Resolve_OTIO["Effect Name"]`: Transform, Cropping, Dynamic Zoom (disabled), Composite, Lens
  Correction, **Retime and Scaling**, Video Faders, and others. At 100 % speed, every `Parameters` list is empty,
  except Dynamic Zoom's defaults.
- Tracks are listed in the order **all video tracks by index, then all audio tracks**. Their names match
  Resolve's ("Video 1", "Audio 1"). Every track is padded with gaps to the timeline's length.
- A compound on a video track **also** appears as its own `Stack` on the audio track.

## Matching an OTIO compound to a `readTimelineEdit` item
- Video track *n* = the *n*-th `Track` with `kind == "Video"` (don't use the raw index in `tracks.children`).
- Record start = `global_start_time` + the sum of the `source_range.duration` of the earlier children in that
  track (gaps included). This gave 86400 + 1109 = **87509**, which matches C2's `GetStart()`. Resolve's end frame
  is exclusive, and so is this sum.
- Also check that the `Stack.name` equals the item's `GetName()` ("Compound Clip 2" in both).
- The media pool item's `GetUniqueId()`/`GetMediaId()` **don't** match the OTIO `Sequence ID`. C3 also found no
  project timeline with the compound's name, so ids can't be used to match.

## Outer trim → visible window (rule from the OTIO model; the trim itself is unconfirmed)
The compound Stack's `source_range` selects a window of the stack's own time. Inner time starts at **0**: the
first inner item sits at 0, and the compound's Start TC is `00:00:00:00` (C3), as is FCPXML's
`sequence tcStart="0/1s"`. In this run the outer compound wasn't trimmed, so `source_range` was `0 + 911`, and
the inner lengths add up to exactly 911 (416 + 495).

**Rule for brief 14:** the visible inner span is `[source_range.start_time, start_time + duration)` in stack
time, at the stack's rate. Its length equals the compound's record length (911 = 911 here). Positions of inner
items count from 0 (the sum of the earlier siblings' durations). A head trim is expected to show up as a
non-zero `source_range.start_time`. **This hasn't been observed yet.** Brief 14 should check that
`source_range.duration` equals the item's record length (±1 frame) and skip the compound with
"Could not read the compound clip's contents" if it doesn't.

## Source time origin and rates
- An inner clip's `source_range.start_time` is at the **compound's sequence rate** (24, the same as
  `"Sequence Fps"`). It **includes the media's Start TC**: 87885@24 = 3661.875 s, where the Start TC is 3600 s.
- `available_range.start_time` is the **Start TC at the media's own rate**: `108000@30` = 01:00:00:00. The
  duration is the file's frame count (`2995@30`).
- The outer top-level clips follow the same rule. `chatgpt-newplan.mp4`'s source start 86400@24 − 108000@30 = 0,
  which matches ADR 0009's `GetSourceStartFrame() = 0`. `captions-short-captions.mp4` (Start TC 0) has source
  start 0@24.
- **Rule: frames counted from the file's first frame** =
  `round((start.value / start.rate − available.start.value / available.start.rate) × mediaFps)`, where
  `mediaFps = available_range.start_time.rate`. Compute it with rationals and integer µs, and convert each
  boundary on its own.
- **Precision (OTIO quantises):** Resolve rounds inner source times to the **sequence** frame grid. FCPXML has the
  exact values: `start="54928/15s"` = 3661.8667 s → **1856** media frames. OTIO gives 3661.875 s → 1856.25, and
  rounding gives 1856 (it matched). The second clip matched the same way (2376.25 → 2376). The worst-case error is
  half a sequence frame. With media fps above the sequence fps, rounding can land **±1 media frame** off. That's
  the same tolerance ADR 0009 accepted for `GetSourceStartFrame`/`GetSourceEndFrame`, so it's acceptable for
  import. A caption's placement comes from record time, so this doesn't affect sync.
- Take durations from the record side (`source_range.duration` at the sequence rate). This follows ADR 0009's
  rule and is exact here: 416@24 = 52/3 s and 495@24 = 165/8 s, the same as FCPXML.
- **Untested:** a compound whose inner timeline fps differs from the outer timeline, and a compound with a
  non-zero Start TC. Use each `RationalTime`'s own `rate` everywhere and never assume it's the outer timeline's
  fps.

## Titles, generators, gaps, retime and nesting
- **Gaps:** `Gap.1` with a duration. They advance the position and produce nothing.
- **Titles:** a `Clip.2` with a `MissingReference.1` and no URL. `effects` alone can't tell a Text+ title from a
  generator. List both as a title/generator using the existing `KIND_REASON`, or as "Could not read this clip".
- **Inner title tracks (a suggestion for brief 14):** the tested compound, like most real ones, has its Text+ on
  inner V2. Under brief 14's "several video tracks inside → skip the whole compound" rule, this compound would
  not be unpacked. Count only tracks that hold a clip with an `ExternalReference` as "video tracks". List the
  titles on other tracks as skipped ("Title (KathaCut makes its own captions) (inside …)").
- **Retime: unconfirmed.** At 100 %, "Retime and Scaling" has an empty `Parameters` list. No retimed clip was
  tested. Treat an inner clip as **retimed** if any of these holds:
  - its "Retime and Scaling" effect has any parameter;
  - any effect is an OTIO `LinearTimeWarp`/`FreezeFrame`/`TimeEffect`;
  - `source_range.duration` differs from the media span it would need.

  In each case, skip it as "Retimed clip (speed change)". This may over-skip, which is the safe direction.
- **Nested compound / nested timeline: unconfirmed.** A compound is a `Stack` with `"Sequence Type":
  "Compound Clip"`, so a nested compound is very likely a `Stack` inside an inner track. A nested timeline
  probably appears the same way with a different `Sequence Type`. Recurse into any `Stack` (depth ≤ 4). If a
  `Stack` has an unknown `Sequence Type`, skip it rather than guess.

## File paths
- **OTIO `target_url` is a plain OS path, not a URL:** `C:\Users\sadiq\Desktop\Content Creation\Shorts-2\126.
  australia\chatgpt-newplan.mp4`. It has backslashes and no percent-encoding, and it's byte-identical to
  `GetClipProperty("File Path")`. Use it as is. Handle a `file://` URL too, in case a Mac or another version
  writes one: percent-decode it, and strip the leading `/` before a Windows drive letter.
- FCPXML (not used) writes `file://localhost/C:/Users/.../Content%20Creation/...`, percent-encoded with forward
  slashes. It also writes one `<asset>` per use of the same file (r2/r3/r4).

## Consequences for brief 14
- Use OTIO, as brief 14 assumes. No XML dependency is needed.
- Use one synchronous `exportTimelineOtio` command. Start + poll isn't needed at this size.
- Read `media_references[active_media_reference_key]`, not `media_reference`.
- Match compounds by video-kind track index + record start + name.
- Remove the start TC by subtracting `available_range.start_time`.
- Apply the title-track suggestion above so that ordinary compounds (file clips + a title on another track)
  aren't skipped.
- Skip compounds whose outer trim window doesn't line up.

## Unconfirmed
- An outer head/tail trim on a compound (`source_range.start_time ≠ 0`).
- A compound at a different fps from the outer timeline; an inner clip at a different fps from the other inner
  clips; a compound with a non-zero Start TC.
- Retimed clips (the parameters or effect Resolve writes), nested compounds, nested timelines, multicam inside
  a compound.
- Wall-clock export time on a long timeline.
- Resolve Free (only Studio was run), Mac (the path form and `TMPDIR`), and Resolve versions other than
  21.0.0.47.
