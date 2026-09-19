const CONTAINER_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
}

export type ContainerHint = { checked: boolean; verdict: '' | 'maybe' | 'probably' }

/** Asks the actual embedded player (via its real `canPlayType`), rather than guessing from a hardcoded codec matrix. */
export function containerPlaybackHint(fileName: string, canPlayType: (mimeType: string) => string): ContainerHint {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = CONTAINER_MIME[extension]
  if (!mimeType) return { checked: false, verdict: '' }
  const verdict = canPlayType(mimeType)
  return { checked: true, verdict: verdict === 'probably' || verdict === 'maybe' ? verdict : '' }
}

/** Standard HTMLMediaElement error codes; this mapping is a stable web-platform spec, not a per-file guess. */
export function describeMediaError(error: { code: number } | null | undefined): string | null {
  if (!error) return null
  switch (error.code) {
    case 1: return 'Loading this media was aborted.'
    case 2: return 'A network error interrupted loading this media.'
    case 3: return 'The embedded player could not decode this media: the codec or stream is unsupported or corrupt.'
    case 4: return 'The embedded player does not support this media’s format or codec.'
    default: return 'The embedded player could not play this media.'
  }
}

/**
 * Turns a rejected `HTMLMediaElement.play()` into a user-facing message, or null when nothing is
 * wrong. `AbortError` means the play was superseded by a `pause()`, seek or new load before it
 * started — the element is already in the state of the last call, so it is not an error to report.
 * Anything else names the actual DOMException, plus the element's own `MediaError` when it has one,
 * so a report says *why* playback failed rather than a generic line that hides the cause.
 */
export function describePlayFailure(error: unknown, mediaError: { code: number } | null | undefined): string | null {
  const name = error instanceof Error ? error.name : ''
  if (name === 'AbortError') return null
  const reason = error instanceof Error ? `${name ? `${name}: ` : ''}${error.message}` : 'Unknown error'
  const detail = describeMediaError(mediaError)
  return `Playback could not start (${reason}).${detail ? ` ${detail}` : ''}`
}
