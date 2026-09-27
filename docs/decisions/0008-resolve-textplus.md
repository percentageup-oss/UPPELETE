# ADR 0008 — DaVinci Resolve Text+ spike findings

Date: 2026-09-27. Status: **Go** (Text+, Malayalam shaping confirmed correct by the user's visual check).
Several facts below are unconfirmed or unmeasured — each is called out explicitly. Evidence:
`docs/decisions/evidence/resolve-spike-2026-09-27.txt` (script output) and
`docs/decisions/evidence/kathacut-spike-still-2026-09-27.png` (T14 still export).

## Go/no-go on Malayalam

The spike's own still export (T14) came back a blank/black 1920×1080 frame, so it gives no visual
confirmation either way. Separately, the user visually inspected the Malayalam Text+ clip in Resolve's
viewer/Inspector (mixed string `"മലയാളം ക്യാപ്ഷൻ Caption ശ്രീ"`, T9) and confirmed **conjuncts joined and
vowel signs correctly placed — no dotted circles, no detached marks**. That direct visual check is the basis
for **Go**; the blank still is a separate tooling gap (see Size calibration, below) and does not affect this
call.

## Environment

- Resolve: **DaVinci Resolve Studio, 21.0.0.47** (ENV line). Not tested on the Free edition.
- OS: Windows (`package.config:sub(1,1)` = `\`; `tempDir=C:\Users\...\AppData\Local\Temp`).
- Lua: 5.1, LuaJIT `2.1.0-beta3` (T1).
- `bmd.wait` exists and works: T4's 15 s loop at `bmd.wait(0.15)` ran 96 iterations in 15 elapsed seconds
  (~156 ms/iteration, consistent with the requested 150 ms poll interval).
- Responsiveness (T4): the user confirmed Resolve **stayed responsive** while scrubbing/clicking during the
  loop.

## Mailbox

- **`os.rename` over an existing file fails on Windows** (T2c: `ok=nil err="...: File exists"`). The
  remove-then-rename fallback works (T2d: `removeOk=true renameOk=true`). This confirms the README's mailbox
  design is not optional on Windows — brief 03 must implement `os.remove(target)` then `os.rename(tmp,
  target)` unconditionally, not as a fallback path only taken after a failed plain rename (or it must try
  plain rename first and fall back, per the README; either way both branches are exercised on Windows).
- Poll interval: ~150 ms confirmed workable (T4).
- Mac is untested; assume the same `os.rename`-over-existing-file failure until verified there.

## Timeline info (T3)

Read from whatever timeline was current when the script started (a prior run's leftover `KathaCut spike
<time>` timeline, not a real user timeline — still valid for confirming API shapes and return types):

| Field | Value | Lua type |
|---|---|---|
| `GetName()` | `KathaCut spike 1790505393` | string |
| `GetUniqueId()` | `9f624e4c-e3ac-4443-b530-36a5c453f591` | string |
| `GetStartFrame()` | `108000` | **number** |
| `GetEndFrame()` | `110995` | **number** |
| `GetSetting("timelineFrameRate")` | `30` | **number** |
| `GetSetting("timelineDropFrameTimecode")` | `0` | **string** (not boolean) |
| `project:GetSetting("timelineResolutionWidth")` | `1920` | **string** (not number) |
| `project:GetSetting("timelineResolutionHeight")` | `1080` | **string** (not number) |

**Deviation:** resolution width/height and the drop-frame flag come back as strings, not numbers/booleans.
Later briefs' zod schemas for bridge responses must accept strings for these three fields and coerce
(`Number(...)`, `value !== "0"`), not assume JSON-native types.

Separately, T14 constructs a rational-looking frame rate (`fps=30/1`) and a boolean drop-frame (`dropFrame=false`)
for its own timecode math — that's the script's own derived representation, not a second raw API return.

## Placement (T5, T6, T13)

- **T5: no `KathaCut` template bin found.** The user did not complete the manual template-creation step in
  `SPIKE.md`. Placement therefore has **only the fallback method confirmed**:
  `timeline:InsertFusionTitleIntoTimeline("Text+")` (T6, PASS). The `.drb` + `AppendToTimeline` path (the
  primary method the README describes) is **unconfirmed** — not tried, not failed.
- T6 result: inserted at the playhead (`tc=01:00:00:24`), item `start=108024 end=108174` (150 frames = 5 s
  at 30 fps — Resolve's default title duration), `GetUniqueId()` returned a string
  (`bd632bec-1eb2-4b59-8ee6-a1fede8d63de`), `GetFusionCompCount()` returned `1`.
- **T13 (bulk speed) skipped** — it needs a media-pool template item from T5, which doesn't exist yet. **No
  bulk-append timing or recommended batch size exists.** Brief 06 must not assume a batch size from this ADR;
  treat the README's "~2 s per bridge command" as an unverified target until a template exists and T13 runs.

## Text+ input IDs (T7, T9)

T7 dumped all 309 inputs of a freshly inserted default fallback title (`GetInputList()`, before any
customization) — this is ground truth for IDs, types and Resolve's own defaults, not for KathaCut's values.

| KathaCut feature | Confirmed input ID(s) | Type | Default | Notes |
|---|---|---|---|---|
| Text | `StyledText` | Text | `"Custom Title"` | T9 successfully set the mixed Malayalam/English string and read it back unchanged. |
| Font | `Font` | Text | `"Open Sans"` | T9 set `"Noto Sans Malayalam"`, read back unchanged. `SetInput` does not validate the font exists — silent substitution isn't detectable via the API (T9-note); rely on the visual check, not the return value. |
| Style | `Style` | Text | `"Semibold"` | T9 set `"Bold"`, read back unchanged. Same caveat as Font: an invalid style name won't error. |
| Size | `Size` | Number | `0.09` | T9 set `0.08`, read back unchanged. (There's a separate `TransformSize` input, default `0`, that is **not** the same thing — don't confuse the two.) |
| Fill color | `Red1`, `Green1`, `Blue1`, `Alpha1` | Number (0-1) | `1,1,1,1` | Gates on `Enabled1` (default `1`, on). Default element name is `"White Solid Fill"`. |
| Outline enable/color | `Enabled2` (bool-as-number), `Red2`/`Green2`/`Blue2` | Number | `Enabled2=0` | Default element name `"Red Outline"`. T9 set `Enabled2=1, Red2=0, Green2=0, Blue2=0` (black) and read back correctly. **`Red2`/`Green2`/`Blue2` do not appear in T7's `GetInputList()` dump** (only element 1's numbered fields are listed by default — see Deviations) but are directly settable/gettable by ID; confirmed working in T9. Outline **thickness** (`Thickness2`, by analogy with `Thickness1`) was not tested. |
| Shadow enable | `Enabled3` | Number | `0` | Default element name `"Black Shadow"`. Not exercised beyond reading the default. |
| Background box | `Enabled4` | Number | `0` | Default element name is **`"Blue Border"`**, not "Background" — a Resolve default-template naming quirk, not a functional difference. Not exercised. |
| Center (position) | `Center` | Point `{1=x, 2=y, 3=z}` | `{0.5, 0.5, 0}` | T9 set `{0.5, 0.2}`, read back unchanged. **Y-axis direction (up vs. down) is unconfirmed** — the still that would show the resulting position came back blank (see Size calibration). Until verified visually, treat the README's "y up" claim as unverified. |
| Angle | *(no single confirmed ID)* | — | — | The README's assumed `Angle` ID does not appear in the dump. Candidates: `LayoutRotation` (overall composition), `TransformRotation`, or per-level `AngleX/Y/Z` (Line/Word/Character have their own triads). None tested. Brief 05 needs a follow-up test before relying on any of these. |
| Line spacing | `LineSpacing` | Number | `1` | ID confirmed present; value change not tested. |
| Character spacing | `CharacterSpacing` | Number | `1` | ID confirmed present; value change not tested. |
| Horizontal justification | `HorizontalJustificationNew` | Number | `3` | ID confirmed present. **The enum mapping (which number = left/center/right) is unconfirmed** — needs an explicit per-value test with a visual check before Brief 05 encodes it. |
| Write-on | **`Start`**, **`End`** | Number | `Start=0`, `End=1` | **Deviation from the README:** T7's full 309-input dump for this tool shows no `WriteOnStart`/`WriteOnEnd` input at all — the real IDs are `Start`/`End` (labelled "Write On Start"/"Write On End"). Neither of T10's two approaches used these IDs (see Keyframes, below); write-on keyframing itself remains unconfirmed. |

## Size calibration (T9, T14)

**Not measured.** T14's still export returned `exportOk=true result=true`, but the saved PNG
(`kathacut-spike-still-2026-09-27.png`) is a blank black 1920×1080 frame with no visible text — the return
value does not guarantee a valid captured frame. **Root cause is unconfirmed; two hypotheses, neither
proven:**
1. The script's own printed hint: `ExportCurrentFrameAsStill` needs Resolve on the Edit or Color page. Which
   page was active during this run wasn't recorded.
2. A frame/timecode computation bug (raised by a separate, uncommitted local revision of `spike.lua` made
   after this report): if the playhead timecode math assumes the wrong frame-rate/drop-frame combination, the
   playhead could land outside the clip's 150-frame range before the still is captured. This run's own T3/T14
   data shows `dropFrame=0`/`false` and an integer `fps=30`, which doesn't obviously match that failure mode,
   so it may not be the actual cause here — but it's a real class of bug worth ruling out.

Either way, no cap-height/line-height pixel measurement exists for `Size=0.08`, so **brief 05 has no
confirmed formula for converting KathaCut's px font size to Text+ `Size`, and no confirmation of which axis
(width or height) `Size` scales against.** This blocks brief 05's size-scaling work until re-measured: re-run
the spike (ideally after both hypotheses above are addressed) and confirm the still actually shows the styled
Malayalam clip before trusting any pixel measurement taken from it.

## Comp time (T8)

`COMPN_GlobalStart=0 COMPN_GlobalEnd=149 COMPN_RenderStart=0 COMPN_RenderEnd=149 COMPN_CurrentTime=0`. The
range (150 frames) matches the T6 fallback clip's own duration exactly. **Frame 0 is the clip's first
frame** — comp-local time is clip-relative, zero-based. Keyframe offset formula: absolute record frame =
`clip start frame + comp-local frame` (no extra offset).

## Keyframes (T10)

**Both of T10's two approaches target the wrong input name and neither is evidence about real keyframing.**
`resources/resolve/dev/spike.lua` (as currently written, uncommitted at the time of this run — see note
below) has T10-A do `tool.WriteOnEnd = { [0] = 0, [24] = 1 }` and T10-B do `tool.WriteOnEnd =
comp:BezierSpline()` then index into it, both followed by `tool:GetInput("WriteOnEnd", 12)`. **`WriteOnEnd`
does not appear anywhere in T7's 309-input ground-truth dump for this exact tool** — the real ID is `End`
(see the input-ID table above). That fully explains both results:
- `T10-B` **errored**: `attempt to index field 'WriteOnEnd' (a nil value)` — reading back `tool.WriteOnEnd`
  immediately after the assignment is `nil`, because Fusion's tool object doesn't recognize `WriteOnEnd` as a
  field, so nothing was attached to index into.
- `T10-A` **returned `ok=true` with no error**, but this is very likely a silent no-op on an unrecognized
  field name (assigning a Lua table to an arbitrary key on the tool's userdata) rather than a working
  keyframe — consistent with its own readback at frame 12 coming back `nil`.

**Write-on keyframing is therefore completely untested against the real `End`/`Start` IDs.** Brief 07 (and
whoever next revises `spike.lua`) must retarget T10 at `End`/`Start`, and confirm with a rendered frame or
still — not just an error-free `SetInput`/spline call — before relying on write-on keyframing.

*Note: `resources/resolve/dev/spike.lua` had uncommitted local changes at the time of this report (a T10/T14
revision from a prior session, not yet committed) that still use `WriteOnEnd`; this brief is docs-only and
doesn't touch that file, but the next session to edit it should fix the ID along with committing it.*

## Character Level Styling (T11)

**Skipped — zero data.** The user did not complete the manual step (styling a word on a second Text+ clip on
video track 2) before this run. The CLS data format, whether `SetInput` can write it, and the character
counting unit (code points / UTF-8 bytes / graphemes) are all **unresolved**. This blocks any per-character
or per-word styling work (emphasis, brief 07) until a follow-up spike run completes T11.

## Tagging (T12)

- `comp:SetData("KathaCut.cueId", "cue-123")` then `comp:GetData(...)` returned `"cue-123"` — confirmed
  working **within the same Resolve session**. Persistence across a project close/reopen was not tested.
- `item:SetClipColor("Teal")` / `GetClipColor()` round-tripped correctly; `item:GetName()` returned
  `"Text+"`.
- `item:GetUniqueId()` exists and returns a string (confirmed via T6's `uid=bd632bec-...`, not a separate
  T12 test).

## Render (T15)

Not run (`RUN_RENDER` was left `false`). No format/codec/timing data exists yet.

## Deviations from the README's API reference

1. **Write-on input IDs are `Start`/`End`**, not `WriteOnStart`/`WriteOnEnd`. Using the README's assumed
   names throws `attempt to index field 'WriteOnEnd' (a nil value)`.
2. **`GetSetting("timelineDropFrameTimecode")` and the project's resolution width/height settings return
   strings**, not booleans/numbers. `GetSetting("timelineFrameRate")` does return a Lua number. Bridge
   response schemas (zod) must coerce, not assume.
3. **`GetInputList()` is scoped to the currently selected shading element** (`SelectElement`, default `0` /
   element 1). Element 2/3/4's own color/thickness fields (e.g. `Red2`, `Green2`, `Blue2`) don't appear in
   the dump at all, but are directly readable/writable by ID regardless of `SelectElement` — confirmed by T9
   successfully setting the outline color this way. Brief 05's input-ID table (above) already reflects this;
   don't rely on a raw `GetInputList()` dump alone to discover element 2+ IDs.
4. **No single `Angle` input exists.** Candidates are `LayoutRotation`, `TransformRotation`, or per-level
   `AngleX/Y/Z`; untested.
5. **`os.rename` over an existing file fails on Windows** — the remove-then-rename fallback is mandatory, not
   a defensive extra.
6. **`ExportCurrentFrameAsStill` returning `true` does not guarantee a valid captured frame.** The active
   Resolve page (Edit/Color) matters and isn't reflected in the return value.
7. **The default fallback title's own defaults** (`StyledText="Custom Title"`, `Font="Open Sans"`,
   `Style="Semibold"`, `Size=0.09`, 150-frame/5 s duration) are Resolve's generic title defaults, not
   KathaCut-specific — every field must be set explicitly on insert; nothing usable can be left at default.

## Open items before later briefs proceed

- ~~Template bin pending~~ **Done (2026-09-27):** `resources/resolve/kathacut-captions.drb`, with bin
  `KathaCut` holding the Text+ item **`Fusion Title`** (an `Sm2MpGenerator` in the bin XML) and an unused
  `Timeline 1`. Exported via right-click on the bin **in the Media Pool's bin-list sidebar** → Export Bin. The
  clip area's context menu has only Import Bin.
- Re-run the spike: now folded into **brief 09** (`09-edit-spike.md`, tests E7–E11), together with the timeline
  edit read/write tests. Re-run the spike once the template exists, with Resolve on the Edit/Color page for T14, and with a
  hand-styled second clip on video track 2 for T11, to fill in: size calibration, `Center` Y-axis direction,
  the `HorizontalJustificationNew` enum mapping, T13 bulk-append timing, Character Level Styling format, and
  a confirmed write-on keyframe readback.

## Addendum (2026-09-27): launcher globals

The first real run of the bridge (brief 03's launcher, `dofile(bridge.lua)`) failed with `attempt to index
global 'KATHACUT' (a nil value)`. **A Resolve menu script's globals are not visible to a file it loads.**
`dofile` did not see them, and neither did `loadfile` + `setfenv(chunk, getfenv(1))`. `Resolve` and `bmd` are
affected the same way. The fix, `e413a6d`: the generated launcher keeps its config in a **local** and calls
`loadfile(bridge.lua)(KATHACUT, Resolve, bmd)`, and `bridge.lua` reads them from `...`. Any future script
loaded from a menu script must take what it needs as arguments. With that fix the bridge connected in Resolve
Studio 21.0.0.47 on Windows.
