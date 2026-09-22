import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { CaptionWord, Cue } from './core/model'
import type { Clip, Marker, ProjectAsset, Track } from './core/edit'
import { anchoredScrollLeft, dragCueBy, pixelToTime, snapDelta, timeToPixel, type CueDragMode } from './core/timeline'
import { captionClips, clipEndUs, clipLengthUs, spansInSequence } from './core/timelineModel'
import { gapsOnTrack, snapTargets, type ClipEdge, type EditMode } from './core/clipEdits'
import { previewClipDrag, type ClipDragMode } from './core/clipDrag'
import { timelineRows, trackAtY, trackRows, videoStackHeightPx, RULER_HEIGHT_PX } from './core/timelineLayout'
import type { Selection } from './core/timelineItems'
import { formatClock } from './core/time'
import type { WaveformData } from './core/waveform'
import { TimelineToolbar, type ClipTools, type TimelineActions } from './TimelineToolbar'
import type { CaptionDisplay } from './captions/wordDisplay'
import { dropContent, type AssetDragPayload } from './core/dragPayload'
import { DEFAULT_IMAGE_CLIP_US, dropTimeAt } from './core/timelineDrop'
import { CaptionsTrack, type CaptionSpan } from './timeline/CaptionsTrack'
import { ClipBlock } from './timeline/ClipBlock'
import { VideoClipContent } from './timeline/VideoClipContent'
import { AudioClipContent } from './timeline/AudioClipContent'
import { TimelineRuler, useRulerTicks } from './timeline/TimelineRuler'
import { TimelineTrackHeaders, type TrackHeaderActions } from './timeline/TimelineTrackHeaders'
import type { ThumbnailQueue } from './timeline/thumbnailQueue'

type CueDrag = {
  kind: 'cue'
  cue: Cue
  mode: CueDragMode
  /** Sequence minus source time for the clip the grabbed piece is seen through. */
  offsetUs: number
  /** The grabbed clip's source range: a caption drag stays inside the clip it was grabbed in. */
  sourceBounds: { startUs: number; endUs: number }
  originClientX: number
  pointerId: number
  contentWidthPx: number
  originPlayheadUs: number
}
type ClipDrag = {
  kind: 'clip'
  clip: Clip
  mode: ClipDragMode
  /** Alt+drag on the body: the gesture places a copy and leaves the original where it is. */
  clone: boolean
  originClientX: number
  pointerId: number
  contentWidthPx: number
  originPlayheadUs: number
}
type DividerDrag = { pointerId: number; originClientY: number; originSplit: number; mediaHeightPx: number }

type TimelineProps = {
  /** Every caption, in the source time of the video it names. */
  cues: Cue[]
  tracks: Track[]
  clips: Clip[]
  assets: ProjectAsset[]
  /** Sequence time. */
  currentUs: number
  /** Sequence time: the length the timeline shows. */
  durationUs: number
  selection: Selection | null
  /** Ruler notes (docs/MCP.md): user-authored, or proposed by an agent for the user to accept or
   * dismiss. Optional so every existing caller keeps compiling unchanged. */
  markers?: Marker[]
  onSelectMarker?: (markerId: string) => void
  warningCueIds: Set<string>
  /** Peaks per asset id, extracted once per file and sliced per clip. */
  waveforms: ReadonlyMap<string, WaveformData>
  waveformStatus: string | null
  onCancelWaveform?: () => void
  /** Receives **sequence** microseconds. */
  onSeek: (sequenceUs: number, cueId?: string) => void
  /** Caption drags stay in source time; `seekUs` is the sequence time of the dragged edge. */
  onDragPreview: (cue: Cue | null, seekUs?: number) => void
  onDragCommit: (original: Cue, preview: Cue, mode: CueDragMode) => void
  editMode: EditMode
  onEditMode: (mode: EditMode) => void
  onSelectClip: (clipId: string) => void
  onClipMove: (clipId: string, trackId: string, startUs: number) => void
  onClipClone: (clip: Clip) => void
  onClipTrim: (clipId: string, edge: ClipEdge, deltaUs: number) => void
  onCloseGap: (trackId: string, atUs: number) => void
  trackActions: TrackHeaderActions
  /** A file's measured duration where its probe reported none, for clamping trims. */
  assetDurationUs: (assetId: string) => number | null
  display: CaptionDisplay
  onDisplay: (display: CaptionDisplay) => void
  selectedWordId: string | null
  onSelectWord: (cue: Cue, word: CaptionWord) => void
  actions: TimelineActions
  clipTools: ClipTools
  canSplit: boolean
  canMerge: boolean
  canAdd: boolean
  hasSelectedWord: boolean
  /** A bin asset dragged onto the timeline, with the track under the pointer. */
  onDropAsset?: (payload: AssetDragPayload, sequenceUs: number, trackId: string | null) => void
  /** Files dragged in from Finder/Explorer. */
  onDropFiles?: (files: File[], sequenceUs: number, trackId: string | null) => void
  thumbnailQueue?: ThumbnailQueue | null
}

