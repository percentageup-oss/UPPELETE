# 02 — Spike findings → ADR 0008 + Text+ template bin

## Goal
Turn the user's spike results into `docs/decisions/0008-resolve-textplus.md`, the single source of truth for
the Resolve API facts that briefs 03-07 use. Get the Text+ template bin (`.drb`) committed. Decide the go/no-go
on Malayalam shaping.

Read `docs/plans/resolve-textplus/README.md` first.

## Inputs (ask the user if missing, don't guess)
- `docs/decisions/evidence/resolve-spike-<date>.txt` (the report from `resources/resolve/dev/spike.lua`).
- The still, the Malayalam screenshot, the user's responsiveness note, the Resolve edition and version, and the OS.
  Read the PNGs with the Read tool.

## Read only
- `docs/plans/resolve-textplus/README.md`, `resources/resolve/dev/spike.lua`, the evidence files, and one existing
  ADR for format (`docs/decisions/0006-zoom-regions.md`).

## Steps
1. **Go/no-go on Malayalam.** If the screenshot shows broken shaping (dotted circles, detached vowel signs,
   unjoined conjuncts), write the ADR with status **Blocked**, record what broke, add a STATUS entry, commit and
   **stop**. Tell the user that Text+-only conflicts with the Malayalam rule, and that the options are (a) a
   rendered transparent overlay clip from our export host, or (b) Text+ for English only. Do not continue the
   plan.
2. Write `docs/decisions/0008-resolve-textplus.md` with these sections. Each fact cites the spike test ID.
   - **Environment**: Resolve edition(s) and version tested, OS, Lua version, and whether `bmd.wait` works.
   - **Mailbox**: whether `os.rename` over an existing file works (T2). If not, the Lua side does
     `os.remove(target)` then `os.rename(tmp, target)`, and the TS reader retries once on a missing or partial
     file. Poll interval, and the Resolve responsiveness result (T4).
   - **Timeline info** (T3): exact types and values of the start frame, `timelineFrameRate` and resolution.
   - **Placement** (T5, T6, T13): the confirmed method (`.drb` template + `AppendToTimeline`, or the fallback),
     its argument shape, bulk speed per 100 clips, and the recommended batch size (aim for under ~2 s per bridge
     command).
   - **Text+ input IDs** (T7, T9): a table mapping each style feature used by KathaCut to the confirmed input ID,
     value type and range. Cover text, font, style, size, fill color, outline enable/color/thickness, shadow,
     background box, center (y direction), angle, line spacing, character spacing, horizontal justification and
     write-on.
   - **Size calibration** (T9, T14): from the still, the measured cap height or line height in pixels for
     `Size=0.08` at the timeline's resolution. From that, the formula converting KathaCut's font size (px in the
     1080-wide composition) to Text+ `Size`. Say whether `Size` scales with frame width or height.
   - **Comp time** (T8): whether frame 0 is the clip's first frame, which gives the keyframe offset formula.
   - **Keyframes** (T10): the confirmed syntax, or that it failed and why.
   - **Character Level Styling** (T11): the data format, whether it can be written by `SetInput`, and the
     **character counting unit** (code points, UTF-8 bytes or graphemes). Include the rule: ranges only at word
     boundaries, converted to that unit.
   - **Tagging** (T12): whether `SetData`/`GetData` on the comp persists, and whether `GetUniqueId` exists on
     timeline items.
   - **Render** (T15, if run): confirmed format/codec names, settings keys, and the timing for 5 s.
   - **Deviations from the README's API reference**: a list that later briefs must follow.
3. **Template bin.** If placement uses a template, ask the user to export it: in Resolve's Media Pool, right-click
   the `KathaCut` bin → **Export Bin…**, and save it as `resources/resolve/kathacut-captions.drb`. Record the exact
   clip name inside the bin in the ADR. If the user can't do it now, record "template pending" in STATUS. Brief 06
   then needs it before it starts.
4. `docs/STATUS.md` entry: the findings summary, go/no-go, and the pending items.

## Out of scope
App code and the bridge.

## Done checklist
- [ ] ADR 0008 exists with every section above (or status Blocked + reasons).
- [ ] The evidence files are committed under `docs/decisions/evidence/`.
- [ ] `.drb` committed, or marked pending in STATUS.
- [ ] `npx tsc --noEmit -p .` passes.
- [ ] Commit only these files: `Record DaVinci Resolve spike findings (ADR 0008)`.
