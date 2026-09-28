# DaVinci Resolve integration

Status: **implemented, not yet verified end-to-end in Resolve** — every piece below passes
`npx tsc --noEmit -p .`, but per-brief manual checks in a real Resolve session are still outstanding
(see [STATUS.md](STATUS.md)'s "Resolve Text+" entries for which pieces the user has actually run).
Verified so far: the bridge connects and shows Connected (Resolve Studio 21.0.0.47, Windows).
Render, sync, import and push have not been run against real Resolve yet.

## What it does

KathaCut can connect to a running DaVinci Resolve project and exchange captions and a video edit with
it, entirely on the local machine:

1. **Connect.** A small Lua script started from inside Resolve (Workspace → Scripts → KathaCut) opens
   or focuses KathaCut and shows a live connection pill (project › timeline).
2. **Bring a Resolve timeline into KathaCut**, either by:
   - **Importing the edit** — rebuilds the cuts from the original media files (no render), or
   - **Rendering a proxy** — renders the timeline to a small H.264 file when the edit can't be rebuilt
     (retimed clips, compound/multicam clips, titles, unreadable formats).
3. **Transcribe, translate, style and template** the project exactly as any other KathaCut project —
   there is no plugin-specific transcription path.
4. **Sync to Resolve** sends only the captions that changed to a "KathaCut" video track as native,
   editable **Text+** clips: font, size, colors, outline, shadow, box, position, some emphasis and some
   word animations. A per-feature support list says what actually made it across.
5. **Create in DaVinci** goes the other way: it builds a brand-new timeline in the open Resolve project
   from KathaCut's own video clips, then syncs captions onto it.

Everything is local. The Lua script runs inside the user's own Resolve; nothing is uploaded, no
account is needed, and both Resolve **Free** and **Studio** work (Free only runs scripts started from
inside Resolve, which is exactly how this works).

## Install, connect and sync

1. **Install the plugin.** KathaCut → Settings → DaVinci Resolve → **Install plugin**. This writes one
   small generated launcher file, `KathaCut.lua`, into Resolve's Scripts folder (see [install paths](#install-paths-per-os)
   below). No other file is added there — Resolve turns every `.lua` file in that folder into its own
   menu entry, so only this one launcher is written.
2. **Restart Resolve** if it was already open (Resolve only scans the Scripts folder at startup).
3. **Connect.** In Resolve, open the project/timeline you want to work with, then
   **Workspace → Scripts → KathaCut**. This starts the bridge script inside Resolve and launches (or
   focuses) KathaCut. KathaCut's status pill changes to **Connected: `<project>` › `<timeline>`**.
4. **Bring the timeline into KathaCut**, from Home:
   - **Import DaVinci timeline — "`<name>`"** (default): rebuilds cuts from the original files. Anything
     it can't classify confidently (retimed clips, compound/multicam clips, titles, unreadable formats,
     missing files) is listed in a review dialog with **Import the rest** / **Render instead** / Cancel.
   - **Render instead**: renders the whole timeline to a small proxy and opens that as one clip.
