export const US_PER_SECOND = 1_000_000

export function parseTimestamp(value: string): number | null {
  const match = value.trim().match(/^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{3})$/)
  if (!match) return null
  const [, hours, minutes, seconds, millis] = match
  const h = Number(hours), m = Number(minutes), s = Number(seconds), ms = Number(millis)
  if (m > 59 || s > 59) return null
  return ((h * 3600 + m * 60 + s) * 1000 + ms) * 1000
}

export function formatTimestamp(timeUs: number, separator = ','): string {
  const totalMs = Math.max(0, Math.round(timeUs / 1000))
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(ms).padStart(3, '0')}`
}

export function formatClock(timeUs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeUs / US_PER_SECOND))
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}

/** Preserve exact source boundaries when millisecond inspector text has not been edited. */
export function parseEditedTimestamp(value: string, originalUs: number): number | null {
  if (value === formatTimestamp(originalUs, ':')) return originalUs
  return parseTimestamp(value.replace(/:(\d{3})$/, ',$1'))
}
