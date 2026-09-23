import type { CaptionTrack, EffectRegionKind, Track } from './edit'
import { captionTrackLabel, trackLabel } from './timelineModel'

/**
 * The timeline's rows (docs/EDITING.md "Timeline"): a fixed ruler, then one row per caption track
 * from `project.captionTracks` (schema 6) — back to front, top-down, the same convention
 * video/audio tracks use — then the one zoom lane (schema 7: `project.zoomRegions` is a single
 * sequence-timed lane over the whole program, not a per-track list, so it gets one fixed row, not
 * one per something), then the blur lane when the project has any blur region (unlike zoom, blur's
 * row is shown only when used — every later effect kind follows this, not zoom's always-shown
 * precedent), then one row per track from `project.tracks` — video tracks top-down in
 * **reverse** array order (V2 above V1, since the array is back to front), a divider, then audio
 * tracks in array order. The divider splits the space between the video stack and the audio stack;
 * a track's own `heightPx` overrides its share. Caption-track, zoom-lane and blur-lane rows have a
 * fixed height — there is only ever a handful of caption tracks and one lane of each effect kind,
 * and nothing yet needs to resize any of them. Pure, so the label column and the content column
 * share one grid template, and `trackAtY` finds the track under the pointer for a cross-track drag.
 */
export const RULER_HEIGHT_PX = 26
export const CAPTIONS_HEIGHT_PX = 44
export const ZOOM_LANE_HEIGHT_PX = 32
export const BLUR_LANE_HEIGHT_PX = 32
/** Frame-paint effects (docs/EDITING.md "Frame-paint effects") each get their own lane, shown only
 * when used — the same "each lane names its own kind" convention blur set for later effects. */
export const EFFECT_LANE_HEIGHT_PX = 32
export const TEXT_LANE_HEIGHT_PX = 44
/** Display order for effect lanes when more than one kind is present at once. */
export const EFFECT_KIND_ORDER: readonly EffectRegionKind[] = ['vignette', 'letterbox', 'fade']
export const DIVIDER_HEIGHT_PX = 8
export const MIN_TRACK_PX = 28

export type TimelineRow =
  | { id: 'ruler'; kind: 'ruler'; heightPx: number }
  | { id: 'textLane'; kind: 'textLane'; heightPx: number }
  | { id: string; kind: 'captionTrack'; track: CaptionTrack; label: string; heightPx: number }
  | { id: 'zoomLane'; kind: 'zoomLane'; heightPx: number }
  | { id: 'blurLane'; kind: 'blurLane'; heightPx: number }
  | { id: string; kind: 'effectLane'; effectKind: EffectRegionKind; heightPx: number }
  | { id: string; kind: 'track'; track: Track; label: string; heightPx: number }
  | { id: 'divider'; kind: 'divider'; heightPx: number }

/** Shares `total` among tracks: explicit heights first, the rest split evenly, never below the minimum. */
function stackHeights(tracks: readonly Track[], total: number): number[] {
  const fixed = tracks.reduce((sum, track) => sum + (track.heightPx ?? 0), 0)
  const flexible = tracks.filter((track) => track.heightPx === undefined).length
  const share = flexible ? Math.max(MIN_TRACK_PX, Math.floor((total - fixed) / flexible)) : 0
  return tracks.map((track) => track.heightPx ?? share)
}

/** `split` is the video stack's share (0-1) of the space below the captions and the effect lanes.
 * `effectKinds` are the frame-paint kinds actually present in the project (any order; shown in
 * `EFFECT_KIND_ORDER`), each getting its own lane the same way blur's does. */
export function timelineRows(tracks: readonly Track[], captionTracks: readonly CaptionTrack[], bodyHeightPx: number, split: number, hasBlur = false, effectKinds: readonly EffectRegionKind[] = [], textRows = 1): TimelineRow[] {
  const video = tracks.filter((track) => track.kind === 'video').reverse()
  const audio = tracks.filter((track) => track.kind === 'audio')
  const captionsHeightPx = CAPTIONS_HEIGHT_PX * captionTracks.length
  const minVideo = MIN_TRACK_PX * video.length
  const minAudio = MIN_TRACK_PX * audio.length
  const present = new Set(effectKinds)
  const shownEffectKinds = EFFECT_KIND_ORDER.filter((kind) => present.has(kind))
  const effectLanesHeightPx = ZOOM_LANE_HEIGHT_PX + (hasBlur ? BLUR_LANE_HEIGHT_PX : 0) + shownEffectKinds.length * EFFECT_LANE_HEIGHT_PX
  const textLaneHeightPx = TEXT_LANE_HEIGHT_PX + Math.max(0, textRows - 1) * 18
  const media = Math.max(minVideo + minAudio, bodyHeightPx - RULER_HEIGHT_PX - captionsHeightPx - effectLanesHeightPx - textLaneHeightPx - DIVIDER_HEIGHT_PX)
  const videoStack = Math.round(Math.min(media - minAudio, Math.max(minVideo, media * Math.max(0, Math.min(1, split)))))
  const videoHeights = stackHeights(video, videoStack)
  const audioHeights = stackHeights(audio, media - videoStack)
  const row = (track: Track, heightPx: number): TimelineRow => ({ id: track.id, kind: 'track', track, label: trackLabel(track, tracks), heightPx })
  const captionRow = (track: CaptionTrack): TimelineRow => ({ id: track.id, kind: 'captionTrack', track, label: captionTrackLabel(track, captionTracks), heightPx: CAPTIONS_HEIGHT_PX })
  const effectRow = (kind: EffectRegionKind): TimelineRow => ({ id: `effectLane-${kind}`, kind: 'effectLane', effectKind: kind, heightPx: EFFECT_LANE_HEIGHT_PX })
  return [
    { id: 'ruler', kind: 'ruler', heightPx: RULER_HEIGHT_PX },
    ...captionTracks.map(captionRow),
    { id: 'textLane', kind: 'textLane', heightPx: textLaneHeightPx },
    // One fixed lane, always shown: zoom regions belong to the whole program, not to one video
    // track, so there is nothing to add/remove/reorder here — just a permanent drop target.
    { id: 'zoomLane', kind: 'zoomLane', heightPx: ZOOM_LANE_HEIGHT_PX },
    // Blur's own lane, shown only when the project actually has a blur region — the drop target to
    // create the first one is the Effects panel tile, not an empty permanent row.
    ...(hasBlur ? [{ id: 'blurLane' as const, kind: 'blurLane' as const, heightPx: BLUR_LANE_HEIGHT_PX }] : []),
    ...shownEffectKinds.map(effectRow),
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