5. Transcribe, style and edit captions as usual.
6. **Sync to Resolve** (a button beside the connection pill, with a change count) sends only changed
   captions as Text+ clips to a **KathaCut** video track. A review dialog shows counts, the target
   track, any conflicts (see [Sync, diff and conflicts](#sync-diff-and-conflicts)) and the
   [support matrix](#text-support-matrix). Clicking through applies the sync as one undo step in
   KathaCut.
7. **Create in DaVinci** (beside the pill, once the project has captions) builds a new timeline in the
   currently open Resolve project from KathaCut's video clips and syncs captions onto it. It never
   switches or creates a Resolve project, and never touches an existing timeline.

## Architecture

```
Resolve (Free/Studio)                         KathaCut (Electron)
Workspace → Scripts → KathaCut.lua  ──dofile──►  <resources>/resolve/bridge.lua  (ships with the app)
   bridge.lua loop (Lua, inside Resolve)          electron/resolve/bridge.ts  (main process)
        ▲    polls request.json every ~150 ms          │ writes request.json (tmp + rename)
        └──── writes response.json, status.json ◄──────┘ reads/validates response.json with zod
                     <userData>/resolve-bridge/   (userData = %APPDATA%/caption-studio, ~/Library/Application Support/caption-studio)
```

- **Why a file mailbox, not a socket:** Resolve Free only runs scripts started from inside Resolve
  (external scripting is Studio-only), and Resolve's bundled Lua has no sockets without FFI. The
  open-source AutoSubs plugin (MIT) uses the same mailbox pattern; it is design inspiration only — no
  AutoSubs code is copied.
- **Why Lua:** Lua (LuaJIT) ships inside Resolve. Python would need a separate install most users don't
  have.
- **The installed launcher is generated, not hand-written.** `KathaCut.lua` bakes in absolute paths
  (`electron/resolve/install.ts`'s `generateLauncherContent`) and `loadfile`s `bridge.lua` and
  `json.lua` from the app's own resources, so bridge updates ship with the app — reinstalling the
  plugin is only needed if the app itself moves. A Resolve menu script's globals (`Resolve`, `bmd`) are
  **not** visible to a file it loads, so the launcher passes its config and those globals as explicit
  arguments to `bridge.lua`, which reads them from `...` (this bit the first real run; see
  [STATUS.md](STATUS.md), "Resolve bridge: first real connection").
- **All caption logic lives in TypeScript.** `bridge.lua` is a dumb executor of a fixed command
  whitelist (`handlers` in `resources/resolve/bridge.lua`) and never `load`s or `loadstring`s request
  content. JSON is (de)serialized by a small hand-written encoder/decoder, `resources/resolve/json.lua`
  — no third-party Lua library is vendored.
- **Honest parity:** Text+ is Resolve's own renderer, not KathaCut's. The Sync dialog always shows the
  [support matrix](#text-support-matrix); the Resolve result is never claimed to match the KathaCut
  preview pixel-for-pixel.

### Mailbox protocol v1

Directory `<userData>/resolve-bridge/`. Every file is JSON, written as `<name>.tmp` then renamed over
the target (`os.rename` over an existing file **fails on Windows**, so the target is removed first,
unconditionally — confirmed by the spike, ADR 0008).

- `app.json` (KathaCut writes every 2 s while running): `{ v, pid, heartbeatAt }`.
- `status.json` (Lua writes on start and about every 1 s): `{ v, sessionId, heartbeatAt, product, version, projectName, timelineName, busy }`.
- `request.json` (KathaCut writes; one slot): `{ v, sessionId, seq, command, params }`. KathaCut sends
  the next request only after the response for `seq` arrives or times out (10 s, `ResolveBridge.request()`).
- `response.json` (Lua writes, then deletes `request.json`): `{ v, sessionId, seq, ok: true, result } | { v, sessionId, seq, ok: false, error }`.
- Lua ignores a request whose `sessionId` isn't its own, and exits when `disconnect` is received, when
  `app.json` is older than 60 s, or when no `app.json` appears within 60 s of the bridge launching
  KathaCut.

### Command list

Every handler is in `resources/resolve/bridge.lua`'s `handlers` table; every handler must finish in
about 2 seconds so Resolve stays responsive — long work (renders) uses a start + poll pair.

| Command | Params | Result | Added |
|---|---|---|---|
| `ping` | — | `{ pong, version }` | 03 |
| `timelineInfo` | — | `{ projectName, timelineName, timelineId, startFrame, endFrame, frameRate, dropFrame, width, height }` | 03 |
| `disconnect` | — | `{}` (bridge exits its loop) | 03 |
| `renderProxyStart` | `{ targetDir, name, maxLongSide }` | `{ jobId, width, height }` | 04 |
| `renderStatus` | `{ jobId }` | `{ status, percent, error }` | 04 |
| `renderCancel` | `{ jobId }` | `{}` | 04 |
| `ensureTemplate` | `{ timelineId, clipName, drbPath }` | `{ imported }` | 06 |
| `findTrack` | `{ timelineId, name }` | `{ trackIndex }` | 06 |
| `ensureTrack` | `{ timelineId, name }` | `{ trackIndex }` | 06 |
| `readClips` | `{ timelineId, trackIndex }` | `{ clips: [{ clipId, startFrame, endFrame, key, text }] }` | 06 |
| `insertClips` | `{ timelineId, trackIndex, templateName, clips: [{ key, startFrame, endFrame, text, inputs, keyframes, styleRanges }] }` | `{ clips: [{ key, clipId, startFrame, endFrame, error }] }` | 06 |
| `updateClips` | `{ timelineId, trackIndex, clips: [{ clipId, spec }] }` | `{ clips: [{ clipId, error }] }` | 06 |
| `deleteClips` | `{ timelineId, trackIndex, clipIds }` | `{ deleted, missing }` | 06 |
| `jumpTo` | `{ timelineId, timecode }` | `{}` | 06 |
| `readTimelineEdit` | `{ timelineId }` | `{ timeline, items: [{ trackIndex, recordStart, recordEnd, sourceStart, sourceEnd, filePath, fileFps, clipType, name, kind }], audioItems, truncated }` | 11 |
| `createTimeline` | `{ name, fps, width, height }` | `{ timelineId, startFrame, name, projectName, note }` | 12 |
| `importMedia` | `{ paths }` | `{ items: [{ path, ok }] }` | 12 |
| `appendVideoClips` | `{ timelineId, clips: [{ filePath, trackIndex, recordFrame, startFrame, endFrame }] }` | `{ clips: [{ ok, error }] }` | 12 |

`insertClips`/`updateClips`'s `spec.inputs` may only set keys in a hard-coded input whitelist
(`INPUT_WHITELIST` in `bridge.lua`, mirrored by `LUA_INPUT_WHITELIST` in `src/resolve/textPlusInputs.ts`):
`StyledText`, `Font`, `Style`, `Size`, `Enabled1/Red1/Green1/Blue1/Alpha1`,
`Enabled2/Red2/Green2/Blue2/Thickness2`, `Enabled3`, `Enabled4`, `Center`, `LineSpacing`,
`CharacterSpacing`, `HorizontalJustificationNew`, `Start`, `End`. Anything else is silently ignored on
the Lua side, and request values are validated (ids, counts, string/array length caps) by zod on the
TypeScript side before they're sent (`src/core/resolveIpc.ts`).

## Install paths per OS

| | Windows | macOS |
|---|---|---|
| Resolve Scripts folder (`resolveScriptsDir`) | `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility` | `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility` |
| Mailbox (`mailboxDir`) | `%APPDATA%\caption-studio\resolve-bridge` | `~/Library/Application Support/caption-studio/resolve-bridge` |
| Bridge resources (`bridgeResourcesDir`) | packaged: `resources\resolve` next to the app; dev: `resources/resolve` in the repo | same, POSIX path |
| Launching KathaCut if not running | `start "" "<KathaCut.exe>"` | `open -a "<KathaCut.app>"` |

Resolve only looks in this one fixed per-platform folder — there is no way to point it elsewhere.
Linux is not supported (Resolve's own scripting locations differ and are unimplemented here).
**Windows is the only platform verified against a real Resolve session so far**; the macOS script
folder, `open -a` launch and `.app` bundle derivation in `launchSpec()` are unverified (see
[known limits](#known-limits)).

## Time mapping

- The canonical time on both sides is **integer microseconds** (KathaCut) mapped to **Resolve record
  frames** (`src/resolve/frames.ts`: `usToTimelineFrame` / `timelineFrameToUs`). Each boundary is
  computed independently in `bigint` math with round-half-up — never accumulated — because
  `us × fps.num` can exceed 2^53 for a long timeline at a high frame rate.
- `usToTimelineFrame` takes **sequence** microseconds (the timeline you see after cuts), not source
  time: captions are placed by KathaCut sequence time → Resolve frame, which is why the same mapping
  works whatever the link's origin (`proxy`, `edit` or `pushed`).
- Resolve record frame = `timelineStartFrame + round(us × fpsNum / (fpsDen × 1_000_000))`. A cue's end
  frame is clamped to the next cue's start frame on the same track so Text+ clips never overlap.
- fps is rational, mapped from Resolve's `timelineFrameRate` string: `23.976→24000/1001`,
  `29.97→30000/1001`, `47.952→48000/1001`, `59.94→60000/1001`, `119.88→120000/1001`; integers map to
  `n/1`. Drop-frame only affects timecode *display*; frame counts are unaffected.
- Confirmed by the edit-round-trip spike (ADR 0009): `GetEnd()` is **exclusive**; record frames are
  absolute timeline frames including the timeline's own start frame; source frames on a timeline item
  count from the file's **first frame**, not its start timecode, and are in the **source file's own
  fps**, not the timeline's; `GetSourceEndFrame()` is only accurate to about ±1 frame, so a clip's
  source *duration* is derived from its record duration, and `GetSourceEndFrame` is used only for the
  retime check.
- Timeline resolution/frame-rate/drop-frame settings must be read from the **timeline**, not the
  project — a custom timeline's own settings differ from the project default, and Resolve returns
  drop-frame and resolution as **strings**, not booleans/numbers (coerced on the TypeScript side, never
  assumed).

## Sync, diff and conflicts

`src/resolve/syncDiff.ts`'s `diffSync`/`planSync`, run from `electron/resolve/sync.ts`'s `applySync`:

1. **Fresh read.** `readClips` reads every clip currently on the KathaCut track, keyed by Resolve clip
   id, falling back to the `KathaCut.key` tag (`comp:SetData`/`GetData`) when the id doesn't match a
   known entry (e.g. after Resolve renumbers ids).
2. **Diff** against the project's own `resolveLink.synced` record:
   - **Changed in Resolve**: the live clip's start/end/text differs from what KathaCut last synced.
     Default is **keep the Resolve version**; the user can **Overwrite** (delete + re-insert, so no
     stray Resolve-side edits to other Text+ inputs survive) or **Show in Resolve** (jumps the Resolve
     playhead there) instead.
   - **Untracked in Resolve**: a clip tagged by KathaCut that this project's sync record doesn't know
     about, whose text no longer matches or whose caption is gone. Overwriting replaces or deletes it.
   - **Adopted**: a tagged-but-unrecorded clip whose text still matches is silently adopted into the
     sync record rather than flagged as a conflict.
3. **Apply** (`ensureTemplate` → `ensureTrack` → deletes → inserts → updates, each batched and
   progress-reported) only for what changed; a failing batch stops the sync and returns a synced list
   for only what actually happened, so a partial sync never claims more than it did.
4. **Kept-Resolve conflicts are never dropped** from the sync record — they're kept as an entry with a
   sentinel hash (`RELEASED_HASH`) that no later diff updates, deletes or re-inserts, so the same clip
   doesn't come back as a conflict (or get re-inserted as a duplicate) on every subsequent sync. A
   caption is "released" for real only once the clip is gone from Resolve **and** the caption is gone
   from KathaCut; until then, undoing the sync in KathaCut is the only way to un-release it.
5. Sync itself is **one KathaCut undo step**, always disabled while disconnected, while Resolve has a
   different timeline open, when the proxy asset is gone (`origin: 'proxy'` links only), or when the
   video edit changed since the project was linked (`editSignature` mismatch) — that last case suggests
   **Create in DaVinci** to build a fresh timeline instead of trying to sync onto a picture that moved.

## Text+ support matrix

Reported live in the Sync/Create dialogs by `planTextPlus`'s `support` output
(`src/resolve/textPlusPlan.ts`), aggregated worst-level-wins per feature with the reason for every cue
that hit it. Never trust a level below `sent` as pixel-identical to the KathaCut preview.

| Feature | Level | Why |
|---|---|---|
| Text (`StyledText`) | **sent** | Malayalam/mixed-script shaping visually confirmed correct (ADR 0008, T9) |
| Primary fill color, outline enable + color | **sent** | `Red1..Alpha1` / `Enabled2,Red2..Blue2` confirmed |
| Text transform (upper/lower/capitalize) | **sent** | applied to the string itself, grapheme-safe (never splits a cluster) |
| Position (`Center`) | **sent** | Y-axis direction confirmed "up" (ADR 0009, E8) |
| Font family, weight/italic (`Style`), outline thickness, shadow (enable-only), background box (enable-only), line/character spacing, alignment, line breaks | **approximated** | input id confirmed present, but the exact value mapping is unmeasured/unconfirmed |
| Font size (`Size`) | **approximated** | formula (`Size` = em size ÷ frame height) matches one measured 16:9 case (ADR 0009, E8); a portrait timeline is unmeasured |
| `phrase-fade` motion | **approximated** | `Alpha1` keyframes, 200 ms/speed ramp — the keyframe *mechanism* is only confirmed on `End`, not `Alpha1` |
| `progressive-word-reveal`, line mode | **approximated** | `End` (write-on) keyframes stepped per word to a grapheme-fraction of the text; Text+'s own write-on counting unit is unconfirmed |
| `progressive-word-reveal`, word-at-a-time display | **sent** | no animation needed — already one word per clip |
| `active-word-highlight`, word-at-a-time display | **sent** | the whole clip fill is overridden to the secondary color |
| `word-pop`, word-at-a-time display | **approximated** | secondary color + static `Size × emphasisScale`, no sine pop |
| `active-word-highlight`, line mode | **sent** | split into one Text+ clip per word step, full line text on every step (layout never shifts); Character Level Styling colours the active word (brief 18; keyframing a single clip is still ADR 0011 "no data") |
| `word-pop`, line mode | **approximated** | same split-clip mechanism, plus a static Character Level Styling size scale on the active word — no sine pop animation |
| Emphasis colour, size, weight/italic/underline | **sent** | Character Level Styling ids confirmed from a hand-styled clip (ADR 0011); emphasized words are located on grapheme boundaries only |
| Emphasis text transform | **approximated** | applied to the emphasized word's own substring only when it keeps the exact UTF-16 length; skipped for that word otherwise |
| Emphasis spotlight dim | **approximated** | uses fill-alpha id 2404, which ADR 0011 only guesses at by sequence |
| Emphasis font family | **not-sent** | ADR 0011 has no confirmed per-range font-family id (only a style *name* string) |
| Gradient fill, glow, 3D depth, base (non-emphasis) underline | **not-sent** | no Text+ equivalent identified |
| Rotation | **not-sent** | no single confirmed rotation input exists (`Angle` doesn't appear in the input dump; `LayoutRotation`/`TransformRotation`/per-level `AngleX/Y/Z` are untested candidates) |
| `HorizontalJustificationNew` enum mapping | **unresolved** | a single line renders centred on `Center` at every tested value (0/1/2); only affects multi-line text, which the spike never tested |

## Known limits

- **No auto-sync.** Sync is a manual button; a real-time "auto-sync when idle" is a roadmap follow-up,
  not implemented.
- **Re-create the project after a picture edit in Resolve.** KathaCut does not re-sync captions after
  the user re-cuts the picture on the Resolve timeline it's linked to — Sync is disabled instead
  (`editSignature` mismatch), with a message pointing at **Create in DaVinci** to start a fresh
  timeline. Pushing cut changes into an already-synced timeline is a later phase.
- **Deliver render settings are touched during a proxy render.** `renderProxyStart` changes Resolve's
  current render mode, format/codec ("mp4"/"H264") and render settings on the Deliver page to run the
  proxy render, and restores the previously remembered format/codec once the job leaves the queue
  (complete, failed or cancelled) — but while a render is in flight, the Deliver page reflects
  KathaCut's settings, not whatever the user had configured there.
- **Mac is unverified.** Every confirmed run so far is DaVinci Resolve Studio 21.0.0.47 on Windows.
  The macOS script folder, `open -a` app launch, `.app` bundle path derivation, and every Resolve
  behavior recorded from the spikes (frame semantics, string-typed settings, keyframe mechanism, size
  formula, etc.) are unverified on macOS until someone runs it there and STATUS.md says so.
- **Only captions are synced.** Titles, shapes, overlays and effects placed in KathaCut don't reach
  Resolve; only video clips (**Create in DaVinci**) and caption Text+ clips (**Sync**) do.
- **Batch sizes are measured, not guaranteed.** `INSERT_BATCH` (50 Text+ clips per Resolve command) and
  the media/clip batch sizes in "Create in DaVinci" come from one spike measurement (ADR 0009, E7) on
  one machine; they are not adaptive to slower hardware. A clip that writes or clears Character Level
  Styling costs far more per clip (~0.5s, ADR 0011 "Timing"), so `chunkForCls` (`electron/resolve/sync.ts`)
  caps a batch at 3 such clips regardless of `INSERT_BATCH`/`UPDATE_BATCH` — also a spike measurement, not
  adaptive.
- **Character Level Styling writes emphasis and full-line active-word motion, but not by keyframing.** ADR 0011
  confirmed the data shape, property ids and counting unit; brief 17 sends emphasized-word
  colour/size/weight/underline through it (a file round trip — `ExportFusionComp` → edit → `ImportFusionComp`,
  since `SetInput`/`LoadSettings`/`Paste` of a CLS value are confirmed no-ops). A single *keyframed* CLS value is
  still unconfirmed (ADR 0011 "Keyframing: no data"), so brief 18's `active-word-highlight`/`word-pop` in line
  mode instead splits each cue into one Text+ clip per word step, back to back, every step carrying the full line
  text with only the active word's Character Level Styling range changing — the layout never shifts between
  steps. If a word is both emphasized (with its own, distinct, length-preserving text transform) and the active
  word in the same step, `activeWordRange` (`textPlusStyleRanges.ts`) locates it by the *base* text transform, so
  it can silently miss adding the active-word range on that one step (the word keeps its emphasis styling; it
  just isn't additionally highlighted as active that step) — a narrow, undocumented-until-now edge case, not a
  crash.
- **Multiple KathaCut windows, or multiple Resolve projects with scripts running, are not guarded
  against** — there's no single-instance lock on either side.

## Troubleshooting

- **"KathaCut" doesn't show up under Workspace → Scripts.** Resolve only scans its Scripts folder at
  startup. Restart Resolve after installing (or reinstalling) the plugin.
- **A command in KathaCut seems to hang, then times out.** The bridge script inside Resolve has
  stopped — most often because the Resolve project or the whole app was closed, or because
  `app.json`'s heartbeat went stale for 60 s. Re-run **Workspace → Scripts → KathaCut** in Resolve to
  restart the bridge, then retry the action in KathaCut.
- **Something in Resolve looks wrong and there's no obvious error in KathaCut.** Open
  **Workspace → Console** in Resolve — an error the bridge script itself raised (a missing timeline, a
  bad path, an unexpected API result) is logged there, since it runs as an ordinary Resolve menu
  script.
- **A Sync conflict keeps reappearing.** That clip was kept as the Resolve version on a previous sync
  and is recorded as "released" — it will not be touched again unless you undo the sync in KathaCut or
  delete it from both sides.
