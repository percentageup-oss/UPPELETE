import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { CaptionWord, Cue } from './core/model'
import type { AudioClip, ImageOverlay, ProjectAsset } from './core/edit'
import type { MediaFingerprint } from './core/media'
import { anchoredScrollLeft, dragCueBy, dragRangeBy, itemDragBounds, pixelToTime, rulerStep, snapDelta, timeToPixel, type CueDragMode } from './core/timeline'
import { overlayLanes } from './core/overlayRect'
import { clipDurationUs, clipRange } from './core/sfxClip'
import { effectiveSegments, sequenceToSource, sourceToSequence, spansInSequence, type TimeRange } from './core/sequence'
import { cueItem, trackRows, type Selection, type TimelineItem, type TimelineTrack } from './core/timelineItems'
import { formatClock, formatTimestamp } from './core/time'
import type { WaveformData } from './core/waveform'
import { slicePeaks } from './core/waveformSlice'
import { thumbnailCountForViewport, thumbnailTimestamps, type ThumbnailImage } from './core/thumbnails'
import { TIMING_LABELS } from './TimingProvenance'
import { TimelineToolbar, type TimelineActions } from './TimelineToolbar'
import type { CaptionDisplay } from './captions/wordDisplay'
import { AudioIcon, CaptionsIcon, GripIcon, VideoIcon } from './TimelineIcons'
import { dropContent, type AssetDragPayload } from './core/dragPayload'
import { dropTimeAt } from './core/timelineDrop'

/** A dropped image gets this fixed placeholder width on the timeline, matching `dropPlanForAsset`'s
 * own default overlay duration — the indicator previews exactly the range the drop will create. */
const IMAGE_DROP_INDICATOR_US = 3_000_000

type DragState = {
  /** Generic, so V2-V6 drag overlays, blur regions, sound effects and segments through this path. */
  item: TimelineItem
  mode: CueDragMode
  originClientX: number
  pointerId: number
  contentWidthPx: number
  // Playhead position before the drag began; the edge being dragged seeks the playhead, so the live value is not a usable target.
  originPlayheadSourceUs: number
}

type DividerDrag = { pointerId: number; originClientY: number; originSplit: number; mediaHeightPx: number }

type TimelineProps = {
  cues: Cue[]
  /** Sequence time: where the playhead sits on the post-cut output timeline. */
  currentUs: number
  /** Sequence time: the length of the output timeline, which cuts shorten. */
  durationUs: number
  /** Source time: the real length of the media, used for clamping drags and media-keyed requests. */
  mediaDurationUs: number | null
  /** Kept source ranges; absent is the identity edit, where sequence time equals source time. */
  segments?: readonly TimeRange[]
  fingerprint: MediaFingerprint | null
  selection: Selection | null
  warningCueIds: Set<string>
  mediaName: string
  waveform: WaveformData | null
  waveformStatus: string | null
  onCancelWaveform?: () => void
  /** Receives **sequence** microseconds; App maps them back to source time. */
  onSeek: (sequenceUs: number, cueId?: string) => void
  onDragPreview: (cue: Cue | null, seekUs?: number) => void
  onDragCommit: (original: Cue, preview: Cue, mode: CueDragMode) => void
  /** Absent/empty means no Overlays track is drawn at all — an unedited project's layout is unchanged. */
  overlays?: readonly ImageOverlay[]
  /** Names overlay blocks by their asset ("beach.png" instead of the generic "Image overlay") once there's more than one. */
  assets?: readonly ProjectAsset[]
  onOverlayDragPreview?: (overlay: ImageOverlay | null, seekUs?: number) => void
  /** `options.clone` is set when the gesture began with Alt held (`beginOverlayDrag`): `preview` is
   * a brand-new overlay (its own id) to add, and `original` is unchanged and should stay in place. */
  onOverlayDragCommit?: (original: ImageOverlay, preview: ImageOverlay, mode: CueDragMode, options?: { clone?: boolean }) => void
  onSelectOverlay?: (overlayId: string) => void
  /** Absent/empty means no SFX track is drawn at all — an unedited project's layout is unchanged. */
  audioClips?: readonly AudioClip[]
  /** Per-asset peak data for the SFX track's waveforms, keyed by asset id. */
  assetWaveforms?: Map<string, WaveformData>
  onSfxDragPreview?: (clip: AudioClip | null, seekUs?: number) => void
  onSfxDragCommit?: (original: AudioClip, preview: AudioClip, mode: CueDragMode) => void
  onSelectSfx?: (clipId: string) => void
  display: CaptionDisplay
  onDisplay: (display: CaptionDisplay) => void
  selectedWordId: string | null
  onSelectWord: (cue: Cue, word: CaptionWord) => void
  actions: TimelineActions
  canSplit: boolean
  canMerge: boolean
  canAdd: boolean
  hasSelectedWord: boolean
  /** A bin asset dragged onto the timeline; absent means dropping one has no effect. */
  onDropAsset?: (payload: AssetDragPayload, sequenceUs: number) => void
  /** Files dragged in from Finder/Explorer; absent means dropping them has no effect. */
  onDropFiles?: (files: File[], sequenceUs: number) => void
}

type ThumbnailState =
  | { kind: 'idle' }
  | { kind: 'loading'; requestId: string; percent: number | null }
  | { kind: 'ready'; images: ThumbnailImage[] }
  | { kind: 'error'; message: string }

