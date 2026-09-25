# Local agent control (MCP)

Status: **core, the transcript-to-edit loop, judgment guidance and media import implemented 2026-09-24** — an agent can read the
transcript in timeline time, look up valid looks/backgrounds/titles/effects, apply zooms, titles,
backgrounds, effects and grades as one undo step, look at the result (`render_frame`), and grade a
video to match a reference picture (`match_color_to_reference`), bring in images (`import_media`) and place them on a spoken word (`place_at_word`). Claude Code connects over HTTP;
Claude Desktop connects through the bundled stdio connector. Job tools (transcribe, export, save)
are **not implemented yet** (see "Not implemented yet"). This document is
the contract; `tickets.md`'s MCP tickets track the remaining slices.

## Why

A user working in Claude Code or Claude Desktop can ask Claude to restyle captions to match a
screenshot, place a logo over a time range, or tighten pauses, and have Claude perform the edit
**inside the running app**, see the result and iterate — with the user watching, able to undo, and
never needing an account or cloud call from the app itself. Every edit already goes through one
pure, validated, serializable command union (`src/core/commands.ts`), so an MCP tool is just
another caller of that path: agent edits get the same validation, warnings, undo/redo and autosave
as a mouse click. No second editing model.

## Architecture

```
Claude Code ──HTTP──▶ 127.0.0.1:<port>/mcp   (Bearer token, loopback only)
                          │
        electron/mcp/server.ts (McpServer + StreamableHTTPServerTransport)
          └─ electron/mcp/tools.ts ──IPC──▶ renderer's useAgentBridge (src/agent/useAgentBridge.ts)
                                              → App.tsx: runCommands/seek/select/undo/redo,
                                                the same history projectRef the UI itself uses
```

