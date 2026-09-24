/**
 * The `<video>` elements preview playback draws from, one per (track, asset) with an LRU cap
 * (docs/EDITING.md "Playback"). Elements are created here — never by React — and mounted into the
 * composition by `VideoSlot`, so a change to the layer list never reloads media. `playsInline` and
 * `preload="auto"`; volume and mute are set per clip by the transport.
 */
export type VideoLike = {
  src: string
  currentTime: number
  readonly paused: boolean
  readonly seeking: boolean
  readonly readyState: number
  readonly error?: MediaError | null
  muted: boolean
  volume: number
  playbackRate: number
  preload: string
  playsInline?: boolean
  play(): Promise<void>
  pause(): void
  load(): void
  removeAttribute(name: string): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
  requestVideoFrameCallback?(callback: (now: number, metadata: { mediaTime: number }) => void): number
  cancelVideoFrameCallback?(handle: number): void
}

export type PooledVideo<V extends VideoLike = VideoLike> = { key: string; trackId: string; assetId: string; url: string; element: V; lastUsed: number }

/** Room for a few stacked videos and each one's linked audio element. */
export const VIDEO_POOL_CAPACITY = 10

export type VideoPool<V extends VideoLike = VideoLike> = {
  get(key: string): PooledVideo<V> | undefined
  /** The element for `key`, pointed at `url` — evicting the least recently used one when full. */
  acquire(key: string, trackId: string, assetId: string, url: string): PooledVideo<V>
  entries(): PooledVideo<V>[]
  /** Marks keys as in use this frame so they are never the ones evicted. */
  touch(keys: Iterable<string>): void
  dispose(): void
}

export function createVideoPool<V extends VideoLike>(create: () => V, options: { capacity?: number; onCreate?: (entry: PooledVideo<V>) => void; onEvict?: (entry: PooledVideo<V>) => void } = {}): VideoPool<V> {
  const capacity = Math.max(1, options.capacity ?? VIDEO_POOL_CAPACITY)
  const entries = new Map<string, PooledVideo<V>>()
  let clock = 0
  const unload = (entry: PooledVideo<V>) => {
    entry.element.pause()
    entry.element.removeAttribute('src')
    entry.element.load()
  }
  return {
    get: (key) => entries.get(key),
    acquire(key, trackId, assetId, url) {
      const existing = entries.get(key)
      if (existing) {
        existing.lastUsed = ++clock
        if (existing.url !== url) { existing.url = url; existing.element.src = url }
        return existing
      }
      if (entries.size >= capacity) {
        const victim = [...entries.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0]
        entries.delete(victim.key)
        unload(victim)
        options.onEvict?.(victim)
      }
      const element = create()
      element.preload = 'auto'
      element.playsInline = true
      element.src = url
      const entry = { key, trackId, assetId, url, element, lastUsed: ++clock }
      entries.set(key, entry)
      options.onCreate?.(entry)
      return entry
    },
    entries: () => [...entries.values()],
    touch(keys) { for (const key of keys) { const entry = entries.get(key); if (entry) entry.lastUsed = ++clock } },
    dispose() { for (const entry of entries.values()) { unload(entry); options.onEvict?.(entry) } entries.clear() },
  }
}