const ZOOM_MIN = 1
const ZOOM_MAX = 32
const THUMBNAIL_PIXEL_WIDTH = 160
const THUMBNAIL_DEBOUNCE_MS = 300
const SNAP_THRESHOLD_PX = 8
const RULER_HEIGHT_PX = 26
const CAPTIONS_HEIGHT_PX = 44
/** One overlay lane's height: 4px padding + a 24px block + 4px padding, matching V2's fixed
 * single-lane track exactly when nothing overlaps (`overlayLanes`, `core/overlayRect.ts`). */
const OVERLAY_LANE_PX = 24
const DIVIDER_HEIGHT_PX = 8
const MIN_MEDIA_TRACK_PX = 28
const FOLLOW_MARGIN = 0.1

function formatRulerTime(timeUs: number): string {
  const timestamp = formatTimestamp(timeUs, '.')
  return timestamp.startsWith('00:') ? timestamp.slice(3) : timestamp
}

function waveformPath(peaks: readonly number[]): string {
  return peaks.map((peak, index) => {
    const amplitude = Math.max(0, Math.min(1, peak)) * .92
    return `M${index} ${1 - amplitude}V${1 + amplitude}`
  }).join('')
}

/**
 * Peaks are extracted and cached against source time; only their placement is sequence time. One
 * `<svg>` per kept segment, each sliced from the single extracted waveform, so a cut removes the
 * silent stretch from the drawing instead of squeezing the whole waveform into a shorter span (an
 * identity edit — no cuts — is one segment covering the whole waveform, unchanged from before).
 */
function Waveform({ waveform, durationUs, mediaDurationUs, segments, toSequence }: {
  waveform: WaveformData; durationUs: number; mediaDurationUs: number | null
  segments: readonly TimeRange[] | undefined; toSequence: (sourceUs: number) => number
}) {
  const kept = useMemo(() => effectiveSegments(segments, mediaDurationUs), [segments, mediaDurationUs])
  return <>{kept.map((segment) => {
    const peaks = slicePeaks(waveform, segment)
    if (!peaks.length) return null
    const left = timeToPixel(toSequence(segment.startUs), durationUs, 100)
    const width = timeToPixel(toSequence(segment.endUs) - toSequence(segment.startUs), durationUs, 100)
    return <svg key={segment.startUs} className="waveform" style={{ left: `${left}%`, width: `${width}%` }} viewBox={`0 0 ${peaks.length} 2`} preserveAspectRatio="none" aria-label="Audio waveform">
      <path d={waveformPath(peaks)} />
    </svg>
  })}</>
}

/** A thin marker at each cut instant, on the video track, with the removed duration as its tooltip. */
function CutMarkers({ mediaDurationUs, segments, durationUs, toSequence }: {
  mediaDurationUs: number | null; segments: readonly TimeRange[] | undefined; durationUs: number
  toSequence: (sourceUs: number) => number
}) {
  const kept = useMemo(() => effectiveSegments(segments, mediaDurationUs), [segments, mediaDurationUs])
  if (kept.length < 2) return null
  return <>{kept.slice(0, -1).map((segment, index) => <i key={segment.endUs} className="cut-marker" aria-hidden="true"
    style={{ left: `${timeToPixel(toSequence(segment.endUs), durationUs, 100)}%` }}
    title={`Removed ${formatClock(kept[index + 1].startUs - segment.endUs)}`} />)}</>
}

/** Frames tile edge to edge by bucket index; each requested timestamp is the midpoint of its bucket (see thumbnailTimestamps). */
function ThumbnailStrip({ images }: { images: ThumbnailImage[] }) {
  const ordered = useMemo(() => [...images].sort((a, b) => a.requestedUs - b.requestedUs), [images])
  return <div className="thumbnail-strip" aria-hidden="true">
    {ordered.map((image, index) => <img key={image.requestedUs} src={image.dataUrl} alt="" loading="lazy"
      style={{ left: `${index * 100 / ordered.length}%`, width: `${100 / ordered.length}%` }} />)}
  </div>
}

function WordBlocks({ cue, selectedWordId, onSeek, onSelectWord }: {
  cue: Cue; selectedWordId: string | null
  onSeek: (timeUs: number, cueId: string) => void
  onSelectWord: (cue: Cue, word: CaptionWord) => void
}) {
  const cueDurationUs = cue.endUs - cue.startUs
  const activate = (event: ReactPointerEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>, word: CaptionWord) => {
    if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return
    if ('button' in event && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onSeek(word.startUs, cue.id)
    onSelectWord(cue, word)
  }
  if (!cue.words.length) {
    return <span role="button" tabIndex={0} lang="ml" className="word-block untimed" style={{ left: 0, width: '100%' }}
      title="No word timing. Use “Estimate all words & group” in the inspector to create reviewable estimates."
      aria-label={`Caption ${cue.text || 'empty'} without word timing, ${formatClock(cue.startUs)}`}
      onPointerDown={() => onSeek(cue.startUs, cue.id)} onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault(); event.stopPropagation(); onSeek(cue.startUs, cue.id)
      }}>{cue.text || '(empty)'}</span>
  }
  return <>{cue.words.map((word: CaptionWord) => {
    const estimated = word.timingSource === 'estimated' || word.needsReview
    const selected = word.id === selectedWordId
    return <span key={word.id} role="button" tabIndex={0} lang="ml" aria-pressed={selected}
      className={`word-block ${estimated ? 'estimated' : ''} ${selected ? 'selected' : ''}`}
      title={`${TIMING_LABELS[word.timingSource]}${estimated ? ' — needs review' : ''}`}
      aria-label={`Word ${word.text}, ${formatClock(word.startUs)}, ${TIMING_LABELS[word.timingSource]}`}
      style={{ left: `${timeToPixel(word.startUs - cue.startUs, cueDurationUs, 100)}%`, width: `${Math.max(.5, timeToPixel(word.endUs - word.startUs, cueDurationUs, 100))}%` }}
      onPointerDown={(event) => activate(event, word)} onKeyDown={(event) => activate(event, word)}>{word.text}</span>
  })}</>
}

