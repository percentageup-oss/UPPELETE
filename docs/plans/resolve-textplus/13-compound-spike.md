# 13 — Spike 3: what's inside a compound clip

## Goal
**Import DaVinci timeline** (brief 11) skips compound clips. `bridge.lua` `classifyEditItem` marks
`Type = Compound`/`Timeline` as `compound`, and `planEditImport` (`src/resolve/editToProject.ts`) lists them as
"Compound clip or nested timeline". The user (2026-09-27) wants a compound's **inner clips imported as normal,
editable KathaCut clips** (brief 14).

Resolve's scripting API has no call that opens or decomposes a compound clip. The compound's media pool item has
an empty `File Path` (ADR 0009, run 2), and compound clips aren't listed as project timelines. The one documented
route is `timeline:Export(path, type, subtype)` to **OTIO** or **FCPXML**, which should write the compound's
inner edit as a nested stack. This spike confirms that, and finds out the time origins the file uses.

This session writes the script and its instructions, then stops. A later **findings session** turns the user's
report into ADR 0010 (step 4).

Read `docs/plans/resolve-textplus/README.md` and `docs/decisions/0009-resolve-edit-roundtrip.md` first.

## Read only
- `resources/resolve/dev/edit-spike.lua` and `resources/resolve/dev/SPIKE2.md`: reuse their structure, logging
  helper, `pcall` wrapping and the "copy into Scripts/Utility" instructions. Don't edit them.
- `resources/resolve/bridge.lua`: `classifyEditItem`, `describeEditItem`, `clipProperty`, `callOn`.
- `electron/resolve/install.ts` `generateLauncherContent`: a Resolve menu script's globals aren't visible to a
  file it loads (ADR 0008 addendum). The spike runs directly as a menu script and uses `Resolve()`/`bmd` as its
  own globals.

## Steps
1. **`resources/resolve/dev/compound-spike.lua`** (new; `dev/` isn't packaged). Log one `CNN key=value …` line
   per fact to the console **and** append it to `<temp>/kathacut-compound-spike.txt`. Wrap every test in `pcall`,
   and log `missing` for an absent method or constant. **Read-only** on the user's project: it never edits,
   deletes or adds timeline items.
   - **C1: export.** For each of `resolve.EXPORT_OTIO` (ext `otio`) and `resolve.EXPORT_FCPXML_1_10` (ext
     `fcpxml`), log the constant's value or `missing`. Call
     `timeline:Export(<temp>/kathacut-compound-spike.<ext>, <type>, resolve.EXPORT_NONE)`. Log the return value,
     the file size in bytes (`io.open` + `seek("end")`) and the elapsed `os.clock()` time. If `EXPORT_NONE` is
     nil, try without the third argument and log that. Also log the product name and version
     (`resolve:GetProductName()`, `resolve:GetVersionString()`).
   - **C2: outer items.** For every video and audio track item: log track type/index, `GetName`,
     `GetStart`/`GetEnd`/`GetDuration`, `GetLeftOffset`/`GetRightOffset`, `GetSourceStartFrame`/
     `GetSourceEndFrame`, the media pool item's `Type`, `File Path`, `FPS` and `Start TC`, and
     `timeline:GetStartFrame()` once. Stop after 200 items.
   - **C3: compound pool item.** For the first item whose `Type` contains `Compound` or equals `Timeline`, log:
     - the whole `GetClipProperty()` table (the key/value pairs, sorted);
     - `GetUniqueId()`, `GetMediaId()` if present;
     - whether any project timeline (`project:GetTimelineByIndex(1..n)`) has the same name, and its unique id.
   - At the end, print `DONE` and the three output paths.
2. **`resources/resolve/dev/SPIKE3.md`** (new): step-by-step for the user.
   - Copy the script into Resolve's Scripts folder, Utility sub-folder, as `SPIKE2.md` does.
   - **Prepare** a timeline whose outer V1 has, in order:
     1. an untrimmed file clip;
     2. **Compound A**, trimmed at **both head and tail** on the outer timeline. Inside it: a trimmed file clip
        from a file whose **Start TC isn't 00:00:00:00** (most camera files), a second file clip at a
        **different fps**, a short gap, and a Text+ title on inner V2;
     3. **Compound B**. Inside it: a clip retimed to 50 % and a **nested compound** (a compound inside the
        compound).
     4. Optional: a nested timeline (drag another timeline from the Media Pool onto V1).
   - In the notes, write down each compound's inner clips by hand: file name, the in/out timecodes shown in the
     inner timeline, and where each clip sits inside the compound. The findings session needs this ground
     truth.
   - Run from Workspace → Scripts with the console open.
   - **Send back:** `kathacut-compound-spike.txt`, `.otio`, `.fcpxml` (all in the temp folder the script
     prints), and the hand notes.
3. **Commit** only the two new files: `Add Resolve compound clip spike (brief 13)`. Add a `docs/STATUS.md`
   entry: "not tested, typecheck only; the user runs the spike".
4. **Findings (a second session, after the user's report).** Copy the three files into
   `docs/decisions/evidence/` (named `resolve-compound-spike-<date>.*`). Write
   `docs/decisions/0010-resolve-compound-clips.md`, answering from the files and the hand notes:
   - Which format carries the compound's inner clips? Recommend OTIO if it does, because it's JSON and needs no
     new dependency.
   - Export time vs. the ~2 s bridge command budget. If it's slow, say the export must be start + poll.
   - How a compound appears in the file (e.g. a nested `Stack` inside a `Track`), and how to match it to a C2
     item. Is it track index + record start? Is the OTIO track order the same as Resolve's?
   - Where the **outer trim** lives: the compound's `source_range`, or FCPXML `start`/`offset`. With the
     compound's record duration, which inner window is visible?
   - Inner clips' **source time origin**: does `source_range.start_time` include the media's Start TC? What is
     `media_reference.available_range.start_time`? Compare with ADR 0009, which found `GetSourceStartFrame`
     counts from the file's first frame. State the rule to get "frames from the file's first frame".
   - Which rate each time value uses (inner timeline rate vs. the media rate).
   - How retime (`LinearTimeWarp` effect / FCPXML `timeMap`), titles/generators, gaps, nested compounds and
     nested timelines appear.
   - File path encoding: a `file://` URL vs. a plain path, percent-encoding, and the Windows drive letter form.
   - Unconfirmed: Resolve Free (unless the user ran it there), Mac.
   Update `docs/STATUS.md` and commit: `Record compound clip spike findings (ADR 0010)`.

## Out of scope
Any app feature, bridge command, IPC or schema change (brief 14 does those). Rendering a part of the timeline.

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes (no TS changes are expected).
- [ ] Every test is `pcall`-wrapped and logs `missing` rather than failing on an absent API.
- [ ] The script only writes its three output files in the temp folder; it never changes the user's project.
- [ ] `docs/STATUS.md` entry.

## Manual check for the user
Follow `resources/resolve/dev/SPIKE3.md` and send back the report file, the `.otio` and `.fcpxml` files, and
your notes on each compound's inner clips.