const ZOOM_MIN = 1
const ZOOM_MAX = 32
const SNAP_THRESHOLD_PX = 8
const FOLLOW_MARGIN = 0.1

export function Timeline(props: TimelineProps) {
  const { cues, tracks, clips, assets, currentUs, durationUs, selection, markers = [], warningCueIds, waveforms, onSeek, display, actions } = props
  const [zoom, setZoom] = useState(1)
  const [snap, setSnap] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [mediaSplit, setMediaSplit] = useState(.5)
  const [drag, setDrag] = useState<CueDrag | ClipDrag | null>(null)
  const [draggedCue, setDraggedCue] = useState<Cue | null>(null)
  const [clipPreview, setClipPreview] = useState<Clip | null>(null)
  const [snapGuideUs, setSnapGuideUs] = useState<number | null>(null)
  const [dividerDrag, setDividerDrag] = useState<DividerDrag | null>(null)
  const [scrubPointer, setScrubPointer] = useState<number | null>(null)
  const [viewport, setViewport] = useState({ widthPx: 0, heightPx: 0, scrollLeft: 0 })
  const [dropIndicator, setDropIndicator] = useState<{ leftUs: number; widthUs: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const callbacks = useRef(props)
  callbacks.current = props
  const selectedCueId = selection?.kind === 'cue' ? selection.id : null
  const selectedClipId = selection?.kind === 'clip' ? selection.id : null

  useEffect(() => {
    const body = bodyRef.current
    const scroller = viewportRef.current
    if (!body || !scroller) return
    // The body, not the scrolling viewport, sets the height the rows share, so a tall stack of tracks
    // scrolls instead of feeding its own height back into the layout.
    const measure = () => setViewport((state) => ({ ...state, widthPx: scroller.clientWidth, heightPx: body.clientHeight }))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  const rows = useMemo(() => timelineRows(tracks, viewport.heightPx, mediaSplit), [tracks, viewport.heightPx, mediaSplit])
  const gridStyle = { gridTemplateRows: trackRows(rows) } as CSSProperties
  const mediaHeightPx = rows.filter((row) => row.kind === 'track').reduce((sum, row) => sum + row.heightPx, 0)
  const trackById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks])
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])
  const clipCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const clip of clips) counts.set(clip.trackId, (counts.get(clip.trackId) ?? 0) + 1)
    return counts
  }, [clips])

  // Captions are seen through the visible video clips of their own file.
  const visibleVideo = useMemo(() => captionClips(tracks, clips), [tracks, clips])
  const hasVideo = clips.some((clip) => clip.kind === 'video')
  const spansOf = (cue: Cue): CaptionSpan[] => {
    if (!cue.mediaAssetId) return hasVideo ? [] : [{ startUs: cue.startUs, endUs: cue.endUs, sourceStartUs: cue.startUs, sourceEndUs: cue.endUs, clipId: null }]
    return spansInSequence(cue, cue.mediaAssetId, visibleVideo)
  }
  const displayCues = draggedCue ? cues.map((cue) => cue.id === draggedCue.id ? draggedCue : cue) : cues
  const displayClips = clipPreview && drag?.kind === 'clip'
    ? drag.clone ? [...clips, clipPreview] : clips.map((clip) => clip.id === clipPreview.id ? clipPreview : clip)
    : clips
  const ticks = useRulerTicks(durationUs, zoom)

  const updateZoom = (nextZoom: number, anchorUs = currentUs) => {
    const element = viewportRef.current
    if (!element) return setZoom(nextZoom)
    const nextScroll = anchoredScrollLeft(anchorUs, durationUs, element.clientWidth * zoom, element.scrollLeft, element.clientWidth, element.clientWidth * nextZoom)
    setZoom(nextZoom)
    requestAnimationFrame(() => { element.scrollLeft = nextScroll })
  }
  const zoomRef = useRef({ zoom, updateZoom })
  zoomRef.current = { zoom, updateZoom }

  // ⌘/Ctrl + wheel zooms around the pointer; React's onWheel is passive, so the native listener is needed to suppress page zoom.
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      const { zoom: current, updateZoom: apply } = zoomRef.current
      const next = event.deltaY < 0
        ? Math.min(ZOOM_MAX, Math.max(current + 1, Math.round(current * 1.25)))
        : Math.max(ZOOM_MIN, Math.min(current - 1, Math.round(current * .8)))
      if (next === current) return
      const pointerUs = pixelToTime(element.scrollLeft + event.clientX - element.getBoundingClientRect().left, durationUs, element.clientWidth * current)
      apply(next, Math.max(0, Math.min(durationUs, pointerUs)))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [durationUs])

  const scrollPlayheadTo = (fraction: number, behavior: ScrollBehavior = 'auto') => {
    const element = viewportRef.current
    if (!element) return
    const playheadPx = timeToPixel(currentUs, durationUs, element.clientWidth * zoom)
    element.scrollTo({ left: Math.max(0, playheadPx - element.clientWidth * fraction), behavior })
  }

  // Keep a moving playhead in view during playback and transcript-driven seeks; page-flip rather than continuous scroll.
  useEffect(() => {
    const element = viewportRef.current
    if (!element || drag || scrubPointer !== null || zoom === 1) return
    const playheadPx = timeToPixel(currentUs, durationUs, element.clientWidth * zoom)
    if (playheadPx < element.scrollLeft || playheadPx > element.scrollLeft + element.clientWidth) scrollPlayheadTo(FOLLOW_MARGIN)
  }, [currentUs])

  /** Sequence-time snap targets shared by caption and clip drags. */
  const snapTargetsFor = (exceptClipIds: string[], exceptCueId: string | null, originPlayheadUs: number) => snapTargets(clips, exceptClipIds, [
    0, originPlayheadUs, durationUs,
    ...cues.filter((cue) => cue.id !== exceptCueId).flatMap((cue) => spansOf(cue).flatMap((span) => [span.startUs, span.endUs])),
  ])

  const contentWidth = () => contentRef.current?.getBoundingClientRect().width ?? 1

  const beginCueDrag = (event: ReactPointerEvent<HTMLElement>, cue: Cue, mode: CueDragMode, span: CaptionSpan) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const clip = span.clipId ? clips.find((candidate) => candidate.id === span.clipId) : undefined
    const offsetUs = clip ? clip.timelineStartUs - clip.sourceStartUs : 0
    const sourceBounds = clip ? { startUs: clip.sourceStartUs, endUs: clip.sourceEndUs } : { startUs: 0, endUs: Number.MAX_SAFE_INTEGER }
    setDrag({ kind: 'cue', cue, mode, offsetUs, sourceBounds, originClientX: event.clientX, pointerId: event.pointerId, contentWidthPx: contentWidth(), originPlayheadUs: currentUs })
    setDraggedCue(cue)
    const edgeUs = mode === 'end' ? cue.endUs : cue.startUs
    onSeek(edgeUs + offsetUs, cue.id)
    props.onDragPreview(cue, edgeUs + offsetUs)
  }

  const beginClipDrag = (event: ReactPointerEvent<HTMLElement>, clip: Clip, mode: ClipDragMode) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    props.onSelectClip(clip.id)
    if (trackById.get(clip.trackId)?.locked) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const clone = mode === 'move' && event.altKey
    const subject = clone ? { ...clip, id: crypto.randomUUID() } : clip
    setDrag({ kind: 'clip', clip: subject, mode, clone, originClientX: event.clientX, pointerId: event.pointerId, contentWidthPx: contentWidth(), originPlayheadUs: currentUs })
    setClipPreview(subject)
  }

  useEffect(() => {
    if (!drag) return
    const thresholdUs = pixelToTime(SNAP_THRESHOLD_PX, durationUs, drag.contentWidthPx)
    const sequenceDelta = (clientX: number) => pixelToTime(clientX - drag.originClientX, durationUs, drag.contentWidthPx)
    let finish: (event: PointerEvent, commit: boolean) => void
    let move: (event: PointerEvent) => void
    if (drag.kind === 'cue') {
      // The caption is read live, so one deleted or undone mid-gesture abandons the drag cleanly.
      const dragged = cues.find((cue) => cue.id === drag.cue.id)
      if (!dragged) { setDrag(null); setDraggedCue(null); callbacks.current.onDragPreview(null); return }
      const { cue: original, offsetUs, sourceBounds, mode } = drag
      const targets = snap ? snapTargetsFor([], original.id, drag.originPlayheadUs).map((us) => us - offsetUs) : []
      // Keep the grabbed edge inside the clip it was grabbed in (a pure translation within it).
      const clampDelta = (delta: number) => {
        if (mode === 'end') return Math.min(delta, sourceBounds.endUs - dragged.endUs)
        const low = sourceBounds.startUs - dragged.startUs
        const high = mode === 'move' ? Math.max(low, Math.min(sourceBounds.endUs - dragged.endUs, sourceBounds.endUs - 1 - dragged.startUs)) : Infinity
        return Math.max(low, Math.min(high, delta))
      }
      const mediaUs = props.assetDurationUs(dragged.mediaAssetId ?? '') ?? null
      const previewAt = (clientX: number) => {
        const delta = clampDelta(sequenceDelta(clientX))
        const free = dragCueBy(dragged, mode, delta, mediaUs)
        const extra = snapDelta(free, mode, targets, thresholdUs)
        const preview = extra ? dragCueBy(dragged, mode, clampDelta(delta + extra), mediaUs) : free
        const edgeUs = mode === 'end' ? preview.endUs : preview.startUs
        const guideUs = extra ? (mode === 'move' ? [preview.startUs, preview.endUs].find((edge) => targets.includes(edge)) ?? null : edgeUs) : null
        return { preview, edgeUs, guideUs }
      }
      move = (event) => {
        if (event.pointerId !== drag.pointerId) return
        const { preview, edgeUs, guideUs } = previewAt(event.clientX)
        setDraggedCue(preview)
        setSnapGuideUs(guideUs === null ? null : guideUs + offsetUs)
        callbacks.current.onDragPreview(preview, edgeUs + offsetUs)
      }
      finish = (event, commit) => {
        if (event.pointerId !== drag.pointerId) return
        const { preview } = previewAt(event.clientX)
        setDrag(null); setDraggedCue(null); setSnapGuideUs(null)
        callbacks.current.onDragPreview(null)
        if (commit) callbacks.current.onDragCommit(dragged, preview, mode)
      }
    } else {
      const live = drag.clone ? drag.clip : clips.find((clip) => clip.id === drag.clip.id)
      if (!live) { setDrag(null); setClipPreview(null); return }
      const targets = snap ? snapTargetsFor(drag.clone ? [] : [live.id], null, drag.originPlayheadUs) : []
      const trackUnder = (clientY: number) => {
        const body = bodyRef.current
        if (!body) return null
        return trackAtY(rows, clientY - body.getBoundingClientRect().top + body.scrollTop)
      }
      const previewAt = (event: PointerEvent) => previewClipDrag({
        clip: live, mode: drag.mode, deltaUs: sequenceDelta(event.clientX), targetTrack: drag.mode === 'move' ? trackUnder(event.clientY) : null,
        tracks, clips: drag.clone ? [...clips, live] : clips, assetDurationUs: props.assetDurationUs(live.assetId), editMode: props.editMode,
        snap: targets.length ? { targetsUs: targets, thresholdUs } : null,
      })
      move = (event) => {
        if (event.pointerId !== drag.pointerId) return
        const preview = previewAt(event)
        setClipPreview(preview.clip)
        setSnapGuideUs(preview.guideUs)
      }
      finish = (event, commit) => {
        if (event.pointerId !== drag.pointerId) return
        const preview = previewAt(event)
        setDrag(null); setClipPreview(null); setSnapGuideUs(null)
        if (!commit) return
        if (drag.clone) { if (preview.clip.timelineStartUs !== live.timelineStartUs || preview.clip.trackId !== live.trackId) callbacks.current.onClipClone(preview.clip); return }
        if (drag.mode === 'move') {
          if (preview.clip.timelineStartUs !== live.timelineStartUs || preview.clip.trackId !== live.trackId) callbacks.current.onClipMove(live.id, preview.clip.trackId, preview.clip.timelineStartUs)
        } else if (preview.appliedDeltaUs) callbacks.current.onClipTrim(live.id, drag.mode, preview.appliedDeltaUs)
      }
    }
    const up = (event: PointerEvent) => finish(event, true)
    const cancel = (event: PointerEvent) => finish(event, false)
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDrag(null); setDraggedCue(null); setClipPreview(null); setSnapGuideUs(null)
      if (drag.kind === 'cue') callbacks.current.onDragPreview(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', escape)
    }
  }, [drag, durationUs, cues, clips, tracks, rows, snap, props.editMode])

  const seekAtClientX = (clientX: number) => {
    const content = contentRef.current
    if (!content) return
    const rect = content.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(durationUs, pixelToTime(clientX - rect.left, durationUs, rect.width))))
  }
  const seekTrack = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    seekAtClientX(event.clientX)
  }
  const beginScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setScrubPointer(event.pointerId)
    seekAtClientX(event.clientX)
  }
  const scrub = (event: ReactPointerEvent<HTMLDivElement>) => { if (scrubPointer === event.pointerId) seekAtClientX(event.clientX) }
  const endScrub = (event: ReactPointerEvent<HTMLDivElement>) => { if (scrubPointer === event.pointerId) setScrubPointer(null) }

  const videoStackPx = videoStackHeightPx(rows)
  const beginDividerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDividerDrag({ pointerId: event.pointerId, originClientY: event.clientY, originSplit: mediaHeightPx ? videoStackPx / mediaHeightPx : .5, mediaHeightPx })
  }
  const moveDivider = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dividerDrag || dividerDrag.pointerId !== event.pointerId) return
    setMediaSplit(Math.max(0, Math.min(1, dividerDrag.originSplit + (event.clientY - dividerDrag.originClientY) / Math.max(1, dividerDrag.mediaHeightPx))))
  }
  const endDividerDrag = (event: ReactPointerEvent<HTMLDivElement>) => { if (dividerDrag?.pointerId === event.pointerId) setDividerDrag(null) }
  const nudgeDivider = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    setMediaSplit((split) => Math.max(0, Math.min(1, split + (event.key === 'ArrowUp' ? -8 : 8) / Math.max(1, mediaHeightPx))))
  }

  const selectCueFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>, cue: Cue, span: CaptionSpan) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    onSeek(span.startUs + Math.max(0, cue.startUs - span.sourceStartUs), cue.id)
  }
  const selectClipFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>, clip: Clip) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    props.onSelectClip(clip.id)
    onSeek(clip.timelineStartUs)
  }

  /** The track under a drag, from the pointer's height within the timeline body. */
  const dropTarget = (event: ReactDragEvent<HTMLDivElement>) => {
    const rect = contentRef.current?.getBoundingClientRect()
    const body = bodyRef.current
    const timeUs = rect ? dropTimeAt(event.clientX, rect, durationUs) : currentUs
    const track = body ? trackAtY(rows, event.clientY - body.getBoundingClientRect().top + body.scrollTop) : null
    return { timeUs, trackId: track?.id ?? null }
  }
  /** `dragover` never has `dataTransfer.files` populated even for a real file drag (Chromium
   * withholds it until drop), so `dropContent` reads the live in-window payload for a bin asset and
   * the `Files` type alone for an OS drag — see `core/dragPayload.ts`. */
  const onContentDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    const content = dropContent(event.dataTransfer)
    if (!content) { setDropIndicator(null); return }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const { timeUs } = dropTarget(event)
    const widthUs = content.kind === 'asset' ? (content.payload.kind === 'image' ? DEFAULT_IMAGE_CLIP_US : content.payload.durationUs ?? 0) : 0
    setDropIndicator({ leftUs: timeUs, widthUs })
  }
  const onContentDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const content = dropContent(event.dataTransfer)
    setDropIndicator(null)
    if (!content) return
    event.preventDefault()
    const { timeUs, trackId } = dropTarget(event)
    if (content.kind === 'asset') props.onDropAsset?.(content.payload, timeUs, trackId)
    else if (content.files.length) props.onDropFiles?.(content.files, timeUs, trackId)
  }

  const pct = (us: number) => timeToPixel(us, durationUs, 100)
  const contentWidthPx = viewport.widthPx * zoom
  const visibleFrom = pixelToTime(viewport.scrollLeft, durationUs, contentWidthPx)
  const visibleTo = pixelToTime(viewport.scrollLeft + viewport.widthPx, durationUs, contentWidthPx)
  const clipLabel = (clip: Clip) => assetById.get(clip.assetId)?.name ?? 'Missing file'

  return <section className={`timeline-panel ${expanded ? 'expanded' : ''}`} aria-label="Timeline">
    <TimelineToolbar
      mode={display} onMode={props.onDisplay}
      snap={snap} onSnap={setSnap}
      zoom={zoom} zoomMin={ZOOM_MIN} zoomMax={ZOOM_MAX} onZoom={(next) => updateZoom(next)}
      expanded={expanded} onExpand={setExpanded}
      onCenterPlayhead={() => scrollPlayheadTo(.5, 'smooth')}
      actions={actions} hasSelection={selectedCueId !== null && cues.some((cue) => cue.id === selectedCueId)} canMerge={props.canMerge} canSplit={props.canSplit} canAdd={props.canAdd} hasCues={cues.length > 0} hasSelectedWord={props.hasSelectedWord}
      editMode={props.editMode} onEditMode={props.onEditMode} clipTools={props.clipTools}
    />
    {/* --ruler-h is inherited by .gridlines and .snap-guide, which hang from below the ruler row. */}
    <div className="timeline-body" ref={bodyRef} style={{ '--ruler-h': `${RULER_HEIGHT_PX}px` } as CSSProperties}>
      <TimelineTrackHeaders rows={rows} style={gridStyle} currentUs={currentUs} durationUs={durationUs} clipCounts={clipCounts} actions={props.trackActions}
        dividerActive={dividerDrag !== null} dividerValue={mediaHeightPx ? Math.round(videoStackPx / mediaHeightPx * 100) : 50}
        onDividerPointerDown={beginDividerDrag} onDividerPointerMove={moveDivider} onDividerPointerUp={endDividerDrag} onDividerKeyDown={nudgeDivider} />
      <div className="timeline-viewport" ref={viewportRef} onScroll={(event) => { const left = event.currentTarget.scrollLeft; setViewport((state) => state.scrollLeft === left ? state : { ...state, scrollLeft: left }) }}>
        <div className="timeline-content" ref={contentRef} style={{ ...gridStyle, width: `${zoom * 100}%` }}
          onDragOver={onContentDragOver} onDragLeave={() => setDropIndicator(null)} onDrop={onContentDrop}>
          {rows.map((row, rowIndex) => {
            if (row.kind === 'ruler') return <TimelineRuler key="ruler" ticks={ticks} durationUs={durationUs} onPointerDown={beginScrub} onPointerMove={scrub} onPointerUp={endScrub}
              markers={markers} selectedMarkerId={selection?.kind === 'marker' ? selection.id : null}
              onSelectMarker={(markerId, atUs) => { onSeek(atUs); props.onSelectMarker?.(markerId) }} />
            if (row.kind === 'captions') return <CaptionsTrack key="captions" cues={displayCues} spansOf={spansOf} durationUs={durationUs} mode={display}
              selectedCueId={selectedCueId} warningCueIds={warningCueIds} draggingId={drag?.kind === 'cue' ? drag.cue.id : null} selectedWordId={props.selectedWordId}
              onBeginDrag={beginCueDrag} onKeyboardSelect={selectCueFromKeyboard}
              onSeekSource={(cue, sourceUs, span) => onSeek(span.startUs + Math.max(0, sourceUs - span.sourceStartUs), cue.id)}
              onSelectWord={props.onSelectWord} onSeekTrack={seekTrack} />
            if (row.kind === 'divider') return <div key="divider" className="track-divider-line" aria-hidden="true" />
            const { track } = row
            const onTrack = displayClips.filter((clip) => clip.trackId === track.id)
            return <div key={track.id} className={`track ${track.kind} ${track.hidden ? 'is-hidden' : ''} ${track.muted ? 'is-muted' : ''}`}
              onPointerDown={seekTrack} role="group" aria-label={`${row.label} track`}>
              <span className="track-overlay-label" aria-hidden="true">{row.label}</span>
              {!track.locked && gapsOnTrack(clips, track.id).map((gap) => <span key={gap.startUs} className="gap-zone"
                style={{ left: `${pct(gap.startUs)}%`, width: `${pct(gap.endUs - gap.startUs)}%` }}>
                <button type="button" className="close-gap" title={`Close this ${formatClock(gap.endUs - gap.startUs)} gap`}
                  onPointerDown={(event) => event.stopPropagation()} onClick={() => props.onCloseGap(track.id, gap.startUs)}>Close gap</button>
              </span>)}
              {onTrack.map((clip) => {
                const asset = assetById.get(clip.assetId) ?? null
                const widthPx = timeToPixel(clipLengthUs(clip), durationUs, contentWidthPx)
                const visible = clip.timelineStartUs < visibleTo && clipEndUs(clip) > visibleFrom
                const dragging = (drag?.kind === 'clip' && drag.clip.id === clip.id) || false
                const label = clipLabel(clip)
                return <ClipBlock key={clip.id} clip={clip} label={label} leftPct={pct(clip.timelineStartUs)} widthPct={pct(clipLengthUs(clip))}
                  title={`${clip.kind === 'image' ? 'Image' : clip.kind === 'audio' ? 'Audio' : 'Video'} ${label}, ${formatClock(clip.timelineStartUs)} to ${formatClock(clipEndUs(clip))}${track.locked ? ' (track locked)' : ''}`}
                  selected={clip.id === selectedClipId} dragging={dragging} locked={track.locked}
                  onBeginDrag={(event, mode) => beginClipDrag(event, clip, mode)} onKeyDown={(event) => selectClipFromKeyboard(event, clip)}>
                  {clip.kind === 'video' && <VideoClipContent clip={clip} asset={asset} widthPx={widthPx} heightPx={row.heightPx} visible={visible}
                    queue={props.thumbnailQueue ?? null} waveform={waveforms.get(clip.assetId) ?? null} />}
                  {clip.kind === 'audio' && <AudioClipContent clip={clip} waveform={waveforms.get(clip.assetId) ?? null} />}
                  {clip.kind === 'image' && asset && <span className="clip-image-hint" />}
                </ClipBlock>
              })}
              {!onTrack.length && track.kind === 'video' && !clips.some((clip) => clip.kind === 'video') && <span className="track-status">No video on the timeline</span>}
              {track.kind === 'audio' && rowIndex === rows.findIndex((candidate) => candidate.kind === 'track' && candidate.track.kind === 'audio') && props.waveformStatus
                && <span className="track-status" role="status">{props.waveformStatus}{props.onCancelWaveform && <button type="button" className="cancel-waveform" onClick={props.onCancelWaveform} aria-label="Cancel waveform extraction">×</button>}</span>}
            </div>
          })}
          <div className="gridlines" aria-hidden="true">
            {ticks.map((timeUs) => <i key={timeUs} style={{ left: `${pct(timeUs)}%` }} />)}
          </div>
          {snapGuideUs !== null && <i className="snap-guide" style={{ left: `${pct(snapGuideUs)}%` }} aria-hidden="true" />}
          {dropIndicator && <i className="drop-indicator" style={{ left: `${pct(dropIndicator.leftUs)}%`, width: dropIndicator.widthUs ? `${pct(dropIndicator.widthUs)}%` : undefined }} aria-hidden="true" />}
          <i className="playhead" style={{ left: `${pct(Math.min(currentUs, durationUs))}%`, top: 0 }} aria-hidden="true" />
        </div>
      </div>
    </div>
  </section>
}
