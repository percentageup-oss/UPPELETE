import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from 'react'
import type { CaptionWord, Cue } from './core/model'
import type { BlurRegion, CaptionTrack, Clip, EffectRegion, Group, Marker, ProjectAsset, Shape, TextOverlay, Track, ZoomRegion } from './core/edit'
import { anchoredScrollLeft, dragCueBy, pixelToTime, snapDelta, timeToPixel, type CueDragMode } from './core/timeline'
import { colorClipLabel, isAnimated, swatchCss } from './core/fill'
import { captionClips, clipEndUs, clipLengthUs, sequenceUsOf, sourceUsAt, spanSequenceUs, spansInSequence } from './core/timelineModel'
import { speedRateAt, type Retime } from './core/clipTime'
import { linkIdOf, linkPartners, trimPartners } from './core/clipLinks'
import { gapsOnTrack, snapTargets, type ClipEdge, type EditMode } from './core/clipEdits'
import { previewClipDrag, type ClipDragMode } from './core/clipDrag'
import { DEFAULT_ZOOM_REGION_US, previewZoomDrag, type ZoomDragMode } from './core/zoomRegion'
import { DEFAULT_BLUR_REGION_US, previewBlurDrag, type BlurDragMode } from './core/blurRegion'
import { previewEffectDrag, type EffectDragMode } from './core/effectCommands'
import { rowTops, timelineRows, trackAtY, trackRows, videoStackHeightPx, RULER_HEIGHT_PX } from './core/timelineLayout'
import type { Selection } from './core/timelineItems'
import { formatClock } from './core/time'
import type { WaveformData } from './core/waveform'
import { TimelineToolbar, type ClipTools, type EditTools, type TimelineActions } from './TimelineToolbar'
import type { CaptionDisplay } from './captions/wordDisplay'
import { dropContent, type AssetDragPayload, type BackgroundDragPayload, type ColorDragPayload, type PresetDragPayload } from './core/dragPayload'
import { DEFAULT_ADJUSTMENT_CLIP_US, DEFAULT_BACKGROUND_CLIP_US, DEFAULT_IMAGE_CLIP_US, dropTimeAt } from './core/timelineDrop'
import { CaptionsTrack, type CaptionSpan } from './timeline/CaptionsTrack'
import { ZoomLane } from './timeline/ZoomLane'
import { BlurLane } from './timeline/BlurLane'
import { EffectLane } from './timeline/EffectLane'
import { TextLane } from './timeline/TextLane'
import { ShapeLane } from './timeline/ShapeLane'
import { packTextOverlays } from './core/textLayout'
import { ClipBlock } from './timeline/ClipBlock'
import { VideoClipContent } from './timeline/VideoClipContent'
import { AudioClipContent } from './timeline/AudioClipContent'
import { TimelineRuler, useRulerTicks } from './timeline/TimelineRuler'
import { TimelineTrackHeaders, type CaptionTrackHeaderActions, type TrackHeaderActions } from './timeline/TimelineTrackHeaders'
import type { ThumbnailQueue } from './timeline/thumbnailQueue'

type CueDrag = {
  kind: 'cue'
  cue: Cue
  mode: CueDragMode
  /** The clip the grabbed piece is seen through (its source↔sequence mapping), or null for the untethered case. */
  clip: Retime | null
  /** Source µs per sequence µs at the grabbed edge: pointer deltas arrive in sequence time. */
  rate: number
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
  /** Act on this clip alone (Alt held, or it was Alt-selected): its link partners stay put. */
  unlinked: boolean
  originClientX: number
  pointerId: number
  contentWidthPx: number
  originPlayheadUs: number
}
/** Sequence-timed, one lane, no source clamping — the simplest of the three drag kinds. */
type ZoomDrag = {
  kind: 'zoom'
  region: ZoomRegion
  mode: ZoomDragMode
  /** Alt+drag on the body: the gesture places a copy and leaves the original where it is. */
  clone: boolean
  originClientX: number
  pointerId: number
  contentWidthPx: number
  originPlayheadUs: number
}
/** Sequence-timed like zoom, but no lane to fit into — blur regions may overlap. */
type BlurDrag = {
  kind: 'blur'
  region: BlurRegion
  mode: BlurDragMode
  originClientX: number
  pointerId: number
  contentWidthPx: number
  originPlayheadUs: number
}
/** Sequence-timed like zoom, one lane **per kind** — a vignette only fits the gap around other
 * vignettes, never a letterbox (docs/EDITING.md "Frame-paint effects"). */
