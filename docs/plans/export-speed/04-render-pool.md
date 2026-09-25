# 04: Parallel render pool (conditional)

## First: should this run at all?
Open `docs/STATUS.md` and find the brief-03 entry. **If `hostWaitMs` is not clearly larger than
`encoderWaitMs` (for example under 1.5×), stop:** the encoder or decoder is the bottleneck, and more
render processes won't help. Add a one-line STATUS note ("04 skipped: encoder-bound, numbers …") and commit.

## Goal
Run N export hosts in parallel, feeding **one** FFmpeg encoder in frame order.

## Constraints that matter here
- **One encoder, one filter graph.** Don't split the timeline into separately encoded chunks and
  concatenate them: time-based filter expressions and the audio mix would need offsetting, NVENC limits
  concurrent sessions, and GOP boundaries risk visible seams.
- Bounded memory: each host is ≈300 MB, and each raw 1080p frame is 8 MB. Pool size:
  `N = clamp(floor(os.availableParallelism() / 4), 1, 3)`, overridable via `CAPTION_STUDIO_EXPORT_HOSTS`.
- Every host gets its own `--user-data` profile dir (the existing `mkdtemp` pattern) and the same
  `--asset` allow-list and `--transport`.
- Cancellation or any host dying fails the whole export with the most informative error
  (`mostInformativeFailure`), and every host is reaped in `finally`.
- Output must be byte-identical to the single-host run (same frames, same order).

## Read only
- `workers/media/export.ts`: `renderVideo` (host spawn, mask loop, frame loop as changed by 02/03)
- `workers/media/exportProcesses.ts`: `ownedProcess`, the frame reader
- `src/core/layerPlan.ts`: `frameAt` and the `spans` grouping (≈lines 160–180)
- `workers/media/export.test.ts`: the fake-process setup

## Steps
1. Extract the host-talking part into a small `RenderHost` wrapper: spawn, a `render(request)` promise, a reader, `closed`, and `stop`.
2. Masks: rendered by host 0 before the encoder starts, exactly as today.
3. Scheduler: walk the frame indices in order. Indices whose signature equals the previous index's (or
   the gap cache) need no render. Assign each "needs render" index to the next idle host, and keep a
   `Map<index, Promise<Buffer>>`. Write to the encoder strictly in index order. Cap outstanding renders
   at `2N` (the reorder window), so memory stays bounded.
4. Only host 0's lifecycle matters for the Windows stdin-EOF quirk. Apply the same `settledWithin` +
   reap handling to all hosts.
5. Add the pool size to the brief-01 `timings` (`hosts: N`).

## Out of scope
UI, transport, encoder args.

## Tests / verify
- Fake processes with random per-frame delays: the encoder receives frames in order, and the reuse
  pattern is unchanged.
- One host dying mid-export fails the export and reaps the rest. Cancellation reaps all hosts.
- Outstanding renders never exceed 2N.
- Real: smoke with `CAPTION_STUDIO_EXPORT_HOSTS=1` vs the default. Compare decoded frame hashes
  (`ffmpeg -i out.mp4 -f framemd5 -`); they must be identical. Record fps.
- `npx vitest run workers/media` then `npm run typecheck`.

## Done when
- [ ] Tests, typecheck and smoke pass, with identical framemd5
- [ ] `docs/STATUS.md` entry: fps for 1 vs N hosts, peak memory if observed, platform
- [ ] Committed. Stop.
