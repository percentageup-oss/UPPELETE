# 08 — Docs + dependency inventory

## Goal
Document the DaVinci Resolve integration so users and future sessions understand it without reading the code.

Read `docs/plans/resolve-textplus/README.md`, `docs/decisions/0008-resolve-textplus.md`, and the Resolve entries in
`docs/STATUS.md` (briefs 01-07) first.

## Read only
- The files above, `resources/resolve/bridge.lua` (the command list only), `electron/resolve/*.ts` (skim),
  `docs/MCP.md` (as a style example for a feature doc), and the relevant sections of `docs/PRODUCT.md`,
  `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/DEPENDENCIES.md` and `docs/INSTALL_TESTERS.md`.

## Steps
1. New `docs/RESOLVE.md`:
   - what it does
   - install, connect and sync steps for users (Free and Studio)
   - the architecture diagram and mailbox protocol v1, with the full command list and parameters
   - install paths per OS
   - time mapping
   - the sync/diff/conflict rules
   - the Text+ support matrix (sent / approximated / not sent)
   - known limits: no auto-sync; re-create the project after picture edits in Resolve; Deliver render settings are
     touched during proxy renders; Mac unverified unless STATUS says otherwise
   - troubleshooting: script not listed means restart Resolve; timeouts mean the script ended, so run it again;
     Workspace → Console shows bridge logs
2. `docs/ARCHITECTURE.md`: a short "DaVinci Resolve bridge" section that links to RESOLVE.md.
3. `docs/PRODUCT.md`: one bullet on Resolve Text+ sync. Note that it's local only, the Lua script runs inside
   Resolve, and nothing is uploaded.
4. `docs/ROADMAP.md`: add the milestone as done, with the follow-ups: an opt-in "auto-sync when idle", proxy
   refresh, cache cleanup, and a rendered-overlay mode for unsupported effects.
5. `docs/DEPENDENCIES.md`:
   - A row for the Lua bridge. `json.lua` is KathaCut's own code (GPL-3.0-or-later), and no third-party code is
     vendored.
   - A note that the Resolve scripting API is used at runtime inside the user's Resolve and not redistributed.
   - A note that the `.drb` template is a KathaCut-authored asset.
   - AutoSubs (MIT) credited as design inspiration only.
6. `docs/INSTALL_TESTERS.md`: a short "DaVinci Resolve" test section, taken from the manual checks in briefs
   03, 04, 06 and 07.

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes.
- [ ] `docs/STATUS.md` entry. The next task is whatever the ROADMAP follow-ups list first.
- [ ] Commit only the docs changed: `Document the DaVinci Resolve integration`.