Project state lives only in the renderer (`App.tsx`'s history/`projectRef`) — main never keeps a
copy, matching PRODUCT.md's "transcript, preview, bin and timeline reflect a single project state."
Every MCP tool call forwards to the renderer over one request/response IPC pair
(`electron/mcp/rendererBridge.ts`) and waits for its answer.

## Enabling it

Off by default. In **Settings → AI agents**, turn on **Allow agent access**. This:
- Mints a Bearer token (`crypto.randomBytes(32)`, base64url) and starts a loopback HTTP server on
  `127.0.0.1` at an OS-assigned port, stored (with the token) at
  `<userData>/mcp.json`, mode `0600`. The token is a loopback-only shared secret — the same trust
  tier as a local dev server's `.env` — not a cloud credential, so it is not OS-keychain-encrypted;
  that keeps port/token rotation dependency-free. `Rotate token` mints a new one and restarts the
  listener if it was running.
- Shows the ready-to-paste command for Claude Code:
  `claude mcp add --transport http caption-studio http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"`.
- A **🤖 Agent** chip appears in the top bar whenever the server is listening, with a live client
  count; clicking it opens the Settings tab.

Each initialized HTTP client gets its own MCP server/transport pair, routed by `Mcp-Session-Id`.
This allows Claude Code, the bundled stdio bridge and an OpenAI Secure MCP Tunnel to connect
independently, and means an agent or tunnel that exits without closing its session cannot block the
next client with `Server already initialized`. Closing the app closes every remaining session.

The DNS-rebinding protection built into the MCP SDK's Streamable HTTP transport is enabled
(`allowedHosts` locked to `127.0.0.1:<port>`/`localhost:<port>`), and every request is checked for
the exact Bearer token (constant-time compare) before it ever reaches MCP protocol handling — an
unauthenticated request gets a 401 and touches nothing else.

Every tool declares the MCP safety annotations ChatGPT uses during connector discovery:
`readOnlyHint`, `destructiveHint`, `openWorldHint`, and `idempotentHint`. Inspection tools are
read-only; `edit` is marked potentially destructive because its command union includes deletion and
overwrite operations; `import_media` is open-world because its URL form can fetch a public HTTPS
resource. Tools that only change KathaCut editor state or add undoable project content are
non-destructive but are not labelled read-only.

## Time bases and units

Every tool speaks **integer microseconds**. `get_transcript` is the one to plan edits from: it is already in sequence time. Two time bases exist in this app
(`docs/EDITING.md` "Schema 5"), and tools are explicit about which one they use:
- **Captions** (`get_captions`) are in the **source time of the video they name** (`mediaAssetId`).
  `get_captions`'s `range` filters a cue's own stored `startUs`/`endUs` — not sequence time, since a
  project can hold several videos on independent source timelines and there is no single
  sequence-time range to filter by without first picking one.
- **Clips, blur regions and markers** (`edit`, `seek`) are in **sequence time** — the timeline you
  see, after cuts.

Composition space is always **1080 units wide** by `1080 / aspect` tall (`COMPOSITION_WIDTH`).

## Tool reference (current)

| Tool | Does |
| --- | --- |
| `get_project` | Title, output format, assets, tracks (with `solo`/`volume`), clips (with `linkId`, `enabled`, `gain`, `detachedAudio` — clips sharing a `linkId` are edited together; pass `unlinked: true` on a clip command to act on one), blur regions, caption style, caption count, playhead, selection, validation warnings. Call first to orient. |
| `get_captions` | Cues by source-time range and/or id, paginated; `words: true` includes per-word timing. |
| `edit` | An array of editing commands (the same union the UI's `runCommand` uses — captions, assets, tracks, clips, blur regions, markers) applied as **one undo step**. Nothing commits if any command fails; the failing index and its errors come back so the caller can fix and retry. |
| `set_caption_style` | Patches `{motion?, motionSpeed?, appearance?}` onto the current style (read via an internal `get_project`-equivalent call first) and applies it project-wide, exactly like the Style panel. |
| `apply_template` | Applies one of the five built-in caption templates by id. |
| `list_style_options` | Motions, installed font choices, built-in templates, and every appearance field's valid range/enum, generated from the real zod schema — no separate source of truth to drift. |
| `get_transcript` | The transcript in **sequence** time (after cuts and speed changes), so it lines up with clips, zooms, effects and titles; `words: true`, `range`, paging. Reports `omitted` cues that fall inside removed ranges. Prefer this over `get_captions` when planning edits. |
| `list_creative_options` | Looks, background presets, title treatments, and JSON Schemas for zoom regions, effects, text animations, backgrounds and grades — generated from the real zod schemas plus the same constants the UI uses. Every look, background, title and effect also carries `mood`/`useWhen`/`avoidWhen`, and the result adds `effectGuidance`, `zoomGuidance` and `styleRecipes` (see "Editorial judgment"). |
| `import_media` | Brings an image (or audio/video) into the project from exactly one of: `path`, `fromClipboard`, `imageBase64` (≤ 5 MB) or `url` (public https, ≤ 25 MB). Images are identified by content, not extension; the same picture twice reuses one asset. With `placement` an image is also placed at `sequenceUs` in the same undo step. Bytes that did not come from a path are saved content-addressed to `<userData>/agent-media/`. |
| `place_at_word` | Places an already-imported image at a spoken word or phrase (`text` + optional `occurrence`, or `cueId` + `wordIndex`), in sequence time, as one undo step. Reports `timing: ESTIMATED` when the word's timing is not aligned, and fails when the word is inside a removed range. |
| `add_title` | One animated title from a built-in treatment (`title-*` templates) at sequence times, one undo step. |
| `add_shape` | One vector graphic (`box`, `circle`, `arrow`, `dotted-arrow`, `underline`, `highlight`) at sequence times, optionally recoloured, one undo step. Refine it with the `shape-*` commands in `edit`; `list_creative_options` lists the presets (with `useWhen`/`avoidWhen`) and the shape schema. A `box` takes `cornerRadius`, or `cornerRadii {tl,tr,br,bl}` in `shape-update` geometry for four independent corners. A `bubble` geometry (rounded box plus a tail: `tail {side, offset, width, length, curve}`) can be set through `shape-update`/`shape-add`; `fitTo` and `fitPadding` record the title a box is sized to, and `template-insert` adds a whole template as a group (measured text sizes are passed in the command). A closed shape can be Liquid Glass with `shape-update` `changes.glass` (`null` removes it); the preview and export both show it (a project with glass exports with PNG frame transport). |
| `edit` group commands | `group-create`, `group-ungroup`, `group-rename`, `group-move`, `group-translate`, `group-scale`, `group-duplicate`, `group-delete` (schema 22, docs/EDITING.md "Groups"). Callers mint every id; `group-duplicate` takes an `idMap` of old id to new id for the group and each member. The project summary lists `groups` (with `memberIds`) and a `groupId` on grouped shapes and texts. |
| `render_frame` | Up to 6 preview frames (as JPEG images, ≤1024 px) at sequence times: what the user sees, including zooms, titles, effects, grade and captions. Seeks the playhead. Needs the window visible. |
| `match_color_to_reference` | Derives a LUT from a reference picture (`imagePath`, `fromClipboard`, or small `imageBase64`) against the frame at `sequenceUs` and adds it as one adjustment layer (one undo step). Reuses `src/color/referenceMatch.ts`. The LUT is saved silently to `<userData>/generated-luts/`. |
| `seek` | Moves the playhead (sequence µs). |
| `select` | Selects a cue/clip/blur/marker, or clears the selection. |
| `undo` / `redo` | The same project history every ⌘/Ctrl+Z uses. |

Every tool forwards a renderer-reported failure (a validation error, an unknown id) as a tool error
(`isError: true`) with the real message — never a generic failure.

## Timeline markers

`project.markers` (schema 5, optional/defaulted — no migration): `{id, atUs (sequence µs), text,
color?}`. Drawn as small diamonds on the timeline ruler; click seeks and selects. They are not an
edit, just a note — the intended landing spot for an agent-proposed shot list ("at 0:12 put a
stopwatch icon here") that the user can accept or dismiss on the timeline instead of it living only
in chat. `edit` creates/updates/deletes them like any other item (`marker-add`/`marker-update`/`marker-delete`).

## Trust and safety rules (enforced, not just documented)

- Off by default; loopback only; Bearer token required on every request.
- Agent edits are ordinary history steps: undo reverts them exactly as a mouse-driven edit would.
  Autosave applies only when the project already has a path (existing behavior, unchanged).
- Agent-produced caption text carries `textSource: 'user'`, so a later retranscription protects it
  exactly like a human correction (AGENTS.md: corrections are authoritative).
- No tool opens a native dialog or exposes model downloads, the Gemini key, or app settings beyond
  what is listed above. The one tool that reads a file, `match_color_to_reference`, accepts only an
  absolute path to a png/jpg/webp/gif/bmp of at most 25 MB, uses it solely to derive a grade, and
  never returns its pixels; the clipboard is read only when that call asks for it.
- The server's `instructions` and the `auto_edit` prompt (`EDITING_GUIDE` in `electron/mcp/tools.ts`)
  tell an agent to read the transcript, look at sampled frames, pick a style recipe, map beats to
  tools, batch into one undo step and verify with `render_frame`.
- `import_media` never overwrites a user file and never sends project data anywhere. `path` must be an
  absolute image/audio/video path (the media probe, not the extension, decides what it is). `url` is the
  one network call the app makes on an agent's behalf: https only, no credentials, no IP literals or
  local names, each redirect re-validated, ≤ 25 MB, 20 s timeout, and the bytes must be a real
  png/jpeg/webp/gif/bmp by magic number. It does **not** defend against a hostname that resolves to a
  private address (DNS rebinding); the fetched bytes are only decoded as an image and never returned.
  Image licensing is the user's responsibility; the guide tells the agent to name the source.

## Editorial judgment

The agent is expected to choose, not to be told. `src/core/editorialGuidance.ts` holds `mood`,
`useWhen` and `avoidWhen` for every background preset, look, title treatment and effect kind (plus zoom
guidance), and `src/core/styleRecipes.ts` holds five coherent packages (Tech explainer, Retro/nostalgia,
Corporate clean, Energetic shorts, Calm storytelling). Both are served by `list_creative_options`.
`editorialGuidance.test.ts` fails when a catalog entry has no guidance or a recipe names an id that does
not exist, so guidance cannot drift. `EDITING_GUIDE` tells the agent to sample frames before planning,
commit to one recipe, map transcript beats to tools (e.g. a moving grid for tech bridges, a short VHS
only on a nostalgia beat, images on named things), keep density restrained, and report what it did and
why. The guidance is advice; whether a given model applies it well is not something the app can enforce.
- The renderer bridge serializes one request at a time; a hung or closed project window fails the
  in-flight call with an honest error rather than hanging forever (`RendererBridge`'s timeout/cancel).

## Claude Desktop connector

Claude Desktop starts local MCP servers as stdio child processes, so `electron/mcp-stdio.ts`
(bundled to `dist-electron/mcp-stdio.cjs`) adapts stdio to the app's loopback endpoint. It reads the
app's own `mcp.json` (port + token) on each launch, forwards JSON-RPC unchanged in both directions
(`electron/mcp/stdioBridge.ts`), holds no state and adds no tools. The app's executable runs it as
plain Node with `ELECTRON_RUN_AS_NODE=1`, so no separate Node install is needed. **Settings → AI
agents** shows the exact `claude_desktop_config.json` entry for this machine; KathaCut must be open
with agent access on, and Claude Desktop restarted after the config is added. If the app is closed or
access is off, the connector says so on stderr and requests fail with a clear error.

## Not implemented yet

Tracked as `tickets.md` entries:

- **Jobs** (`transcribe`, `detect_silence`, `export_video`, `export_srt`, `get_job`, `cancel_job`,
  `save_project`) are not exposed over MCP, so an agent cannot transcribe a video that has no
  captions yet.
- Alpha-clip (`hasAlpha`) export support for word-anchored fillers/overlays. `place_at_word` places
  still images only (not video or audio), and `import_media` places images only.
- **Vox-style image motion** (Ken Burns pan/zoom, pop/slide-in entrances, paper border, drop shadow,
  tilt, highlighted words) needs animatable image clips, which the schema does not have yet: image
  clips are static (position, opacity, fit, mask). Planned as the next slice with a "Vox collage"
  recipe.
- Claude Desktop cannot pass the bytes of an image attached in chat to a tool. It can give
  `import_media` a public `url`, or you can copy the image and have it use `fromClipboard`; otherwise it
  can only grade by eye with `edit` and check with `render_frame`.
- Packaged builds: the connector relies on `ELECTRON_RUN_AS_NODE`; it works with the dev Electron
  binary but has **not** been run from an installed KathaCut build.
- No repo-shipped Claude Code skills yet for the B-roll/ComfyUI or Remotion-filler recipes below.

## Planned: word-anchored fillers and B-roll (external generators, not bundled)

Two related follow-ups, both keeping generators **outside** the app and composing through MCP
rather than adding a bundled dependency:

- **Fillers via Remotion.** Remotion is not bundled (source-available, paid above a 3-person
  company, and a Claude-written composition would be untrusted code running in-app). Instead, once
  alpha-clip export support lands, a filler is baked to a transparent WebM by Remotion running
  under the user's own license via Claude Code, then brought in with `import_media` and placed at a
  word's timestamp with `place_at_word` — the same transparent-clip compositing path
  `workers/media/exportArguments.ts` already uses for picture-in-picture.
- **B-roll via ComfyUI.** No in-app integration is planned; Claude Code calls ComfyUI's own
  loopback API directly and imports the result the same way. This keeps the app generator-agnostic
  (ComfyUI today, something else tomorrow) and keeps ComfyUI's GPL-3.0 license and workflow formats
  out of the app's own surface.
- Both will ship as `.claude/skills/` recipes in this repo once the underlying tools
  (`place_at_word`, `import_media`, alpha clips) exist, plus real in-app parametric fillers
  (kinetic word, icon pop, image zoom) as a later, license-clean, offline-friendly alternative for
  Claude Desktop users with no Node/Remotion available.

## Files

- `src/core/editCommandSchema.ts` — the zod boundary for every editing command, with a compile-time
  check that whatever it accepts is a real `EditCommand`.
- `src/core/agentProtocol.ts` — the renderer↔main IPC contract (`AgentRequest`/`AgentResponse`),
  `summarizeProject`/`summarizeCue`, and `listStyleOptions`/`styleFieldRanges` (generated from
  `captionAppearanceSchema`).
- `src/agent/useAgentBridge.ts` — the renderer-side dispatcher; `dispatch` is the pure request→
  response mapping, unit-tested with fake handlers.
- `electron/mcp/config.ts` — token/port persistence.
- `electron/mcp/rendererBridge.ts` — the one IPC round trip to the renderer.
- `electron/mcp/server.ts` — the loopback HTTP + `StreamableHTTPServerTransport` + auth check.
- `electron/mcp/tools.ts` — the registered tool set, the `EDITING_GUIDE` and the `auto_edit` prompt.
- `electron/mcp/referenceImage.ts` — pure path/size rules for reference pictures.
- `electron/mcp/importMedia.ts` — pure rules and I/O for `import_media`: path/url validation, magic-number sniffing, capped fetch, atomic content-addressed save.
- `src/core/wordAnchor.ts` — resolves a spoken word/phrase to sequence time for `place_at_word`.
- `src/core/editorialGuidance.ts`, `src/core/styleRecipes.ts` — when-to-use guidance and style recipes served by `list_creative_options`.
- `electron/mcp/stdioBridge.ts`, `electron/mcp-stdio.ts` — the Claude Desktop connector.
- `src/core/creativeOptions.ts`, `src/core/backgroundPresets.ts` — the option catalogs.
- `src/agent/framePaint.ts` — waits until a sought frame has actually painted before capture.
- `electron/mcp/ipc.ts` — Settings-tab IPC (`agent:status`, `agent:settings-*`) and the app-lifetime
  start/stop/resume glue.
- `src/SettingsDialog.tsx`'s `AgentSettings` — the Settings tab; `App.tsx`'s `agentStatus` state and
  top-bar chip.

## Verification

**What ran (Windows 11, 2026-09-24):** `tsc --noEmit` is clean. New unit tests pass: bridge dispatch
for `get-transcript`/`prepare-snapshot`/`match-reference`, the creative-options catalogs, reference
image rules, and `electron/mcp/server.test.ts` cases driving a real `startMcpServer` with the MCP SDK
client for every new tool. `electron/mcp/stdioBridge.test.ts` pipes a real client through the bridge
to a real server. The built `dist-electron/mcp-stdio.cjs` was run as a real child process by the SDK's
stdio client against a real server (`tools/list` and `tools/call` succeeded), and starts under the dev
Electron binary with `ELECTRON_RUN_AS_NODE=1`. Failures in the wider run are pre-existing and
unrelated: `config.test.ts` (POSIX 0600 mode on Windows) and two `keynoteTemplates` tests, identical
on a clean tree.

**Not exercised:** the renderer-side handlers in `App.tsx` (`prepareSnapshot`, `matchReference`,
`getTranscript`) and `capturePage` have only typecheck and the pure dispatch tests — no real window,
video, Claude Code or Claude Desktop session ran. macOS is untested. Whether `match_color_to_reference`
gives a pleasing grade on real footage is unjudged.

**Judgment guidance and media import (Windows 11, 2026-09-24).** `tsc --noEmit` is clean. New unit tests pass:
`editorialGuidance.test.ts` (coverage of every preset/look/title/effect, recipe ids), `wordAnchor.test.ts`
(case/punctuation, phrases, occurrences, estimated timing, Malayalam NFC), `importMedia.test.ts` (magic
numbers, path/url rules, redirects re-validated, size caps, atomic content-addressed save),
`useAgentBridge.test.ts` (the two new request kinds and the preload schema), and `server.test.ts` cases
driving a real server with the MCP SDK client for `import_media`, `place_at_word` and the guidance in
`list_creative_options`. **Not exercised:** the renderer handlers `importInspected`/`placeImage` in
`App.tsx` and `importSource` in `electron/mcp/ipc.ts` (clipboard, fetch, real probe) have only
typecheck plus the tests above around them; no real window, footage, URL fetch, Claude Code or Claude
Desktop session ran, and no exported video with an imported image was checked. macOS is untested.
