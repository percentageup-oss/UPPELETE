# DaVinci Resolve Text+ captions: session briefs

Each brief is one **fresh session**'s work. Open a new session and say:

> Implement docs/plans/resolve-textplus/0N-<name>.md

The session reads that brief and only the files it lists, implements it, runs the typecheck, appends a short
entry to `docs/STATUS.md`, commits, and stops. Briefs never rely on earlier conversation. Anything a later brief
needs from an earlier one is recorded in `docs/STATUS.md`, in `docs/decisions/0008-resolve-textplus.md`, or in the
code.

## Goal
A user edits captions in KathaCut, and they appear on the DaVinci Resolve timeline as **native, editable Text+
clips**:
1. In Resolve, **Workspace → Scripts → KathaCut** starts a small Lua bridge inside Resolve and opens or focuses
   KathaCut. KathaCut shows *Connected: <Resolve project> › <timeline>*.
2. **Create project from current DaVinci timeline.** Resolve renders the timeline to a small H.264 proxy (720p,
   with audio) in KathaCut's cache. KathaCut makes a project from it. Transcription (whisper, Gemini, OpenAI,
   ElevenLabs), translation, styling and templates then work exactly as they do today, with no plugin-specific
   transcription.
3. **Sync to Resolve** (a button with a change count) sends only the captions that changed to a "KathaCut" video
   track as Text+ clips: font, size, colors, outline, shadow, box, position, emphasis and the supported
   animations.
4. Clips edited or deleted in Resolve are detected at sync time. The user decides whether to keep the Resolve
   version or overwrite it; nothing is overwritten silently.

Decisions (user, 2026-09-27): Text+ only (no rendered-overlay mode); the full KathaCut editor (no compact
panel); Resolve **Free and Studio** both supported; manual incremental Sync first, with real-time "auto-sync when
idle" as a later opt-in.

## Order

