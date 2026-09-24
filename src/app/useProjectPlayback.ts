import { useEffect, useMemo, useRef, useState } from 'react'
import type { CaptionProject } from '../core/model'
import type { ProjectAsset } from '../core/edit'
import { createSequenceClock } from '../playback/sequenceClock'
import { createVideoPool } from '../playback/videoPool'
import { createSequenceTransport } from '../playback/transport'
import { createSfxScheduler, type SfxClipSpec } from '../playback/SfxScheduler'
import { clipLengthUs } from '../core/timelineModel'
import { constantRate, isConstantSpeed } from '../core/clipTime'
import { effectiveGain } from '../core/clipLinks'

/** Non-frame UI (the transport readout, the timeline playhead) updates at this rate while playing;
 * only `CaptionStage` and the stage editor follow the clock frame by frame. */
const UI_TICK_MS = 100

/**
 * Preview playback for the whole timeline (docs/EDITING.md "Playback"): the sequence clock, the
 * pooled `<video>` elements and their transport, and the sound scheduler — kept out of `App.tsx`,
 * which only asks it to play, pause and seek. Everything reads the live project and asset URLs on
 * each evaluation, so edits, relinks and track mute/hide take effect while playing.
 */
export function useProjectPlayback(project: CaptionProject, durationUs: number, urlOf: (asset: ProjectAsset | null | undefined) => string | null, handlers: {
  onPlayError: (error: unknown, element: HTMLVideoElement) => void
  onMediaError: (assetId: string, element: HTMLVideoElement) => void
  onMediaReady: (assetId: string) => void
  onSoundIssue: (message: string) => void
}) {
  // The compositor finds pooled elements through `transport.elementFor`; a new element can appear
  // without the clock moving (a project opened with the playhead parked), so creating one re-renders.
  const [poolVersion, setPoolVersion] = useState(0)
  const live = useRef({ project, urlOf, handlers, bump: () => setPoolVersion((version) => version + 1) })
  live.current = { project, urlOf, handlers, bump: live.current.bump }
  const clock = useMemo(() => createSequenceClock(), [])
  const pool = useMemo(() => createVideoPool<HTMLVideoElement>(() => document.createElement('video'), {
    onCreate: (entry) => {
      entry.element.addEventListener('error', () => live.current.handlers.onMediaError(entry.assetId, entry.element))
      entry.element.addEventListener('loadeddata', () => live.current.handlers.onMediaReady(entry.assetId))
      live.current.bump()
    },
  }), [])
  const transport = useMemo(() => createSequenceTransport({
    pool,
    timeline: () => {
      const { project: current, urlOf: resolve } = live.current
      const assets = new Map(current.assets.map((asset) => [asset.id, asset]))
      const videoAssetIds = new Set(current.assets.filter((asset) => asset.kind === 'video').map((asset) => asset.id))
      return { tracks: current.tracks, clips: current.clips, videoAssetIds, urlOf: (assetId) => resolve(assets.get(assetId)) }
    },
    onPlayError: (error, element) => live.current.handlers.onPlayError(error, element),
  }), [pool])
  const sfx = useMemo(() => createSfxScheduler({
    createContext: () => new AudioContext(),
    fetchArrayBuffer: (url) => fetch(url).then((response) => response.arrayBuffer()),
    onIssue: (_clipId, message) => live.current.handlers.onSoundIssue(message),
  }), [])

  // Every subscription to the clock is made and undone here, so it survives an effect being torn
  // down and set up again (StrictMode does that on mount). The clock, pool and transport are
  // memoised for the life of the window and are deliberately not disposed: disposing the clock
  // drops every listener, and nothing would re-subscribe them.
  useEffect(() => {
    transport.attach(clock)
    sfx.attach(clock)
    return () => { sfx.detach(); transport.detach(); clock.pause() }
  }, [clock, transport, sfx])

  useEffect(() => { clock.setDurationUs(durationUs) }, [clock, durationUs])
  // Any change to what should be playing — an edit, a relink, a mute/hide toggle — re-evaluates now.
  useEffect(() => transport.refresh(), [transport, project.tracks, project.clips, project.assets, urlOf])

  // Audio clips on unmuted tracks, resolved to what the scheduler plays.
  useEffect(() => {
    const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
    const specs: SfxClipSpec[] = project.clips.flatMap((clip) => {
      // A speed curve has no steady rate to play at, so it is silent here (and in export).
      if (clip.kind !== 'audio' || !isConstantSpeed(clip)) return []
      const asset = assets.get(clip.assetId)
      // A video file's sound plays through the transport's pooled elements, not decoded into memory here.
      if (asset?.kind === 'video') return []
      const url = urlOf(asset)
      return url ? [{ id: clip.id, url, startUs: clip.timelineStartUs, inPointUs: clip.sourceStartUs, durationUs: clipLengthUs(clip), speed: constantRate(clip), gain: effectiveGain(clip, project.tracks) }] : []
    })
    sfx.setClips(specs)
  }, [sfx, project.clips, project.tracks, project.assets, urlOf])

  const [currentUs, setCurrentUs] = useState(0)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    let last = 0
    let pending: number | null = null
    const flush = () => { pending = null; last = Date.now(); setCurrentUs(clock.getUs()) }
    const onTick = () => {
      if (!clock.isPlaying()) { flush(); return }
      if (pending !== null) return
      pending = window.setTimeout(flush, Math.max(0, UI_TICK_MS - (Date.now() - last)))
    }
    const onState = () => { setPlaying(clock.isPlaying()); flush() }
    const offTick = clock.subscribe(onTick)
    const offState = clock.subscribeState(onState)
    return () => { offTick(); offState(); if (pending !== null) window.clearTimeout(pending) }
  }, [clock])

  return {
    clock,
    transport,
    poolVersion,
    currentUs,
    playing,
    seek: (sequenceUs: number) => clock.set(Math.max(0, Math.min(durationUs, Math.round(sequenceUs)))),
    play: () => clock.play(),
    pause: () => clock.pause(),
  }
}
