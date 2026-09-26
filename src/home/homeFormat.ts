/** "Just now", "5 min ago", "Yesterday", or a short date: what a project card says about its last edit. */
export function relativeTime(then: number, now = Date.now()): string {
  const minutes = Math.floor((now - then) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(then).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' })
}

/** m:ss or h:mm:ss from microseconds; empty projects show 0:00. */
export function durationLabel(durationUs: number): string {
  const total = Math.floor(durationUs / 1_000_000)
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`
}
