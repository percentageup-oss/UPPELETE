/**
 * The per-frame playback clock the preview subscribes to. Only `CaptionStage` and the overlay stage
 * editor subscribe (through `useSyncExternalStore`), so a 60 fps tick re-renders only those small
 * subtrees. `getUs` is **sequence** microseconds; the implementation is the transport's
 * `createSequenceClock` (src/playback/sequenceClock.ts).
 */
export type PlaybackClock = {
  /** Subscribe to timestamp changes; returns an unsubscribe function (React `useSyncExternalStore` shape). */
  subscribe(listener: () => void): () => void
  getUs(): number
  /** Seeks to an absolute sequence time (integer microseconds). */
  set(us: number): void
}