type EffectDrag = {
  kind: 'effect'
  region: EffectRegion
  mode: EffectDragMode
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
  captionTracks: CaptionTrack[]
  clips: Clip[]
  /** The one zoom lane over the whole program (schema 7); sequence-timed, never per-track. */
  zoomRegions?: ZoomRegion[]
  /** The blur lane, shown only when non-empty (`timelineLayout.ts`); regions may overlap. */
  blurRegions?: BlurRegion[]
  /** Frame-paint effects (schema 9): one lane per kind present, shown only when used, like blur. */
  effects?: EffectRegion[]
  textOverlays?: TextOverlay[]
  shapes?: Shape[]
  assets: ProjectAsset[]
  /** Sequence time. */
  currentUs: number
  /** Sequence time: the span the timeline draws (program plus headroom past the last clip). */
  durationUs: number
  /** Sequence time: where the program actually ends (seek limit, snap target). Defaults to `durationUs`. */
  programUs?: number
  /** The In/Out export range (I / O): the timeline dims everything outside it. Optional so existing callers compile unchanged. */
  range?: { startUs: number; endUs: number } | null
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
  /** `unlinked` (Alt-click) selects the clip on its own, without its link partners. */
  onSelectClip: (clipId: string, options?: { unlinked?: boolean }) => void
  /** Right-click (or Shift+F10 / the Menu key): the item under the pointer is already selected; the
   * host opens its menu at the screen point. `empty` is track background, with its sequence time. */
  onContextMenu?: (target: TimelineMenuTarget, clientX: number, clientY: number) => void
  onClipMove: (clipId: string, trackId: string, startUs: number, unlinked?: boolean, newTrack?: Track) => void
  onClipClone: (clip: Clip) => void
  onClipTrim: (clipId: string, edge: ClipEdge, deltaUs: number, unlinked?: boolean) => void
  onCloseGap: (trackId: string, atUs: number) => void
  onSelectZoom?: (zoomId: string) => void
  onZoomMove?: (zoomId: string, startUs: number) => void
  onZoomClone?: (region: ZoomRegion) => void
  onZoomTrim?: (zoomId: string, edge: 'start' | 'end', deltaUs: number) => void
  onSelectBlur?: (blurId: string) => void
  onBlurMove?: (blurId: string, startUs: number) => void
  onBlurTrim?: (blurId: string, edge: 'start' | 'end', deltaUs: number) => void
  onSelectEffect?: (effectId: string) => void
  onEffectMove?: (effectId: string, startUs: number) => void
  onEffectTrim?: (effectId: string, edge: 'start' | 'end', deltaUs: number) => void
  onSelectText?: (textId: string) => void
  onAddText?: () => void
  onTextMove?: (textId: string, startUs: number) => void
  onTextTrim?: (textId: string, edge: 'start' | 'end', deltaUs: number) => void
  onSelectShape?: (shapeId: string) => void
  /** Schema 22 groups and the Ctrl/Shift-click pending selection, for the group chip, shared accent and highlight. */
  groups?: readonly Group[]
  pendingGroupIds?: readonly string[]
  onShapeMove?: (shapeId: string, startUs: number) => void
  onShapeTrim?: (shapeId: string, edge: 'start' | 'end', deltaUs: number) => void
  trackActions: TrackHeaderActions
  captionTrackActions: CaptionTrackHeaderActions
  /** A file's measured duration where its probe reported none, for clamping trims. */
  assetDurationUs: (assetId: string) => number | null
  display: CaptionDisplay
  onDisplay: (display: CaptionDisplay) => void
  selectedWordId: string | null
  onSelectWord: (cue: Cue, word: CaptionWord) => void
  actions: TimelineActions
  clipTools: ClipTools
  edit: EditTools
  canMerge: boolean
  canAdd: boolean
  /** A bin asset dragged onto the timeline, with the track under the pointer. */
  onDropAsset?: (payload: AssetDragPayload, sequenceUs: number, trackId: string | null) => void
  /** Files dragged in from Finder/Explorer. */
  onDropFiles?: (files: File[], sequenceUs: number, trackId: string | null) => void
  /** A panel preset dropped anywhere on the timeline (the Effects panel's zoom/blur tiles); it
   * creates its own item rather than an asset clip, so it carries no track. */
  onDropPreset?: (payload: PresetDragPayload, sequenceUs: number) => void
  onDropBackground?: (payload: BackgroundDragPayload, sequenceUs: number, trackId: string | null) => void
  /** A Color panel tile dropped on the timeline: the track under the pointer, if any, decides
   * whether it grades a clip there or lands as its own layer (docs/EDITING.md "Color: adjustment
   * layers") — the caller does that placement logic, this only reports where the drop landed. */
  onDropColor?: (payload: ColorDragPayload, sequenceUs: number, trackId: string | null) => void
  thumbnailQueue?: ThumbnailQueue | null
}

export type TimelineMenuTarget =
  | { kind: 'clip' | 'cue' | 'word' | 'text' | 'shape' | 'zoomRegion' | 'blur' | 'effect'; id: string; unlinked?: boolean }
  | { kind: 'empty'; trackId: string | null; atUs: number; captionLane?: boolean }

const ZOOM_MIN = 1
const ZOOM_MAX = 32
const SNAP_THRESHOLD_PX = 8
const FOLLOW_MARGIN = 0.1