| # | Brief | Depends on | Who | Size |
|---|-------|-----------|-----|------|
| 01 | [Spike script for Resolve](01-spike-script.md) | none | session, then **the user runs it in Resolve** | S |
| 02 | [Spike findings → ADR + Text+ template bin](02-spike-findings.md) | 01 + the user's report | session + user | S |
| 03 | [Bridge + plugin install + connection status](03-bridge-and-install.md) | 02 | session | M-L |
| 04 | [Create project from current timeline](04-project-from-timeline.md) | 03 | session | M |
| 05 | [Text+ planner (pure TS)](05-textplus-planner.md) | 04 | session | M |
| 06 | [Sync to Resolve (incremental, conflicts)](06-sync.md) | 04, 05 | session | L |
| 09 | [Spike 2: edit read/write + open Text+ items](09-edit-spike.md) | 06 | session, then **the user runs it**, then a findings session (ADR 0009) | S |
| 10 | [Link v26 + sequence-time caption mapping](10-link-sequence-mapping.md) | 06 | session | M |
| 11 | [Resolve → KathaCut: import the timeline edit](11-import-edit.md) | 09 findings, 10 | session | M-L |
| 12 | [KathaCut → Resolve: Create in DaVinci](12-push-to-resolve.md) | 09 findings, 10 | session | L |
| 07 | [Emphasis + word animations in Text+](07-emphasis-animations.md) | 09 findings, 10 | session | M |
| 08 | [Docs + license inventory](08-docs.md) | 07, 11, 12 | session | S |
| 13 | [Spike 3: what's inside a compound clip](13-compound-spike.md) | 11 | session, then **the user runs it**, then a findings session (ADR 0010) | S |
| 14 | [Import: unpack compound clips](14-unpack-compound.md) | 13 findings | session | M |
| 15 | [Spike 4: Character Level Styling](15-cls-spike.md) | 06 | session, then **the user runs it** | S |
| 16 | [CLS findings → ADR 0011](16-cls-findings.md) | 15 + the user's report | session | S |
| 19 | [Spike 5: CLS write method](19-cls-write-spike.md) | 16 | session, then **the user runs it** | S |
| 17 | [Send emphasis to Resolve (CLS)](17-cls-emphasis.md) | 16, 19 findings | session | M |
| 18 | [Full-line active-word highlight + word pop](18-cls-word-motion.md) | 16, 17 | session | M |

Run order: 09 → 10 → 11 → 12 → 07 → 08. Brief 10 doesn't need the spike, so it can run while the user runs the
spike.

### Two-way round trip (added 2026-09-27)
The user asked for both directions, with no render needed:
- **Resolve → KathaCut (11)** rebuilds the Resolve timeline's cuts from the **original files**. Brief 04's render
  stays as the fallback for items it can't rebuild (retimed, compound, multicam, titles, unreadable formats).
- **KathaCut → Resolve (12)** creates a **new timeline in the open Resolve project**. It never switches or
  creates projects. It sends the video clips and the captions as Text+; other layers come in later phases.

Both rely on one mapping (10). Captions are placed by **KathaCut sequence time** → Resolve frame, whether the
link is `proxy`, `edit` or `pushed`. The link stores an **edit signature** of the video clips. If the cuts change
in KathaCut afterwards, Sync is disabled (user decision); pushing cut changes into an existing timeline is a
later phase.

### Compound clips (added 2026-09-27)
Import (11) skips compound clips. The user chose to **unpack** them: the inner file clips are imported as normal
clips (14). The scripting API can't open a compound, so 13 checks first that `timeline:Export` (OTIO/FCPXML)
carries the inner edit, and how its times are counted. Render stays the fallback for what can't be unpacked.
Run order: 13 → (user runs it) → findings → 14.

### Emphasis and per-word styling (added 2026-09-27)
Emphasis, and full-line active-word highlight / word pop, need Text+ **Character Level Styling**, whose format no
spike has captured yet (ADR 0008 T11 and ADR 0009 E10 had no data). 15 adds a spike that works even without hand
prep. 16 records ADR 0011: it confirmed the data shape, property ids and counting unit, but every write brief 15
tried used the old guessed shape/ids/unit, so **no write has ever been confirmed working**. 19 retries the write
with ADR 0011's confirmed values; its findings extend ADR 0011's "Write method" section. 17 sends emphasis (blocked
until 19 confirms a write). 18 moves the styling word by word: one clip with keyframes if 19 confirms that works,
otherwise one clip per word step with the full line text (user decision). Run order: 15 → (user runs it) → 16 →
19 → (user runs it) → ADR 0011 update → 17 → 18.

**Gate:** if the spike (02) finds that Resolve's Text+ breaks Malayalam shaping, **stop after 02** and tell the
user. AGENTS.md forbids broken Malayalam shaping, so the Text+-only choice would have to be revisited (the
alternative is a rendered transparent overlay clip from our own export host).

**Always check the ADR first.** Briefs 03-07 name Resolve API calls and Text+ input IDs from research done
before the spike. `docs/decisions/0008-resolve-textplus.md` (written in 02) holds what the spike **confirmed**.
When the ADR and a brief disagree, follow the ADR and note the difference in STATUS.

## Testing override
The user asked (2026-09-25) that session briefs **not** write or run tests, export parity stages, smoke runs or
benchmarks. This **overrides the AGENTS.md testing rule for this plan**. The only check is
`npx tsc --noEmit -p .`. Do not delete existing tests; fix one minimally only when a typecheck breaks. STATUS
entries say "not tested, typecheck only".

Opt-in suggestion for the user: the frame mapping in 05 (`usToTimelineFrame`) and the sync diff in 06 are pure
functions where a small unit test is cheap and catches off-by-one-frame bugs.

Real verification needs Resolve, and only the user can run it. Each brief ends with a short **manual check for
the user**. Report Windows only as tested; Mac is unverified until someone runs it on a Mac.

## Architecture (shared by all briefs)

```
Resolve (Free/Studio)                         KathaCut (Electron)
Workspace → Scripts → KathaCut.lua  ──dofile──►  <resources>/resolve/bridge.lua  (ships with the app)
   bridge.lua loop (Lua, inside Resolve)          electron/resolve/bridge.ts  (main process)
        ▲    polls request.json every ~150 ms          │ writes request.json (tmp + rename)
        └──── writes response.json, status.json ◄──────┘ reads/validates response.json with zod
                     <userData>/resolve-bridge/   (userData = %APPDATA%/caption-studio, ~/Library/Application Support/caption-studio)
```

- **Why a file mailbox:** Resolve Free only runs scripts started inside Resolve (external scripting is
  Studio-only), and Resolve's Lua has no sockets without FFI. The open-source AutoSubs plugin (MIT) uses the same
  mailbox pattern.
- **Why Lua, not Python:** Lua (LuaJIT) is built into Resolve. Python needs a separate install that users often
  don't have.
- **Launcher vs. bridge:** the file installed into Resolve's Scripts folder is a tiny **generated** launcher,
  `KathaCut.lua`, with absolute paths baked in. It `dofile`s `bridge.lua` and `json.lua` from the app's resources,
  so bridge updates ship with the app. No other files go into the Scripts folder, because every `.lua` there (and
  every sub-folder) becomes a menu entry.
- **All caption logic lives in TypeScript.** The planner (05) turns cues + style into JSON clip specs. `bridge.lua`
  is a dumb executor of a fixed command whitelist. It never `load`s or `loadfile`s request content. JSON is parsed
  by a small encoder/decoder written for this project (`resources/resolve/json.lua`), so there's no third-party
  code to vendor. AutoSubs is design inspiration only; none of its code is copied.
- **Honest parity:** Text+ is Resolve's renderer, not ours. The Sync dialog shows a per-feature support list
  (sent / approximated / not sent). Never claim the Resolve output matches the KathaCut preview.

### Mailbox protocol v1 (03 implements it; later briefs add commands)
Directory `<userData>/resolve-bridge/`. Every file is JSON and written as `<name>.tmp` then renamed.
- `app.json` (written by KathaCut every 2 s while running): `{ v:1, pid, heartbeatAt /*epoch s*/ }`.
- `status.json` (written by Lua when it starts and about every 1 s): `{ v:1, sessionId, heartbeatAt, product
  /*"DaVinci Resolve" | "DaVinci Resolve Studio"*/, version, projectName, timelineName, busy }`.
- `request.json` (KathaCut): `{ v:1, sessionId, seq, command, params }`. There is one slot. KathaCut sends the next
  request only after the response for `seq` arrives or times out.
- `response.json` (Lua): `{ v:1, sessionId, seq, ok:true, result } | { v:1, sessionId, seq, ok:false, error }`.
  Lua deletes `request.json` after it reads it.
- Lua ignores requests whose `sessionId` isn't its own. Lua exits on `disconnect`, when `app.json` is older than
  60 s, or if no `app.json` appears within 60 s of launching the app.
- Long work (renders, big inserts) uses start + poll commands. A single command must return within ~2 s so
  Resolve stays responsive.
- Commands: 03 `ping`, `timelineInfo`, `disconnect`; 04 `renderProxyStart`, `renderStatus`, `renderCancel`;
  06 `ensureTemplate`, `ensureTrack`, `insertClips`, `updateClips`, `deleteClips`, `readClips`, `jumpTo`;
  11 `readTimelineEdit`; 14 `exportTimelineOtio`.

### Time mapping (04, 05, 06)
- The proxy is the whole Resolve timeline rendered from its first frame. So a cue's **source time on the proxy
  asset** (integer µs) is the offset from the timeline start.
- Resolve record frame = `timelineStartFrame + round(us × fpsNum / (fpsDen × 1_000_000))`. Compute each boundary
  independently; never accumulate.
- The end frame is exclusive. A cue's end frame is clamped to the next cue's start frame on the same track, so
  clips never overlap.
- The fps is rational. Map Resolve's `timelineFrameRate` string: `23.976→24000/1001`, `29.97→30000/1001`,
  `47.952→48000/1001`, `59.94→60000/1001`, `119.88→120000/1001`; integers map to `n/1`. Drop-frame only affects
  timecode display; frame counts are unaffected.

## Shared findings (verified against the code, 2026-09-27)
- **Product name is KathaCut** (`electron-builder.yml`: `productName: KathaCut`, appId `com.vxlabs.kathacut`,
  `asar: false`). userData stays at `<appData>/caption-studio` (`electron/main.ts:43-47`, `userDataPath`).
- No Resolve, NLE, FCPXML or Text+ code exists anywhere yet. There is no `resources/` folder. `extraResources` in
  `electron-builder.yml` copies `build/bin/${os}`, `docs/licenses`, LICENSE and THIRD_PARTY_NOTICES.
- Project model: `projectSchema` (`src/core/model.ts:1031`, **schema 24**) spreads `projectSchemaV23.shape`, and its
  `superRefine` re-validates against V23. Each schema change bumps the version with a `migrateVNN.ts`
  (latest: `src/core/migrateV23.ts`, 17 lines). Cues and words are in integer **µs of their video's source time**
  (`wordSchema` L33-46, `cueSchema` L48-105; `cue.mediaAssetId`, `words[].timingSource`
  model|aligned|manual|estimated, `emphasized[]`).
- Caption engine (pure, time-driven): `src/captions/renderer.ts` has `layoutCaption(text, inputs, measure)`
  (~L199, wraps in 1080-wide composition units), `layoutCaptionWords` (~L114), `captionFrame` (~L241; ramps are
  200 ms / speed, pop is `1 + .12·sin`) and `wordMotionAvailability` (~L67). The DOM measurer is
  `createDomMeasurer` in `src/captions/CaptionPreview.tsx` (~L217).
- Styles: `src/captions/style.ts` has `MOTIONS` (~L4: static-clean, active-word-highlight, word-pop, phrase-fade,
  progressive-word-reveal; `motionSpeed` 0.25-4), `captionAppearanceSchema` (~L32), `DEFAULT_CAPTION_STYLE`
  (~L109), `resolveCaptionStyle` (~L141) and `captionStyleInputs` (~L173). Templates: `src/captions/templates.ts`.
  Emphasis: `src/core/emphasis.ts`. Word display (line vs. one word): `src/captions/wordDisplay.ts` `displayCue`
  (~L60).
- Sequence ↔ source: `src/core/timelineModel.ts` (`sourceUsAt`, `sequenceUsOf`, `cuesInSequence`, `activeCueAt`).
- Opening media: main has `inspectFileForBin(filePath, deps)` (`electron/assetInspect.ts:22`, returns
  `InspectedFile` from `src/core/assetImport.ts:5`; wired as `registerMcpIpc({ inspectFile })` at
  `electron/main.ts:57`). The renderer places files with `addAssetsFromInspected(results, placement?)`
  (`src/App.tsx:~1051`; with `placement` it puts a video on the timeline). Main registers inspected media in
  `inspectedMedia` so transcription can resolve the path from a fingerprint (`electron/main.ts:81`).
- Home: `src/home/HomeScreen.tsx`, rendered at `src/App.tsx:~2293` with props `onCreate`, `onOpenFile`,
  `onOpenRecent`, `onSettings` and `onMessage`. A new project gets a managed file automatically once it holds
  anything (`src/App.tsx:~1272-1288`, `createManagedProject`).
- Settings: `src/SettingsDialog.tsx` (`SettingsTab` union at L7, `TABS` at L8; tab bodies around L59, e.g.
  `AgentSettings`). The MCP settings pattern (enable toggle, status broadcast): `electron/mcp/ipc.ts:160-184`
  (`registerMcpIpc`, `initMcp`), preload `agentStatus` / `agent:status-changed` (`electron/preload.ts:~170-190`).
- Preload bridge: `window.captionStudio` (`electron/preload.ts:45`), typed in `src/env.d.ts`. All IPC payloads are
  zod-validated (e.g. `src/core/transcriptionIpc.ts`).
- Windows: `createWindow()` `electron/main.ts:90`, `app.whenReady()` L733. There is no single-instance lock and no
  deep links; the bridge does not need them (see 03).
- Dependency inventory: `docs/DEPENDENCIES.md` (every dependency must be GPL-3-compatible; MIT is fine). License
  texts go in `docs/licenses/`.
- ADR numbers 0001-0007 are taken, so this plan uses **0008**.

Line numbers drift because other sessions edit this repo. Search by symbol name if a line is off.

## Resolve API reference (from research; the spike confirms or corrects it)
- Entry: `resolve = Resolve()` (inside Resolve's Lua, `Resolve()` and `bmd` are globals; `fusion`/`fu` also
  exist). Then `pm = resolve:GetProjectManager()`, `project = pm:GetCurrentProject()`,
  `timeline = project:GetCurrentTimeline()` and `mediaPool = project:GetMediaPool()`.
- Timeline info: `timeline:GetName()`, `timeline:GetUniqueId()`, `timeline:GetStartFrame()`,
  `timeline:GetEndFrame()`, `timeline:GetSetting("timelineFrameRate")`, `project:GetSetting(
  "timelineResolutionWidth"|"timelineResolutionHeight")`, `timeline:GetTrackCount("video")`,
  `timeline:GetItemListInTrack("video", i)`, `timeline:AddTrack("video")`, `timeline:SetTrackName("video", i,
  name)`, `timeline:GetTrackName(...)`, `timeline:DeleteClips({items}, false)`,
  `timeline:SetCurrentTimecode(tc)`.
- Render (the AutoSubs pattern): `project:SetCurrentRenderMode(1)` (single clip),
  `project:SetCurrentRenderFormatAndCodec("mp4", "H264")`, `project:SetRenderSettings({ SelectAllFrames=true,
  TargetDir=dir, CustomName=name, ExportVideo=true, ExportAudio=true, FormatWidth=w, FormatHeight=h })`,
  `jobId = project:AddRenderJob()`, `project:StartRendering(jobId)`, `project:IsRenderingInProgress()`,
  `project:GetRenderJobStatus(jobId)` → `{JobStatus, CompletionPercentage, Error}`, `project:StopRendering()`,
  `project:DeleteRenderJob(jobId)`.
- Placing Text+: a Text+ media-pool item comes from a `.drb` bin (`mediaPool:ImportFolderFromFile(path)`). Then
  `mediaPool:AppendToTimeline({ { mediaPoolItem=item, startFrame=0, endFrame=dur-1, recordFrame=f, trackIndex=t,
  mediaType=1 } , ... })` returns the timeline items. Per item: `comp = item:GetFusionCompByIndex(1)` and
  `tool = comp:FindToolByID("TextPlus")`. The fallback is `timeline:InsertFusionTitleIntoTimeline("Text+")` at the
  playhead.
- Text+ input IDs (to confirm): `StyledText`, `Font`, `Style`, `Size`, `CharacterSpacing`, `LineSpacing`,
  `HorizontalJustificationNew`, `Center` (point, 0-1, **y up**), `Angle`, element 1 fill `Red1 Green1 Blue1
  Alpha1`, outline `Enabled2 … Thickness2`, shadow `Enabled3 …`, background `Enabled4 …`, and write-on
  `WriteOnStart` / `WriteOnEnd`. Keyframes: `tool.WriteOnEnd = comp:BezierSpline()` then
  `tool.WriteOnEnd[frame] = value` inside `comp:Lock()`/`comp:Unlock()`. Character Level Styling modifier:
  `StyledTextCLS`.
- Tagging: `comp:SetData("KathaCut.cueId", id)` / `GetData`; `item:GetUniqueId()`.

## Project rules that matter (from AGENTS.md)
- Local-first: no accounts, telemetry or uploads. The bridge only touches local files. Cloud transcription stays
  the existing opt-in.
- **Malayalam shaping:** never split a grapheme cluster. Any character-index work in Text+ (emphasis ranges,
  write-on steps) happens only at **word boundaries**, and uses the character counting unit the spike confirms.
- **User corrections are authoritative:** sync never silently overwrites clips the user changed in Resolve, and
  never touches clips outside the KathaCut track.
- **Estimated word timing must never masquerade as aligned:** the Sync dialog says when word animations use
  estimated timings.
- Canonical time is integer µs; seconds only at adapters. Frame mapping per boundary, no accumulated rounding.
- The renderer has no Node integration. New IPC goes through the preload bridge with zod validation. Spawn tools
  with argument arrays. The one exception is the Lua launcher, which can only use `os.execute`/`io.popen`: it
  uses only paths the installer wrote, each quoted, and the installer refuses paths containing `"` or `]]`.
- Never block the UI thread; never overwrite input media (the proxy goes to KathaCut's cache, and Resolve media
  is never touched).
- Do not present nonfunctional controls as implemented. Buttons for commands not built yet do not appear.
- Update `docs/STATUS.md` after each brief. **Stage only the files your brief changed**, never `git add -A`.

## Out of scope (all briefs)
- Real-time or auto-sync (a later opt-in "auto-sync when idle"), Resolve subtitle tracks / SRT into Resolve, and a
  rendered transparent-overlay mode.
- Re-syncing after the user re-edits the Resolve timeline's picture (re-create the project from the timeline
  instead), multiple timelines per project, and Resolve's Mac App Store build.
- Studio-only external scripting from KathaCut, and a compact Kalakar-style panel.
- Syncing titles, shapes, overlays or effects. Only captions are sent.