export function Timeline({ cues, currentUs, durationUs, mediaDurationUs, segments, fingerprint, selection, warningCueIds, mediaName, waveform, waveformStatus, onCancelWaveform, onSeek, onDragPreview, onDragCommit, overlays = [], assets = [], onOverlayDragPreview, onOverlayDragCommit, onSelectOverlay, display, onDisplay, selectedWordId, onSelectWord, actions, canSplit, canMerge, canAdd, hasSelectedWord, onDropAsset, onDropFiles }: TimelineProps) {
  const [zoom, setZoom] = useState(1)
  const trackMode = display
  const [snap, setSnap] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [mediaSplit, setMediaSplit] = useState(.5)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [draggedCue, setDraggedCue] = useState<Cue | null>(null)
  const [draggedOverlay, setDraggedOverlay] = useState<ImageOverlay | null>(null)
  // Set for the duration of an Alt+drag clone gesture (beginOverlayDrag): the synthetic overlay
  // (new id, not yet in `overlays`) the drag effect should treat as the dragged item, since
  // `overlays.find` can never find it. Cleared when the gesture ends, committed or not.
  const cloneBaseRef = useRef<ImageOverlay | null>(null)
  const selectedCueId = selection?.kind === 'cue' ? selection.id : null
  const selectedOverlayId = selection?.kind === 'overlay' ? selection.id : null
  const [snapGuideUs, setSnapGuideUs] = useState<number | null>(null)
  const [dividerDrag, setDividerDrag] = useState<DividerDrag | null>(null)
  const [scrubPointer, setScrubPointer] = useState<number | null>(null)
  const [viewportWidthPx, setViewportWidthPx] = useState(0)
  const [bodyHeightPx, setBodyHeightPx] = useState(0)
  const [thumbnailState, setThumbnailState] = useState<ThumbnailState>({ kind: 'idle' })
  const [dropIndicator, setDropIndicator] = useState<{ leftUs: number; widthUs: number } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previewCallbackRef = useRef(onDragPreview)
  const commitCallbackRef = useRef(onDragCommit)
  const overlayPreviewCallbackRef = useRef(onOverlayDragPreview)
  const overlayCommitCallbackRef = useRef(onOverlayDragCommit)
  previewCallbackRef.current = onDragPreview
  commitCallbackRef.current = onDragCommit
  overlayPreviewCallbackRef.current = onOverlayDragPreview
  overlayCommitCallbackRef.current = onOverlayDragCommit

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    // clientHeight excludes a horizontal scrollbar, so tracks never get clipped behind it when zoomed in.
    const measure = () => {
      setViewportWidthPx(viewport.clientWidth)
      setBodyHeightPx(viewport.clientHeight)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  // Overlapping overlays stack into separate lanes (greedy interval packing, last-drawn on top —
  // `overlayLanes`), so the track grows only when overlays actually overlap in time; with none
  // overlapping, one `OVERLAY_LANE_PX` lane matches V2's fixed-height single-lane track exactly.
  const displayOverlays = useMemo(() => {
    if (!draggedOverlay) return overlays
    return overlays.some((overlay) => overlay.id === draggedOverlay.id)
      ? overlays.map((overlay) => overlay.id === draggedOverlay.id ? draggedOverlay : overlay)
      : [...overlays, draggedOverlay]
  }, [overlays, draggedOverlay])
  const overlayLaneInfo = useMemo(() => overlayLanes(displayOverlays), [displayOverlays])
  const overlaysHeightPx = overlays.length ? overlayLaneInfo.laneCount * OVERLAY_LANE_PX + 8 : 0
  const mediaHeightPx = Math.max(2 * MIN_MEDIA_TRACK_PX, bodyHeightPx - RULER_HEIGHT_PX - CAPTIONS_HEIGHT_PX - overlaysHeightPx - DIVIDER_HEIGHT_PX)
  const videoHeightPx = Math.round(Math.min(mediaHeightPx - MIN_MEDIA_TRACK_PX, Math.max(MIN_MEDIA_TRACK_PX, mediaHeightPx * mediaSplit)))
  const audioHeightPx = mediaHeightPx - videoHeightPx
  // Quantised so small divider drags do not re-request thumbnails; tiles aim for the frame's 16:9 footprint at the current track height.
  const thumbnailTileWidthPx = Math.max(80, Math.round(videoHeightPx * 16 / 9 / 40) * 40)

  const thumbnailTimestampsUs = useMemo(() => {
    if (!fingerprint || !mediaDurationUs || viewportWidthPx <= 0) return []
    const count = thumbnailCountForViewport(zoom, viewportWidthPx, thumbnailTileWidthPx)
    return count ? thumbnailTimestamps(mediaDurationUs, count) : []
  }, [fingerprint, mediaDurationUs, viewportWidthPx, zoom, thumbnailTileWidthPx])

  useEffect(() => window.captionStudio?.onThumbnailsProgress((message) => {
    setThumbnailState((state) => {
      if (state.kind !== 'loading' || state.requestId !== message.requestId) return state
      if (message.progress.kind !== 'measured' || message.progress.phase !== 'thumbnails') return state
      return { ...state, percent: Math.round(message.progress.completed / message.progress.total * 100) }
    })
  }), [])

  useEffect(() => {
    const api = window.captionStudio
    if (!api || !fingerprint || !thumbnailTimestampsUs.length) return
    const requestId = crypto.randomUUID()
    let cancelled = false
    const timer = setTimeout(() => {
      setThumbnailState({ kind: 'loading', requestId, percent: null })
      void api.loadThumbnails({ requestId, fingerprint, timestampsUs: thumbnailTimestampsUs, width: THUMBNAIL_PIXEL_WIDTH })
        .then((result) => { if (!cancelled) setThumbnailState({ kind: 'ready', images: result.thumbnails }) })
        .catch((error) => { if (!cancelled) setThumbnailState({ kind: 'error', message: error instanceof Error ? error.message : 'Thumbnails unavailable' }) })
    }, THUMBNAIL_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      void api.cancelThumbnails(requestId).catch(() => {})
    }
  }, [fingerprint, thumbnailTimestampsUs])

  // Geometry is sequence time; every item's own start/end stays source time. With no segments both
  // conversions are the identity function, so an uncut project draws exactly as it did before V1.
  const toSequence = (sourceUs: number) => sourceToSequence(sourceUs, segments, mediaDurationUs).sequenceUs
  const toSource = (sequenceUs: number) => segments?.length ? sequenceToSource(sequenceUs, segments, mediaDurationUs) : sequenceUs
  /** A pixel drag is a sequence-time delta; items move in source time, so map through the edge. */
  const sourceDeltaFor = (edgeSourceUs: number, sequenceDeltaUs: number) =>
    segments?.length ? toSource(toSequence(edgeSourceUs) + sequenceDeltaUs) - edgeSourceUs : sequenceDeltaUs
  /** One block per kept piece: a cue straddling a cut draws as several blocks but stays one cue. */
  const cueSpans = (cue: Cue) => spansInSequence(cue, segments, mediaDurationUs)
  const overlaySpans = (overlay: ImageOverlay) => spansInSequence(overlay, segments, mediaDurationUs)

  const displayCues = draggedCue ? cues.map((cue) => cue.id === draggedCue.id ? draggedCue : cue) : cues
  const stepUs = rulerStep(durationUs, zoom)
  const ticks = useMemo(() => {
    const values: number[] = []
    for (let timeUs = 0; timeUs <= durationUs; timeUs += stepUs) values.push(timeUs)
    return values
  }, [durationUs, stepUs])

  const updateZoom = (nextZoom: number, anchorUs = currentUs) => {
    const viewport = viewportRef.current
    if (!viewport) return setZoom(nextZoom)
    const oldContentWidth = viewport.clientWidth * zoom
    const newContentWidth = viewport.clientWidth * nextZoom
    const nextScroll = anchoredScrollLeft(anchorUs, durationUs, oldContentWidth, viewport.scrollLeft, viewport.clientWidth, newContentWidth)
    setZoom(nextZoom)
    requestAnimationFrame(() => { viewport.scrollLeft = nextScroll })
  }
  const zoomRef = useRef({ zoom, updateZoom })
  zoomRef.current = { zoom, updateZoom }

  // ⌘/Ctrl + wheel zooms around the pointer; React's onWheel is passive, so the native listener is needed to suppress page zoom.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      const { zoom: current, updateZoom: apply } = zoomRef.current
      const next = event.deltaY < 0
        ? Math.min(ZOOM_MAX, Math.max(current + 1, Math.round(current * 1.25)))
        : Math.max(ZOOM_MIN, Math.min(current - 1, Math.round(current * .8)))
      if (next === current) return
      const contentWidth = viewport.clientWidth * current
      const pointerUs = pixelToTime(viewport.scrollLeft + event.clientX - viewport.getBoundingClientRect().left, durationUs, contentWidth)
      apply(next, Math.max(0, Math.min(durationUs, pointerUs)))
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [durationUs])

  const scrollPlayheadTo = (fraction: number, behavior: ScrollBehavior = 'auto') => {
    const viewport = viewportRef.current
    if (!viewport) return
    const playheadPx = timeToPixel(currentUs, durationUs, viewport.clientWidth * zoom)
    viewport.scrollTo({ left: Math.max(0, playheadPx - viewport.clientWidth * fraction), behavior })
  }

  // Keep a moving playhead in view during playback and transcript-driven seeks; page-flip rather than continuous scroll.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || drag || scrubPointer !== null || zoom === 1) return
    const playheadPx = timeToPixel(currentUs, durationUs, viewport.clientWidth * zoom)
    if (playheadPx < viewport.scrollLeft || playheadPx > viewport.scrollLeft + viewport.clientWidth) scrollPlayheadTo(FOLLOW_MARGIN)
  }, [currentUs])

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, cue: Cue, mode: CueDragMode) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const contentWidthPx = contentRef.current?.getBoundingClientRect().width ?? 1
    setDrag({ item: cueItem(cue), mode, originClientX: event.clientX, pointerId: event.pointerId, contentWidthPx, originPlayheadSourceUs: toSource(currentUs) })
    setDraggedCue(cue)
    const edgeSourceUs = mode === 'end' ? cue.endUs : cue.startUs
    onSeek(toSequence(edgeSourceUs), cue.id)
    onDragPreview(cue, edgeSourceUs)
  }

  /** Overlays (V2) drag through the generic `dragRangeBy`/`itemDragBounds` path — the cue branch
   * below keeps its own `dragCueBy` wrapper (word shifting, manual timing) byte-for-byte.
   * Alt+drag on a move (never a handle) clones instead of moving: the drag subject becomes a
   * synthetic overlay with a new id, tracked by `cloneBaseRef` since it isn't in `overlays` yet;
   * the original stays selected and in place, and the clone commits as a new overlay on release. */
  const beginOverlayDrag = (event: ReactPointerEvent<HTMLElement>, overlay: ImageOverlay, mode: CueDragMode) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const contentWidthPx = contentRef.current?.getBoundingClientRect().width ?? 1
    const isClone = mode === 'move' && event.altKey
    const subject = isClone ? { ...overlay, id: crypto.randomUUID() } : overlay
    cloneBaseRef.current = isClone ? subject : null
    setDrag({ item: { kind: 'overlay', id: subject.id, startUs: subject.startUs, endUs: subject.endUs, label: '' }, mode, originClientX: event.clientX, pointerId: event.pointerId, contentWidthPx, originPlayheadSourceUs: toSource(currentUs) })
    setDraggedOverlay(subject)
    // Selects the original either way (matches OverlayStageEditor): a clone-in-progress has no
    // project entry yet, so keeping selection on the source overlay is the only meaningful choice.
    onSelectOverlay?.(overlay.id)
    const edgeSourceUs = mode === 'end' ? overlay.endUs : overlay.startUs
    onSeek(toSequence(edgeSourceUs))
    onOverlayDragPreview?.(subject, edgeSourceUs)
  }

  const selectOverlayFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>, overlay: ImageOverlay) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    onSelectOverlay?.(overlay.id)
    onSeek(toSequence(overlay.startUs))
  }

  useEffect(() => {
    if (!drag) return
    if (drag.item.kind === 'overlay') {
      const isClone = cloneBaseRef.current?.id === drag.item.id
      const dragged = isClone ? cloneBaseRef.current! : overlays.find((overlay) => overlay.id === drag.item.id)
      if (!dragged) {
        setDrag(null)
        setDraggedOverlay(null)
        setSnapGuideUs(null)
        overlayPreviewCallbackRef.current?.(null)
        cloneBaseRef.current = null
        return
      }
      const targetsUs = snap ? [0, drag.originPlayheadSourceUs, ...(mediaDurationUs ? [mediaDurationUs] : []),
        ...cues.flatMap((cue) => [cue.startUs, cue.endUs]),
        ...overlays.filter((overlay) => overlay.id !== drag.item.id).flatMap((overlay) => [overlay.startUs, overlay.endUs])] : []
      const thresholdUs = pixelToTime(SNAP_THRESHOLD_PX, durationUs, drag.contentWidthPx)
      const bounds = itemDragBounds(dragged, mediaDurationUs)
      const previewAt = (clientX: number) => {
        const sequenceDeltaUs = pixelToTime(clientX - drag.originClientX, durationUs, drag.contentWidthPx)
        const edgeSourceUs = drag.mode === 'end' ? drag.item.endUs : drag.item.startUs
        const deltaUs = sourceDeltaFor(edgeSourceUs, sequenceDeltaUs)
        const free = dragRangeBy(dragged, drag.mode, deltaUs, bounds)
        const extra = snapDelta(free, drag.mode, targetsUs, thresholdUs)
        const range = extra ? dragRangeBy(dragged, drag.mode, deltaUs + extra, bounds) : free
        const preview: ImageOverlay = { ...dragged, ...range }
        const edgeUs = drag.mode === 'end' ? preview.endUs : preview.startUs
        const guideUs = extra ? (drag.mode === 'move' ? [preview.startUs, preview.endUs].find((edge) => targetsUs.includes(edge)) ?? null : edgeUs) : null
        return { preview, edgeUs, guideUs }
      }
      const move = (event: PointerEvent) => {
        if (event.pointerId !== drag.pointerId) return
        const { preview, edgeUs, guideUs } = previewAt(event.clientX)
        setDraggedOverlay(preview)
        setSnapGuideUs(guideUs)
        overlayPreviewCallbackRef.current?.(preview, edgeUs)
      }
      const finish = (event: PointerEvent, commit: boolean) => {
        if (event.pointerId !== drag.pointerId) return
        const { preview } = previewAt(event.clientX)
        setDrag(null)
        setDraggedOverlay(null)
        setSnapGuideUs(null)
        overlayPreviewCallbackRef.current?.(null)
        if (commit) overlayCommitCallbackRef.current?.(dragged, preview, drag.mode, isClone ? { clone: true } : undefined)
        cloneBaseRef.current = null
      }
      const up = (event: PointerEvent) => finish(event, true)
      const cancel = (event: PointerEvent) => finish(event, false)
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      return () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
      }
    }
    // Snap targets and previews stay in source time, where the items themselves live.
    // The drag carries a generic item; the cue it refers to is read live, so a cue deleted or undone
    // mid-gesture abandons the drag cleanly instead of committing against a stale snapshot.
    const dragged = cues.find((cue) => cue.id === drag.item.id)
    if (!dragged) {
      setDrag(null)
      setDraggedCue(null)
      setSnapGuideUs(null)
      previewCallbackRef.current(null)
      return
    }
    const targetsUs = snap ? [0, drag.originPlayheadSourceUs, ...(mediaDurationUs ? [mediaDurationUs] : []), ...cues.filter((cue) => cue.id !== drag.item.id).flatMap((cue) => [cue.startUs, cue.endUs])] : []
    const thresholdUs = pixelToTime(SNAP_THRESHOLD_PX, durationUs, drag.contentWidthPx)
    const previewAt = (clientX: number) => {
      const sequenceDeltaUs = pixelToTime(clientX - drag.originClientX, durationUs, drag.contentWidthPx)
      const edgeSourceUs = drag.mode === 'end' ? drag.item.endUs : drag.item.startUs
      const deltaUs = sourceDeltaFor(edgeSourceUs, sequenceDeltaUs)
      const free = dragCueBy(dragged, drag.mode, deltaUs, mediaDurationUs)
      const extra = snapDelta(free, drag.mode, targetsUs, thresholdUs)
      const preview = extra ? dragCueBy(dragged, drag.mode, deltaUs + extra, mediaDurationUs) : free
      const edgeUs = drag.mode === 'end' ? preview.endUs : preview.startUs
      const guideUs = extra ? (drag.mode === 'move' ? [preview.startUs, preview.endUs].find((edge) => targetsUs.includes(edge)) ?? null : edgeUs) : null
      return { preview, edgeUs, guideUs }
    }
    const move = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return
      const { preview, edgeUs, guideUs } = previewAt(event.clientX)
      setDraggedCue(preview)
      setSnapGuideUs(guideUs)
      previewCallbackRef.current(preview, edgeUs)
    }
    const finish = (event: PointerEvent, commit: boolean) => {
      if (event.pointerId !== drag.pointerId) return
      const { preview } = previewAt(event.clientX)
      setDrag(null)
      setDraggedCue(null)
      setSnapGuideUs(null)
      previewCallbackRef.current(null)
      if (commit) commitCallbackRef.current(dragged, preview, drag.mode)
    }
    const up = (event: PointerEvent) => finish(event, true)
    const cancel = (event: PointerEvent) => finish(event, false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [drag, durationUs, mediaDurationUs, cues, overlays, snap])

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
  const scrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubPointer === event.pointerId) seekAtClientX(event.clientX)
  }
  const endScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubPointer === event.pointerId) setScrubPointer(null)
  }

  const beginDividerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDividerDrag({ pointerId: event.pointerId, originClientY: event.clientY, originSplit: videoHeightPx / mediaHeightPx, mediaHeightPx })
  }
  const moveDivider = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dividerDrag || dividerDrag.pointerId !== event.pointerId) return
    setMediaSplit(Math.max(0, Math.min(1, dividerDrag.originSplit + (event.clientY - dividerDrag.originClientY) / dividerDrag.mediaHeightPx)))
  }
  const endDividerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dividerDrag?.pointerId === event.pointerId) setDividerDrag(null)
  }
  const nudgeDivider = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    setMediaSplit((split) => Math.max(0, Math.min(1, split + (event.key === 'ArrowUp' ? -8 : 8) / mediaHeightPx)))
  }

  const selectCueFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>, cue: Cue) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    onSeek(toSequence(cue.startUs), cue.id)
  }

  /** `dragover` never has `dataTransfer.files` populated even for a real file drag (Chromium
   * withholds it until drop), so `dropContent` reads the live in-window payload for a bin asset and
   * the `Files` type alone for an OS drag — see `core/dragPayload.ts`. */
  const onContentDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    const content = dropContent(event.dataTransfer)
    if (!content) { setDropIndicator(null); return }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const rect = contentRef.current?.getBoundingClientRect()
    if (!rect) return
    const leftUs = dropTimeAt(event.clientX, rect, durationUs)
    const widthUs = content.kind === 'asset' && content.payload.kind === 'image' ? IMAGE_DROP_INDICATOR_US : 0
    setDropIndicator({ leftUs, widthUs })
  }
  const onContentDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const content = dropContent(event.dataTransfer)
    setDropIndicator(null)
    if (!content) return
    event.preventDefault()
    const rect = contentRef.current?.getBoundingClientRect()
    const dropUs = rect ? dropTimeAt(event.clientX, rect, durationUs) : currentUs
    if (content.kind === 'asset') onDropAsset?.(content.payload, dropUs)
    else if (content.files.length) onDropFiles?.(content.files, dropUs)
  }

  const playheadLeft = `${timeToPixel(Math.min(currentUs, durationUs), durationUs, 100)}%`
  // One ordered list drives both the label column and the content column. V2-V6 add a track by
  // appending an entry here; the divider is a track of its own so the split drag is unchanged.
  const tracks: TimelineTrack[] = [
    { id: 'ruler', kind: 'ruler', label: 'Ruler', heightPx: RULER_HEIGHT_PX },
    { id: 'captions', kind: 'captions', label: 'Captions', heightPx: CAPTIONS_HEIGHT_PX, itemKind: 'cue' },
    ...(overlays.length ? [{ id: 'overlays', kind: 'overlays' as const, label: 'Overlays', heightPx: overlaysHeightPx, itemKind: 'overlay' as const }] : []),
    { id: 'video', kind: 'video', label: 'Video 1', heightPx: videoHeightPx },
    { id: 'divider', kind: 'divider', label: 'Resize video and audio tracks', heightPx: DIVIDER_HEIGHT_PX },
    { id: 'audio', kind: 'audio', label: 'Audio 1', heightPx: audioHeightPx },
  ]
  const trackHeights = { gridTemplateRows: trackRows(tracks) } as CSSProperties
  const trackLabel = (id: string) => tracks.find((track) => track.id === id)?.label ?? ''

  return <section className={`timeline-panel ${expanded ? 'expanded' : ''}`} aria-label="Timeline">
    <TimelineToolbar
      mode={trackMode} onMode={onDisplay}
      snap={snap} onSnap={setSnap}
      zoom={zoom} zoomMin={ZOOM_MIN} zoomMax={ZOOM_MAX} onZoom={(next) => updateZoom(next)}
      expanded={expanded} onExpand={setExpanded}
      onCenterPlayhead={() => scrollPlayheadTo(.5, 'smooth')}
      actions={actions} hasSelection={selectedCueId !== null && cues.some((cue) => cue.id === selectedCueId)} canMerge={canMerge} canSplit={canSplit} canAdd={canAdd} hasCues={cues.length > 0} hasSelectedWord={hasSelectedWord}
    />
    {/* --ruler-h is inherited by .gridlines and .snap-guide, which hang from below the ruler row. */}
    <div className="timeline-body" style={{ '--ruler-h': `${RULER_HEIGHT_PX}px` } as CSSProperties}>
      <div className="track-labels" style={trackHeights}>
        <span className="ruler-spacer" aria-hidden="true">{formatClock(currentUs)} / {formatClock(durationUs)}</span>
        <div className="track-label"><CaptionsIcon /><span>{trackLabel('captions')}</span></div>
        {overlays.length > 0 && <div className="track-label"><span>{trackLabel('overlays')}</span></div>}
        <div className="track-label" title={mediaName}><VideoIcon /><span>{trackLabel('video')}</span></div>
        <div className={`track-divider ${dividerDrag ? 'dragging' : ''}`} role="separator" aria-orientation="horizontal" aria-label="Resize video and audio tracks" aria-valuenow={Math.round(videoHeightPx / mediaHeightPx * 100)} aria-valuemin={0} aria-valuemax={100} tabIndex={0}
          onPointerDown={beginDividerDrag} onPointerMove={moveDivider} onPointerUp={endDividerDrag} onPointerCancel={endDividerDrag} onKeyDown={nudgeDivider}><GripIcon /></div>
        <div className="track-label"><AudioIcon /><span>{trackLabel('audio')}</span></div>
      </div>
      <div className="timeline-viewport" ref={viewportRef}>
        <div className="timeline-content" ref={contentRef} style={{ ...trackHeights, width: `${zoom * 100}%` }}
          onDragOver={onContentDragOver} onDragLeave={() => setDropIndicator(null)} onDrop={onContentDrop}>
          <div className="ruler" onPointerDown={beginScrub} onPointerMove={scrub} onPointerUp={endScrub} onPointerCancel={endScrub} aria-label="Time ruler. Click or drag to move the playhead.">
            {ticks.map((timeUs) => <span key={timeUs} style={{ left: `${timeToPixel(timeUs, durationUs, 100)}%` }}>{formatRulerTime(timeUs)}</span>)}
          </div>
          <div className="gridlines" aria-hidden="true">
            {ticks.map((timeUs) => <i key={timeUs} style={{ left: `${timeToPixel(timeUs, durationUs, 100)}%` }} />)}
          </div>
          <div className={`track captions ${trackMode}`} onPointerDown={seekTrack} role="group" aria-label={trackMode === 'line' ? 'Caption lines. Tab to a caption, then press Enter or Space to select and seek to it.' : 'Caption words. Tab to a word, then press Enter or Space to seek to it.'}>
            {trackMode === 'line' ? displayCues.flatMap((cue) => cueSpans(cue).map((span, spanIndex, spans) => <div
              key={`${cue.id}:${spanIndex}`}
              role="button"
              tabIndex={0}
              lang="ml"
              aria-label={`Cue ${cue.text}, ${formatClock(cue.startUs)} to ${formatClock(cue.endUs)}${spans.length > 1 ? `, part ${spanIndex + 1} of ${spans.length}` : ''}`}
              className={`cue-block ${cue.id === selectedCueId ? 'active' : ''} ${warningCueIds.has(cue.id) ? 'has-warning' : ''} ${drag?.item.id === cue.id ? 'dragging' : ''}`}
              style={{ left: `${timeToPixel(span.startUs, durationUs, 100)}%`, width: `${Math.max(.02, timeToPixel(span.endUs - span.startUs, durationUs, 100))}%` }}
              onPointerDown={(event) => beginDrag(event, cue, 'move')}
              onKeyDown={(event) => selectCueFromKeyboard(event, cue)}
            >
              {/* A cue clipped by a cut still drags as one cue: only its outer edges carry handles. */}
              {spanIndex === 0 && <span className="cue-handle start" data-handle="start" aria-hidden="true" onPointerDown={(event) => beginDrag(event, cue, 'start')} />}
              <span className="cue-block-text">{cue.text}</span>
              {spanIndex === spans.length - 1 && <span className="cue-handle end" data-handle="end" aria-hidden="true" onPointerDown={(event) => beginDrag(event, cue, 'end')} />}
            </div>)) : displayCues.flatMap((cue) => cueSpans(cue).map((span, spanIndex) => <div key={`${cue.id}:${spanIndex}`} className={`cue-span ${cue.id === selectedCueId ? 'active' : ''} ${warningCueIds.has(cue.id) ? 'has-warning' : ''}`}
              style={{ left: `${timeToPixel(span.startUs, durationUs, 100)}%`, width: `${Math.max(.02, timeToPixel(span.endUs - span.startUs, durationUs, 100))}%` }}>
              <WordBlocks cue={cue} selectedWordId={selectedWordId} onSeek={(sourceUs, cueId) => onSeek(toSequence(sourceUs), cueId)} onSelectWord={onSelectWord} />
            </div>))}
          </div>
          {overlays.length > 0 && <div className="track overlays" onPointerDown={seekTrack} role="group" aria-label="Image overlays. Tab to an overlay, then press Enter or Space to select and seek to it. Alt+drag to clone.">
            {displayOverlays.flatMap((overlay) => overlaySpans(overlay).map((span, spanIndex, spans) => {
              const laneIndex = overlayLaneInfo.laneOf.get(overlay.id) ?? 0
              const label = assets.find((asset) => asset.id === overlay.assetId)?.name ?? 'Image overlay'
              return <div
              key={`${overlay.id}:${spanIndex}`}
              role="button"
              tabIndex={0}
              aria-label={`Image overlay ${label}, ${formatClock(overlay.startUs)} to ${formatClock(overlay.endUs)}${spans.length > 1 ? `, part ${spanIndex + 1} of ${spans.length}` : ''}`}
              className={`overlay-block ${overlay.id === selectedOverlayId ? 'active' : ''} ${drag?.item.id === overlay.id ? 'dragging' : ''}`}
              style={{ left: `${timeToPixel(span.startUs, durationUs, 100)}%`, width: `${Math.max(.02, timeToPixel(span.endUs - span.startUs, durationUs, 100))}%`,
                top: laneIndex * OVERLAY_LANE_PX + 4, height: OVERLAY_LANE_PX - 8 }}
              onPointerDown={(event) => beginOverlayDrag(event, overlay, 'move')}
              onKeyDown={(event) => selectOverlayFromKeyboard(event, overlay)}
            >
              {spanIndex === 0 && <span className="cue-handle start" data-handle="start" aria-hidden="true" onPointerDown={(event) => beginOverlayDrag(event, overlay, 'start')} />}
              <span className="cue-block-text">{label}</span>
              {spanIndex === spans.length - 1 && <span className="cue-handle end" data-handle="end" aria-hidden="true" onPointerDown={(event) => beginOverlayDrag(event, overlay, 'end')} />}
            </div>
            }))}
          </div>}
          <div className="track video" onPointerDown={seekTrack}>
            {thumbnailState.kind === 'ready' && <ThumbnailStrip images={thumbnailState.images} />}
            <CutMarkers mediaDurationUs={mediaDurationUs} segments={segments} durationUs={durationUs} toSequence={toSequence} />
            <span className="track-overlay-label" aria-hidden="true">Video 1</span>
            {!fingerprint && <span className="track-status">No video open</span>}
            {thumbnailState.kind === 'loading' && <span className="track-status" role="status">{`Extracting thumbnails${thumbnailState.percent === null ? '…' : ` ${thumbnailState.percent}%`}`}</span>}
            {thumbnailState.kind === 'error' && <span className="track-status" role="status">Thumbnails unavailable</span>}
          </div>
          <div className="track-divider-line" aria-hidden="true" />
          <div className="track audio" onPointerDown={seekTrack}>
            {waveform && <Waveform waveform={waveform} durationUs={durationUs} mediaDurationUs={mediaDurationUs} segments={segments} toSequence={toSequence} />}
            <span className="track-overlay-label" aria-hidden="true">Audio 1</span>
            {waveformStatus && <span className="track-status" role="status">{waveformStatus}{onCancelWaveform && <button type="button" className="cancel-waveform" onClick={onCancelWaveform} aria-label="Cancel waveform extraction">×</button>}</span>}
          </div>
          {snapGuideUs !== null && <i className="snap-guide" style={{ left: `${timeToPixel(toSequence(snapGuideUs), durationUs, 100)}%` }} aria-hidden="true" />}
          {dropIndicator && <i className="drop-indicator" style={{ left: `${timeToPixel(dropIndicator.leftUs, durationUs, 100)}%`, width: dropIndicator.widthUs ? `${timeToPixel(dropIndicator.widthUs, durationUs, 100)}%` : undefined }} aria-hidden="true" />}
          <i className="playhead" style={{ left: playheadLeft }} aria-hidden="true" />
        </div>
      </div>
    </div>
  </section>
}
