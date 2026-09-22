import type { Track } from './edit'
import { trackLabel } from './timelineModel'

/**
 * The timeline's rows (docs/EDITING.md "Timeline"): a fixed ruler and captions row, then one row
 * per track from `project.tracks` — video tracks top-down in **reverse** array order (V2 above V1,
 * since the array is back to front), a divider, then audio tracks in array order. The divider splits
 * the space between the video stack and the audio stack; a track's own `heightPx` overrides its
 * share. Pure, so the label column and the content column share one grid template, and
 * `trackAtY` finds the track under the pointer for a cross-track drag.
 */
export const RULER_HEIGHT_PX = 26
export const CAPTIONS_HEIGHT_PX = 44
export const DIVIDER_HEIGHT_PX = 8
export const MIN_TRACK_PX = 28

export type TimelineRow =
  | { id: 'ruler'; kind: 'ruler'; heightPx: number }
  | { id: 'captions'; kind: 'captions'; heightPx: number }
  | { id: string; kind: 'track'; track: Track; label: string; heightPx: number }
  | { id: 'divider'; kind: 'divider'; heightPx: number }

/** Shares `total` among tracks: explicit heights first, the rest split evenly, never below the minimum. */
function stackHeights(tracks: readonly Track[], total: number): number[] {
  const fixed = tracks.reduce((sum, track) => sum + (track.heightPx ?? 0), 0)
  const flexible = tracks.filter((track) => track.heightPx === undefined).length
  const share = flexible ? Math.max(MIN_TRACK_PX, Math.floor((total - fixed) / flexible)) : 0
  return tracks.map((track) => track.heightPx ?? share)
}

/** `split` is the video stack's share (0-1) of the space below the captions. */
export function timelineRows(tracks: readonly Track[], bodyHeightPx: number, split: number): TimelineRow[] {
  const video = tracks.filter((track) => track.kind === 'video').reverse()
  const audio = tracks.filter((track) => track.kind === 'audio')
  const minVideo = MIN_TRACK_PX * video.length
  const minAudio = MIN_TRACK_PX * audio.length
  const media = Math.max(minVideo + minAudio, bodyHeightPx - RULER_HEIGHT_PX - CAPTIONS_HEIGHT_PX - DIVIDER_HEIGHT_PX)
  const videoStack = Math.round(Math.min(media - minAudio, Math.max(minVideo, media * Math.max(0, Math.min(1, split)))))
  const videoHeights = stackHeights(video, videoStack)
  const audioHeights = stackHeights(audio, media - videoStack)
  const row = (track: Track, heightPx: number): TimelineRow => ({ id: track.id, kind: 'track', track, label: trackLabel(track, tracks), heightPx })
  return [
    { id: 'ruler', kind: 'ruler', heightPx: RULER_HEIGHT_PX },
    { id: 'captions', kind: 'captions', heightPx: CAPTIONS_HEIGHT_PX },
    ...video.map((track, index) => row(track, videoHeights[index])),
    { id: 'divider', kind: 'divider', heightPx: DIVIDER_HEIGHT_PX },
    ...audio.map((track, index) => row(track, audioHeights[index])),
  ]
}

/** The grid row template both the label column and the content column share. */
export function trackRows(rows: readonly { heightPx: number }[]): string {
  return rows.map((row) => `${row.heightPx}px`).join(' ')
}

/** Distance from the top of the timeline body to each row's top edge. */
export function rowTops(rows: readonly { heightPx: number }[]): number[] {
  let top = 0
  return rows.map((row) => { const at = top; top += row.heightPx; return at })
}

/** The track whose row contains `y` (px from the top of the timeline body), or `null`. */
export function trackAtY(rows: readonly TimelineRow[], y: number): Track | null {
  const tops = rowTops(rows)
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (y >= tops[index] && y < tops[index] + row.heightPx) return row.kind === 'track' ? row.track : null
  }
  return null
}

/** The stacked heights of the video tracks, for the divider's drag math. */
export function videoStackHeightPx(rows: readonly TimelineRow[]): number {
  return rows.filter((row) => row.kind === 'track' && row.track.kind === 'video').reduce((sum, row) => sum + row.heightPx, 0)
}