export function Timeline(props: TimelineProps) {
  const { cues, tracks, captionTracks, clips, zoomRegions = [], blurRegions = [], effects = [], textOverlays = [], shapes = [], assets, currentUs, durationUs, programUs = durationUs, selection, markers = [], warningCueIds, waveforms, onSeek, display, actions } = props
  const [zoom, setZoom] = useState(1)
  const [snap, setSnap] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [mediaSplit, setMediaSplit] = useState(.5)
  const [drag, setDrag] = useState<CueDrag | ClipDrag | ZoomDrag | BlurDrag | EffectDrag | null>(null)
  const [draggedCue, setDraggedCue] = useState<Cue | null>(null)
  const [clipPreview, setClipPreview] = useState<Clip | null>(null)
  /** Where the dragged clip's link partners would land, drawn moving with it. */
  const [partnerPreview, setPartnerPreview] = useState<Clip[]>([])
  const [zoomPreview, setZoomPreview] = useState<ZoomRegion | null>(null)
  const [blurPreview, setBlurPreview] = useState<BlurRegion | null>(null)
  const [effectPreview, setEffectPreview] = useState<EffectRegion | null>(null)
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
  const selectedPartnerIds = useMemo(() => {
    const selected = selection?.kind === 'clip' && !selection.unlinked ? clips.find((clip) => clip.id === selection.id) : undefined
    return new Set(selected ? linkPartners(clips, selected).map((clip) => clip.id) : [])
  }, [selection, clips])
  const selectedZoomId = selection?.kind === 'zoomRegion' ? selection.id : null
  const selectedBlurId = selection?.kind === 'blur' ? selection.id : null
  const selectedEffectId = selection?.kind === 'effect' ? selection.id : null
  const selectedTextId = selection?.kind === 'text' ? selection.id : null
  const selectedShapeId = selection?.kind === 'shape' ? selection.id : null
  const selectedGroupId = selection?.kind === 'group' ? selection.id : null
  const groupNames = useMemo(() => new Map((props.groups ?? []).map((group) => [group.id, group.name])), [props.groups])

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

  const effectKinds = useMemo(() => [...new Set(effects.map((effect) => effect.kind))], [effects])
  const textRows = useMemo(() => Math.max(1, packTextOverlays(textOverlays).rows.length), [textOverlays])
  const shapeRows = useMemo(() => packTextOverlays(shapes).rows.length, [shapes])
  const rows = useMemo(() => timelineRows(tracks, captionTracks, viewport.heightPx, mediaSplit, blurRegions.length > 0, effectKinds, textRows, shapeRows),
    [tracks, captionTracks, viewport.heightPx, mediaSplit, blurRegions.length, effectKinds, textRows, shapeRows])
  const gridStyle = { gridTemplateRows: trackRows(rows) } as CSSProperties
  const mediaHeightPx = rows.filter((row) => row.kind === 'track').reduce((sum, row) => sum + row.heightPx, 0)
  const trackById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks])
  const captionTrackById = useMemo(() => new Map(captionTracks.map((track) => [track.id, track])), [captionTracks])
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])
  const clipCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const clip of clips) counts.set(clip.trackId, (counts.get(clip.trackId) ?? 0) + 1)
    return counts
  }, [clips])
  const captionCueCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const cue of cues) if (cue.captionTrackId) counts.set(cue.captionTrackId, (counts.get(cue.captionTrackId) ?? 0) + 1)
    return counts
  }, [cues])

  // Captions are seen through the visible video clips of their own file.
  const visibleVideo = useMemo(() => captionClips(tracks, clips), [tracks, clips])
  const hasVideo = clips.some((clip) => clip.kind === 'video')
  const spansOf = (cue: Cue): CaptionSpan[] => {
    if (!cue.mediaAssetId) return hasVideo ? [] : [{ startUs: cue.startUs, endUs: cue.endUs, sourceStartUs: cue.startUs, sourceEndUs: cue.endUs, clipId: null }]
    return spansInSequence(cue, cue.mediaAssetId, visibleVideo)
  }
  const displayCues = draggedCue ? cues.map((cue) => cue.id === draggedCue.id ? draggedCue : cue) : cues
  const displayClips = clipPreview && drag?.kind === 'clip'
    ? drag.clone ? [...clips, clipPreview] : clips.map((clip) => clip.id === clipPreview.id ? clipPreview : partnerPreview.find((partner) => partner.id === clip.id) ?? clip)
    : clips
  const displayZoomRegions = zoomPreview
    ? drag?.kind === 'zoom' && drag.clone ? [...zoomRegions, zoomPreview] : zoomRegions.map((region) => region.id === zoomPreview.id ? zoomPreview : region)
    : zoomRegions
  const displayBlurRegions = blurPreview ? blurRegions.map((region) => region.id === blurPreview.id ? blurPreview : region) : blurRegions
  const displayEffects = effectPreview ? effects.map((effect) => effect.id === effectPreview.id ? effectPreview : effect) : effects
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
    0, originPlayheadUs, programUs,
    ...cues.filter((cue) => cue.id !== exceptCueId).flatMap((cue) => spansOf(cue).flatMap((span) => [span.startUs, span.endUs])),
  ])

  const contentWidth = () => contentRef.current?.getBoundingClientRect().width ?? 1

  const beginCueDrag = (event: ReactPointerEvent<HTMLElement>, cue: Cue, mode: CueDragMode, span: CaptionSpan) => {
    if (event.button !== 0) return
    if (captionTrackById.get(cue.captionTrackId ?? '')?.locked) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const clip = span.clipId ? clips.find((candidate) => candidate.id === span.clipId) : undefined
    const edgeSourceUs = mode === 'end' ? cue.endUs : cue.startUs
    const rate = clip ? speedRateAt(clip.kind === 'video' || clip.kind === 'audio' ? clip.speed : undefined, edgeSourceUs) : 1
    const retime = clip ?? null
    const toSequence = (sourceUs: number) => retime ? sequenceUsOf(retime, sourceUs) : sourceUs
    const sourceBounds = clip ? { startUs: clip.sourceStartUs, endUs: clip.sourceEndUs } : { startUs: 0, endUs: Number.MAX_SAFE_INTEGER }
    setDrag({ kind: 'cue', cue, mode, clip: retime, rate, sourceBounds, originClientX: event.clientX, pointerId: event.pointerId, contentWidthPx: contentWidth(), originPlayheadUs: currentUs })
    setDraggedCue(cue)
    const edgeUs = mode === 'end' ? cue.endUs : cue.startUs
    onSeek(toSequence(edgeUs), cue.id)
    props.onDragPreview(cue, toSequence(edgeUs))
  }

  const beginClipDrag = (event: ReactPointerEvent<HTMLElement>, clip: Clip, mode: ClipDragMode) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    // Alt selects (and edits) this clip alone; so does dragging a clip that was already Alt-selected.
    const unlinked = event.altKey || Boolean(selection?.kind === 'clip' && selection.id === clip.id && selection.unlinked)
    props.onSelectClip(clip.id, { unlinked })
    if (trackById.get(clip.trackId)?.locked) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const clone = mode === 'move' && event.altKey
    const subject = clone ? { ...clip, id: crypto.randomUUID() } : clip
    setDrag({ kind: 'clip', clip: subject, mode, clone, unlinked, originClientX: event.clientX, pointerId: event.pointerId, contentWidthPx: contentWidth(), originPlayheadUs: currentUs })
    setClipPreview(subject)
  }

  const beginZoomDrag = (event: ReactPointerEvent<HTMLElement>, region: ZoomRegion, mode: ZoomDragMode) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    props.onSelectZoom?.(region.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    const clone = mode === 'move' && event.altKey
    const subject = clone ? { ...region, id: crypto.randomUUID() } : region
    setDrag({ kind: 'zoom', region: subject, mode, clone, originClientX: event.clientX, pointerId: event.pointerId, contentWidthPx: contentWidth(), originPlayheadUs: currentUs })
    setZoomPreview(subject)
  }

  const beginBlurDrag = (event: ReactPointerEvent<HTMLElement>, region: BlurRegion, mode: BlurDragMode) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    props.onSelectBlur?.(region.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ kind: 'blur', region, mode, originClientX: event.clientX, pointerId: event.pointerId, contentWidthPx: contentWidth(), originPlayheadUs: currentUs })
    setBlurPreview(region)
  }

  const beginEffectDrag = (event: ReactPointerEvent<HTMLElement>, region: EffectRegion, mode: EffectDragMode) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    props.onSelectEffect?.(region.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ kind: 'effect', region, mode, originClientX: event.clientX, pointerId: event.pointerId, contentWidthPx: contentWidth(), originPlayheadUs: currentUs })
    setEffectPreview(region)
  }

  useEffect(() => {
    if (!drag) return
    const cueRate = drag.kind === 'cue' ? drag.rate : 1
    const thresholdUs = pixelToTime(SNAP_THRESHOLD_PX, durationUs, drag.contentWidthPx) * cueRate
    const sequenceDelta = (clientX: number) => pixelToTime(clientX - drag.originClientX, durationUs, drag.contentWidthPx) * cueRate
    let finish: (event: PointerEvent, commit: boolean) => void
    let move: (event: PointerEvent) => void
    if (drag.kind === 'cue') {
      // The caption is read live, so one deleted or undone mid-gesture abandons the drag cleanly.
      const dragged = cues.find((cue) => cue.id === drag.cue.id)
      if (!dragged) { setDrag(null); setDraggedCue(null); callbacks.current.onDragPreview(null); return }
      const { cue: original, clip: dragClip, sourceBounds, mode } = drag
      const toSequence = (sourceUs: number) => dragClip ? sequenceUsOf(dragClip, sourceUs) : sourceUs
      const toSource = (sequenceUs: number) => dragClip ? sourceUsAt(dragClip, sequenceUs) : sequenceUs
      const targets = snap ? snapTargetsFor([], original.id, drag.originPlayheadUs).map(toSource) : []
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
        setSnapGuideUs(guideUs === null ? null : toSequence(guideUs))
        callbacks.current.onDragPreview(preview, toSequence(edgeUs))
      }
      finish = (event, commit) => {
        if (event.pointerId !== drag.pointerId) return
        const { preview } = previewAt(event.clientX)
        setDrag(null); setDraggedCue(null); setSnapGuideUs(null)
        callbacks.current.onDragPreview(null)
        if (commit) callbacks.current.onDragCommit(dragged, preview, mode)
      }
    } else if (drag.kind === 'clip') {
      const live = drag.clone ? drag.clip : clips.find((clip) => clip.id === drag.clip.id)
      if (!live) { setDrag(null); setClipPreview(null); return }
      const targets = snap ? snapTargetsFor(drag.clone ? [] : [live.id], null, drag.originPlayheadUs) : []
      const trackUnder = (clientY: number) => {
        const body = bodyRef.current
        if (!body) return null
        return trackAtY(rows, clientY - body.getBoundingClientRect().top + body.scrollTop)
      }
      // Link partners follow the dragged clip by the same applied delta on their own tracks.
      // A trim carries only the partners whose edge is in sync with the grabbed one (`trimPartners`).
      const followers = drag.clone || drag.unlinked ? [] : drag.mode === 'move' ? linkPartners(clips, live) : trimPartners(clips, live, drag.mode, props.editMode)
      const partnerPreviews = (deltaUs: number) => followers.map((partner) => previewClipDrag({
        clip: partner, mode: drag.mode, deltaUs, targetTrack: null, tracks, clips, assetDurationUs: partner.kind === 'color' || partner.kind === 'adjustment' ? null : props.assetDurationUs(partner.assetId), editMode: props.editMode, snap: null,
      }))
      const partnersOf = (preview: ReturnType<typeof previewClipDrag>): Clip[] => partnerPreviews(preview.appliedDeltaUs).map((partner) => partner.clip)
      // Dragging a picture above the topmost video track lands it on a new track on top.
      const pendingTrack: Track = { id: crypto.randomUUID(), kind: 'video', name: '', muted: false, hidden: false, locked: false }
      const targetAt = (clientY: number): Track | null => {
        const under = trackUnder(clientY)
        if (under || live.kind === 'audio') return under
        const body = bodyRef.current
        const top = rows.findIndex((row) => row.kind === 'track' && row.track.kind === 'video')
        if (!body || top < 0) return null
        return clientY - body.getBoundingClientRect().top + body.scrollTop < rowTops(rows)[top] ? pendingTrack : null
      }
      const previewWith = (deltaUs: number, event: PointerEvent, withSnap: boolean) => previewClipDrag({
        clip: live, mode: drag.mode, deltaUs, targetTrack: drag.mode === 'move' ? targetAt(event.clientY) : null,
        tracks, clips: drag.clone ? [...clips, live] : clips, assetDurationUs: live.kind === 'color' || live.kind === 'adjustment' ? null : props.assetDurationUs(live.assetId), editMode: props.editMode,
        snap: withSnap && targets.length ? { targetsUs: targets, thresholdUs } : null,
      })
      // Like the `clip-trim` commit: a trimmed pair moves by the smallest amount every member can take.
      const previewAt = (event: PointerEvent) => {
        const preview = previewWith(sequenceDelta(event.clientX), event, true)
        if (drag.mode === 'move' || !followers.length) return preview
        const applied = [preview.appliedDeltaUs, ...partnerPreviews(preview.appliedDeltaUs).map((partner) => partner.appliedDeltaUs)]
        const common = preview.appliedDeltaUs >= 0 ? Math.min(...applied) : Math.max(...applied)
        return common === preview.appliedDeltaUs ? preview : previewWith(common, event, false)
      }
      move = (event) => {
        if (event.pointerId !== drag.pointerId) return
        const preview = previewAt(event)
        setClipPreview(preview.clip)
        setPartnerPreview(partnersOf(preview))
        setSnapGuideUs(preview.guideUs)
      }
      finish = (event, commit) => {
        if (event.pointerId !== drag.pointerId) return
        const preview = previewAt(event)
        setDrag(null); setClipPreview(null); setPartnerPreview([]); setSnapGuideUs(null)
        if (!commit) return
        if (drag.clone) { if (preview.clip.timelineStartUs !== live.timelineStartUs || preview.clip.trackId !== live.trackId) callbacks.current.onClipClone(preview.clip); return }
        if (drag.mode === 'move') {
          if (preview.clip.timelineStartUs !== live.timelineStartUs || preview.clip.trackId !== live.trackId) callbacks.current.onClipMove(live.id, preview.clip.trackId, preview.clip.timelineStartUs, drag.unlinked, preview.clip.trackId === pendingTrack.id ? pendingTrack : undefined)
        } else if (preview.appliedDeltaUs) callbacks.current.onClipTrim(live.id, drag.mode, preview.appliedDeltaUs, drag.unlinked)
      }
    } else if (drag.kind === 'zoom') {
      // Zoom regions are sequence-timed with no clip/media clamping — the simplest of the three: a
      // free translation/resize (`previewZoomDrag`) clamped into the gap around every other region.
      const dragged = drag.clone ? drag.region : zoomRegions.find((region) => region.id === drag.region.id)
      if (!dragged) { setDrag(null); setZoomPreview(null); return }
      const { mode } = drag
      const others = zoomRegions.filter((region) => region.id !== dragged.id)
      const targets = snap ? snapTargetsFor([], null, drag.originPlayheadUs) : []
      const previewAt = (clientX: number) => {
        const delta = sequenceDelta(clientX)
        const free = previewZoomDrag(dragged, mode, delta, others)
        const extra = snapDelta(free, mode, targets, thresholdUs)
        const preview = extra ? previewZoomDrag(dragged, mode, delta + extra, others) : free
        const edgeUs = mode === 'end' ? preview.endUs : preview.startUs
        const guideUs = extra ? (mode === 'move' ? [preview.startUs, preview.endUs].find((edge) => targets.includes(edge)) ?? null : edgeUs) : null
        return { preview, guideUs }
      }
      move = (event) => {
        if (event.pointerId !== drag.pointerId) return
        const { preview, guideUs } = previewAt(event.clientX)
        setZoomPreview(preview)
        setSnapGuideUs(guideUs)
      }
      finish = (event, commit) => {
        if (event.pointerId !== drag.pointerId) return
        const { preview } = previewAt(event.clientX)
        setDrag(null); setZoomPreview(null); setSnapGuideUs(null)
        if (!commit) return
        // A bare Alt+click must not stamp a copy: the clamp would slide it beside the original.
        if (drag.clone) { if (sequenceDelta(event.clientX) !== 0) callbacks.current.onZoomClone?.(preview); return }
        if (mode === 'move') {
          if (preview.startUs !== dragged.startUs) callbacks.current.onZoomMove?.(dragged.id, preview.startUs)
        } else {
          const deltaUs = mode === 'start' ? preview.startUs - dragged.startUs : preview.endUs - dragged.endUs
          if (deltaUs) callbacks.current.onZoomTrim?.(dragged.id, mode, deltaUs)
        }
      }
    } else if (drag.kind === 'blur') {
      // Blur regions are sequence-timed with no lane to fit into — several may overlap
      // (`blurRegion.ts`), so `previewBlurDrag` clamps only against zero and its own minimum length.
      const dragged = blurRegions.find((region) => region.id === drag.region.id)
      if (!dragged) { setDrag(null); setBlurPreview(null); return }
      const { mode } = drag
      const targets = snap ? snapTargetsFor([], null, drag.originPlayheadUs) : []
      const previewAt = (clientX: number) => {
        const delta = sequenceDelta(clientX)
        const free = previewBlurDrag(dragged, mode, delta)
        const extra = snapDelta(free, mode, targets, thresholdUs)
        const preview = extra ? previewBlurDrag(dragged, mode, delta + extra) : free
        const edgeUs = mode === 'end' ? preview.endUs : preview.startUs
        const guideUs = extra ? (mode === 'move' ? [preview.startUs, preview.endUs].find((edge) => targets.includes(edge)) ?? null : edgeUs) : null
        return { preview, guideUs }
      }
      move = (event) => {
        if (event.pointerId !== drag.pointerId) return
        const { preview, guideUs } = previewAt(event.clientX)
        setBlurPreview(preview)
        setSnapGuideUs(guideUs)
      }
      finish = (event, commit) => {
        if (event.pointerId !== drag.pointerId) return
        const { preview } = previewAt(event.clientX)
        setDrag(null); setBlurPreview(null); setSnapGuideUs(null)
        if (!commit) return
        if (mode === 'move') {
          if (preview.startUs !== dragged.startUs) callbacks.current.onBlurMove?.(dragged.id, preview.startUs)
        } else {
          const deltaUs = mode === 'start' ? preview.startUs - dragged.startUs : preview.endUs - dragged.endUs
          if (deltaUs) callbacks.current.onBlurTrim?.(dragged.id, mode, deltaUs)
        }
      }
    } else {
      // Effects are sequence-timed like zoom, but one lane **per kind** — only other effects of the
      // same kind constrain the gap (`previewEffectDrag`).
      const dragged = effects.find((effect) => effect.id === drag.region.id)
      if (!dragged) { setDrag(null); setEffectPreview(null); return }
      const { mode } = drag
      const others = effects.filter((effect) => effect.id !== dragged.id && effect.kind === dragged.kind)
      const targets = snap ? snapTargetsFor([], null, drag.originPlayheadUs) : []
      const previewAt = (clientX: number) => {
        const delta = sequenceDelta(clientX)
        const free = previewEffectDrag(dragged, mode, delta, others)
        const extra = snapDelta(free, mode, targets, thresholdUs)
        const preview = extra ? previewEffectDrag(dragged, mode, delta + extra, others) : free
        const edgeUs = mode === 'end' ? preview.endUs : preview.startUs
        const guideUs = extra ? (mode === 'move' ? [preview.startUs, preview.endUs].find((edge) => targets.includes(edge)) ?? null : edgeUs) : null
        return { preview, guideUs }
      }
      move = (event) => {
        if (event.pointerId !== drag.pointerId) return
        const { preview, guideUs } = previewAt(event.clientX)
        setEffectPreview(preview)
        setSnapGuideUs(guideUs)
      }
      finish = (event, commit) => {
        if (event.pointerId !== drag.pointerId) return
        const { preview } = previewAt(event.clientX)
        setDrag(null); setEffectPreview(null); setSnapGuideUs(null)
        if (!commit) return
        if (mode === 'move') {
          if (preview.startUs !== dragged.startUs) callbacks.current.onEffectMove?.(dragged.id, preview.startUs)
        } else {
          const deltaUs = mode === 'start' ? preview.startUs - dragged.startUs : preview.endUs - dragged.endUs
          if (deltaUs) callbacks.current.onEffectTrim?.(dragged.id, mode, deltaUs)
        }
      }
    }
    const up = (event: PointerEvent) => finish(event, true)
    const cancel = (event: PointerEvent) => finish(event, false)
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDrag(null); setDraggedCue(null); setClipPreview(null); setZoomPreview(null); setBlurPreview(null); setEffectPreview(null); setSnapGuideUs(null)
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
  }, [drag, durationUs, cues, clips, zoomRegions, blurRegions, effects, tracks, rows, snap, props.editMode])

  const seekAtClientX = (clientX: number) => {
    const content = contentRef.current
    if (!content) return
    const rect = content.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(programUs, pixelToTime(clientX - rect.left, durationUs, rect.width))))
  }
  /** Selects what was right-clicked (keeping the playhead where it is) and asks the host for its menu. */
  const openContextMenu = (event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>, clientX: number, clientY: number) => {
    if (!props.onContextMenu) return
    event.preventDefault()
    const target = event.target as HTMLElement
    const item = target.closest<HTMLElement>('[data-item-kind]')
    const kind = item?.dataset.itemKind
    const id = item?.dataset.itemId
    if (item && kind && id) {
      if (kind === 'clip') {
        const unlinked = event.altKey
        props.onSelectClip(id, { unlinked })
        props.onContextMenu({ kind, id, unlinked }, clientX, clientY)
      } else if (kind === 'cue') { onSeek(currentUs, id); props.onContextMenu({ kind, id }, clientX, clientY) }
      else if (kind === 'word') {
        const cue = cues.find((entry) => entry.id === id)
        const word = cue?.words.find((entry) => entry.id === item.dataset.wordId)
        if (cue && word) props.onSelectWord(cue, word)
        props.onContextMenu({ kind, id }, clientX, clientY)
      } else if (kind === 'text') { props.onSelectText?.(id); props.onContextMenu({ kind, id }, clientX, clientY) }
      else if (kind === 'shape') { props.onSelectShape?.(id); props.onContextMenu({ kind, id }, clientX, clientY) }
      else if (kind === 'zoomRegion') { props.onSelectZoom?.(id); props.onContextMenu({ kind, id }, clientX, clientY) }
      else if (kind === 'blur') { props.onSelectBlur?.(id); props.onContextMenu({ kind, id }, clientX, clientY) }
      else if (kind === 'effect') { props.onSelectEffect?.(id); props.onContextMenu({ kind, id }, clientX, clientY) }
      return
    }
    const content = contentRef.current
    if (!content) return
    const rect = content.getBoundingClientRect()
    const atUs = Math.max(0, Math.min(durationUs, Math.round(pixelToTime(clientX - rect.left, durationUs, rect.width))))
    const trackId = target.closest<HTMLElement>('[data-track-id]')?.dataset.trackId ?? null
    props.onContextMenu({ kind: 'empty', trackId, atUs, captionLane: target.closest('[data-caption-track-id]') !== null }, clientX, clientY)
  }
  const onContentContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => openContextMenu(event, event.clientX, event.clientY)
  const longPressTimerRef = useRef<number | null>(null)
  const onContentTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    const clientX = touch.clientX
    const clientY = touch.clientY
    const target = event.target as HTMLElement
    longPressTimerRef.current = window.setTimeout(() => {
      openContextMenu({
        preventDefault: () => {},
        target,
        altKey: false,
      } as unknown as ReactMouseEvent<HTMLElement>, clientX, clientY)
    }, 450)
  }
  const onContentTouchMove = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }
  const onContentTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }
  const onContentKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    const box = (event.target as HTMLElement).getBoundingClientRect()
    event.stopPropagation()
    openContextMenu(event, box.left + Math.min(box.width, 24), box.bottom)
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

  // Enter selects; Space is deliberately left alone so it reaches the global play/pause shortcut
  // even while a cue or clip is focused/selected.
  const selectCueFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>, cue: Cue, span: CaptionSpan) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    onSeek(spanSequenceUs(span, Math.max(cue.startUs, span.sourceStartUs)), cue.id)
  }
  const selectClipFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>, clip: Clip) => {
    if (event.key !== 'Enter') return
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
    const widthUs = content.kind === 'asset' ? (content.payload.kind === 'image' ? DEFAULT_IMAGE_CLIP_US : content.payload.durationUs ?? 0)
      : content.kind === 'preset' ? DEFAULT_ZOOM_REGION_US : content.kind === 'background' ? DEFAULT_BACKGROUND_CLIP_US : content.kind === 'color' ? DEFAULT_ADJUSTMENT_CLIP_US : 0
    setDropIndicator({ leftUs: timeUs, widthUs })
  }
  const onContentDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const content = dropContent(event.dataTransfer)
    setDropIndicator(null)
    if (!content) return
    event.preventDefault()
    const { timeUs, trackId } = dropTarget(event)
    if (content.kind === 'asset') props.onDropAsset?.(content.payload, timeUs, trackId)
    else if (content.kind === 'preset') props.onDropPreset?.(content.payload, timeUs)
    else if (content.kind === 'background') props.onDropBackground?.(content.payload, timeUs, trackId)
    else if (content.kind === 'color') props.onDropColor?.(content.payload, timeUs, trackId)
    else if (content.files.length) props.onDropFiles?.(content.files, timeUs, trackId)
  }

  const pct = (us: number) => timeToPixel(us, durationUs, 100)
  const contentWidthPx = viewport.widthPx * zoom
  const visibleFrom = pixelToTime(viewport.scrollLeft, durationUs, contentWidthPx)
  const visibleTo = pixelToTime(viewport.scrollLeft + viewport.widthPx, durationUs, contentWidthPx)
  const clipLabel = (clip: Clip) => clip.kind === 'color' ? colorClipLabel(clip) : clip.kind === 'adjustment' ? 'Adjustment layer' : assetById.get(clip.assetId)?.name ?? 'Missing file'

  return <section className={`timeline-panel ${expanded ? 'expanded' : ''}`} aria-label="Timeline">
    <TimelineToolbar
      mode={display} onMode={props.onDisplay}
      snap={snap} onSnap={setSnap}
      zoom={zoom} zoomMin={ZOOM_MIN} zoomMax={ZOOM_MAX} onZoom={(next) => updateZoom(next)}
      expanded={expanded} onExpand={setExpanded}
      onCenterPlayhead={() => scrollPlayheadTo(.5, 'smooth')}
      actions={actions} edit={props.edit} canMerge={props.canMerge} canAdd={props.canAdd} hasCues={cues.length > 0}
      editMode={props.editMode} onEditMode={props.onEditMode} clipTools={props.clipTools}
    />
    {/* --ruler-h is inherited by .gridlines and .snap-guide, which hang from below the ruler row. */}
    <div className="timeline-body" ref={bodyRef} style={{ '--ruler-h': `${RULER_HEIGHT_PX}px` } as CSSProperties}>
      <TimelineTrackHeaders rows={rows} style={gridStyle} currentUs={currentUs} durationUs={durationUs} clipCounts={clipCounts} captionCueCounts={captionCueCounts}
        actions={props.trackActions} captionTrackActions={props.captionTrackActions}
        onAddText={props.onAddText}
        dividerActive={dividerDrag !== null} dividerValue={mediaHeightPx ? Math.round(videoStackPx / mediaHeightPx * 100) : 50}
        onDividerPointerDown={beginDividerDrag} onDividerPointerMove={moveDivider} onDividerPointerUp={endDividerDrag} onDividerKeyDown={nudgeDivider} />
      <div className="timeline-viewport" ref={viewportRef} onScroll={(event) => { const left = event.currentTarget.scrollLeft; setViewport((state) => state.scrollLeft === left ? state : { ...state, scrollLeft: left }) }}>
        <div className="timeline-content" ref={contentRef} style={{ ...gridStyle, width: `${zoom * 100}%` }}
          onContextMenu={onContentContextMenu} onKeyDown={onContentKeyDown}
          onTouchStart={onContentTouchStart} onTouchMove={onContentTouchMove} onTouchEnd={onContentTouchEnd} onTouchCancel={onContentTouchEnd}
          onDragOver={onContentDragOver} onDragLeave={() => setDropIndicator(null)} onDrop={onContentDrop}>
          {rows.map((row, rowIndex) => {
            if (row.kind === 'ruler') return <TimelineRuler key="ruler" ticks={ticks} durationUs={durationUs} onPointerDown={beginScrub} onPointerMove={scrub} onPointerUp={endScrub}
              markers={markers} selectedMarkerId={selection?.kind === 'marker' ? selection.id : null}
              onSelectMarker={(markerId, atUs) => { onSeek(atUs); props.onSelectMarker?.(markerId) }} />
            if (row.kind === 'captionTrack') {
              const onTrack = displayCues.filter((cue) => cue.captionTrackId === row.track.id)
              return <CaptionsTrack key={row.id} cues={onTrack} spansOf={spansOf} durationUs={durationUs} mode={display} locked={row.track.locked} trackId={row.track.id}
                selectedCueId={selectedCueId} warningCueIds={warningCueIds} draggingId={drag?.kind === 'cue' ? drag.cue.id : null} selectedWordId={props.selectedWordId}
                onBeginDrag={beginCueDrag} onKeyboardSelect={selectCueFromKeyboard}
                onSeekSource={(cue, sourceUs, span) => onSeek(spanSequenceUs(span, Math.max(sourceUs, span.sourceStartUs)), cue.id)}
                onSelectWord={props.onSelectWord} onSeekTrack={seekTrack} />
            }
            if (row.kind === 'zoomLane') return <ZoomLane key="zoomLane" regions={displayZoomRegions} durationUs={durationUs}
              selectedZoomId={selectedZoomId} draggingId={drag?.kind === 'zoom' ? drag.region.id : null}
              onBeginDrag={beginZoomDrag} onKeyboardSelect={(event, region) => {
                if (event.key !== 'Enter') return
                event.preventDefault(); event.stopPropagation(); props.onSelectZoom?.(region.id); onSeek(region.startUs)
              }} onSeekTrack={seekTrack} />
            if (row.kind === 'blurLane') return <BlurLane key="blurLane" regions={displayBlurRegions} durationUs={durationUs}
              selectedBlurId={selectedBlurId} draggingId={drag?.kind === 'blur' ? drag.region.id : null}
              onBeginDrag={beginBlurDrag} onKeyboardSelect={(event, region) => {
                if (event.key !== 'Enter') return
                event.preventDefault(); event.stopPropagation(); props.onSelectBlur?.(region.id); onSeek(region.startUs)
              }} onSeekTrack={seekTrack} />
            if (row.kind === 'effectLane') return <EffectLane key={row.id} effectKind={row.effectKind}
              regions={displayEffects.filter((effect) => effect.kind === row.effectKind)} durationUs={durationUs}
              selectedId={selectedEffectId} draggingId={drag?.kind === 'effect' ? drag.region.id : null}
              onBeginDrag={beginEffectDrag} onKeyboardSelect={(event, region) => {
                if (event.key !== 'Enter') return
                event.preventDefault(); event.stopPropagation(); props.onSelectEffect?.(region.id); onSeek(region.startUs)
              }} onSeekTrack={seekTrack} />
            if (row.kind === 'textLane') return <TextLane key="textLane" items={textOverlays} durationUs={durationUs} selectedId={selectedTextId} selectedGroupId={selectedGroupId} pendingIds={props.pendingGroupIds} groupNames={groupNames}
              onSelect={(id) => { props.onSelectText?.(id); const item = textOverlays.find((entry) => entry.id === id); if (item) onSeek(item.startUs) }}
              onMove={(id, startUs) => props.onTextMove?.(id, startUs)} onTrim={(id, edge, deltaUs) => props.onTextTrim?.(id, edge, deltaUs)} onSeekTrack={seekTrack} />
            if (row.kind === 'shapeLane') return <ShapeLane key="shapeLane" items={shapes} durationUs={durationUs} selectedId={selectedShapeId} selectedGroupId={selectedGroupId} pendingIds={props.pendingGroupIds} groupNames={groupNames}
              onSelect={(id) => { props.onSelectShape?.(id); const item = shapes.find((entry) => entry.id === id); if (item) onSeek(item.startUs) }}
              onMove={(id, startUs) => props.onShapeMove?.(id, startUs)} onTrim={(id, edge, deltaUs) => props.onShapeTrim?.(id, edge, deltaUs)} onSeekTrack={seekTrack} />
            if (row.kind === 'divider') return <div key="divider" className="track-divider-line" aria-hidden="true" />
            const { track } = row
            const onTrack = displayClips.filter((clip) => clip.trackId === track.id)
            return <div key={track.id} className={`track ${track.kind} ${track.hidden ? 'is-hidden' : ''} ${track.muted ? 'is-muted' : ''}`}
              data-track-id={track.id} onPointerDown={seekTrack} role="group" aria-label={`${row.label} track`}>
              <span className="track-overlay-label" aria-hidden="true">{row.label}</span>
              {!track.locked && gapsOnTrack(clips, track.id).map((gap) => <span key={gap.startUs} className="gap-zone"
                style={{ left: `${pct(gap.startUs)}%`, width: `${pct(gap.endUs - gap.startUs)}%` }}>
                <button type="button" className="close-gap" title={`Close this ${formatClock(gap.endUs - gap.startUs)} gap`}
                  onPointerDown={(event) => event.stopPropagation()} onClick={() => props.onCloseGap(track.id, gap.startUs)}>Close gap</button>
              </span>)}
              {onTrack.map((clip) => {
                const asset = clip.kind === 'color' || clip.kind === 'adjustment' ? null : assetById.get(clip.assetId) ?? null
                const widthPx = timeToPixel(clipLengthUs(clip), durationUs, contentWidthPx)
                const visible = clip.timelineStartUs < visibleTo && clipEndUs(clip) > visibleFrom
                const dragging = (drag?.kind === 'clip' && drag.clip.id === clip.id) || false
                const label = clipLabel(clip)
                return <ClipBlock key={clip.id} clip={clip} label={label} leftPct={pct(clip.timelineStartUs)} widthPct={pct(clipLengthUs(clip))}
                  title={`${clip.kind === 'image' ? 'Image' : clip.kind === 'audio' ? 'Audio' : clip.kind === 'color' ? 'Background' : clip.kind === 'adjustment' ? 'Adjustment layer' : 'Video'} ${label}, ${formatClock(clip.timelineStartUs)} to ${formatClock(clipEndUs(clip))}${track.locked ? ' (track locked)' : ''}`}
                  selected={clip.id === selectedClipId} dragging={dragging} locked={track.locked}
                  linked={Boolean(linkIdOf(clip)) && linkPartners(clips, clip).length > 0} linkedSelected={selectedPartnerIds.has(clip.id)}
                  onBeginDrag={(event, mode) => beginClipDrag(event, clip, mode)} onKeyDown={(event) => selectClipFromKeyboard(event, clip)}>
                  {clip.kind === 'color' && <span className={`clip-swatch ${isAnimated(clip) ? 'animated' : ''}`} style={{ background: swatchCss(clip) }} />}
                  {clip.kind === 'adjustment' && <span className="clip-swatch clip-adjustment-swatch" />}
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
          {props.range && <div className="range-layer" aria-hidden="true">
            <i className="range-shade" style={{ left: 0, width: `${pct(props.range.startUs)}%` }} />
            <i className="range-shade" style={{ left: `${pct(props.range.endUs)}%`, right: 0 }} />
            <i className="range-band" style={{ left: `${pct(props.range.startUs)}%`, width: `${pct(props.range.endUs) - pct(props.range.startUs)}%` }} />
          </div>}
          {programUs < durationUs && <i className="timeline-tail" style={{ left: `${pct(programUs)}%` }} aria-hidden="true" />}
          <i className="playhead" style={{ left: `${pct(Math.min(currentUs, durationUs))}%`, top: 0 }} aria-hidden="true" />
        </div>
      </div>
    </div>
  </section>
}
