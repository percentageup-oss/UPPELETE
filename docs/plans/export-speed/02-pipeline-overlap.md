# 02: Overlap caption rendering with encoding

## Goal
Today the host renders frame N, the worker writes it to FFmpeg, and only then asks for N+1, so each
process idles while the other works. Make them run concurrently. Also stop Chromium/Windows
throttling the hidden host. Output pixels must not change.

## Constraints that matter here
- The export host accepts **one request in flight** (`scripts/export-host.mjs`: "Only one frame may be
  in flight"). Keep that. The overlap is between the host rendering N+1 and FFmpeg ingesting N.
- Memory stays bounded: at most one extra frame buffered.
- Cancellation, the stall deadline (`withinStallDeadline`) and failure reporting
  (`mostInformativeFailure`) must keep working. A rejected prefetch must never become an unhandled rejection.
- Spawn args stay argument arrays. The argument snapshots in tests are the contract; update them deliberately.

## Read only
- `workers/media/export.ts`: `renderVideo`, especially the frame loop (≈lines 183–224): `toEncoder`,
  `fromHost`, the `previous`/`gap` reuse cache.
- `workers/media/exportArguments.ts`: the two `'-thread_queue_size', '1', '-f', 'image2pipe'` lines (≈230, ≈625).
- `scripts/export-host.mjs`: lines 10–20 (command-line switches).
- `docs/STATUS.md`: the brief-01 baseline entry (search "baseline").
- Tests: `workers/media/export.test.ts`, `workers/media/exportArguments.test.ts`, `exportArgumentsV3.test.ts`.

## Steps
1. Restructure the loop into two stages with a one-slot hand-off:
   - Work out the sequence of "what to send" per index. It's either a cached buffer, or "needs host
     render" for `job.request(index, frame)`.
   - Keep one pending host promise. When frame N's PNG is received, immediately issue the host request
     for the **next index that needs rendering** (skipping cached indices, whose bytes are known), then
     `await toEncoder(N, png)`.
   - Reuse logic stays identical: `previous` and `gap` compare signatures in index order. Careful: a
     prefetched frame's reuse decision depends on the frame before it. Decide reuse by **signature
     equality with the previous index's signature**, which is known from `job.layer.frameAt(i-1)` without
     needing its bytes. Look up the gap cache by signature too.
   - Attach `.catch(() => {})` to the pending promise for bookkeeping, and still `await` it for the real error.
2. `-thread_queue_size` 1 → 8 for the caption pipe input in both argument builders. Update the snapshot
   expectations in the two `exportArguments*.test.ts` files.
3. In `scripts/export-host.mjs`, next to `force-device-scale-factor`, append the switches
   `disable-renderer-backgrounding`, `disable-background-timer-throttling` and
   `disable-backgrounding-occluded-windows`.
4. Rebuild (`npm run build`) and rerun the brief-01 smoke command with the same media and settings.

## Out of scope
Raw transport (03), multiple hosts (04), any UI.

## Tests / verify
- `export.test.ts` with the fake processes: (a) the host receives request N+1 before the encoder write of
  N resolves; (b) the frame bytes reach the encoder in index order, with the right reuse for a
  signature pattern like A A B B A (the gap cache still hits); (c) cancelling while a prefetch is pending
  rejects `CANCELLED` and leaves no unhandled rejection; (d) the stall deadline still fires with a hung host.
- `npx vitest run workers/media` then `npm run typecheck`.
- Real smoke: the output probes as valid, the frame count equals the brief-01 run, and fps improved.

## Done when
- [ ] Tests, typecheck and the real smoke pass
- [ ] `docs/STATUS.md` entry: before/after fps and host/encoder wait from the timings, and the platform
- [ ] Committed. Stop.
