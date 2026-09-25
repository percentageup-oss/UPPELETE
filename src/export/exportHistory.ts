const STORAGE_KEY = 'caption-studio.export-speed'
const SMOOTHING = 0.3

export type SpeedStorage = Pick<Storage, 'getItem' | 'setItem'>
type Buckets = Record<string, number>

/** Output pixel-count buckets, so a 4K export never predicts a 480p one. */
const BUCKETS: { id: string; maxPixels: number }[] = [
  { id: '480', maxPixels: 854 * 480 * 1.2 },
  { id: '720', maxPixels: 1280 * 720 * 1.2 },
  { id: '1080', maxPixels: 1920 * 1080 * 1.2 },
  { id: '1440', maxPixels: 2560 * 1440 * 1.2 },
  { id: '2160', maxPixels: Infinity },
]
const bucketOf = (width: number, height: number) => (BUCKETS.find((bucket) => width * height <= bucket.maxPixels) ?? BUCKETS[BUCKETS.length - 1]).id

function defaultStorage(): SpeedStorage | null {
  try { return localStorage } catch { return null }
}

function load(storage: SpeedStorage | null): Buckets {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0))
  } catch { return {} }
}

/** Remembers how fast an export ran on this machine (frames per second, smoothed per size bucket). */
export function recordExportSpeed({ width, height, framesPerSecond }: { width: number; height: number; framesPerSecond: number },
  storage: SpeedStorage | null = defaultStorage()): void {
  if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0) return
  const buckets = load(storage)
  const id = bucketOf(width, height)
  const previous = buckets[id]
  buckets[id] = previous === undefined ? framesPerSecond : previous + SMOOTHING * (framesPerSecond - previous)
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(buckets)) } catch { /* not remembered */ }
}

/** Milliseconds a previous export of this size took per this many frames, or null with no history. */
export function estimateExportMs({ width, height, frameCount }: { width: number; height: number; frameCount: number },
  storage: SpeedStorage | null = defaultStorage()): number | null {
  const speed = load(storage)[bucketOf(width, height)]
  if (speed === undefined || !(frameCount > 0)) return null
  return frameCount / speed * 1000
}

/** "about 3 min", "less than a minute". */
export function formatEstimate(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (ms < 60_000) return 'less than a minute'
  if (minutes < 60) return `about ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `about ${hours} h ${minutes % 60} min`
}
