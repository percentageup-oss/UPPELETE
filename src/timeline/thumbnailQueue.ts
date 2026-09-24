import type { MediaFingerprint } from '../core/media'
import type { ClipSpeed } from '../core/edit'
import { isConstantSpeed, timelineLengthUs, timelineToSourceOffsetUs } from '../core/clipTime'
import { THUMBNAIL_MAX_COUNT, thumbnailTimestamps, type ThumbnailImage } from '../core/thumbnails'

/**
 * Per-clip filmstrips (docs/EDITING.md "Per-video thumbnails"). `THUMBNAIL_MAX_COUNT` bounds one
 * request, not how many requests a long multi-clip timeline makes, so strips go through this queue:
 * results are cached by `(fingerprint, source range, count)`, at most `MAX_IN_FLIGHT` requests run
 * at once, and the timeline only asks for clips that intersect the viewport.
 */
export const MAX_IN_FLIGHT = 8

type Loader = (request: { fingerprint: MediaFingerprint; timestampsUs: number[]; width: number }) => Promise<ThumbnailImage[]>
type Entry = { state: 'queued' | 'loading' | 'ready' | 'error'; images: ThumbnailImage[]; run: () => void }

export type ThumbnailStripRequest = { fingerprint: MediaFingerprint; sourceStartUs: number; sourceEndUs: number; speed?: ClipSpeed; count: number; width: number }

export function stripKey(request: ThumbnailStripRequest): string {
  return `${request.fingerprint.value}:${request.sourceStartUs}:${request.sourceEndUs}:${request.speed && !isConstantSpeed(request) ? JSON.stringify(request.speed.points) : ''}:${request.count}:${request.width}`
}

/** Midpoints of `count` equal buckets over the clip's own source range — or, for a speed ramp, over its
 * timeline width, so each tile shows the frame that is actually playing there. */
export function stripTimestamps(sourceStartUs: number, sourceEndUs: number, count: number, speed?: ClipSpeed): number[] {
  const tiles = Math.max(1, Math.min(THUMBNAIL_MAX_COUNT, count))
  if (!speed || isConstantSpeed({ speed })) return thumbnailTimestamps(sourceEndUs - sourceStartUs, tiles).map((us) => sourceStartUs + us)
  const retime = { timelineStartUs: 0, sourceStartUs, sourceEndUs, speed }
  return thumbnailTimestamps(timelineLengthUs(retime), tiles).map((us) => timelineToSourceOffsetUs(retime, us))
}

export function createThumbnailQueue(load: Loader, maxInFlight = MAX_IN_FLIGHT) {
  const entries = new Map<string, Entry>()
  // Listeners are kept per strip, not per entry, so a component can subscribe before it asks.
  const listeners = new Map<string, Set<() => void>>()
  const notify = (key: string) => { for (const listener of listeners.get(key) ?? []) listener() }
  const waiting: string[] = []
  let inFlight = 0
  const pump = () => {
    while (inFlight < maxInFlight && waiting.length) {
      const key = waiting.shift()!
      const entry = entries.get(key)
      if (entry?.state === 'queued') entry.run()
    }
  }
  return {
    /** Current state of a strip; asks for it (once) when `wanted`. `listener` fires when it changes. */
    get(request: ThumbnailStripRequest, wanted: boolean): { state: Entry['state'] | 'idle'; images: ThumbnailImage[] } {
      const key = stripKey(request)
      let entry = entries.get(key)
      if (!entry && wanted) {
        const created: Entry = { state: 'queued', images: [], run: () => {} }
        created.run = () => {
          created.state = 'loading'
          inFlight++
          load({ fingerprint: request.fingerprint, timestampsUs: stripTimestamps(request.sourceStartUs, request.sourceEndUs, request.count, request.speed), width: request.width })
            .then((images) => { created.state = 'ready'; created.images = images })
            .catch(() => { created.state = 'error' })
            .finally(() => { inFlight--; notify(key); pump() })
        }
        entries.set(key, created)
        waiting.push(key)
        entry = created
        pump()
      }
      return entry ? { state: entry.state, images: entry.images } : { state: 'idle', images: [] }
    },
    subscribe(request: ThumbnailStripRequest, listener: () => void): () => void {
      const key = stripKey(request)
      const set = listeners.get(key) ?? new Set()
      listeners.set(key, set)
      set.add(listener)
      return () => { set.delete(listener); if (!set.size) listeners.delete(key) }
    },
    inFlight: () => inFlight,
  }
}
export type ThumbnailQueue = ReturnType<typeof createThumbnailQueue>
