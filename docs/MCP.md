# Local agent control (MCP)

Status: **core implemented 2026-09-21** — Claude Code can connect over HTTP today and drive
inspection, editing, caption styling, playhead/selection and undo/redo. Media import, frame
snapshots, transcription/export/job tools, the Claude Desktop stdio bridge and repo-shipped
recipes are **not implemented yet** (see "Not implemented yet" below). This document is the
contract; `tickets.md`'s MCP tickets track the remaining slices.

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

The DNS-rebinding protection built into the MCP SDK's Streamable HTTP transport is enabled
(`allowedHosts` locked to `127.0.0.1:<port>`/`localhost:<port>`), and every request is checked for
the exact Bearer token (constant-time compare) before it ever reaches MCP protocol handling — an
unauthenticated request gets a 401 and touches nothing else.

## Time bases and units

Every tool speaks **integer microseconds**. Two time bases exist in this app
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
- No tool opens a native dialog, reads an arbitrary file, or exposes model downloads, the Gemini
  key, or app settings beyond what is listed above.
- The renderer bridge serializes one request at a time; a hung or closed project window fails the
  in-flight call with an honest error rather than hanging forever (`RendererBridge`'s timeout/cancel).

## Not implemented yet

These are real gaps, not just unlisted tools — tracked as separate `tickets.md` entries:

- **`render_frame`** (a captured preview PNG for Claude's vision loop — "does this match the
  reference image?") and the `prepare-snapshot` renderer request it needs (frame-exact readiness,
  `capturePage`) are not wired up. `useAgentBridge`'s dispatcher already has the request kind
  reserved and returns an honest "not available yet" error if asked.
- **`import_media` / `import_image_data`** (bringing a path or a pasted image into the project as
  an asset) do not exist yet, so an agent cannot place new media — only edit what is already
  imported.
- **`place_at_word`** and alpha-clip (`hasAlpha`) export support for word-anchored fillers/overlays
  are not implemented.
- **Jobs** (`transcribe`, `detect_silence`, `export_video`, `export_srt`, `get_job`, `cancel_job`,
  `save_project`) are not exposed over MCP.
- **Claude Desktop**: no stdio bridge (`mcp-stdio.cjs`) exists yet, so only Claude Code (HTTP) can
  connect today; the Settings tab says so plainly rather than showing a config snippet for a file
  that does not exist.
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
- `electron/mcp/tools.ts` — the registered tool set.
- `electron/mcp/ipc.ts` — Settings-tab IPC (`agent:status`, `agent:settings-*`) and the app-lifetime
  start/stop/resume glue.
- `src/SettingsDialog.tsx`'s `AgentSettings` — the Settings tab; `App.tsx`'s `agentStatus` state and
  top-bar chip.

## Verification

`npm run check` (strict TypeScript, tests, renderer build, Electron main/preload bundle, worker
build) — **979 tests across 108 files** as of this slice. Notably real, not mocked: `electron/mcp/server.test.ts`
starts an actual `startMcpServer` instance on a loopback port and drives it with the MCP SDK's own
HTTP client (`tools/list`, `tools/call`, wrong/missing token → 401, input-schema rejection), and
`electron/mcp/ipc.test.ts` exercises the real enable/disable/rotate/resume-after-restart lifecycle
against a real server (only `electron`'s `app`/`BrowserWindow`/`ipcMain` are mocked). `useAgentBridge`'s
request→response mapping and every editing-command schema round-trip are unit-tested directly.

**Not exercised in this slice:** the app was not launched interactively in this sandboxed
environment, so no real Claude Code session was connected end to end, the Settings tab was not
clicked through in a live window, and macOS/Windows packaging behavior is unverified here. The
manual verification in the original plan (enable in Settings, `claude mcp add …`, restyle via
`set_caption_style`, confirm the timeline/preview reflect it and ⌘Z reverts it) still needs to be
run on an actual desktop build before this is called done end to end.
