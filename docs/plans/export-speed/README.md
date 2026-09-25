# Export speed + export UX: session briefs

Each brief is one **fresh session**'s work. Open a new session and say:

> Implement docs/plans/export-speed/0N-<name>.md

The session reads that brief and only the files it lists, implements, tests, appends a short entry to
`docs/STATUS.md`, commits, and stops. Briefs never rely on earlier conversation. Anything a later brief
needs from an earlier one (like baseline numbers) is recorded in `docs/STATUS.md` or in the code.

The project rules from `AGENTS.md`, `docs/PRODUCT.md` and `docs/ARCHITECTURE.md` that matter for a brief
are summarized inside it. Open those docs only at the section a brief points to, and only if unsure.

## Order

| # | Brief | Depends on | Size |
|---|-------|-----------|------|
| 01 | [Measure + cache support check](01-measure-and-cache.md) | none | S |
| 02 | [Overlap rendering with encoding](02-pipeline-overlap.md) | 01 | M |
| 03 | [Raw frame transport instead of PNG](03-raw-transport.md) | 02 | L |
| 04 | [Parallel render pool](04-render-pool.md), **only if 03's numbers say so** | 03 | L |
| 05 | [Progress: Preparing, ETA, speed](05-ux-progress.md) | none | S |
| 06 | [Taskbar progress, keep awake, quit guard](06-ux-system.md) | none | S |
| 07 | [Show in folder + completion notification](07-ux-finish.md) | none | S |
| 08 | [Time estimate in the Export dialog](08-ux-estimate.md) | 05 | S |

05–08 are independent of the speed work (01–04) and can run in any order or be skipped.

## Why export is slow (shared findings)

- **Serial frame loop.** `workers/media/export.ts` (the `for` loop near the end of `renderVideo`) asks the
  export host for frame N, waits for the PNG, writes it to FFmpeg, and only then asks for N+1. The host
  and FFmpeg each sit idle while the other works. The PNG pipe input uses `-thread_queue_size 1`.
- **PNG encoding dominates.** ADR 0003 (`docs/decisions/0003-export-renderer.md`, "Measurements") measured
  ≈7 ms to paint a 1080p frame and 11–16 ms to PNG-encode it. FFmpeg then spends more time decoding it.
- **One render process.** Animated captions change every frame, so signature reuse (`src/core/layerPlan.ts`)
  rarely skips work.
- **Fixed per-job overhead.** `exportSupport()` re-runs `ffmpeg -version` / `ffprobe -version` every export.
- **Possible background throttling.** The windowless export host only sets `backgroundThrottling:false`.
