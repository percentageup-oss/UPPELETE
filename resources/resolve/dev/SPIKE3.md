# Resolve compound clip spike (3) — instructions

This is the third spike script. Resolve's scripting API has no call that opens or decomposes a
compound clip (a compound's media pool item has an empty `File Path`; ADR 0009). The one documented
route to a compound's inner edit is exporting the timeline to OTIO or FCPXML. This spike exports both
formats and finds out whether either one carries the compound's inner clips, how long the export takes,
and how the compound's media pool item identifies itself, so a later findings session (ADR 0010) can
work out how to match the exported file back to your timeline.

It's read-only: it only reads the timeline that's current when it starts and calls `timeline:Export()`.
It never adds, edits or deletes anything on your timeline or in your media pool.

## 1. Install the script

Copy `resources/resolve/dev/compound-spike.lua` into Resolve's Scripts folder, same place as the
earlier spikes:

- **Windows:** `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility\`
- **macOS:** `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/`

Restart Resolve if it was already running, so the new script shows up under Workspace → Scripts.

## 2. Prepare a timeline with compound clips

Open a **throwaway** Resolve project. Build one timeline whose outer video track 1 has, in this order:

1. An **untrimmed** file clip (a plain clip, no trimming).
2. **Compound A** — trim it at **both the head and the tail** on the outer timeline (drag both edges
   in from the source). Inside Compound A (double-click it to open, or edit it before making it a
   compound):
   - a **trimmed** file clip from a file whose **Start TC isn't 00:00:00:00** (most camera files have
     a non-zero start timecode; a screen recording or an export from an NLE is often `00:00:00:00`, so
     avoid those for this one),
   - a second file clip at a **different frame rate** than the first,
   - a short **gap** (an empty section with nothing on the track),
   - a **Text+ title** on inner video track 2.
3. **Compound B**. Inside it:
   - a clip **retimed** to 50% speed,
   - a **nested compound** — a compound clip inside Compound B.
4. Optional, if you have another timeline in the project: drag it from the Media Pool onto V1 as a
   **nested timeline** clip.

**Before running the script**, write down by hand, for each compound (A, B, and the nested one inside
B): each inner clip's file name, the in/out timecodes shown on the inner timeline, and where it sits
inside the compound (track, order). The findings session needs this as ground truth to check the
exported files against — there's no other way to know what should be inside them.

## 3. Run it

Go to **Workspace → Scripts → compound-spike**. Open **Workspace → Console** first so you can watch the
output live. The script runs to completion on its own — no pauses, no prompts.

It prints `DONE` followed by the three file paths it wrote, then stops.

## 4. Send back

Please send back all of the following, from the temp folder the script prints (`%TEMP%\...` on Windows,
`$TMPDIR/...` or `/tmp/...` on macOS):

- `kathacut-compound-spike.txt` — the full console report.
- `kathacut-compound-spike.otio`
- `kathacut-compound-spike.fcpxml`
- Your hand-written notes on each compound's inner clips from step 2.

If either export failed or came back empty, send the report anyway — a `FAIL` or `missing` line is
useful information too.
