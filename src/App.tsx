import { TimingProvenance } from './TimingProvenance'
import { ExportDialog } from './ExportDialog'
import { SequenceSettingsDialog } from './SequenceSettingsDialog'
import { formatFromMedia } from './core/format'
import { DEFAULT_EXPORT_SETTINGS, resolveExportFormat, type ExportSettings } from './export/settings'
import { recordExportSpeed } from './export/exportHistory'
import { createProgressRate, describeExport, type ExportRateView } from './export/progressRate'
import { untimedTokenCount } from './core/wordTiming'
import { parseEditedTimestamp } from './core/time'
import { diagnosticSummary } from './core/exportDiagnostic'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { validateCaptions, type ValidationIssue } from './core/captionCommands'
import { applyTranslatedLayers, cuesForLanguage, displayedCues, projectLanguages, shownLanguage, type TranslatedLayerResult } from './core/captionLanguages'
import type { TranslationFailure } from './TranslateCaptions'
import type { TranslationTarget } from './core/transcription'
import { applyEditCommand, type CommandContext, type EditCommand } from './core/commands'
import { validateItems } from './core/itemCommands'
import { summarizeCue, summarizeProject, type AgentRequest, type CommandOutcome, type ProjectSummary } from './core/agentProtocol'
import { waitForFramePaint } from './agent/framePaint'
import { NEUTRAL_GRADE } from './color/bake'
import { loadReferencePixels } from './color/referenceImage'
import { writeCube } from './color/cube'
import { bakeMatch, deriveMatch } from './color/referenceMatch'
import { useAgentBridge, type AgentBridgeHandlers } from './agent/useAgentBridge'
import {
  activeClipsAt, activeCueAt, captionClips, clipEndUs, clipLengthUs, cuesInSequence, firstSequenceUsOf, sequenceDurationUs, sourceUsAt, sourceUsOfAssetAt,
  spansInSequence, trackLabel, videoUnderPlayhead, type ActiveClip,
} from './core/timelineModel'
import type { Selection } from './core/timelineItems'
import { formatAspect } from './core/format'
import { compositionFor } from './core/composition'
import { commitHistory, createHistory, redoHistory, undoHistory } from './core/history'
import { createProject, projectSchema, PROJECT_FILE_EXTENSION, type CaptionProject, type CaptionWord, type Cue, type MigrationNote } from './core/model'
import type { JobSnapshot, JobStructuredError } from './core/jobs'
import { parseSrt, serializeSrt } from './core/srt'
import { isValidRange, projectInRange, type SequenceRange } from './core/sequenceRange'
import { formatClock, formatTimestamp, US_PER_SECOND } from './core/time'
import { isEditableTarget, shortcutForEvent, type ShortcutAction } from './core/shortcuts'
import { timelineViewSpanUs, type CueDragMode } from './core/timeline'
import type { EditTools } from './TimelineToolbar'
import type { PlaybackClock } from './core/playbackClock'
import { MenuButton, type MenuEntry } from './MenuButton'
import { SettingsDialog, type SettingsTab } from './SettingsDialog'
import type { McpStatus } from '../electron/mcp/config'
import { ResolveStatusPill } from './resolve/ResolveStatusPill'
import { ResolveSyncControl } from './resolve/ResolveSync'
import { useResolveStatus } from './resolve/useResolveStatus'
import type { ResolveProxyResult } from './core/resolveIpc'
import { SilenceRemovalDialog } from './SilenceRemovalDialog'
import type { SilenceDetectionOptions } from './core/silenceRemoval'
import { loadTranscriptionDefaults, saveTranscriptionDefaults } from './core/transcriptionDefaults'
import { providerLabel, type ProviderKeyStatuses, type TranscriptionDefaults } from './core/transcriptionProviders'
import type { MenuCommand } from './core/menuCommands'
import { describeJob, type ApplyTranscript, type TranscribeContext, type TranscribeOpenRequest } from './TranscriptionPanel'
import { captionGapAt, formatRangeTime, sourceRangeForSequenceRange, sourceUsForAssetAt, type SourceRange } from './core/transcriptionRange'
import { applyTranscription, rebuildableRun, rebuildOriginalCues } from './core/transcriptionApply'
import { translationTargetLabel } from './core/translationLanguages'
import { Timeline, type TimelineMenuTarget } from './Timeline'
import { ContextMenu } from './ContextMenu'
import type { MediaCandidate } from '../electron/projectMedia'
import type { MediaMetadata, ProjectMedia } from './core/media'
import { assetUsers, bindUnboundItems, clipCountByAsset, hasTrimmedClips, primaryVideoAsset, videoAssets } from './core/projectClips'
import { TIMELINE_WAVEFORM_PEAKS, type WaveformData } from './core/waveform'
import { containerPlaybackHint, describeMediaError, describePlayFailure } from './core/codecSupport'
import { CaptionPreview } from './captions/CaptionPreview'
import { BLEND_BACKDROP_STYLE, CompositionLayers, glowFilterStyle, hasBlendedLayer, pinnedEffectLayers, type CompositionLayer } from './captions/CompositionLayers'
import type { Cube3D } from './color/cube'
import { ClipInspector } from './ClipInspector'
import { ClipStageEditor } from './ClipStageEditor'
import { BubbleTailHandle } from './BubbleTailHandle'
import { RectStageEditor } from './RectStageEditor'
import { LineStageEditor } from './LineStageEditor'
import { MaskStageEditor } from './MaskStageEditor'
import { LayersPanel } from './LayersPanel'
import { GroupInspector } from './GroupInspector'
import { applyGroupCommand, groupMembers, groupSpan, type GroupCommand, type GroupMember } from './core/groupCommands'
import { glassBounds } from './core/glassMap'
import { defaultMaskBounds, itemStartUs, layerStackAt, type LayerRow } from './core/layerStack'
import { defaultMask, drawnMask } from './core/layerMask'
import type { MaskTarget } from './core/maskCommands'
import { assetIdOf, gradeSchema, type LayerMask, type MaskPathPoint, type MaskShape } from './core/edit'
import { paintAt } from './core/fill'
import { CaptionStageEditor, type CaptionPlacementPatch } from './CaptionStageEditor'
import { defaultOverlayRect } from './core/overlayDefaults'
import type { AdjustmentClip, BlendMode, BackgroundMotion, BlurRegion, CaptionTrack, Clip, ClipFit, ClipSpeed, CompositionRect, EffectRegion, Fill, Grade, ProjectAsset, Shape, TextOverlay, Track, VisualClip, ZoomRegion } from './core/edit'
import { linkIdOf, linkPartners } from './core/clipLinks'
import { adjustmentTrackAbove, backgroundTrackFor, clipAt, freeTrackFor, gapsOnTrack, topAdjustmentTrackFor, trackEndUs, type ClipEdge, type EditMode } from './core/clipEdits'
import { gradeStackFor } from './core/gradeStack'
import { imagesHostPainted } from './core/hostPainted'
import { bakedGradeStack } from './color/previewGrade'
import { useLutAssets } from './app/useLutAssets'
import { ColorPanel } from './ColorPanel'
import { captureFrame, useColorFrame } from './app/useColorFrame'
import type { TrackFlags } from './core/trackCommands'
import type { CaptionTrackFlags } from './core/captionTrackCommands'
import { wordMotionAvailability, type CaptionFrame, type Size } from './captions/renderer'
import { activeWordIndex, wordDisplayCue, type CaptionDisplay } from './captions/wordDisplay'
import { applyCaptionPreset, deleteCaptionPreset, saveCaptionPreset } from './captions/presets'
import { applyCaptionTemplateToText, captionStyleInputs, DEFAULT_CAPTION_STYLE, resolveCaptionStyle, type CaptionStyle } from './captions/style'
import { titleTemplateChanges, type CaptionTemplate } from './captions/templates'
import { StylePanel } from './StylePanel'
import { RangeInput, TimeFields } from './style/controls'
import { SettingsIcon } from './RailIcons'
import { WordEmphasisPanel } from './WordEmphasisPanel'
import { InspectorTabs, type InspectorTab } from './InspectorTabs'
import { AlignmentControls } from './AlignmentControls'
import { applyAlignment } from './core/alignment'
import { LeftRail, type RailTab } from './LeftRail'
import { MediaBin } from './MediaBin'
import { CaptionsPanel, VideoPicker } from './CaptionsPanel'
import { wordActionCommand, type TranscriptSpan } from './transcript'
import { OverlaysPanel } from './OverlaysPanel'
import { TitlesPanel } from './TitlesPanel'
import { EffectsPanel } from './EffectsPanel'
import { dropContent } from './core/dragPayload'
import type { AssetDragPayload } from './core/dragPayload'
import { DEFAULT_ADJUSTMENT_CLIP_US, DEFAULT_BACKGROUND_CLIP_US, DEFAULT_IMAGE_CLIP_US, dropPlanForAsset } from './core/timelineDrop'
import { findAssetByFingerprint, type InspectedFile } from './core/assetImport'
import { useAssetUrls } from './app/useAssetUrls'
import { usePlaybackProxies } from './app/usePlaybackProxies'
import type { PlaybackProxyOverride, PlaybackProxyStatus } from './core/proxy'
import { useProjectPlayback } from './app/useProjectPlayback'
import { createThumbnailQueue } from './timeline/thumbnailQueue'
import { HomeScreen } from './home/HomeScreen'
import { HomeIcon } from './home/HomeIcons'
import { DEFAULT_PAN_REGION_US, DEFAULT_ZOOM_REGION_US, defaultPanRects, defaultZoomRect, zoomRectAt } from './core/zoomRegion'
import { applyZoomChanges, type ZoomRegionChanges } from './core/zoomRegionCommands'
import { ZoomInspector } from './ZoomInspector'
import { defaultBlurAreaRect, defaultBlurFrameRect, DEFAULT_BLUR_RADIUS, DEFAULT_BLUR_REGION_US, MIN_BLUR_REGION_US } from './core/blurRegion'
import { BlurInspector } from './BlurInspector'
import { defaultVignette, defaultLetterbox, defaultFade, defaultFlash, defaultGrain, defaultVhs, defaultParticles, defaultGlow, type EffectChanges } from './core/effectCommands'
import { frameEffectsAt, pictureEffectsAt } from './core/frameEffects'
import { compositionScale } from './core/composition'
import { EffectInspector } from './EffectInspector'
import { TextInspector } from './TextInspector'
import { TextOverlayActor } from './captions/TextOverlayActor'
import { ShapeActor } from './captions/ShapeActor'
import { fitShapesToTitle, measureTitleBlock } from './captions/fitMeasure'
import { getTemplate } from './core/overlayTemplateCatalog'
import { isFittableGeometry } from './core/fitToText'
import { ShapeInspector } from './ShapeInspector'
import { defaultShape, type ShapePreset } from './core/shapeCommands'
import { belowCaptions, compareLayered } from './core/graphicsOrder'
import { defaultTextOverlay } from './core/textCommands'
import { textAnchorAt, type TextAnchor } from './core/textPlacement'
import { TextStageInput } from './TextStageInput'
import brandIcon from './assets/brand/icon-dark.png'

type Notice = { tone: 'info' | 'error' | 'warning'; text: string; action?: { label: string; run(): void } } | null
type SaveStatus = { kind: 'saved'; at: number } | { kind: 'saving' } | { kind: 'error'; message: string }
/** Changes settle for this long before a named project is rewritten; a window blur flushes sooner. */
const AUTOSAVE_DELAY_MS = 1000
type ProxyState =
  | { kind: 'idle' }
  | { kind: 'checking-support' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'ready' }
  | { kind: 'creating'; requestId: string; percent: number | null }
  | { kind: 'done'; path: string }
  | { kind: 'error'; message: string }
type ExportState =
  | { kind: 'idle' }
  | { kind: 'checking-support' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'ready' }
  | { kind: 'running'; requestId: string; job: JobSnapshot | null }
  | { kind: 'error'; message: string }
/** What the embedded player made of one video file, per asset id. */
type CodecIssue = { kind: 'likely-unsupported' } | { kind: 'confirmed-unsupported'; message: string }

const initial = createProject()
const EDIT_MODE_STORAGE_KEY = 'caption-studio.edit-mode'
function storedEditMode(): EditMode {
  try { return localStorage.getItem(EDIT_MODE_STORAGE_KEY) === 'ripple' ? 'ripple' : 'overwrite' } catch { return 'overwrite' }
}
/** A project with nothing on its timeline still shows a minute of ruler, like an empty editor. */
const EMPTY_TIMELINE_US = 60 * US_PER_SECOND
const newTrack = (kind: Track['kind']): Track => ({ id: crypto.randomUUID(), kind, name: '', muted: false, hidden: false, locked: false })
const newCaptionTrack = (): CaptionTrack => ({ id: crypto.randomUUID(), name: '', locked: false })

export default function App() {
  const [history, setHistory] = useState(() => createHistory(initial))
  // Set by Save As / Open. Once known, every history change autosaves there (see the effect below `saveProjectAs`).
  const [projectPath, setProjectPath] = useState<string | null>(null)
  // A schema-migrated project is never rewritten silently: autosave waits for an explicit Save so the original file survives.
  const [migrationPending, setMigrationPending] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null)
  const lastSavedProject = useRef<CaptionProject | null>(null)
  // Writes to one file are serialized so a slow earlier write can never land after a newer one.
  const writeQueue = useRef(Promise.resolve())
  const project = history.present
  const media = useAssetUrls()
  const lut = useLutAssets()
  const [codecIssues, setCodecIssues] = useState<Map<string, CodecIssue>>(new Map())
  const undecodableAssetIds = useMemo(() => new Set(codecIssues.keys()), [codecIssues])
  const playbackProxies = usePlaybackProxies(project.assets, media.urlOf, undecodableAssetIds)
  const primary = useMemo(() => primaryVideoAsset(project), [project.assets, project.clips])
  const assetById = useMemo(() => new Map(project.assets.map((asset) => [asset.id, asset])), [project.assets])
  const lutAssetsList = useMemo(() => project.assets.filter((asset) => asset.kind === 'lut'), [project.assets])
  const [pendingAssetRelink, setPendingAssetRelink] = useState<{ asset: ProjectAsset; candidate: MediaCandidate } | null>(null)
  // New Project / Open Project discard the current project outright; this holds which one is
  // pending confirmation while unsaved work exists (see `hasUnsavedWork` and `DiscardProjectReview`).
  const [pendingReset, setPendingReset] = useState<{ kind: 'new' | 'open' | 'home' } | null>(null)
  // The start page shows until a project is created or opened; the editor state underneath is a blank project meanwhile.
  const [view, setView] = useState<'home' | 'editor'>('home')
  const viewRef = useRef(view)
  viewRef.current = view
  // DaVinci Resolve bridge connection (docs/plans/resolve-textplus/04-project-from-timeline.md):
  // drives the Home "Create project from current timeline" button, the render-progress modal and
  // the editor's linked banner.
  const resolveStatus = useResolveStatus()
  const [resolveRender, setResolveRender] = useState<{ requestId: string; timelineName: string; percent: number } | null>(null)
  const resolveRenderRef = useRef(resolveRender)
  resolveRenderRef.current = resolveRender
  // The linked banner's mismatch warning needs Resolve's *live* current timeline id, which `status.json`
  // doesn't carry (only its name); re-read it whenever the connection or the live project/timeline name changes.
  const [resolveLiveTimelineId, setResolveLiveTimelineId] = useState<string | null>(null)
  const resolveConnectedKey = resolveStatus.state === 'connected' ? `${resolveStatus.projectName ?? ''}\u0000${resolveStatus.timelineName ?? ''}` : null
  useEffect(() => {
    if (resolveConnectedKey === null || !project.resolveLink || !window.captionStudio) { setResolveLiveTimelineId(null); return }
    let cancelled = false
    window.captionStudio.resolveTimelineInfo().then((info) => { if (!cancelled) setResolveLiveTimelineId(info.timelineId) }).catch(() => { if (!cancelled) setResolveLiveTimelineId(null) })
    return () => { cancelled = true }
  }, [resolveConnectedKey, project.resolveLink])
  // One draft clip substituted into the visible list, for the inspector's and the stage editor's
  // live rect/opacity/gain drafts — exactly `dragPreview`'s role for captions.
  const [clipDraft, setClipDraft] = useState<Clip | null>(null)
  // Target framing, ease and zoom amount are all previewed live (stage gesture or inspector
  // slider) and committed once as a `zoom-region-update` on release/blur.
  const [zoomRegionDraft, setZoomRegionDraft] = useState<{ id: string; changes: ZoomRegionChanges } | null>(null)
  // Which framing of a pan region the stage gizmo and the inspector's amount slider edit.
  const [panFraming, setPanFraming] = useState<'start' | 'end'>('end')
  // Same shape as `zoomRegionDraft`, for the blur area/radius stage gesture and inspector slider.
  const [blurRegionDraft, setBlurRegionDraft] = useState<{ id: string; changes: Partial<Omit<BlurRegion, 'id'>> } | null>(null)
  // Same shape again, for a frame-paint effect's inspector sliders.
  const [effectDraft, setEffectDraft] = useState<{ id: string; changes: EffectChanges } | null>(null)
  // Layer masks (docs/EDITING.md "Layer masks"): a mask being slid or dragged previews live without touching history.
  const [maskDraft, setMaskDraft] = useState<{ key: string; target: MaskTarget; mask: LayerMask } | null>(null)
  // Layer opacity (docs/EDITING.md "Layer opacity and blend"): a slider drag previews live, then commits once.
  const [lookDraft, setLookDraft] = useState<{ key: string; target: MaskTarget; opacity: number } | null>(null)
  const [layerFocus, setLayerFocus] = useState<string | null>(null)
  const [maskEdit, setMaskEdit] = useState<{ key: string; drawing: boolean } | null>(null)
  // An Alt+drag clone on the stage, previewed on a transient track above everything until it commits.
  const [cloneDraft, setCloneDraft] = useState<VisualClip | null>(null)
  const [waveforms, setWaveforms] = useState<Map<string, WaveformData>>(new Map())
  const [waveformsLoading, setWaveformsLoading] = useState(0)
  // One selection for every kind of timeline item (one ID namespace). `selectedCueId` keeps every
  // caption read site unchanged.
  const [selection, setSelection] = useState<Selection | null>(null)
  // Shapes and titles picked with Ctrl/Shift-click, waiting for Ctrl+G. Only meaningful while the
  // selection is one of them (`pendingItems` below), so any other selection change discards it.
  const [pendingGroup, setPendingGroup] = useState<{ kind: 'shape' | 'text'; id: string }[]>([])
  // Modifier keys as they were at the last pointer press, so the stage, timeline and Layers tab can
  // tell a plain click from Ctrl/Shift-click (add to pending) and Alt-click (select one part).
  const modifiersRef = useRef({ multi: false, alt: false })
  useEffect(() => {
    const record = (event: PointerEvent) => { modifiersRef.current = { multi: event.ctrlKey || event.metaKey || event.shiftKey, alt: event.altKey } }
    window.addEventListener('pointerdown', record, true)
    return () => window.removeEventListener('pointerdown', record, true)
  }, [])
  // Ctrl/Cmd+C snapshots which item to clone by reference; Ctrl/Cmd+V re-resolves it against the
  // live project so a paste after further edits (or the original's deletion) fails cleanly.
  const [clipboardItem, setClipboardItem] = useState<{ kind: 'cue' | 'clip' | 'text' | 'zoomRegion'; id: string } | null>(null)
  const [editingText, setEditingText] = useState<{ id: string; selectAll: boolean } | null>(null)
  const selectedCueId = selection?.kind === 'cue' ? selection.id : null
  const setSelectedId = (id: string | null) => setSelection(id === null ? null : { kind: 'cue', id })
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<Cue | null>(null)
  const [focusCueId, setFocusCueId] = useState<string | null | undefined>(undefined)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: TimelineMenuTarget } | null>(null)
  const [notice, setNotice] = useState<Notice>({ tone: 'info', text: 'Open a video to transcribe it, or import an SRT file.' })
  const [proxyState, setProxyState] = useState<ProxyState>({ kind: 'idle' })
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' })
  const addCueButtonRef = useRef<HTMLButtonElement>(null)
  // View-only preview zoom (Ctrl/⌘ + wheel): a CSS transform on the frame, never project state or export.
  const [stageView, setStageView] = useState({ scale: 1, x: 0, y: 0 })
  const videoStageRef = useRef<HTMLDivElement>(null)
  const videoFrameRef = useRef<HTMLDivElement>(null)
  // Native listener: React's onWheel is passive, so it cannot suppress the page-level zoom.
  useEffect(() => {
    const stage = videoStageRef.current
    if (!stage) return
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      const frame = videoFrameRef.current
      if (!frame) return
      setStageView((view) => {
        const scale = Math.min(8, Math.max(1, view.scale * Math.exp(-event.deltaY * .01)))
        if (scale === 1) return { scale: 1, x: 0, y: 0 }
        const rect = frame.getBoundingClientRect()
        // The frame scales about its own centre, whose untransformed position is the rect centre less the translation.
        const px = event.clientX - (rect.left + rect.width / 2 - view.x)
        const py = event.clientY - (rect.top + rect.height / 2 - view.y)
        const ratio = scale / view.scale
        return { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio }
      })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
    // The stage only mounts outside the home view, so re-attach whenever the view changes.
  }, [view])
  const cueButtonRefs = useRef(new Map<string, HTMLElement>())
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('edit')
  // The left rail's active panel. `initial` (module scope) never has media, so 'media' is always
  // the correct default at first mount, matching a fresh project with nothing to caption yet.
  const [railTab, setRailTab] = useState<RailTab>('media')
  const [pendingSrt, setPendingSrt] = useState<{ name: string; parsed: ReturnType<typeof parseSrt> } | null>(null)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  const [silenceDialogOpen, setSilenceDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [sequenceSettingsOpen, setSequenceSettingsOpen] = useState(false)
  const [providerKeys, setProviderKeys] = useState<ProviderKeyStatuses | null>(null)
  const geminiKey = providerKeys?.gemini ?? null
  const [transcriptionDefaults, setTranscriptionDefaultsState] = useState<TranscriptionDefaults>(loadTranscriptionDefaults)
  const setTranscriptionDefaults = (value: TranscriptionDefaults) => { setTranscriptionDefaultsState(value); saveTranscriptionDefaults(value) }
  const [editMode, setEditModeState] = useState<EditMode>(storedEditMode)
  const setEditMode = (mode: EditMode) => { setEditModeState(mode); try { localStorage.setItem(EDIT_MODE_STORAGE_KEY, mode) } catch { /* a convenience only */ } }
  // The video transcription, alignment and silence removal work on: `null` follows the playhead.
  const [pickedVideoId, setPickedVideoId] = useState<string | null>(null)
  const [transcribeRequest, setTranscribeRequest] = useState<TranscribeOpenRequest | null>(null)
  useEffect(() => {
    const none = { configured: false, source: 'keychain' as const }
    void window.captionStudio?.providerKeyStatuses().then(setProviderKeys).catch(() => setProviderKeys({ gemini: none, openai: none, elevenlabs: none }))
  }, [])
  // Local agent control (docs/MCP.md): the top bar's "Agent connected" chip, driven live so a
  // client connecting or disconnecting shows up without reopening Settings.
  const [agentStatus, setAgentStatusState] = useState<McpStatus | null>(null)
  useEffect(() => {
    void window.captionStudio?.agentStatus().then(setAgentStatusState).catch(() => {})
    return window.captionStudio?.onAgentStatus(setAgentStatusState)
  }, [])

  // Sequence time: the output timeline the ruler, playhead, transport and scrubber all speak.
  const clipsDurationUs = sequenceDurationUs(project.clips)
  const hasVideo = project.clips.some((clip) => clip.kind === 'video')
  // A project with no clips (SRT first) times its captions in sequence time directly.
  const durationUs = clipsDurationUs || (hasVideo ? 0 : Math.max(EMPTY_TIMELINE_US, ...project.cues.map((cue) => cue.endUs)))
  const playback = useProjectPlayback(project, durationUs, playbackProxies.urlOf, {
    onPlayError: (error, element) => {
      // AbortError (play superseded by a pause/seek/load) is not an error; anything else is reported.
      const text = describePlayFailure(error, element.error)
      if (!text) return
      console.error('video.play() rejected', error, { mediaError: element.error, readyState: element.readyState })
      setNotice({ tone: 'error', text })
    },
    onMediaError: (assetId, element) => setCodecIssues((issues) => new Map(issues).set(assetId, { kind: 'confirmed-unsupported', message: describeMediaError(element.error) ?? (element.videoWidth === 0 && element.readyState >= 2 ? 'The embedded player can play this file’s audio but cannot decode its video (e.g. ProRes from an iPhone). Create a playable proxy.' : 'The embedded player could not play this media.') })),
    onMediaReady: (assetId) => setCodecIssues((issues) => { if (!issues.has(assetId)) return issues; const next = new Map(issues); next.delete(assetId); return next }),
    onSoundIssue: (message) => setNotice({ tone: 'warning', text: `A sound could not be decoded: ${message}` }),
  })
  const { clock, currentUs } = playback
  // The In/Out marks (I / O): view state for exporting part of the timeline. Not saved, not undoable.
  const [marks, setMarks] = useState<{ inUs: number | null; outUs: number | null }>({ inUs: null, outUs: null })
  useEffect(() => { setMarks({ inUs: null, outUs: null }) }, [project.id])
  const rangeCandidate = marks.inUs === null && marks.outUs === null ? null : { startUs: marks.inUs ?? 0, endUs: marks.outUs ?? durationUs }
  const activeRange: SequenceRange | null = rangeCandidate && isValidRange(rangeCandidate, durationUs) ? rangeCandidate : null
  useEffect(() => { clock.setStopAtUs(activeRange?.endUs ?? null) }, [clock, activeRange?.endUs])
  const thumbnailQueue = useMemo(() => window.captionStudio ? createThumbnailQueue(async (request) => {
    const result = await window.captionStudio!.loadThumbnails({ requestId: crypto.randomUUID(), ...request })
    return result.thumbnails
  }) : null, [])

  const projectRef = useRef(project)
  projectRef.current = project
  // Mirrors `projectRef`'s pattern for the same reason: the agent bridge (`useAgentBridge`) needs a
  // selection value it can read synchronously right after setting it, which `useState` alone cannot
  // give it within the same tick (a batched update is not visible until the next render).
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  // The output frame (`project.format`) fixes the caption composition, so captions never re-layout
  // when the playhead crosses into a video of a different aspect.
  const captionComposition = useMemo(() => compositionFor(formatAspect(project.format)), [project.format])
  // Only the language shown on video (`displayedCues`); every consumer of on-screen captions reads this list.
  const previewedCues = useMemo(() => dragPreview ? project.cues.map((cue) => cue.id === dragPreview.id ? dragPreview : cue) : project.cues, [project.cues, dragPreview])
  const visibleCues = useMemo(() => displayedCues(previewedCues, project.shownTranslation), [previewedCues, project.shownTranslation])
  const timelineCues = useMemo(() => displayedCues(project.cues, project.shownTranslation), [project.cues, project.shownTranslation])
  // The Captions panel's active language tab (`null` = original). It follows the language shown on video and the
  // language of a cue picked elsewhere; a tab whose language no longer exists falls back to the original.
  const [languageTab, setLanguageTab] = useState<TranslationTarget | null>(project.shownTranslation ?? null)
  const languages = useMemo(() => projectLanguages(project), [project.cues, project.transcriptionRuns])
  const captionLanguageTab = languageTab !== null && languages.translations.includes(languageTab) ? languageTab : null
  const panelCues = useMemo(() => cuesForLanguage(previewedCues, captionLanguageTab), [previewedCues, captionLanguageTab])
  useEffect(() => { setLanguageTab(project.shownTranslation ?? null) }, [project.shownTranslation])
  useEffect(() => {
    const cue = selectedCueId ? projectRef.current.cues.find((item) => item.id === selectedCueId) : undefined
    if (cue) setLanguageTab(cue.translationLanguage ?? null)
  }, [selectedCueId])
  const selected = previewedCues.find((cue) => cue.id === selectedCueId) ?? null
  const [shapeDraft, setShapeDraft] = useState<{ id: string; geometry: Shape['geometry'] } | null>(null)
  // A group drag or resize previews by applying the same command the release will commit.
  const [groupDraft, setGroupDraft] = useState<{ command: GroupCommand; rect: CompositionRect; base: CompositionRect } | null>(null)
  const groupBaseRef = useRef<CompositionRect | null>(null)
  const groupPreview = useMemo(() => {
    if (!groupDraft) return null
    const result = applyGroupCommand(project, groupDraft.command, captionComposition.height)
    return 'project' in result ? result.project : null
  }, [project, groupDraft, captionComposition.height])
  const previewShapes = groupPreview?.shapes ?? project.shapes
  const previewTexts = groupPreview?.textOverlays ?? project.textOverlays
  const visibleShapes = useMemo(() => shapeDraft ? previewShapes.map((item) => item.id === shapeDraft.id ? { ...item, geometry: shapeDraft.geometry } : item) : previewShapes, [previewShapes, shapeDraft])
  // Measured layout boxes of grouped titles, so the group's stage box can wrap them.
  const [textBounds, setTextBounds] = useState<Record<string, CompositionRect>>({})
  const captureTextBounds = (id: string, frame: CaptionFrame) => setTextBounds((current) => {
    if (frame.layout.status !== 'ready') return current
    const { x, y, width, height } = frame.layout.bounds, old = current[id]
    return old && old.x === x && old.y === y && old.width === width && old.height === height ? current : { ...current, [id]: { x, y, width, height } }
  })
  const selectedGroup = selection?.kind === 'group' ? (project.groups ?? []).find((group) => group.id === selection.id) ?? null : null
  const groupBox = useMemo((): CompositionRect | null => {
    if (!selectedGroup) return null
    const boxes: CompositionRect[] = []
    for (const member of groupMembers(project, selectedGroup.id)) {
      if (currentUs < member.item.startUs || currentUs >= member.item.endUs) continue
      if (member.kind === 'shape') boxes.push(glassBounds(member.item.geometry))
      else if (textBounds[member.item.id]) boxes.push(textBounds[member.item.id])
    }
    if (boxes.length === 0) return null
    const left = Math.min(...boxes.map((box) => box.x)), top = Math.min(...boxes.map((box) => box.y))
    const right = Math.max(...boxes.map((box) => box.x + box.width)), bottom = Math.max(...boxes.map((box) => box.y + box.height))
    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
  }, [selectedGroup, project, currentUs, textBounds])
  const selectedShape = selection?.kind === 'shape' ? visibleShapes.find((item) => item.id === selection.id) ?? null : null
  const stageShape = selectedShape && currentUs >= selectedShape.startUs && currentUs < selectedShape.endUs ? selectedShape : null
  const selectedText = selection?.kind === 'text' ? previewTexts.find((item) => item.id === selection.id) ?? null : null
  const visibleClips = useMemo(() => {
    let clips = clipDraft ? project.clips.map((clip) => clip.id === clipDraft.id ? clipDraft : clip) : project.clips
    if (cloneDraft) clips = [...clips, { ...cloneDraft, trackId: CLONE_TRACK.id }]
    return clips
  }, [project.clips, clipDraft, cloneDraft])
  const visibleTracks = useMemo(() => cloneDraft ? [...project.tracks, CLONE_TRACK] : project.tracks, [project.tracks, cloneDraft])
  const visibleZoomRegions = useMemo(() => zoomRegionDraft
    ? project.zoomRegions.map((region) => region.id === zoomRegionDraft.id ? applyZoomChanges(region, zoomRegionDraft.changes) : region)
    : project.zoomRegions, [project.zoomRegions, zoomRegionDraft])
  const visibleBlurRegions = useMemo(() => blurRegionDraft
    ? project.blurRegions.map((region) => region.id === blurRegionDraft.id ? { ...region, ...blurRegionDraft.changes } : region)
    : project.blurRegions, [project.blurRegions, blurRegionDraft])
  const visibleEffects = useMemo(() => effectDraft
    ? project.effects.map((effect) => effect.id === effectDraft.id ? { ...effect, ...effectDraft.changes } as EffectRegion : effect)
    : project.effects, [project.effects, effectDraft])
  const maskDrafted = <T extends { id: string; mask?: LayerMask }>(items: readonly T[], kind: MaskTarget['kind']): readonly T[] =>
    maskDraft && maskDraft.target.kind === kind ? items.map((item) => item.id === maskDraft.target.id ? { ...item, mask: maskDraft.mask } : item) : items
  const lookDrafted = <T extends { id: string; opacity?: number }>(items: readonly T[], kind: MaskTarget['kind']): readonly T[] =>
    lookDraft && lookDraft.target.kind === kind ? items.map((item) => item.id === lookDraft.target.id ? { ...item, opacity: lookDraft.opacity } : item) : items
  const stackRows = useMemo(() => railTab === 'layers' ? layerStackAt(project, currentUs) : [], [railTab, project, currentUs])
  const layerRows = maskDraft || lookDraft ? stackRows.map((row) => {
    let next = row
    if (maskDraft && row.key === maskDraft.key) next = { ...next, mask: maskDraft.mask }
    if (lookDraft && row.key === lookDraft.key) next = { ...next, opacity: lookDraft.opacity }
    return next
  }) : stackRows
  const focusedLayer = layerRows.find((row) => row.key === layerFocus) ?? null
  const editingMask = maskEdit && focusedLayer && maskEdit.key === focusedLayer.key ? maskEdit : null
  const offscreenSelection = railTab === 'layers' && selection !== null && ['clip', 'text', 'shape', 'blur', 'effect'].includes(selection.kind)
    && !stackRows.some((row) => row.selection?.kind === selection.kind && row.selection.id === selection.id)
  useEffect(() => {
    if (railTab !== 'layers') { setMaskEdit(null); setMaskDraft(null); setLookDraft(null); return }
    // Selecting an item on the timeline or stage focuses its layer.
    const row = stackRows.find((candidate) => selection && candidate.selection?.kind === selection.kind && candidate.selection.id === selection.id)
    if (row) setLayerFocus(row.key)
  }, [selection, railTab])
  useEffect(() => { if (maskEdit && !editingMask) setMaskEdit(null) }, [maskEdit, editingMask])
  const unlinkedSelection = selection?.kind === 'clip' && Boolean(selection.unlinked)
  const clipBase = selection?.kind === 'clip' ? project.clips.find((clip) => clip.id === selection.id) ?? null : null
  const selectedClip = clipBase && clipDraft?.id === clipBase.id ? clipDraft : clipBase
  const selectedZoomRegion = selection?.kind === 'zoomRegion' ? visibleZoomRegions.find((region) => region.id === selection.id) ?? null : null
  // A pan region's gizmo edits whichever framing the inspector's Start/End switch selected.
  const zoomRectKey: 'rect' | 'fromRect' = panFraming === 'start' && selectedZoomRegion?.fromRect ? 'fromRect' : 'rect'
  const activeZoomRegion = visibleZoomRegions.find((region) => currentUs >= region.startUs && currentUs < region.endUs) ?? null
  const stageZoomRegion = activeZoomRegion && activeZoomRegion.id === selectedZoomRegion?.id && zoomRectKey === 'fromRect' && activeZoomRegion.fromRect
    ? { ...activeZoomRegion, rect: activeZoomRegion.fromRect } : activeZoomRegion
  const selectedBlurRegion = selection?.kind === 'blur' ? visibleBlurRegions.find((region) => region.id === selection.id) ?? null : null
  const selectedEffect = selection?.kind === 'effect' ? visibleEffects.find((effect) => effect.id === selection.id) ?? null : null
  const captionVideo = useMemo(() => captionClips(project.tracks, project.clips), [project.tracks, project.clips])
  const under = useMemo(() => videoUnderPlayhead(currentUs, project.tracks, project.clips), [currentUs, project.tracks, project.clips])
  const underAssetId = under ? assetIdOf(under.clip) : null
  const underAsset = underAssetId ? assetById.get(underAssetId) ?? null : null
  // The frame under the playhead, for the Color tab's look thumbnails and "Match reference image".
  const underElement = () => (under && underAssetId ? playback.transport.elementFor(under.clip.trackId, underAssetId) as HTMLVideoElement | null : null)
  const colorFrame = useColorFrame(railTab === 'color', underElement, [Math.round(currentUs), under?.clip.id, playback.poolVersion])
  const pickedVideo = (pickedVideoId ? assetById.get(pickedVideoId) : undefined) ?? underAsset ?? primary
  // The playhead is rounded to 100 ms so the context is not rebuilt on every playback frame.
  const playheadTenthUs = Math.round(currentUs / 100_000) * 100_000
  const transcribeContext = useMemo((): TranscribeContext => ({
    durationUs: pickedVideo?.metadata?.durationUs ?? null,
    playheadSourceUs: pickedVideo ? sourceUsForAssetAt(playheadTenthUs, pickedVideo.id, project.clips) : null,
    inOutSourceRange: pickedVideo && activeRange ? sourceRangeForSequenceRange(activeRange, pickedVideo.id, project.clips) : null,
  }), [pickedVideo, project.clips, playheadTenthUs, activeRange?.startUs, activeRange?.endUs])
  const activeCue = activeCueAt(currentUs, project.tracks, project.clips, visibleCues)?.cue
  const timelineDisplay: CaptionDisplay = project.timelineDisplay ?? 'line'
  const captionDisplay: CaptionDisplay = project.captionDisplay ?? 'line'
  // Derived, not cleared by an effect: a stale selectedWordId simply stops matching once the
  // selected cue's words change (e.g. after delete/undo/re-estimate) and disappears on its own.
  const selectedWord = selected?.words.find((word) => word.id === selectedWordId) ?? null

  // Style is project state so it saves/reopens and is undoable; a live draft feeds the preview
  // immediately while dragging a control, and one history commit lands per finished gesture.
  const [styleDraft, setStyleDraft] = useState<CaptionStyle | null>(null)
  const [textStyleDraft, setTextStyleDraft] = useState<{ id: string; style: CaptionStyle } | null>(null)
  const savedStyle = project.captionStyle ?? DEFAULT_CAPTION_STYLE
  const effectiveStyle = selectedText
    ? (textStyleDraft?.id === selectedText.id ? textStyleDraft.style : selectedText.style)
    : styleDraft ?? savedStyle
  // The inspector follows the selection, but speech captions must always render from the project
  // caption style. Reusing `effectiveStyle` here made a selected text item's stage drag appear to
  // transform every caption even though only the text item's style was being committed.
  const previewCaptionStyle = selectedText ? savedStyle : styleDraft ?? savedStyle
  useEffect(() => setStyleDraft(null), [project.id])

  // Every command and validation shares this: new unbound captions belong to the video under the
  // playhead, and a project with no video bounds its captions by the timeline shown.
  const commandContext = useMemo<CommandContext>(() => ({
    mediaDurationUs: hasVideo ? null : durationUs,
    defaultAssetId: underAssetId,
    compositionHeight: captionComposition.height,
  }), [hasVideo, durationUs, underAssetId, captionComposition.height])
  const validation = useMemo(() => {
    const captions = validateCaptions(visibleCues, commandContext)
    const items = validateItems(project, commandContext)
    return { errors: [...captions.errors, ...items.errors], warnings: [...captions.warnings, ...items.warnings] }
  }, [visibleCues, project, commandContext])
  const warningCueIds = useMemo(() => new Set(validation.warnings.flatMap((warning) => warning.cueIds)), [validation.warnings])

  // A project with video needs every caption bound to one; stamp any that a direct commit created
  // (SRT import) with the video under the playhead. Commands do this themselves.
  const bindToVideo = (next: CaptionProject) => bindUnboundItems(next, (() => { const active = videoUnderPlayhead(clock.getUs(), next.tracks, next.clips); return active ? assetIdOf(active.clip) : null })() ?? primaryVideoAsset(next)?.id)
  const commit = (update: (project: CaptionProject) => CaptionProject) => setHistory((state) => commitHistory(state, {
    ...bindToVideo(update(state.present)),
    updatedAt: new Date().toISOString(),
  }))

  // The title is not undoable state worth a history step of its own: opening a video names an
  // untitled project after it in every snapshot, so undo never resurrects the placeholder name.
  const retitleProject = (title: string) => setHistory((state) => {
    const update = (snapshot: CaptionProject): CaptionProject => ({ ...snapshot, title })
    return { past: state.past.map(update), present: update(state.present), future: state.future.map(update) }
  })

  const errorText = (error: unknown) => error instanceof Error ? error.message : 'The operation failed.'
  /** A job's `diagnostic` carries the encoder's own stderr or a worker exit code. Its root-cause
   * lines (not FFmpeg's per-stream teardown) reach the notice; the whole of it is in the export log. */
  const exportErrorText = (error: JobStructuredError) => {
    const diagnostic = diagnosticSummary(error.diagnostic)
    return diagnostic ? `${error.message} — ${diagnostic}` : error.message
  }
  const migrationNote = (from: 1 | 2 | 3 | 4 | null, backup: string | null) => from ? (backup ? ` and migrated from schema ${from} — the original was kept as ${backup}` : ` and migrated from schema ${from} — autosave starts once you save it in the current format (⌘/Ctrl+S)`) : ''
  const describeMigration = (notes: MigrationNote[]) => {
    if (!notes.length) return ''
    const shown = notes.slice(0, 3).map((note) => note.message).join(' ')
    return ` ${notes.length} item${notes.length === 1 ? '' : 's'} could not be carried over exactly: ${shown}${notes.length > 3 ? ` …and ${notes.length - 3} more.` : ''}`
  }

  // Codec diagnostics ask the real embedded player (`canPlayType`, then its actual `error` event)
  // rather than a hardcoded matrix, per video file.
  useEffect(() => {
    const probe = document.createElement('video')
    setCodecIssues((issues) => {
      let next = issues
      for (const asset of videoAssets(project)) {
        if (!media.urlOf(asset) || next.has(asset.id)) continue
        const hint = containerPlaybackHint(asset.name, (type) => probe.canPlayType(type))
        if (hint.checked && hint.verdict === '') next = new Map(next).set(asset.id, { kind: 'likely-unsupported' })
      }
      return next
    })
  }, [project.assets, media.urlOf])
  const issueAsset = (underAsset && codecIssues.has(underAsset.id) ? underAsset : null) ?? videoAssets(project).find((asset) => codecIssues.has(asset.id)) ?? null
  const codecIssue = issueAsset ? codecIssues.get(issueAsset.id)! : null
  const issueProxyState = playbackProxies.statusOf(issueAsset)?.state
  const autoProxyPending = issueProxyState === 'queued' || issueProxyState === 'generating'

  useEffect(() => {
    if (!codecIssue || !window.captionStudio || proxyState.kind !== 'idle') return
    setProxyState({ kind: 'checking-support' })
    window.captionStudio.checkProxySupport()
      .then((support) => setProxyState(support.supported ? { kind: 'ready' } : { kind: 'unsupported', reason: support.reason ?? 'Local proxy conversion is unavailable.' }))
      .catch((error) => setProxyState({ kind: 'error', message: errorText(error) }))
  }, [codecIssue?.kind, proxyState.kind])

  useEffect(() => window.captionStudio?.onProxyProgress((message) => {
    setProxyState((state) => {
      if (state.kind !== 'creating' || state.requestId !== message.requestId) return state
      if (message.progress.kind !== 'measured' || message.progress.phase !== 'proxy') return state
      return { ...state, percent: Math.round(message.progress.completed / message.progress.total * 100) }
    })
  }), [])

  const createProxy = async () => {
    if (!window.captionStudio || !issueAsset?.fingerprint) return
    const requestId = crypto.randomUUID()
    setProxyState({ kind: 'creating', requestId, percent: null })
    try {
      const result = await window.captionStudio.createProxy({ requestId, fingerprint: issueAsset.fingerprint })
      if (!result) { setProxyState({ kind: 'ready' }); return }
      setProxyState({ kind: 'done', path: result.path })
      setNotice({ tone: 'info', text: `Created a playable local proxy of ${issueAsset.name} at ${result.path}. Source media was not modified.` })
    } catch (error) { setProxyState({ kind: 'error', message: errorText(error) }) }
  }

  const cancelProxyCreation = () => {
    if (proxyState.kind !== 'creating' || !window.captionStudio) return
    void window.captionStudio.cancelProxy(proxyState.requestId)
    setProxyState({ kind: 'ready' })
  }

  // Checked once, independent of the loaded media: MP4 export needs a fixed platform/FFmpeg/export-host
  // profile, not a per-file codec decision. The Export Video control is shown only once this reports
  // supported — never as a nonfunctional placeholder before the real pipeline is verified working.
  useEffect(() => {
    if (!window.captionStudio || exportState.kind !== 'idle') return
    setExportState({ kind: 'checking-support' })
    window.captionStudio.checkExportSupport()
      .then((support) => setExportState(support.supported ? { kind: 'ready' } : { kind: 'unsupported', reason: support.reason ?? 'MP4 export is unavailable.' }))
      .catch((error) => setExportState({ kind: 'error', message: errorText(error) }))
  }, [exportState.kind])

  // Which export request has actually reported progress, so a `null` outcome can be told apart
  // from a dismissed save dialog: once a job has run, a result that names no outcome is a bug,
  // not a dismissal, and must never return the UI to idle without saying anything.
  const exportStartedRef = useRef<string | null>(null)
  const exportRateRef = useRef(createProgressRate())
  const [exportRate, setExportRate] = useState<ExportRateView | null>(null)
  useEffect(() => window.captionStudio?.onExportProgress((message) => {
    exportStartedRef.current = message.requestId
    const progress = message.job.progress
    if (progress?.kind === 'measured' && progress.unit === 'frames') setExportRate(exportRateRef.current.sample(progress.completed, progress.total, performance.now()))
    setExportState((state) => state.kind === 'running' && state.requestId === message.requestId ? { ...state, job: message.job } : state)
  }), [])

  // Every file the export would read, and which of them are not playable this session.
  const hidden = new Set(project.tracks.filter((track) => track.hidden).map((track) => track.id))
  const exportAssets = [...new Set(project.clips.filter((clip) => !hidden.has(clip.trackId)).flatMap((clip) => assetIdOf(clip) ?? []))].flatMap((id) => assetById.get(id) ?? [])
  const offlineAssets = exportAssets.filter((asset) => !media.urlOf(asset))
  const usedLutIds = new Set(project.clips.filter((clip): clip is AdjustmentClip => clip.kind === 'adjustment' && clip.enabled !== false
    && !hidden.has(clip.trackId)).flatMap((clip) => clip.grade.input.type === 'lut' ? [clip.grade.input.assetId] : []))
  const offlineLuts = lutAssetsList.filter((asset) => usedLutIds.has(asset.id) && !lut.cubes.has(asset.id))
  const offlineVideos = videoAssets(project).filter((asset) => project.clips.some((clip) => assetIdOf(clip) === asset.id) && !media.urlOf(asset))

  const startExportVideo = async (settings?: ExportSettings) => {
    if (!window.captionStudio) return
    const requestId = crypto.randomUUID()
    exportRateRef.current = createProgressRate()
    setExportRate(null)
    setExportState({ kind: 'running', requestId, job: null })
    const startedMs = performance.now()
    const outputFormat = (() => {
      const source = project.format ?? formatFromMedia(primaryVideoAsset(project)?.metadata)
      return source ? resolveExportFormat(source, settings ?? DEFAULT_EXPORT_SETTINGS) : null
    })()
    try {
      const outcome = await window.captionStudio.startExport({ requestId, project, ...(settings ? { settings } : {}) })
      setExportState({ kind: 'ready' })
      if (!outcome) {
        // No outcome and no job: the user dismissed the save dialog, which needs no message.
        if (exportStartedRef.current !== requestId) return
        setNotice({ tone: 'error', text: 'The export stopped without reporting a result. Check the export log in the app data folder.' })
        return
      }
      if (outcome.state === 'succeeded') {
        const seconds = (performance.now() - startedMs) / 1000
        if (outputFormat && outcome.frameCount > 0 && seconds > 0) recordExportSpeed({ width: outputFormat.width, height: outputFormat.height, framesPerSecond: outcome.frameCount / seconds })
        setNotice({
          tone: 'info', text: `Exported video to ${outcome.path}. Source media was not modified.`,
          action: {
            label: 'Show in folder',
            run: () => void window.captionStudio?.revealExport(requestId).then((result) => { if (!result.ok) setNotice({ tone: 'error', text: result.message }) })
              .catch((error) => setNotice({ tone: 'error', text: errorText(error) })),
          },
        })
      }
      else if (outcome.state === 'cancelled') setNotice({ tone: 'info', text: 'Export cancelled.' })
      else setNotice({ tone: 'error', text: exportErrorText(outcome.error) })
    } catch (error) { setExportState({ kind: 'ready' }); setNotice({ tone: 'error', text: errorText(error) }) }
  }

  const cancelExportVideo = () => {
    if (exportState.kind !== 'running' || !window.captionStudio) return
    void window.captionStudio.cancelExport(exportState.requestId)
  }

  // Waveforms: one extraction per file, cached in main by fingerprint and sliced per clip. Requested
  // once per asset id; a failed request is retried the next time this runs (e.g. after a relink).
  const loadedWaveformsRef = useRef<Set<string>>(new Set())
  // In-flight request IDs, so the timeline's cancel button can actually reach `media:waveform-cancel`
  // instead of being permanently disconnected dead UI.
  const activeWaveformRequestsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const api = window.captionStudio
    if (!api) return
    for (const asset of project.assets) {
      if (asset.kind === 'image' || !asset.fingerprint || !asset.metadata?.durationUs || !media.urlOf(asset)) continue
      if (loadedWaveformsRef.current.has(asset.id)) continue
      loadedWaveformsRef.current.add(asset.id)
      const assetId = asset.id
      const requestId = crypto.randomUUID()
      activeWaveformRequestsRef.current.add(requestId)
      setWaveformsLoading((count) => count + 1)
      void api.loadWaveform({ requestId, fingerprint: asset.fingerprint, range: { startUs: 0, endUs: asset.metadata.durationUs }, maxPeaks: TIMELINE_WAVEFORM_PEAKS })
        .then((result) => setWaveforms((map) => new Map(map).set(assetId, result.waveform)))
        .catch((error) => {
          loadedWaveformsRef.current.delete(assetId)
          setNotice({ tone: 'warning', text: `Waveform unavailable for ${asset.name}: ${errorText(error)}` })
        })
        .finally(() => { activeWaveformRequestsRef.current.delete(requestId); setWaveformsLoading((count) => count - 1) })
    }
  }, [project.assets, media.urlOf])

  const cancelWaveforms = () => {
    const api = window.captionStudio
    if (!api) return
    for (const requestId of activeWaveformRequestsRef.current) void api.cancelWaveform(requestId).catch(() => {})
  }

  /** Registers a relinked asset's runtime URL and rewrites its stored media fields in one undo step
   * (an initial open patches the project directly — see `openProject` — since there is nothing yet
   * to undo back to). A video's URL is keyed by fingerprint, so undoing this restores the old file. */
  const useAssetCandidate = (asset: ProjectAsset, candidate: MediaCandidate) => {
    media.register({ id: asset.id, kind: asset.kind, fingerprint: candidate.media.fingerprint }, candidate.url)
    media.clearIssue(asset.id)
    setCodecIssues((issues) => { if (!issues.has(asset.id)) return issues; const next = new Map(issues); next.delete(asset.id); return next })
    // A relink can point the same asset id at a different file with a different fingerprint; drop
    // its old peaks and let the waveform effect above re-request them, rather than keeping stale
    // audio drawn under a clip that now plays something else.
    loadedWaveformsRef.current.delete(asset.id)
    setWaveforms((map) => { if (!map.has(asset.id)) return map; const next = new Map(map); next.delete(asset.id); return next })
    runCommand({ type: 'asset-update', assetId: asset.id, changes: candidate.media })
  }

  useEffect(() => {
    if (focusCueId === undefined) return
    const target = (focusCueId ? cueButtonRefs.current.get(focusCueId) : undefined) ?? addCueButtonRef.current
    requestAnimationFrame(() => target?.focus())
    setFocusCueId(undefined)
  }, [focusCueId, project.cues])

  // `describe` overrides the default notice for commands whose outcome the caller can explain more
  // usefully than the generic overlap warning.
  const runCommand = (command: EditCommand, describe?: (warnings: ValidationIssue[]) => Notice) => {
    // A title that a shape is fitted to (`fitTo`): measure the new text first, then commit the text and the refitted shapes as ONE undo step.
    if (command.type === 'text-update' && ('text' in command.changes || 'style' in command.changes)) {
      const current = projectRef.current.textOverlays.find((item) => item.id === command.textId)
      const fitted = projectRef.current.shapes.filter((shape) => shape.fitTo === command.textId && isFittableGeometry(shape.geometry))
      if (current && fitted.length) {
        const next = { ...current, ...command.changes }
        void fitShapesToTitle(fitted, next.text, next.style, captionComposition).then((results) => {
          const updates: EditCommand[] = [...results].map(([shapeId, result]) => ({ type: 'shape-update', shapeId, changes: { geometry: result.geometry } }))
          if (updates.length === 0) applyCommand(command, describe)
          else {
            const outcome = runCommands([command, ...updates], 'Text updated; its shape was refitted.')
            const failure = outcome.failedIndex === null ? null : outcome.outcomes[outcome.failedIndex]
            if (failure && !failure.ok) setNotice({ tone: 'error', text: failure.errors.map((issue) => issue.message).join(' ') })
          }
        }, () => { applyCommand(command, describe) })
        return true
      }
    }
    return applyCommand(command, describe)
  }
  const applyCommand = (command: EditCommand, describe?: (warnings: ValidationIssue[]) => Notice) => {
    const result = applyEditCommand(projectRef.current, command, commandContext)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.errors.map((issue) => issue.message).join(' ') })
      return false
    }
    if (result.project === projectRef.current) return true
    projectRef.current = result.project
    setHistory((state) => commitHistory(state, { ...result.project, updatedAt: new Date().toISOString() }))
    if (result.selection !== undefined) setSelection(result.selection)
    else if (result.selectedId !== undefined) setSelectedId(result.selectedId)
    if (command.type === 'delete') setFocusCueId(result.selectedId ?? null)
    setNotice(describe ? describe(result.warnings) : result.warnings.length ? { tone: 'warning', text: 'Edit applied. Overlapping cues were preserved and are flagged.' } : null)
    return true
  }

  const projectWarnings = (value: CaptionProject) => [...validateCaptions(value.cues, commandContext).warnings, ...validateItems(value, commandContext).warnings]
  const summarizeAgentState = (value: CaptionProject, selectionValue: Selection | null): ProjectSummary =>
    summarizeProject(value, projectPath, clock.getUs(), selectionValue, projectWarnings(value))

  /** The MCP agent's batch entry point (`useAgentBridge`): every command in the array applies
   * against the same working project and commits as **one** undo step, exactly like one
   * `runCommand` call — mirroring its selection handling but without the toast, since the agent
   * (not the mouse) is the caller. Nothing commits if any command fails; the failing index and its
   * errors are returned so the caller knows exactly which command to fix and retry. */
  const runCommands = (commands: EditCommand[], message?: string): { outcomes: CommandOutcome[]; failedIndex: number | null; state: ProjectSummary } => {
    let working = projectRef.current
    let nextSelection = selectionRef.current
    let failedIndex: number | null = null
    const outcomes: CommandOutcome[] = []
    for (const [index, command] of commands.entries()) {
      const result = applyEditCommand(working, command, commandContext)
      if (!result.ok) {
        outcomes.push({ ok: false, errors: result.errors, warnings: result.warnings })
        failedIndex = index
        break
      }
      outcomes.push({ ok: true, warnings: result.warnings })
      working = result.project
      if (result.selection !== undefined) nextSelection = result.selection
      else if (result.selectedId !== undefined) nextSelection = result.selectedId === null ? null : { kind: 'cue', id: result.selectedId }
    }
    if (failedIndex === null && working !== projectRef.current) {
      projectRef.current = working
      selectionRef.current = nextSelection
      setHistory((state) => commitHistory(state, { ...working, updatedAt: new Date().toISOString() }))
      setSelection(nextSelection)
      setNotice({ tone: 'info', text: message ?? `Agent applied ${commands.length} edit${commands.length === 1 ? '' : 's'}.` })
    }
    return { outcomes, failedIndex, state: summarizeAgentState(working, nextSelection) }
  }

  // One undoable history step; human-authored captions are only replaced by an explicit choice (applyTranscription).
  const applyTranscript: ApplyTranscript = (result, choice) => {
    try {
      const { run, transcript, translations, translationFailures, assetId, partial } = result
      const applied = applyTranscription(projectRef.current, transcript, run, choice, () => crypto.randomUUID(), translations, assetId, { partial })
      setHistory((state) => commitHistory(state, { ...applied.project, updatedAt: new Date().toISOString() }))
      setSelectedId(applied.project.cues.find((cue) => cue.transcriptionRunId === run.id)?.id ?? selectedCueId)
      const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
      const parts = [transcript.segments.length ? `added ${plural(applied.summary.added, 'caption')}` : 'no speech was recognized, so no captions were added']
      if (applied.summary.removed) parts.push(`replaced ${plural(applied.summary.removed, 'existing caption')}`)
      if (applied.summary.boundaryKept) parts.push(`kept ${plural(applied.summary.boundaryKept, 'caption')} crossing the range edge`)
      if (applied.summary.skippedOverlapping) parts.push(`skipped ${plural(applied.summary.skippedOverlapping, 'segment')} overlapping kept captions`)
      if (run.adjustedSegmentCount) parts.push(`${plural(run.adjustedSegmentCount, 'caption')} with adjusted timing marked Needs review`)
      const uncovered = 'provider' in run ? run.uncoveredRanges ?? [] : []
      if (uncovered.length) {
        const shown = uncovered.slice(0, 3).map((gap) => `${formatClock(gap.startUs)}–${formatClock(gap.endUs)}`).join(', ')
        parts.push(`${plural(uncovered.length, 'stretch')} of 10 s or more inside speech got no words from the provider, so captions may be missing (${shown}${uncovered.length > 3 ? ', …' : ''})`)
      }
      if (translations.length) parts.push(`translated to ${translations.map((entry) => `${translationTargetLabel(entry.targetLanguage)} (${entry.model})`).join(', ')}, ${translations[0] ? `${translationTargetLabel(translations[0].targetLanguage)} shown on video` : ''}; the original captions are kept too; translated word timing estimated and marked Needs review`)
      if (translationFailures.length) parts.push(`${translationFailures.map((failure) => `${translationTargetLabel(failure.target)} failed (${failure.message})`).join('; ')}; the transcript and original captions were kept. Use + Translate… in the Captions tab to retry a failed language without transcribing again`)
      const language = run.language ? `, language ${run.language}` : ''
      const name = assetById.get(assetId)?.name
      const part = partial ? ` ${formatClock(transcript.sourceRange.startUs)}–${formatClock(transcript.sourceRange.endUs)} of` : ''
      const how = 'provider' in run
        ? `Transcribed${part}${name ? ` ${name}` : ''} with ${providerLabel(run.provider)} (${run.model.id}, ${plural(run.chunkCount, 'speech chunk')} uploaded${language})`
        : `Transcribed${part}${name ? ` ${name}` : ''} locally (${run.engine.id} ${run.engine.version}, ${run.model.fileName}, ${run.backends.join(' + ') || 'recognizer not run'}${language})`
      setNotice({ tone: applied.summary.skippedOverlapping || applied.summary.boundaryKept || run.adjustedSegmentCount || uncovered.length || translations.length || translationFailures.length ? 'warning' : 'info', text: `${how}: ${parts.join('; ')}.` })
      return { ok: true }
    } catch (error) { return { ok: false, message: errorText(error) } }
  }

  // Text-only translation of existing captions: every successful language lands in one undo step; failed ones are reported for retry.
  const applyTranslations = ({ assetId, sourceLanguage, originals, results, failures }: { assetId: string; sourceLanguage: string | null; originals: Cue[]; results: TranslatedLayerResult[]; failures: TranslationFailure[] }) => {
    const failureText = failures.map((failure) => `${translationTargetLabel(failure.target)} failed (${failure.message})`).join('; ')
    if (!results.length) { setNotice({ tone: 'error', text: `No language was added: ${failureText}. Pick it again to retry.` }); return }
    try {
      const applied = applyTranslatedLayers(projectRef.current, assetId, sourceLanguage, originals, results, () => crypto.randomUUID())
      setHistory((state) => commitHistory(state, { ...applied.project, updatedAt: new Date().toISOString() }))
      setLanguageTab(results[0].target)
      const added = applied.summaries.map((summary) => `${translationTargetLabel(summary.target)} (${summary.added} caption${summary.added === 1 ? '' : 's'}${summary.keptEdited ? `, kept ${summary.keptEdited} you edited` : ''})`).join(', ')
      setNotice({ tone: 'warning', text: `Added ${added}. Translated captions are marked Needs review with estimated word timing; what is shown on video is unchanged.${failureText ? ` ${failureText}. Pick it again to retry.` : ''}` })
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
  }

  const applyAlignedTiming = (transcript: Parameters<typeof applyAlignment>[1], run: Parameters<typeof applyAlignment>[2], snapshot: { id: string; startUs: number; endUs: number; text: string }[], assetId: string) => {
    try {
      const current = projectRef.current
      const unchanged = new Set(snapshot.filter((before) => {
        const cue = current.cues.find((candidate) => candidate.id === before.id)
        return cue?.text === before.text && cue.startUs === before.startUs && cue.endUs === before.endUs
      }).map((segment) => segment.id))
      const filtered = { ...transcript, segments: transcript.segments.filter((segment) => unchanged.has(segment.id)) }
      if (!filtered.segments.length) return setNotice({ tone: 'warning', text: 'Captions changed while alignment was running, so no timing was applied.' })
      const appliedSnapshots = snapshot.filter((segment) => unchanged.has(segment.id))
      const sourceRange = { startUs: Math.min(...appliedSnapshots.map((segment) => segment.startUs)), endUs: Math.max(...appliedSnapshots.map((segment) => segment.endUs)) }
      const aligned = applyAlignment(current, filtered, { ...run, mediaAssetId: assetId, sourceRange, segmentCount: filtered.segments.length }, () => crypto.randomUUID())
      setHistory((state) => commitHistory(state, aligned))
      const appliedRun = aligned.alignmentRuns?.at(-1)
      const skipped = transcript.segments.length - filtered.segments.length
      setNotice({ tone: appliedRun?.estimatedWordCount || skipped ? 'warning' : 'info', text: `Audio aligned: ${appliedRun?.alignedWordCount ?? 0} words matched${appliedRun?.estimatedWordCount ? `; ${appliedRun.estimatedWordCount} remain estimated` : ''}${skipped ? `; ${skipped} changed caption${skipped === 1 ? '' : 's'} skipped` : ''}.` })
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
  }

  /** Where a clip of `kind` can go at `range`: a free track (preferring `preferTrackId`), or a new
   * track created in the same undo step. */
  const placementTrack = (kind: Clip['kind'], range: { startUs: number; endUs: number }, preferTrackId?: string | null) => {
    const current = projectRef.current
    const existing = freeTrackFor(current.tracks, current.clips, kind, range, preferTrackId)
    return existing ? { trackId: existing, track: undefined } : (() => { const track = newTrack(kind === 'audio' ? 'audio' : 'video'); return { trackId: track.id, track } })()
  }

  /**
   * A video goes onto the timeline — never replacing what is there. With no video yet it starts V1
   * at 0 (one undoable step that also binds captions imported before it and sets the output
   * format); otherwise — with no explicit placement — it is appended after the last clip on V1
   * (the lowest unlocked video track), or on a new video track when every video track is locked.
   */
  const addVideoClip = (asset: ProjectAsset, mediaAsset?: ProjectAsset, at?: { startUs: number; trackId: string | null }) => {
    const current = projectRef.current
    const durationUs = asset.metadata?.durationUs ?? null
    if (durationUs === null) { setNotice({ tone: 'error', text: `${asset.name}’s duration could not be read, so it cannot be placed on the timeline.` }); return false }
    const first = !current.clips.some((candidate) => candidate.kind === 'video')
    // Reuse V1 only while it is empty: an image added before the first video already lives there, and
    // the video would otherwise land on top of it in the same lane.
    const v1 = first ? current.tracks.find((track) => track.kind === 'video' && !track.locked && !current.clips.some((clip) => clip.trackId === track.id)) : undefined
    // Without an explicit placement a later video is appended after the last clip on the lowest
    // unlocked video track (V1), not stacked at the playhead.
    const appendTrack = first || at ? undefined : current.tracks.find((entry) => entry.kind === 'video' && !entry.locked)
    const track = at?.trackId ? undefined : v1 ? undefined : appendTrack ? undefined : newTrack('video')
    const trackId = at?.trackId ?? v1?.id ?? appendTrack?.id ?? track!.id
    const startUs = at?.startUs ?? (first || appendTrack ? trackEndUs(current.clips, trackId) : Math.round(currentUs))
    const clip: Clip = { kind: 'video', id: crypto.randomUUID(), trackId, assetId: asset.id, timelineStartUs: startUs, sourceStartUs: 0, sourceEndUs: durationUs, opacity: 1, fit: 'contain', gain: 1 }
    if (!runCommand({ type: 'clip-add', clip, asset: mediaAsset, track, mode: at ? editMode : 'overwrite', idPrefix: crypto.randomUUID() })) return false
    // The first video starts a captioning session: nothing selected, playhead at the start.
    if (first) { playback.seek(0); setSelection(null) }
    else if (!at) setNotice({ tone: 'info', text: `${appendTrack ? 'Appended' : 'Added'} ${asset.name} on ${trackLabel(current.tracks.find((entry) => entry.id === trackId) ?? track!, [...current.tracks, ...(track ? [track] : [])])}.` })
    return true
  }

  /** Imports a video into the media bin only; nothing reaches the timeline until the user drags it
   * there or presses Add. Returns whether it was newly added (false: already in the project). */
  const importVideoToBin = (probed: ProjectMedia, url: string, retitle = false): { ok: boolean; added: boolean } => {
    const current = projectRef.current
    const existing = findAssetByFingerprint(current.assets.filter((asset) => asset.kind === 'video'), probed)
    const asset: ProjectAsset = existing ?? { id: crypto.randomUUID(), kind: 'video', ...probed }
    media.register({ id: asset.id, kind: 'video', fingerprint: probed.fingerprint }, url)
    if (existing) return { ok: true, added: false }
    const firstVideo = !current.assets.some((entry) => entry.kind === 'video')
    if (!runCommand({ type: 'asset-add', asset })) return { ok: false, added: false }
    if (retitle && firstVideo) retitleProject(probed.name.replace(/\.[^.]+$/, ''))
    return { ok: true, added: true }
  }

  const openVideo = async () => {
    if (!window.captionStudio) return setNotice({ tone: 'error', text: 'Native dialogs are available in the desktop app.' })
    setNotice({ tone: 'info', text: 'Reading media metadata and fingerprint…' })
    try {
      const result = await window.captionStudio.openVideo()
      if (!result) return setNotice(null)
      if (!result.ok) return setNotice({ tone: 'error', text: result.message })
      const { candidate } = result
      const imported = importVideoToBin(candidate.media, candidate.url, true)
      if (!imported.ok) return
      setRailTab('media')
      setNotice({ tone: 'info', text: imported.added ? `Imported ${candidate.media.name} to the Media tab. Drag it to the timeline or press Add.` : `${candidate.media.name} is already in the project.` })
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
  }

  const applyParsedSrt = (parsed: ReturnType<typeof parseSrt>) => {
    commit((state) => ({ ...state, cues: parsed.cues }))
    setSelectedId(parsed.cues[0]?.id ?? null)
    const overlaps = validateCaptions(parsed.cues).warnings.length
    setNotice({ tone: parsed.issues.length ? 'error' : overlaps ? 'warning' : 'info', text: `Imported ${parsed.cues.length} cues${parsed.issues.length ? `; skipped ${parsed.issues.length} malformed blocks` : ''}${overlaps ? `; preserved ${overlaps} overlap${overlaps === 1 ? '' : 's'} with warnings` : ''}.` })
  }

  // Shared by the File menu's Import SRT, the Captions panel's empty-state button, and any bin/stage/
  // timeline drop of a .srt file. An existing transcript is never silently replaced (AGENTS.md).
  const importSrtContent = (name: string, content: string) => {
    const parsed = parseSrt(content)
    if (project.cues.length) { setPendingSrt({ name, parsed }); return }
    applyParsedSrt(parsed)
  }

  const importSrt = async () => {
    if (!window.captionStudio) return setNotice({ tone: 'error', text: 'Native dialogs are available in the desktop app.' })
    const file = await window.captionStudio.openText()
    if (!file) return
    importSrtContent(file.path.split(/[\\/]/).pop() ?? file.path, file.content)
  }

  /** A new image clip: three seconds at `startUs`, sized like a title, on a track above the video. */
  const addImageClip = (asset: ProjectAsset, metadata: MediaMetadata | null, startUs: number, preferTrackId?: string | null, inlineAsset?: ProjectAsset) => {
    const range = { startUs: Math.max(0, Math.round(startUs)), endUs: Math.max(0, Math.round(startUs)) + DEFAULT_IMAGE_CLIP_US }
    const { trackId, track } = placementTrack('image', range, preferTrackId)
    const clip: Clip = { kind: 'image', id: crypto.randomUUID(), trackId, assetId: asset.id, timelineStartUs: range.startUs, sourceStartUs: 0, sourceEndUs: DEFAULT_IMAGE_CLIP_US,
      rect: defaultOverlayRect(metadata, captionComposition), opacity: 1, fit: 'contain' }
    return runCommand({ type: 'clip-add', clip, asset: inlineAsset, track, idPrefix: crypto.randomUUID() })
  }

  /**
   * A new background (generated `color` clip) at `startUs`, two seconds long by default. It goes under the picture — a free track below every track holding video
   * or images, else a new track at the bottom of the stack — in one undoable step.
   */
  const addBackground = (look: { fill: Fill; motion?: BackgroundMotion }, startUs: number, preferTrackId?: string | null) => {
    const current = projectRef.current
    const start = Math.max(0, Math.round(startUs))
    const lengthUs = DEFAULT_BACKGROUND_CLIP_US
    const existing = backgroundTrackFor(current.tracks, current.clips, { startUs: start, endUs: start + lengthUs }, preferTrackId)
    const track = existing ? undefined : newTrack('video')
    const clip: Clip = { kind: 'color', id: crypto.randomUUID(), trackId: existing ?? track!.id, timelineStartUs: start, sourceStartUs: 0, sourceEndUs: lengthUs,
      opacity: 1, fit: 'contain', fill: look.fill, ...(look.motion ? { motion: look.motion } : {}) }
    return runCommand({ type: 'clip-add', clip, track, trackIndex: track ? 0 : undefined, idPrefix: crypto.randomUUID() })
  }

  /**
   * A new adjustment layer (docs/EDITING.md "Color: adjustment layers"), from a Color panel tile.
   * Dropped onto an existing picture clip, it spans that clip's own range on the free unlocked video
   * track directly above it (creating one there if none is free); dropped anywhere else — an empty
   * spot, or a click at the playhead — it is `DEFAULT_ADJUSTMENT_CLIP_US` long on `preferTrackId` if
   * that fits, else the topmost free video track (a click always passes `null`, landing on top).
   */
  const addAdjustment = (grade: Grade, startUs: number, preferTrackId?: string | null) => {
    const current = projectRef.current
    const start = Math.max(0, Math.round(startUs))
    const order = new Map(current.tracks.map((track, index) => [track.id, index]))
    const target = preferTrackId ? clipAt(current.clips, preferTrackId, start) : null
    if (target && target.kind !== 'adjustment') {
      const targetIndex = order.get(target.trackId) ?? -1
      const range = { startUs: target.timelineStartUs, endUs: clipEndUs(target) }
      const existing = adjustmentTrackAbove(current.tracks, current.clips, targetIndex, range)
      const track = existing ? undefined : newTrack('video')
      const clip: Clip = { kind: 'adjustment', id: crypto.randomUUID(), trackId: existing ?? track!.id,
        timelineStartUs: range.startUs, sourceStartUs: 0, sourceEndUs: range.endUs - range.startUs, grade }
      return runCommand({ type: 'clip-add', clip, track, trackIndex: track ? targetIndex + 1 : undefined, idPrefix: crypto.randomUUID() })
    }
    const lengthUs = DEFAULT_ADJUSTMENT_CLIP_US
    const range = { startUs: start, endUs: start + lengthUs }
    const existing = preferTrackId ? freeTrackFor(current.tracks, current.clips, 'adjustment', range, preferTrackId) : topAdjustmentTrackFor(current.tracks, current.clips, range)
    const track = existing ? undefined : newTrack('video')
    const clip: Clip = { kind: 'adjustment', id: crypto.randomUUID(), trackId: existing ?? track!.id, timelineStartUs: start, sourceStartUs: 0, sourceEndUs: lengthUs, grade }
    return runCommand({ type: 'clip-add', clip, track, idPrefix: crypto.randomUUID() })
  }

  /** "My LUTs" → Import .cube (Slice 5): the same dialog result creates a new `lut` asset, or — if
   * its fingerprint already matches one in the project — just re-registers its content this session. */
  const importLut = async () => {
    if (!window.captionStudio) return
    const result = await window.captionStudio.importLut()
    if (!result) return
    if (!result.ok) return setNotice({ tone: 'error', text: result.message })
    addLutCandidate(result.candidate)
  }

  /** "Match reference image" → Save: main writes the `.cube` (native save dialog, defaulting to the
   * project folder) and returns it as an inspected LUT, which then joins the project like an import. */
  const saveMatchLut = async ({ text, name }: { text: string; name: string }) => {
    if (!window.captionStudio) return
    const defaultDir = projectPath ? projectPath.replace(/[\\/][^\\/]*$/, '') : null
    const result = await window.captionStudio.saveGeneratedLut({ text, name, defaultDir })
    if (!result) return
    if (!result.ok) return setNotice({ tone: 'error', text: result.message })
    addLutCandidate(result.candidate)
  }

  /** Registers an inspected `.cube` as a project `lut` asset (or just re-registers it when its
   * fingerprint is already in the project). Shared by Import and "Match reference image" → Save. */
  const addLutCandidate = (candidate: MediaCandidate) => {
    const existing = findAssetByFingerprint(project.assets.filter((asset) => asset.kind === 'lut'), candidate.media)
    if (existing) { lut.register(existing.id, candidate.text!); setNotice({ tone: 'info', text: `${candidate.media.name} is already in the project.` }); return }
    const asset: ProjectAsset = { id: crypto.randomUUID(), kind: 'lut', ...candidate.media }
    lut.register(asset.id, candidate.text!)
    if (runCommand({ type: 'asset-add', asset })) setNotice({ tone: 'info', text: `Imported ${candidate.media.name}.` })
  }

  /** Relinks a missing or mismatched LUT asset in place — same dialog, but updates the existing
   * asset's reference/fingerprint (`asset-update`) rather than creating a new one. */
  const relinkLut = async (assetId: string) => {
    if (!window.captionStudio) return
    const result = await window.captionStudio.importLut()
    if (!result) return
    if (!result.ok) return setNotice({ tone: 'error', text: result.message })
    const { candidate } = result
    lut.register(assetId, candidate.text!)
    media.clearIssue(assetId)
    runCommand({ type: 'asset-update', assetId, changes: candidate.media })
    setNotice({ tone: 'info', text: `Relinked ${candidate.media.name}.` })
  }

  /** A new audio clip: the whole file at `startUs`, on a free audio track. */
  const addAudioClip = (asset: ProjectAsset, startUs: number, preferTrackId?: string | null, inlineAsset?: ProjectAsset) => {
    const lengthUs = asset.metadata?.durationUs ?? null
    if (lengthUs === null) { setNotice({ tone: 'error', text: `${asset.name}’s duration could not be read, so it cannot be placed on the timeline.` }); return false }
    const range = { startUs: Math.max(0, Math.round(startUs)), endUs: Math.max(0, Math.round(startUs)) + lengthUs }
    const { trackId, track } = placementTrack('audio', range, preferTrackId)
    const clip: Clip = { kind: 'audio', id: crypto.randomUUID(), trackId, assetId: asset.id, timelineStartUs: range.startUs, sourceStartUs: 0, sourceEndUs: lengthUs, gain: 1 }
    return runCommand({ type: 'clip-add', clip, asset: inlineAsset, track, idPrefix: crypto.randomUUID() })
  }

  /** Imports/places every file the media bin, an OS drop, or the stage resolved. With a `placement`
   * each lands on the timeline there; without one images and sounds just join the bin, and videos
   * are appended to V1. */
  const addAssetsFromInspected = (results: InspectedFile[], placement?: { sequenceUs: number; trackId: string | null }) => {
    const fragments: string[] = []
    let tone: 'info' | 'warning' | 'error' = 'info'
    for (const result of results) {
      if (!result.ok) { fragments.push(result.message); tone = 'error'; continue }
      if (result.kind === 'subtitle') { importSrtContent(result.name, result.content); continue }
      if (result.kind === 'video') {
        const current = projectRef.current
        const existing = findAssetByFingerprint(current.assets.filter((asset) => asset.kind === 'video'), result.media)
        const asset: ProjectAsset = existing ?? { id: crypto.randomUUID(), kind: 'video', ...result.media }
        media.register({ id: asset.id, kind: 'video', fingerprint: result.media.fingerprint }, result.url)
        if (!placement) {
          if (existing) { fragments.push(`${result.media.name} is already in the project`); continue }
          if (runCommand({ type: 'asset-add', asset })) fragments.push(`imported ${result.media.name}`)
          continue
        }
        const plan = dropPlanForAsset({ kind: 'video', durationUs: asset.metadata?.durationUs ?? null }, placement.sequenceUs, current.tracks, current.clips, placement.trackId)
        const ok = plan.kind === 'clip'
          ? addVideoClip(asset, existing ? undefined : asset, { startUs: plan.placement.startUs, trackId: plan.placement.trackId })
          : addVideoClip(asset, existing ? undefined : asset)
        if (ok) fragments.push(`added ${result.media.name}`)
        continue
      }
      const existing = findAssetByFingerprint(project.assets, result.media)
      const asset: ProjectAsset = existing ?? { id: crypto.randomUUID(), kind: result.kind, ...result.media }
      media.register({ id: asset.id, kind: asset.kind, fingerprint: result.media.fingerprint }, result.url)
      const inline = existing ? undefined : asset
      const ok = placement
        ? result.kind === 'image' ? addImageClip(asset, result.media.metadata, placement.sequenceUs, placement.trackId, inline) : addAudioClip(asset, placement.sequenceUs, placement.trackId, inline)
        : existing ? true : runCommand({ type: 'asset-add', asset })
      if (!ok) continue
      fragments.push(existing && !placement ? `${result.media.name} is already in the project` : `added ${result.media.name}`)
    }
    if (fragments.length) setNotice({ tone, text: `${fragments.join('; ')}.` })
  }

  const importAssetFiles = async () => {
    if (!window.captionStudio) return setNotice({ tone: 'error', text: 'Native dialogs are available in the desktop app.' })
    const results = await window.captionStudio.importAssetFiles()
    if (results) addAssetsFromInspected(results)
  }

  const inspectAndAdd = (files: File[], placement?: { sequenceUs: number; trackId: string | null }) => {
    if (!window.captionStudio || !files.length) return
    void window.captionStudio.inspectDroppedFiles(files).then((results) => addAssetsFromInspected(results, placement))
  }

  const onTimelineDropAsset = (payload: AssetDragPayload, sequenceUs: number, trackId: string | null) => {
    const asset = project.assets.find((candidate) => candidate.id === payload.assetId)
    if (!asset) return
    const plan = dropPlanForAsset({ kind: asset.kind, durationUs: asset.metadata?.durationUs ?? null }, sequenceUs, project.tracks, project.clips, trackId)
    if (plan.kind === 'refused') { setNotice({ tone: 'warning', text: plan.reason }); return }
    if (asset.kind === 'video') addVideoClip(asset, undefined, { startUs: plan.placement.startUs, trackId: plan.placement.trackId })
    else if (asset.kind === 'image') addImageClip(asset, asset.metadata, plan.placement.startUs, plan.placement.trackId)
    else addAudioClip(asset, plan.placement.startUs, plan.placement.trackId)
  }
  const onTimelineDropFiles = (files: File[], sequenceUs: number, trackId: string | null) => inspectAndAdd(files, { sequenceUs, trackId })

  const addOverlayAtPlayhead = (asset: ProjectAsset) => { if (addImageClip(asset, asset.metadata, currentUs)) setInspectorTab('edit') }
  const addSfxAtPlayhead = (asset: ProjectAsset) => { if (addAudioClip(asset, currentUs)) setInspectorTab('edit') }

  const useCountByAsset = useMemo(() => {
    const counts = clipCountByAsset(project.clips)
    for (const cue of project.cues) if (cue.mediaAssetId) counts.set(cue.mediaAssetId, (counts.get(cue.mediaAssetId) ?? 0) + 1)
    return counts
  }, [project.clips, project.cues])

  /** Removing an asset never drops its cached runtime URL — Undo must restore a working clip
   * immediately, without asking the user to relink a file that never actually left the project. */
  const removeAsset = (assetId: string) => {
    if (assetUsers(project, assetId).length) return
    if (!runCommand({ type: 'asset-remove', assetId })) return
    media.clearIssue(assetId)
  }

  // Dialog-free write to the named project. The queue keeps writes ordered; `force` is for explicit ⌘S so it
  // always touches the file, while autosave skips a snapshot that is already on disk.
  const writeProject = (targetPath: string, snapshot: CaptionProject, force = false) => {
    const run = async () => {
      if (!window.captionStudio || (!force && snapshot === lastSavedProject.current)) return
      setSaveStatus({ kind: 'saving' })
      try {
        await window.captionStudio.writeProject({ project: snapshot, path: targetPath })
        lastSavedProject.current = snapshot
        setSaveStatus({ kind: 'saved', at: Date.now() })
      } catch (error) {
        setSaveStatus({ kind: 'error', message: errorText(error) })
        setNotice({ tone: 'error', text: `Could not save ${targetPath}: ${errorText(error)}` })
      }
    }
    writeQueue.current = writeQueue.current.then(run)
    return writeQueue.current
  }

  const autosaveEnabled = projectPath !== null && !migrationPending

  useEffect(() => {
    if (!autosaveEnabled || !projectPath || project === lastSavedProject.current) return
    const timer = window.setTimeout(() => void writeProject(projectPath, project), AUTOSAVE_DELAY_MS)
    // Leaving the window (or opening a native dialog) is a natural checkpoint; don't wait out the debounce.
    const flush = () => { window.clearTimeout(timer); void writeProject(projectPath, project) }
    window.addEventListener('blur', flush)
    return () => { window.clearTimeout(timer); window.removeEventListener('blur', flush) }
  }, [project, projectPath, autosaveEnabled])

  // Returns whether the project actually landed on disk, so a caller that must not proceed until a
  // save lands (the unsaved-work guard below) can tell a completed save from a cancelled dialog.
  const saveProjectAs = async (): Promise<boolean> => {
    if (!window.captionStudio) return false
    try {
      const result = await window.captionStudio.saveProject({ project, defaultName: projectPath ?? `${project.title}.${PROJECT_FILE_EXTENSION}` })
      if (!result) return false
      lastSavedProject.current = result.project
      setHistory((state) => ({ ...state, present: result.project }))
      setProjectPath(result.path)
      setMigrationPending(false)
      setSaveStatus({ kind: 'saved', at: Date.now() })
      setNotice({ tone: 'info', text: `Saved project to ${result.path}. Changes now autosave there.` })
      return true
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }); return false }
  }

  const saveProject = async (): Promise<boolean> => {
    if (!autosaveEnabled || !projectPath) return saveProjectAs()
    await writeProject(projectPath, project, true)
    const saved = lastSavedProject.current === project
    if (saved) setNotice({ tone: 'info', text: `Saved project to ${projectPath}` })
    return saved
  }

  // Shared by New Project and Open Project: every piece of state that identifies or previews a
  // particular project, so switching projects never leaves a stale draft, dialog or drag from the
  // one just left. `migrationPending` differs per caller (Open sets it from the migration result;
  // New never migrates), so it stays the caller's own explicit `setMigrationPending` call.
  const resetForProject = (next: CaptionProject, path: string | null) => {
    setHistory(createHistory(next))
    projectRef.current = next
    lastSavedProject.current = next
    setProjectPath(path)
    setSaveStatus({ kind: 'saved', at: Date.now() })
    setSelectedId(next.cues[0]?.id ?? null)
    setSelectedWordId(null)
    playback.pause()
    playback.seek(0)
    setWaveforms(new Map())
    loadedWaveformsRef.current = new Set()
    setCodecIssues(new Map())
    setClipDraft(null)
    setCloneDraft(null)
    setDragPreview(null)
    setStyleDraft(null)
    setPendingAssetRelink(null)
    setPendingSrt(null)
    setPickedVideoId(null)
    setProxyState({ kind: 'idle' })
  }

  const newProject = () => {
    resetForProject(createProject(), null)
    setMigrationPending(false)
    media.reset(new Map(), new Map(), new Map())
    lut.hydrate({})
    setRailTab('media')
    setInspectorTab('edit')
    setNotice({ tone: 'info', text: 'Started a new project. Open a video to transcribe it, or import an SRT file.' })
  }

  const openProject = async (recentPath?: string) => {
    if (!window.captionStudio) return
    try {
      const result = recentPath ? await window.captionStudio.openRecentProject({ path: recentPath }) : await window.captionStudio.openProject()
      if (!result) return
      if (!result.ok) return setNotice({ tone: 'error', text: result.message })
      const opened = projectSchema.parse(result.project)
      resetForProject(opened, result.path)
      setView('editor')
      // Autosave waits only when the original could not be preserved; otherwise the backup makes it safe to start.
      setMigrationPending(result.migratedFrom !== null && !result.migrationBackup)
      // Every asset — every video included — resolves the same way. A resolved file gets its runtime
      // URL; a missing or mismatched one only gets an issue badge, and a mismatched video the timeline
      // plays opens the review dialog straight away (exactly like an explicit Relink…).
      const urls = new Map<string, string>()
      const videos = new Map<string, string>()
      const issues = new Map<string, 'missing' | 'mismatch'>()
      for (const entry of result.assets) {
        const asset = opened.assets.find((candidate) => candidate.id === entry.id)
        if (entry.resolution.kind === 'resolved') {
          const fingerprint = entry.resolution.candidate.media.fingerprint?.value
          if (asset?.kind === 'video') { if (fingerprint) videos.set(fingerprint, entry.resolution.candidate.url) }
          else urls.set(entry.id, entry.resolution.candidate.url)
        } else if (entry.resolution.kind === 'missing') issues.set(entry.id, 'missing')
        else if (entry.resolution.kind === 'mismatch') issues.set(entry.id, 'mismatch')
      }
      media.reset(videos, urls, issues)
      lut.hydrate(result.lutTexts)
      const migration = describeMigration(result.migrationNotes)
      const onTimeline = new Set(opened.clips.flatMap((clip) => assetIdOf(clip) ?? []))
      const mismatched = result.assets.find((entry) => entry.resolution.kind === 'mismatch' && onTimeline.has(entry.id))
      const missing = opened.assets.filter((asset) => onTimeline.has(asset.id) && issues.get(asset.id) === 'missing')
      if (mismatched && mismatched.resolution.kind === 'mismatch') {
        setPendingAssetRelink({ asset: opened.assets.find((asset) => asset.id === mismatched.id)!, candidate: mismatched.resolution.candidate })
        setNotice({ tone: 'warning', text: `A file on the timeline does not match this project. Review the differences before using it.${migration}` })
      } else if (missing.length) {
        setNotice({ tone: 'warning', text: `Project loaded${migrationNote(result.migratedFrom, result.migrationBackup)}, but ${missing.map((asset) => asset.name).join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing. Relink from the media bin.${migration}` })
      } else setNotice({ tone: result.migrationNotes.length ? 'warning' : 'info', text: `Project loaded${migrationNote(result.migratedFrom, result.migrationBackup)}${opened.assets.length ? '; media fingerprints verified' : ''}.${migration}` })
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
  }

  // Home closes the open project: flush the autosave first, and only ask when something would still be lost.
  const leaveToHome = () => { newProject(); setNotice(null); setView('home') }
  const goHome = async () => {
    if (projectPath && !migrationPending) await writeProject(projectPath, projectRef.current)
    const current = projectRef.current
    const unsaved = (current.cues.length > 0 || current.clips.length > 0 || current.assets.length > 0) && current !== lastSavedProject.current
    if (unsaved) setPendingReset({ kind: 'home' }); else leaveToHome()
  }
  const startFromHome = () => {
    setView('editor')
    setNotice({ tone: 'info', text: 'Open a video to transcribe it, or import an SRT file. The project saves automatically once you add something.' })
  }

  // Create project from current DaVinci timeline (docs/plans/resolve-textplus/04-project-from-timeline.md):
  // opens the editor with the rendered proxy on V1 at 0, linked to the Resolve timeline via `resolveLink`.
  // `applyResolveProxyResultRef` always holds this render's latest closure so the `[]`-effect below (which must
  // not re-subscribe on every keystroke) never acts on a stale `project`/`commit`.
  const applyResolveProxyResultRef = useRef<(result: ResolveProxyResult) => void>(() => {})
  applyResolveProxyResultRef.current = (result: ResolveProxyResult) => {
    setView('editor')
    addAssetsFromInspected([result.inspected], { sequenceUs: 0, trackId: null })
    const proxyAsset = findAssetByFingerprint(projectRef.current.assets.filter((asset) => asset.kind === 'video'), result.inspected.media)
    if (proxyAsset) {
      commit((current) => ({
        ...current,
        resolveLink: {
          projectName: result.timeline.projectName,
          timelineName: result.timeline.timelineName,
          timelineId: result.timeline.timelineId,
          startFrame: result.timeline.startFrame,
          fps: result.timeline.fps,
          width: result.timeline.width,
          height: result.timeline.height,
          proxyAssetId: proxyAsset.id,
          trackName: 'KathaCut',
          synced: [],
        },
      }))
    }
    setNotice({ tone: 'info', text: 'Timeline imported. Transcribe it from the Captions tab.' })
  }

  useEffect(() => window.captionStudio?.onResolveProxyProgress((message) => {
    setResolveRender((state) => state && state.requestId === message.requestId ? { ...state, percent: message.percent } : state)
  }), [])

  useEffect(() => window.captionStudio?.onResolveProxyDone((message) => {
    const current = resolveRenderRef.current
    if (!current || current.requestId !== message.requestId) return
    setResolveRender(null)
    if (message.ok) applyResolveProxyResultRef.current(message.result)
    else setNotice({ tone: 'error', text: message.message })
  }), [])

  const createFromResolve = async () => {
    if (!window.captionStudio || resolveStatus.state !== 'connected') return
    const timelineName = resolveStatus.timelineName ?? 'the current timeline'
    try {
      const { requestId } = await window.captionStudio.resolveCreateProxyStart()
      setResolveRender({ requestId, timelineName, percent: 0 })
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
  }

  const cancelResolveRender = () => {
    const requestId = resolveRender?.requestId
    setResolveRender(null)
    if (requestId) void window.captionStudio?.resolveCreateProxyCancel(requestId)
  }

  // A project made from Home gets its file in the managed projects folder as soon as it holds anything, so autosave
  // covers it from the first edit and an empty project never leaves a file behind.
  const creatingProjectFile = useRef(false)
  useEffect(() => {
    if (view !== 'editor' || projectPath !== null || creatingProjectFile.current || !window.captionStudio) return
    if (!(project.cues.length > 0 || project.clips.length > 0 || project.assets.length > 0)) return
    creatingProjectFile.current = true
    const snapshot = project
    window.captionStudio.createManagedProject({ project: snapshot }).then((result) => {
      if (viewRef.current !== 'editor') return
      if (projectRef.current === snapshot) { lastSavedProject.current = result.project; setHistory((state) => ({ ...state, present: result.project })) }
      else lastSavedProject.current = snapshot
      setProjectPath(result.path)
      setSaveStatus({ kind: 'saved', at: Date.now() })
    }).catch((error) => setNotice({ tone: 'error', text: `Could not create the project file: ${errorText(error)}` }))
      .finally(() => { creatingProjectFile.current = false })
  }, [view, project, projectPath])

  // The card image on the home screen: a frame from the first video, captured while its media is open here.
  const posterAsset = view === 'editor' && projectPath ? primaryVideoAsset(project) : null
  const posterReady = posterAsset ? Boolean(media.urlOf(posterAsset)) : false
  const posterKey = useRef<string | null>(null)
  useEffect(() => {
    const api = window.captionStudio
    const fingerprint = posterAsset?.fingerprint
    const durationUs = posterAsset?.metadata?.durationUs
    if (!api || !projectPath || !fingerprint || !durationUs || !posterReady || saveStatus?.kind !== 'saved') return
    const key = `${projectPath}|${fingerprint.value}`
    if (posterKey.current === key) return
    const requestId = crypto.randomUUID()
    let cancelled = false
    void api.loadThumbnails({ requestId, fingerprint, timestampsUs: [Math.round(durationUs / 10)], width: 320 })
      .then((result) => result.thumbnails[0] ? api.setProjectThumbnail({ path: projectPath, dataUrl: result.thumbnails[0].dataUrl }) : false)
      .then((stored) => { if (stored && !cancelled) posterKey.current = key })
      .catch(() => undefined)
    return () => { cancelled = true; void api.cancelThumbnails(requestId).catch(() => undefined) }
  }, [projectPath, posterAsset?.id, posterAsset?.fingerprint?.value, posterAsset?.metadata?.durationUs, posterReady, saveStatus?.kind])

  // The same reference check the autosave effect uses (App.tsx's autosave `useEffect`): a project
  // that has never diverged from what was last written — including a fresh, never-saved project with
  // nothing added yet — has nothing worth confirming before it is discarded.
  const hasUnsavedWork = (project.cues.length > 0 || project.clips.length > 0 || project.assets.length > 0) && project !== lastSavedProject.current
  const requestNewProject = () => { if (hasUnsavedWork) setPendingReset({ kind: 'new' }); else newProject() }
  const requestOpenProject = () => { if (hasUnsavedWork) setPendingReset({ kind: 'open' }); else void openProject() }
  const resumePendingReset = () => {
    const kind = pendingReset?.kind
    setPendingReset(null)
    if (kind === 'new') newProject(); else if (kind === 'open') void openProject(); else if (kind === 'home') leaveToHome()
  }
  const saveThenResumePendingReset = async () => {
    if (await saveProject()) resumePendingReset()
    // A cancelled or failed save leaves the dialog open so the user can retry or choose another option.
  }

  const importImageOverlay = async () => {
    if (!window.captionStudio) return
    try {
      const result = await window.captionStudio.importAsset('image')
      if (!result) return
      if (!result.ok) return setNotice({ tone: 'error', text: result.message })
      const asset: ProjectAsset = { id: crypto.randomUUID(), kind: 'image', ...result.media }
      media.register(asset, result.url)
      if (!addImageClip(asset, result.media.metadata, currentUs, null, asset)) return
      setInspectorTab('edit')
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
  }

  /** Imports an image into the media bin only; it reaches the timeline when the user drags or adds it. */
  const importImageToBin = async () => {
    if (!window.captionStudio) return
    try {
      const result = await window.captionStudio.importAsset('image')
      if (!result) return
      if (!result.ok) return setNotice({ tone: 'error', text: result.message })
      const existing = findAssetByFingerprint(projectRef.current.assets.filter((entry) => entry.kind === 'image'), result.media)
      const asset: ProjectAsset = existing ?? { id: crypto.randomUUID(), kind: 'image', ...result.media }
      media.register(asset, result.url)
      if (!existing && !runCommand({ type: 'asset-add', asset })) return
      setRailTab('media')
      setNotice({ tone: 'info', text: existing ? `${result.media.name} is already in the project.` : `Imported ${result.media.name} to the Media tab.` })
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
  }

  const relinkAsset = async (assetId: string) => {
    const asset = project.assets.find((entry) => entry.id === assetId)
    if (!window.captionStudio || !asset) return
    setNotice({ tone: 'info', text: 'Checking the selected replacement…' })
    try {
      const result = await window.captionStudio.relinkAsset(asset)
      if (!result) return setNotice(null)
      if (!result.ok) return setNotice({ tone: 'error', text: result.message })
      if (result.candidate.mismatches.length) {
        setPendingAssetRelink({ asset, candidate: result.candidate })
        setNotice({ tone: 'warning', text: 'The replacement differs from the stored file. Review the details below.' })
      } else {
        useAssetCandidate(asset, result.candidate)
        setNotice({ tone: 'info', text: `Relinked ${result.candidate.media.name}; fingerprint verified.` })
      }
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
  }
  const relinkOffline = () => { const first = offlineVideos[0] ?? offlineAssets[0]; if (first) void relinkAsset(first.id) }

  // ---- Clips ----------------------------------------------------------------------------------
  const draftClip = (changes: Partial<{ rect: CompositionRect; opacity: number; gain: number; fill: Fill; motion: BackgroundMotion; grade: Grade }>) => {
    if (!clipBase) return
    setClipDraft({ ...(clipDraft ?? clipBase), ...changes } as Clip)
  }
  const commitClip = (changes: { rect?: CompositionRect | null; opacity?: number; fit?: ClipFit; gain?: number; fill?: Fill; motion?: BackgroundMotion | null; grade?: Grade; speed?: ClipSpeed | null; enabled?: boolean }) => {
    if (!clipBase) return
    setClipDraft(null)
    runCommand({ type: 'clip-update', clipId: clipBase.id, changes, ...(unlinkedSelection ? { unlinked: true } : {}) })
  }
  const deleteClip = (ripple: boolean) => {
    if (!clipBase) return
    runCommand({ type: 'clip-delete', clipId: clipBase.id, mode: ripple ? 'ripple' : 'overwrite', ...(unlinkedSelection ? { unlinked: true } : {}) })
  }
  // ---- Linked audio (schema 15) ----------------------------------------------------------------
  const clipPartners = clipBase ? linkPartners(project.clips, clipBase) : []
  /** Unlinks the selected clip's group, or links it with the clip that carries the matching sound/picture. */
  const toggleClipLink = () => {
    if (!clipBase || (clipBase.kind !== 'video' && clipBase.kind !== 'audio')) return
    if (clipPartners.length) { runCommand({ type: 'clips-unlink', clipIds: [clipBase.id, ...clipPartners.map((clip) => clip.id)] }); return }
    const wantKind = clipBase.kind === 'video' ? 'audio' : 'video'
    const overlap = (clip: Clip) => Math.min(clipEndUs(clip), clipEndUs(clipBase)) - Math.max(clip.timelineStartUs, clipBase.timelineStartUs)
    const match = project.clips.filter((clip) => clip.kind === wantKind && clip.assetId === clipBase.assetId && !linkIdOf(clip) && overlap(clip) > 0).sort((a, b) => overlap(b) - overlap(a))[0]
    if (!match) { setNotice({ tone: 'info', text: `No unlinked ${wantKind} clip of the same file overlaps this clip to link with.` }); return }
    runCommand({ type: 'clips-link', clipIds: [clipBase.id, match.id], linkId: crypto.randomUUID() })
  }
  const canDetachAudio = clipBase?.kind === 'video' && !clipBase.detachedAudio && !clipBase.linkId
    && Boolean(project.assets.find((asset) => asset.id === clipBase.assetId)?.metadata?.streams.some((stream) => stream.kind === 'audio'))
  const detachAudio = () => {
    if (!clipBase || clipBase.kind !== 'video') return
    const { trackId, track } = placementTrack('audio', { startUs: clipBase.timelineStartUs, endUs: clipEndUs(clipBase) })
    runCommand({ type: 'clip-detach-audio', clipId: clipBase.id, audioClipId: crypto.randomUUID(), linkId: crypto.randomUUID(), trackId, track })
  }
  const toggleClipEnabled = () => { if (clipBase) commitClip({ enabled: clipBase.enabled === false }) }
  /** A copy of a clip at the same time goes on a free track of its kind (a new one if none is free). */
  const placeCopy = (clip: Clip, startUs = clip.timelineStartUs, preferTrackId: string | null = null) => {
    const range = { startUs, endUs: startUs + clipLengthUs(clip) }
    const { trackId, track } = placementTrack(clip.kind, range, preferTrackId)
    // A copy joins no link group: a copied video gets its own new audio pair from `clip-add`.
    const { linkId: _linkId, ...unlinkedClip } = clip as Clip & { linkId?: string }
    return runCommand({ type: 'clip-add', clip: { ...unlinkedClip, id: crypto.randomUUID(), trackId, timelineStartUs: startUs } as Clip, track, idPrefix: crypto.randomUUID() })
  }
  const duplicateClip = (clip: Clip) => {
    const offset = clip.kind !== 'audio' && clip.kind !== 'adjustment' && clip.rect ? { ...clip, rect: { ...clip.rect, x: Math.min(clip.rect.x + 24, 1080 - clip.rect.width), y: clip.rect.y + 24 } } as Clip : clip
    placeCopy(offset)
  }
  const duplicateSelectedClip = () => { if (clipBase) duplicateClip(clipBase) }
  const splitClips = () => {
    const onlyIds = clipBase && currentUs > clipBase.timelineStartUs && currentUs < clipEndUs(clipBase) ? [clipBase.id] : undefined
    runCommand({ type: 'clip-split', atUs: Math.round(currentUs), clipIds: onlyIds, idPrefix: crypto.randomUUID(), ...(onlyIds && unlinkedSelection ? { unlinked: true } : {}) }, () => null)
  }
  const trimClipsTo = (edge: ClipEdge) => {
    const onlyIds = clipBase && currentUs > clipBase.timelineStartUs && currentUs < clipEndUs(clipBase) ? [clipBase.id] : undefined
    runCommand({ type: 'clip-trim-to', atUs: Math.round(currentUs), edge, clipIds: onlyIds, mode: editMode, ...(onlyIds && unlinkedSelection ? { unlinked: true } : {}) }, () => null)
  }
  const canSplitClips = project.clips.some((clip) => currentUs > clip.timelineStartUs && currentUs < clipEndUs(clip)
    && !project.tracks.find((track) => track.id === clip.trackId)?.locked)
  const moveClip = (clipId: string, trackId: string, startUs: number, unlinked = false, track?: Track) => runCommand({ type: 'clip-move', clipId, trackId, startUs, mode: editMode, idPrefix: crypto.randomUUID(), ...(track ? { track } : {}), ...(unlinked ? { unlinked: true } : {}) })
  const trimClip = (clipId: string, edge: ClipEdge, deltaUs: number, unlinked = false) => runCommand({ type: 'clip-trim', clipId, edge, deltaUs, mode: editMode, ...(unlinked ? { unlinked: true } : {}) })
  const addZoomRegion = (preset: 'zoom-in' | 'zoom-out' | 'pan' | 'ken-burns', atUs = currentUs) => {
    const startUs = Math.max(0, Math.round(atUs))
    if (preset === 'pan' || preset === 'ken-burns') {
      const { fromRect, rect } = defaultPanRects(preset, captionComposition)
      setPanFraming('end')
      return runCommand({ type: 'zoom-region-add', region: { id: crypto.randomUUID(), startUs, endUs: startUs + DEFAULT_PAN_REGION_US, fromRect, rect, easeInUs: 0, easeOutUs: 0, enabled: true } })
    }
    const region: ZoomRegion = {
      id: crypto.randomUUID(), startUs, endUs: startUs + DEFAULT_ZOOM_REGION_US,
      rect: defaultZoomRect(captionComposition),
      easeInUs: preset === 'zoom-in' ? 500_000 : 0,
      easeOutUs: preset === 'zoom-in' ? 500_000 : 700_000,
      enabled: true,
    }
    return runCommand({ type: 'zoom-region-add', region })
  }
  const moveZoomRegion = (zoomId: string, startUs: number) => runCommand({ type: 'zoom-region-move', zoomId, startUs: Math.max(0, Math.round(startUs)) })
  const trimZoomRegion = (zoomId: string, edge: 'start' | 'end', deltaUs: number) => runCommand({ type: 'zoom-region-trim', zoomId, edge, deltaUs: Math.round(deltaUs) })
  // `zoom-region-add`'s own `clampZoomRegion` already finds the copy a free spot in the one lane
  // (the nearest gap next to the original), so a duplicate needs no offset math of its own.
  const duplicateZoomRegion = (region: ZoomRegion) => runCommand({ type: 'zoom-region-add', region: { ...region, id: crypto.randomUUID() } })
  const draftZoomRegion = (zoomId: string, changes: ZoomRegionChanges) => setZoomRegionDraft({ id: zoomId, changes })
  const commitZoomRegion = (zoomId: string, changes: ZoomRegionChanges) => { setZoomRegionDraft(null); return runCommand({ type: 'zoom-region-update', zoomId, changes }) }
  // Blur has no shared lane (regions may overlap, `blurRegion.ts`), so — unlike zoom — `blur-update`
  // takes start/end directly rather than going through separate move/trim commands.
  const addBlurRegion = (preset: 'blur-area' | 'blur-frame', atUs = currentUs) => {
    const startUs = Math.max(0, Math.round(atUs))
    const region: BlurRegion = {
      id: crypto.randomUUID(), startUs, endUs: startUs + DEFAULT_BLUR_REGION_US,
      rect: preset === 'blur-area' ? defaultBlurAreaRect(captionComposition) : defaultBlurFrameRect(captionComposition),
      radius: DEFAULT_BLUR_RADIUS,
      enabled: true,
    }
    return runCommand({ type: 'blur-add', region })
  }
  const moveBlurRegion = (blurId: string, startUs: number) => {
    const region = project.blurRegions.find((candidate) => candidate.id === blurId)
    if (!region) return false
    const clampedStart = Math.max(0, Math.round(startUs))
    return runCommand({ type: 'blur-update', blurId, changes: { startUs: clampedStart, endUs: clampedStart + (region.endUs - region.startUs) } })
  }
  const trimBlurRegion = (blurId: string, edge: 'start' | 'end', deltaUs: number) => {
    const region = project.blurRegions.find((candidate) => candidate.id === blurId)
    if (!region) return false
    if (edge === 'start') return runCommand({ type: 'blur-update', blurId, changes: { startUs: Math.min(region.endUs - MIN_BLUR_REGION_US, Math.max(0, Math.round(region.startUs + deltaUs))) } })
    return runCommand({ type: 'blur-update', blurId, changes: { endUs: Math.max(region.startUs + MIN_BLUR_REGION_US, Math.round(region.endUs + deltaUs)) } })
  }
  const draftBlurRegion = (blurId: string, changes: Partial<Omit<BlurRegion, 'id'>>) => setBlurRegionDraft({ id: blurId, changes })
  const commitBlurRegion = (blurId: string, changes: Partial<Omit<BlurRegion, 'id'>>) => { setBlurRegionDraft(null); return runCommand({ type: 'blur-update', blurId, changes }) }
  // Frame-paint effects (docs/EDITING.md "Frame-paint effects"): one lane per kind, so — like zoom,
  // unlike blur — move/trim go through the clamped `effect-move`/`effect-trim` commands.
  const addFrameEffect = (preset: 'vignette' | 'letterbox-239' | 'letterbox-185' | 'fade-in' | 'fade-out' | 'fade-dip' | 'flash' | 'film-grain' | 'vhs' | 'light-particles' | 'dreamy-glow', atUs = currentUs) => {
    const startUs = Math.max(0, Math.round(atUs))
    const id = crypto.randomUUID()
    const effect: EffectRegion = preset === 'vignette' ? defaultVignette(id, startUs)
      : preset === 'letterbox-239' ? defaultLetterbox(id, startUs, 2.39)
      : preset === 'letterbox-185' ? defaultLetterbox(id, startUs, 1.85)
      : preset === 'fade-in' ? defaultFade(id, startUs, 'in')
      : preset === 'fade-out' ? defaultFade(id, startUs, 'out')
      : preset === 'fade-dip' ? defaultFade(id, startUs, 'dip')
      : preset === 'film-grain' ? defaultGrain(id, startUs)
      : preset === 'vhs' ? defaultVhs(id, startUs)
      : preset === 'light-particles' ? defaultParticles(id, startUs)
      : preset === 'dreamy-glow' ? defaultGlow(id, startUs)
      : defaultFlash(id, startUs)
    return runCommand({ type: 'effect-add', effect })
  }
  const moveEffect = (effectId: string, startUs: number) => runCommand({ type: 'effect-move', effectId, startUs: Math.max(0, Math.round(startUs)) })
  const trimEffect = (effectId: string, edge: 'start' | 'end', deltaUs: number) => runCommand({ type: 'effect-trim', effectId, edge, deltaUs: Math.round(deltaUs) })
  const draftEffect = (effectId: string, changes: EffectChanges) => setEffectDraft({ id: effectId, changes })
  const commitEffect = (effectId: string, changes: EffectChanges) => { setEffectDraft(null); return runCommand({ type: 'effect-update', effectId, changes }) }
  const commitMask = (row: LayerRow, mask: LayerMask | null) => { setMaskDraft(null); return runCommand({ type: 'mask-set', target: row.target, mask }) }
  const commitLook = (row: LayerRow, opacity: number) => { setLookDraft(null); return runCommand({ type: 'layer-look-set', target: row.target, opacity }) }
  const changeBlend = (row: LayerRow, blendMode: BlendMode) => runCommand({ type: 'layer-look-set', target: row.target, blendMode })
  const draftLook = (row: LayerRow, opacity: number) => setLookDraft({ key: row.key, target: row.target, opacity })
  const draftMask = (row: LayerRow, mask: LayerMask | null) => setMaskDraft(mask ? { key: row.key, target: row.target, mask } : null)
  const focusLayer = (row: LayerRow) => {
    setLayerFocus(row.key); setMaskEdit(null); setMaskDraft(null); setLookDraft(null)
    if (row.selection?.kind === 'cue') setSelectedId(row.selection.id)
    else if (row.selection) setSelection(row.selection)
  }
  const addMask = (row: LayerRow, shape: MaskShape['kind']) => {
    if (shape === 'path') { setMaskEdit({ key: row.key, drawing: true }); return }
    commitMask(row, defaultMask(shape, defaultMaskBounds(row, project, captionComposition)))
    setMaskEdit({ key: row.key, drawing: false })
  }
  const finishDrawnMask = (row: LayerRow, points: MaskPathPoint[]) => {
    commitMask(row, drawnMask(points))
    setMaskEdit({ key: row.key, drawing: false })
  }
  const resetMask = (row: LayerRow) => { if (row.mask) commitMask(row, { ...row.mask, shape: defaultMask(row.mask.shape.kind, defaultMaskBounds(row, project, captionComposition)).shape }) }
  const addEffectPreset = (preset: 'zoom-in' | 'zoom-out' | 'pan' | 'ken-burns' | 'blur-area' | 'blur-frame' | 'vignette' | 'letterbox-239' | 'letterbox-185' | 'fade-in' | 'fade-out' | 'fade-dip' | 'flash' | 'film-grain' | 'vhs' | 'light-particles' | 'dreamy-glow', atUs = currentUs) =>
    preset === 'zoom-in' || preset === 'zoom-out' || preset === 'pan' || preset === 'ken-burns' ? addZoomRegion(preset, atUs)
      : preset === 'blur-area' || preset === 'blur-frame' ? addBlurRegion(preset, atUs)
      : addFrameEffect(preset, atUs)
  const trackActions = {
    onUpdate: (trackId: string, changes: TrackFlags) => runCommand({ type: 'track-update', trackId, changes }),
    onReorder: (trackId: string, direction: 'forward' | 'backward') => runCommand({ type: 'track-reorder', trackId, direction }),
    onRemove: (trackId: string) => runCommand({ type: 'track-remove', trackId }),
    onAdd: (kind: Track['kind']) => runCommand({ type: 'track-add', track: newTrack(kind) }),
  }
  const captionTrackActions = {
    onUpdate: (trackId: string, changes: CaptionTrackFlags) => runCommand({ type: 'caption-track-update', trackId, changes }),
    onReorder: (trackId: string, direction: 'forward' | 'backward') => runCommand({ type: 'caption-track-reorder', trackId, direction }),
    onRemove: (trackId: string) => runCommand({ type: 'caption-track-remove', trackId }),
    onAdd: () => runCommand({ type: 'caption-track-add', track: newCaptionTrack() }),
  }

  const exportSrt = async (inRange = false) => {
    if (!window.captionStudio) return
    // Captions are stored in their video's source time; SRT for the timeline must speak sequence
    // time — what the viewer of the *exported* video actually sees. An In/Out export is the same
    // thing for the cropped project, so it starts at zero and only holds what that video shows.
    const source = inRange && activeRange ? projectInRange(project, activeRange) : project
    const cues = cuesInSequence(displayedCues(source.cues, project.shownTranslation), inRange && activeRange ? captionClips(source.tracks, source.clips) : captionVideo)
    const result = await window.captionStudio.saveText({ content: serializeSrt(cues), defaultName: `${project.title}${inRange && activeRange ? '-range' : ''}.srt` })
    if (result) setNotice({ tone: 'info', text: `Exported SRT to ${result.path}` })
  }

  /** One detection request/response round trip for the Remove Silence dialog; `App.tsx` owns the
   * fingerprint and IPC bridge so the dialog itself stays a pure "options in, ranges out" form. */
  const silenceVideo = pickedVideo
  const detectSilence = async (requestId: string, options: SilenceDetectionOptions, onProgress: (percent: number | null) => void) => {
    if (!window.captionStudio || !silenceVideo?.fingerprint) throw new Error('Open or relink the video before detecting silence.')
    const unsubscribe = window.captionStudio.onSilenceProgress((message) => {
      if (message.requestId !== requestId) return
      onProgress(message.progress.kind === 'measured' ? Math.round(message.progress.completed / message.progress.total * 100) : null)
    })
    try {
      const result = await window.captionStudio.detectSilence({ requestId, fingerprint: silenceVideo.fingerprint, thresholdDbfs: options.thresholdDbfs, minSilenceMs: options.minSilenceMs })
      return { durationUs: result.durationUs, silences: result.silences }
    } finally { unsubscribe() }
  }
  const cancelSilenceDetection = (requestId: string) => void window.captionStudio?.cancelSilenceDetection(requestId)

  const applySilenceRemoval = (ranges: { startUs: number; endUs: number }[]) => {
    if (!silenceVideo) return
    const before = sequenceDurationUs(projectRef.current.clips)
    runCommand({ type: 'clips-set', keptByAsset: [{ assetId: silenceVideo.id, ranges }], idPrefix: crypto.randomUUID() }, (warnings) => {
      const after = sequenceDurationUs(projectRef.current.clips)
      return { tone: warnings.length ? 'warning' : 'info', text: before > after
        ? `Removed ${formatClock(before - after)} of silence from ${silenceVideo.name}; new length ${formatClock(after)}.`
        : 'No silence removed; the timeline is unchanged.' }
    })
  }

  const restoreCuts = () => {
    if (!hasTrimmedClips(project)) return
    runCommand({ type: 'clips-restore' }, () => ({ tone: 'info', text: 'Restored every trimmed clip to its whole video.' }))
  }

  /** Seeks to where a caption is first seen; a caption no clip plays is only selected. */
  const seek = (cue: Cue) => {
    setSelectedId(cue.id)
    const at = cue.mediaAssetId ? firstSequenceUsOf(cue.mediaAssetId, cue.startUs, captionVideo) : hasVideo ? null : cue.startUs
    if (at !== null) seekTo(at)
    else setNotice({ tone: 'info', text: 'That caption’s part of its video is not on the timeline.' })
  }

  /** `sequenceUs` is timeline time; captions are converted by the caller. */
  const seekTo = (sequenceUs: number, cueId?: string) => {
    if (cueId !== undefined) setSelectedId(cueId)
    playback.seek(sequenceUs)
  }

  const previewCueDrag = (cue: Cue | null, seekUs?: number) => {
    setDragPreview(cue)
    if (seekUs !== undefined) seekTo(seekUs, cue?.id)
  }

  const commitCueDrag = (original: Cue, preview: Cue, mode: CueDragMode) => {
    if (mode === 'move') runCommand({ type: 'shift-time', cueId: original.id, deltaUs: preview.startUs - original.startUs })
    else runCommand({ type: 'update-time', cueId: original.id, startUs: preview.startUs, endUs: preview.endUs })
  }

  const undo = () => setHistory((state) => undoHistory(state))
  const redo = () => setHistory((state) => redoHistory(state))

  // Agent bridge handlers (useAgentBridge): each computes `history`'s pure transition itself so it
  // can hand back the resulting summary synchronously, the same reasoning as `runCommands` above.
  const agentUndoRedo = (transition: typeof undoHistory | typeof redoHistory): ProjectSummary => {
    const next = transition(history)
    if (next !== history) { projectRef.current = next.present; setHistory(next) }
    return summarizeAgentState(projectRef.current, selectionRef.current)
  }
  /** An image clip (with the asset inline when it is new) placed by an agent: same default size and length as a dropped image, one `clip-add` so asset and clip undo together. */
  const buildAgentImageClip = (asset: ProjectAsset, metadata: MediaMetadata | null, placement: Extract<AgentRequest, { kind: 'place-image' }>['placement'], inlineAsset?: ProjectAsset) => {
    const startUs = Math.max(0, Math.round(placement.startUs))
    const lengthUs = placement.durationUs ?? DEFAULT_IMAGE_CLIP_US
    const { trackId, track } = placementTrack('image', { startUs, endUs: startUs + lengthUs }, placement.trackId)
    const clip: Clip = { kind: 'image', id: crypto.randomUUID(), trackId, assetId: asset.id, timelineStartUs: startUs, sourceStartUs: 0, sourceEndUs: lengthUs,
      rect: placement.rect ?? defaultOverlayRect(metadata, captionComposition), opacity: 1, fit: 'contain' }
    const command: EditCommand = { type: 'clip-add', clip, asset: inlineAsset, track, idPrefix: crypto.randomUUID() }
    return { clip, command }
  }
  /** `runCommands`, but a failure throws the real validation message (the bridge turns it into a tool error) instead of returning outcomes. */
  const runAgentCommands = (commands: EditCommand[], what: string): ProjectSummary => {
    const result = runCommands(commands)
    if (result.failedIndex !== null) {
      const failed = result.outcomes[result.failedIndex]
      throw new Error(`${what} failed: ${failed && !failed.ok ? failed.errors.map((issue) => issue.message).join('; ') : 'unknown error'}`)
    }
    return result.state
  }
  const agentHandlers: AgentBridgeHandlers = {
    getState: () => summarizeAgentState(projectRef.current, selectionRef.current),
    getCaptions: ({ range, cueIds }) => {
      const idSet = cueIds ? new Set(cueIds) : null
      const cues = projectRef.current.cues.filter((cue) =>
        (!idSet || idSet.has(cue.id)) && (!range || (cue.startUs < range.endUs && cue.endUs > range.startUs)))
      return { cues, total: cues.length }
    },
    getTranscript: () => {
      const cues = cuesInSequence(projectRef.current.cues, captionClips(projectRef.current.tracks, projectRef.current.clips))
      const kept = new Set(cues.map((cue) => cue.id.split(':')[0]))
      return { cues, omitted: projectRef.current.cues.filter((cue) => !kept.has(cue.id)).length }
    },
    runCommands,
    seek: (sequenceUs) => { seekTo(sequenceUs); return summarizeAgentState(projectRef.current, selectionRef.current) },
    select: (nextSelection) => { selectionRef.current = nextSelection; setSelection(nextSelection); return summarizeAgentState(projectRef.current, nextSelection) },
    undo: () => agentUndoRedo(undoHistory),
    redo: () => agentUndoRedo(redoHistory),
    matchReference: async ({ imageBase64, mimeType, sequenceUs, startUs, endUs, strength, name }) => {
      const before = projectRef.current
      const at = Math.min(Math.max(0, Math.round(sequenceUs ?? clock.getUs())), durationUs)
      const under = videoUnderPlayhead(at, before.tracks, before.clips)
      if (!under || under.clip.kind !== 'video') throw new Error('No video clip plays at that time. Pass sequenceUs on a video clip so the match has a frame to start from.')
      const frame = videoFrameRef.current
      if (!frame) throw new Error('There is no preview to read a frame from.')
      if (playback.playing) playback.pause()
      seekTo(at)
      if (!(await waitForFramePaint(frame, () => clock.getUs(), at))) throw new Error('The preview did not finish drawing that frame in time. Make sure the KathaCut window is visible, then retry.')
      const source = captureFrame(playback.transport.elementFor(under.clip.trackId, under.clip.assetId) as HTMLVideoElement | null, 320)
      if (!source) throw new Error('The frame could not be read from the video (still decoding, or an unsupported codec).')
      const reference = await loadReferencePixels(`data:${mimeType};base64,${imageBase64}`)
      const label = name ?? 'Reference match'
      const cubeText = writeCube(bakeMatch(deriveMatch(source, reference), strength, 33, label))
      const saved = await window.captionStudio?.saveGeneratedLut({ text: cubeText, name: label, defaultDir: null, silent: true })
      if (!saved || !saved.ok) throw new Error(saved && !saved.ok ? saved.message : 'The LUT could not be saved.')
      const { candidate } = saved
      const known = findAssetByFingerprint(before.assets.filter((asset) => asset.kind === 'lut'), candidate.media)
      const asset: ProjectAsset = known ?? { id: crypto.randomUUID(), kind: 'lut', ...candidate.media }
      lut.register(asset.id, candidate.text!)
      const range = { startUs: startUs ?? 0, endUs: endUs ?? sequenceDurationUs(before.clips) }
      if (range.endUs <= range.startUs) throw new Error('The grade range is empty: endUs must be after startUs.')
      const existingTrack = topAdjustmentTrackFor(before.tracks, before.clips, range)
      const track = existingTrack ? undefined : newTrack('video')
      const clip: Clip = { kind: 'adjustment', id: crypto.randomUUID(), trackId: existingTrack ?? track!.id, timelineStartUs: range.startUs, sourceStartUs: 0, sourceEndUs: range.endUs - range.startUs,
        grade: gradeSchema.parse({ ...NEUTRAL_GRADE, input: { type: 'lut', assetId: asset.id } }) }
      const commands: EditCommand[] = [...(known ? [] : [{ type: 'asset-add' as const, asset }]), { type: 'clip-add', clip, track, idPrefix: crypto.randomUUID() }]
      const result = runCommands(commands)
      if (result.failedIndex !== null) {
        const failed = result.outcomes[result.failedIndex]
        throw new Error(`The grade could not be added: ${failed && !failed.ok ? failed.errors.map((issue) => issue.message).join('; ') : 'unknown error'}`)
      }
      return { match: { lutName: candidate.media.name, lutPath: null, clipId: clip.id, startUs: range.startUs, endUs: range.endUs, sourceFrameUs: at }, state: result.state }
    },
    importInspected: ({ inspected, placement }) => {
      if (placement && inspected.kind !== 'image') throw new Error('Only images can be placed on import. Import the file without a placement, then add it to the timeline.')
      const current = projectRef.current
      const existing = findAssetByFingerprint(current.assets.filter((asset) => asset.kind === inspected.kind), inspected.media)
      const asset: ProjectAsset = existing ?? { id: crypto.randomUUID(), kind: inspected.kind, ...inspected.media }
      media.register({ id: asset.id, kind: inspected.kind, fingerprint: inspected.media.fingerprint }, inspected.url)
      const built = placement ? buildAgentImageClip(asset, inspected.media.metadata, placement, existing ? undefined : asset) : null
      const commands: EditCommand[] = built ? [built.command] : existing ? [] : [{ type: 'asset-add', asset }]
      const state = commands.length ? runAgentCommands(commands, 'The import') : summarizeAgentState(projectRef.current, selectionRef.current)
      const imported = { assetId: asset.id, kind: inspected.kind, name: asset.name, alreadyInProject: Boolean(existing), clipId: built?.clip.id ?? null, startUs: built ? built.clip.timelineStartUs : null, endUs: built ? built.clip.timelineStartUs + (built.clip.sourceEndUs - built.clip.sourceStartUs) : null }
      return { imported, state }
    },
    placeImage: ({ assetId, placement }) => {
      const asset = projectRef.current.assets.find((candidate) => candidate.id === assetId)
      if (!asset) throw new Error(`No asset "${assetId}" in the project. Call get_project for asset ids, or import_media first.`)
      if (asset.kind !== 'image') throw new Error(`"${asset.name}" is a ${asset.kind}, not an image; only images can be placed this way.`)
      const { clip, command } = buildAgentImageClip(asset, asset.metadata ?? null, placement)
      const state = runAgentCommands([command], 'Placing the image')
      return { placed: { clipId: clip.id, assetId, trackId: clip.trackId, startUs: clip.timelineStartUs, endUs: clip.timelineStartUs + (clip.sourceEndUs - clip.sourceStartUs) }, state }
    },
    prepareSnapshot: async (sequenceUs) => {
      const frame = videoFrameRef.current
      if (!frame) return null
      if (stageView.scale !== 1) { setStageView({ scale: 1, x: 0, y: 0 }); await new Promise((resolve) => requestAnimationFrame(() => resolve(null))) }
      const target = Math.min(Math.max(0, Math.round(sequenceUs)), durationUs)
      if (playback.playing) playback.pause()
      seekTo(target)
      if (!(await waitForFramePaint(frame, () => clock.getUs(), target))) throw new Error('The preview did not finish drawing that frame in time. Make sure the KathaCut window is visible and the media is available, then retry.')
      const { x, y, width, height } = frame.getBoundingClientRect()
      return { x, y, width, height }
    },
  }
  useAgentBridge(agentHandlers)

  const togglePlayback = () => {
    if (!project.clips.length && !project.cues.length) return setNotice({ tone: 'error', text: 'Open a video or import captions before playing.' })
    if (playback.playing) return playback.pause()
    // Playing from outside the In/Out range starts at In; from inside it, continues to Out.
    if (activeRange && (currentUs < activeRange.startUs || currentUs >= activeRange.endUs)) playback.seek(activeRange.startUs)
    playback.play()
  }
  const markIn = () => { const at = Math.round(currentUs); setMarks((current) => ({ inUs: at, outUs: current.outUs !== null && current.outUs <= at ? null : current.outUs })) }
  const markOut = () => { const at = Math.round(currentUs); setMarks((current) => ({ inUs: current.inUs !== null && current.inUs >= at ? null : current.inUs, outUs: at })) }
  const clearRange = () => setMarks({ inUs: null, outUs: null })

  const seekBy = (deltaUs: number) => seekTo(Math.max(0, Math.min(durationUs, currentUs + deltaUs)))

  const selectAdjacentCue = (direction: -1 | 1) => {
    const cues = cuesForLanguage(project.cues, captionLanguageTab)
    if (!cues.length) return
    const selectedIndex = cues.findIndex((cue) => cue.id === selectedCueId)
    const nextIndex = selectedIndex < 0 ? (direction > 0 ? 0 : cues.length - 1) : Math.max(0, Math.min(cues.length - 1, selectedIndex + direction))
    const cue = cues[nextIndex]
    seek(cue)
    setFocusCueId(cue.id)
  }

  /** The selected caption's own source time under the playhead, when a clip of its video is there. */
  const sourceUsForCue = (cue: Cue | null): number | null => {
    if (!cue) return null
    if (!cue.mediaAssetId) return hasVideo ? null : currentUs
    return sourceUsOfAssetAt(currentUs, cue.mediaAssetId, project.tracks, project.clips)?.sourceUs ?? null
  }
  const selectedSourceUs = sourceUsForCue(selected)

  const splitSelectedCue = () => {
    if (!selected) return setNotice({ tone: 'error', text: 'Select a cue before splitting it.' })
    if (selectedSourceUs === null) return setNotice({ tone: 'error', text: 'Move the playhead over the caption’s video to split it there.' })
    runCommand({ type: 'split', cueId: selected.id, atUs: Math.round(selectedSourceUs), rightCueId: crypto.randomUUID() })
  }

  const deleteSelectedCue = () => {
    if (!selected) return setNotice({ tone: 'error', text: 'Select a cue before deleting it.' })
    runCommand({ type: 'delete', cueId: selected.id })
  }

  const mergeSelectedCue = () => {
    if (!selected) return setNotice({ tone: 'error', text: 'Select a cue before merging it.' })
    runCommand({ type: 'merge-next', cueId: selected.id })
  }

  const trimSelectedCueTo = (edge: ClipEdge) => {
    if (!selected) return setNotice({ tone: 'error', text: 'Select a cue before trimming it.' })
    if (selectedSourceUs === null) return setNotice({ tone: 'error', text: 'Move the playhead over the caption’s video to trim it there.' })
    runCommand({ type: 'update-time', cueId: selected.id, startUs: edge === 'start' ? Math.round(selectedSourceUs) : selected.startUs, endUs: edge === 'end' ? Math.round(selectedSourceUs) : selected.endUs })
  }

  // A caption is added in the source time of the video under the playhead (or, with no video at
  // all, in sequence time), and never runs past the end of the clip it starts in.
  const canAddCue = hasVideo ? under !== null : currentUs < durationUs
  const canSplitSelected = selected !== null && selectedSourceUs !== null && selectedSourceUs > selected.startUs && selectedSourceUs < selected.endUs
  const canMergeSelected = selected !== null && project.cues.at(-1)?.id !== selected.id
  // One Split / Trim / Delete set: it acts on the selected caption, otherwise on clips.
  const rippleClipDelete = editMode === 'ripple' && selection?.kind === 'clip'
  const editTools: EditTools = selected
    ? {
      split: splitSelectedCue, canSplit: canSplitSelected, splitLabel: 'Split caption at playhead (S)',
      trimTo: trimSelectedCueTo, canTrim: canSplitSelected, trimLabels: { start: 'Trim caption start to playhead', end: 'Trim caption end to playhead' },
      remove: () => deleteSelection(false), canRemove: true, removeLabel: selectedWord ? 'Delete selected word (Delete)' : 'Delete selected caption (Delete)',
    }
    : {
      split: splitClips, canSplit: canSplitClips, splitLabel: 'Split clips at the playhead (Ctrl/⌘+B)',
      trimTo: trimClipsTo, canTrim: canSplitClips, trimLabels: { start: 'Trim clip start to the playhead (Q)', end: 'Trim clip end to the playhead (W)' },
      remove: () => deleteSelection(rippleClipDelete), canRemove: selection !== null,
      removeLabel: rippleClipDelete ? 'Ripple delete the selected clip (Shift+Delete)' : selection?.kind === 'clip' ? 'Lift the selected clip, leaving a gap (Delete)' : 'Delete the selected item (Delete)',
    }

  const addCue = (lengthUs = 2 * US_PER_SECOND) => {
    if (hasVideo && !under) { setNotice({ tone: 'error', text: 'Move the playhead over a video to add a caption there.' }); return }
    const startUs = Math.round(under ? under.sourceUs : currentUs)
    const limitUs = under ? under.clip.sourceEndUs : durationUs
    if (startUs >= limitUs) { setNotice({ tone: 'error', text: 'Move the playhead before the end of the media to add a cue.' }); return }
    const endUs = Math.min(startUs + lengthUs, limitUs)
    runCommand({ type: 'add', cue: { id: crypto.randomUUID(), ...(underAssetId ? { mediaAssetId: underAssetId } : {}), ...(captionLanguageTab ? { translationLanguage: captionLanguageTab } : {}), startUs, endUs, text: '', timingSource: 'manual', needsReview: false, textSource: 'user', words: [] } })
  }
  const addWord = () => addCue(600_000)

  const onSelectWord = (cue: Cue, word: CaptionWord) => {
    const at = cue.mediaAssetId ? firstSequenceUsOf(cue.mediaAssetId, word.startUs, captionVideo) : hasVideo ? null : word.startUs
    setSelectedId(cue.id)
    if (at !== null) seekTo(at, cue.id)
    setSelectedWordId(word.id)
  }
  // The captions panel also lets the user click a token that has no word timing yet. There is no
  // honest time to seek to for it, so it only selects the caption and clears any word selection.
  const onSelectSpan = (cue: Cue, span: TranscriptSpan) => {
    if (span.word) return onSelectWord(cue, span.word)
    setSelectedId(cue.id)
    setSelectedWordId(null)
  }

  const deleteSelectedWord = () => {
    if (!selected || !selectedWord) return
    const index = selected.words.findIndex((word) => word.id === selectedWord.id)
    // delete-word never assigns new ids to the words it keeps (only offsets shift), so the
    // remaining list is exactly today's list minus the deleted word.
    const remaining = selected.words.filter((word) => word.id !== selectedWord.id)
    if (!runCommand({ type: 'delete-word', cueId: selected.id, target: { wordId: selectedWord.id } })) return
    setSelectedWordId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null)
  }

  const setTimelineDisplay = (next: CaptionDisplay) => {
    setSelectedWordId(null)
    runCommand({ type: 'set-timeline-display', display: next })
  }
  const setCaptionDisplay = (next: CaptionDisplay) => runCommand({ type: 'set-caption-display', display: next })

  const draftStyle = (style: CaptionStyle) => selectedText ? setTextStyleDraft({ id: selectedText.id, style }) : setStyleDraft(style)
  const commitStyle = (style: CaptionStyle) => {
    if (selectedText) { setTextStyleDraft(null); runCommand({ type: 'text-update', textId: selectedText.id, changes: { style } }); return }
    setStyleDraft(null); commit((state) => ({ ...state, captionStyle: style }))
  }
  const applyTemplate = (style: CaptionStyle, template?: CaptionTemplate) => {
    setStyleDraft(null)
    if (selectedText) {
      setTextStyleDraft(null)
      runCommand({ type: 'text-update', textId: selectedText.id, changes: template
        ? titleTemplateChanges(template, selectedText)
        : { style: applyCaptionTemplateToText(style, selectedText.style) } })
      return
    }
    const needsEstimates = project.cues.some((cue) =>
      ['active-word-highlight', 'word-pop', 'progressive-word-reveal'].includes(cue.motionOverride?.motion ?? style.motion)
      && untimedTokenCount(cue) > 0)
    runCommand({ type: 'apply-template', style, idPrefix: crypto.randomUUID() }, (warnings) => {
      const skipped = warnings.filter((warning) => warning.kind === 'estimate-skipped').length
      const overlaps = warnings.filter((warning) => warning.kind === 'overlap').length
      const details = [
        needsEstimates ? 'Missing word timings were added as review-required estimates.' : '',
        skipped ? `${skipped} caption${skipped === 1 ? '' : 's'} could not be estimated and will use the static fallback.` : '',
        overlaps ? `Preserved ${overlaps} existing overlap${overlaps === 1 ? '' : 's'}.` : '',
      ].filter(Boolean).join(' ')
      return { tone: skipped || overlaps ? 'warning' : 'info', text: `Template applied to all captions.${details ? ` ${details}` : ''}` }
    })
  }
  const lastTextStyle = useRef<CaptionStyle | null>(null)
  if (selectedText) lastTextStyle.current = selectedText.style
  const addTextAtPlayhead = (anchor?: TextAnchor) => {
    if (durationUs <= 0) { setNotice({ tone: 'warning', text: 'Add a video or caption with duration before adding text.' }); return }
    const startUs = Math.min(currentUs, Math.max(0, durationUs - 1))
    const endUs = Math.min(durationUs, startUs + 3 * US_PER_SECOND)
    const overlay = defaultTextOverlay(crypto.randomUUID(), startUs, endUs, undefined, lastTextStyle.current ?? project.textOverlays.at(-1)?.style)
    if (anchor) overlay.style = { ...overlay.style, appearance: { ...overlay.style.appearance, ...anchor } }
    if (startUs !== currentUs) playback.seek(startUs)
    setInspectorTab('edit')
    if (runCommand({ type: 'text-add', overlay })) setEditingText({ id: overlay.id, selectAll: true })
  }
  const addShapeAtPlayhead = (preset: ShapePreset) => {
    if (durationUs <= 0) { setNotice({ tone: 'warning', text: 'Add a video or caption with duration before adding a shape.' }); return }
    const startUs = Math.min(currentUs, Math.max(0, durationUs - 1))
    const endUs = Math.min(durationUs, startUs + 3 * US_PER_SECOND)
    if (startUs !== currentUs) playback.seek(startUs)
    setInspectorTab('edit')
    runCommand({ type: 'shape-add', shape: defaultShape(preset, crypto.randomUUID(), startUs, endUs, captionComposition.height) })
  }
  const addTemplateAtPlayhead = async (templateId: string, glass: boolean) => {
    const builder = getTemplate(templateId)
    if (!builder) return
    if (durationUs <= 0) { setNotice({ tone: 'warning', text: 'Add a video or caption with duration before adding a template.' }); return }
    const startUs = Math.min(currentUs, Math.max(0, durationUs - 1))
    const endUs = Math.min(durationUs, startUs + 4 * US_PER_SECOND)
    const measured: Record<string, { width: number; height: number }> = {}
    for (const text of builder.texts) {
      const block = await measureTitleBlock(text.text, text.style, captionComposition)
      if (!block) { setNotice({ tone: 'warning', text: `The “${builder.name}” template could not measure its text.` }); return }
      measured[text.key] = { width: block.width, height: block.height }
    }
    if (startUs !== currentUs) playback.seek(startUs)
    setInspectorTab('edit')
    runCommand({ type: 'template-insert', templateId, startUs, endUs, at: { x: captionComposition.width / 2, y: captionComposition.height / 2 }, measured,
      ids: { group: crypto.randomUUID(), items: Object.fromEntries(builder.memberKeys.map((key) => [key, crypto.randomUUID()])) }, ...(glass ? { glass: true } : {}) })
  }
  const addTextFromPreview = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('.caption-overlay-hit, .text-overlay-hit, .overlay-handle, .zoom-hit, .blur-hit, button, input, textarea')) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const anchor = textAnchorAt(event.clientX, event.clientY, { left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    if (anchor) addTextAtPlayhead(anchor)
  }
  const savePreset = (name: string) => { setStyleDraft(null); commit((state) => saveCaptionPreset(state, name, effectiveStyle, () => crypto.randomUUID())) }
  const applyPreset = (id: string) => {
    setStyleDraft(null)
    if (selectedText) {
      const preset = project.savedCaptionPresets?.find((entry) => entry.id === id)
      if (!preset) return
      runCommand({ type: 'text-update', textId: selectedText.id, changes: { style: applyCaptionTemplateToText(preset.style, selectedText.style) } })
      return
    }
    commit((state) => applyCaptionPreset(state, id))
  }
  const deletePreset = (id: string) => commit((state) => deleteCaptionPreset(state, id))

  // ---- Groups (schema 22): selection, pending group, and the actions that treat a group as one item ----
  const pendingItems = selection && (selection.kind === 'shape' || selection.kind === 'text') && pendingGroup.some((entry) => entry.id === selection.id)
    ? pendingGroup.filter((entry) => entry.kind === 'shape' ? project.shapes.some((item) => item.id === entry.id) : project.textOverlays.some((item) => item.id === entry.id)) : []
  const groupIdOf = (kind: 'shape' | 'text', id: string) => (kind === 'shape' ? project.shapes : project.textOverlays).find((item) => item.id === id)?.groupId
  /** A click on a shape or title (stage, timeline or Layers tab): Ctrl/Shift adds it to the pending group, a plain click selects its group, Alt selects just the part. */
  const selectGraphic = (kind: 'shape' | 'text', id: string) => {
    const { multi, alt } = modifiersRef.current
    const current = selectionRef.current
    if (multi) {
      if (groupIdOf(kind, id)) { setNotice({ tone: 'error', text: 'That item is already in a group. Alt-click selects it on its own; ungroup it before grouping it again.' }); return }
      const base = pendingItems.length ? pendingItems : current && (current.kind === 'shape' || current.kind === 'text') && !groupIdOf(current.kind, current.id) ? [{ kind: current.kind, id: current.id }] : []
      const next = base.some((entry) => entry.id === id) ? base.filter((entry) => entry.id !== id) : [...base, { kind, id }]
      setPendingGroup(next); setSelection({ kind, id })
      if (next.length >= 2) setNotice({ tone: 'info', text: `${next.length} items picked. Press ${shortcutLabel('G')} to group them.` })
      return
    }
    setPendingGroup([])
    const groupId = groupIdOf(kind, id)
    if (groupId && !alt && !(current?.kind === kind && current.id === id)) setSelection({ kind: 'group', id: groupId })
    else setSelection({ kind, id })
  }
  /** Double-click or Alt-click: the part itself, even when it belongs to a group. */
  const selectPart = (kind: 'shape' | 'text', id: string) => { setPendingGroup([]); setSelection({ kind, id }) }
  const groupItems = () => {
    if (pendingItems.length < 2) return setNotice({ tone: 'error', text: 'Ctrl/Shift-click two or more shapes or titles first, then group them.' })
    const groupId = crypto.randomUUID()
    if (runCommand({ type: 'group-create', groupId, itemIds: pendingItems.map((entry) => entry.id) }, () => ({ tone: 'info', text: `Grouped ${pendingItems.length} items.` }))) {
      setPendingGroup([]); setSelection({ kind: 'group', id: groupId })
    }
  }
  const selectedGroupId = selection?.kind === 'group' ? selection.id
    : selection && (selection.kind === 'shape' || selection.kind === 'text') ? groupIdOf(selection.kind, selection.id) ?? null : null
  const ungroupItems = (groupId: string | null = selectedGroupId) => {
    if (!groupId) return setNotice({ tone: 'error', text: 'Select a group to ungroup it.' })
    const members = groupMembers(project, groupId)
    // Ungrouping keeps every item; select the first one so the user lands on something editable.
    if (runCommand({ type: 'group-ungroup', groupId }, () => ({ tone: 'info', text: 'Ungrouped.' })) && members[0]) setSelection({ kind: members[0].kind, id: members[0].item.id })
  }
  const duplicateGroup = (groupId: string) => {
    const idMap: Record<string, string> = { [groupId]: crypto.randomUUID() }
    for (const member of groupMembers(project, groupId)) idMap[member.item.id] = crypto.randomUUID()
    if (runCommand({ type: 'group-duplicate', groupId, idMap })) setSelection({ kind: 'group', id: idMap[groupId] })
  }
  /** Moving a grouped item moves the whole group (the drag keeps its offset); Alt moves just that item. */
  const moveGraphic = (kind: 'shape' | 'text', id: string, startUs: number) => {
    const item = (kind === 'shape' ? project.shapes : project.textOverlays).find((entry) => entry.id === id)
    const span = item?.groupId && !modifiersRef.current.alt ? groupSpan(project, item.groupId) : null
    if (item?.groupId && span) { runCommand({ type: 'group-move', groupId: item.groupId, startUs: span.startUs + (startUs - item.startUs) }); return }
    if (kind === 'shape') runCommand({ type: 'shape-move', shapeId: id, startUs }); else runCommand({ type: 'text-move', textId: id, startUs })
  }
  const groupRectCommand = (groupId: string, base: CompositionRect, rect: CompositionRect): GroupCommand => {
    if (Math.abs(rect.width - base.width) < .5 && Math.abs(rect.height - base.height) < .5) return { type: 'group-translate', groupId, dx: rect.x - base.x, dy: rect.y - base.y }
    // A corner resize keeps the opposite corner fixed; that corner is the scale anchor.
    const anchor = {
      x: Math.abs(rect.x - base.x) <= Math.abs(rect.x + rect.width - base.x - base.width) ? base.x : base.x + base.width,
      y: Math.abs(rect.y - base.y) <= Math.abs(rect.y + rect.height - base.y - base.height) ? base.y : base.y + base.height,
    }
    return { type: 'group-scale', groupId, factor: Math.max(.01, rect.width / base.width), anchor }
  }
  const draftGroupRect = (groupId: string, rect: CompositionRect | null) => {
    if (!rect || !groupBox) { setGroupDraft(null); groupBaseRef.current = null; return }
    const base = groupBaseRef.current ?? groupBox
    groupBaseRef.current = base
    setGroupDraft({ command: groupRectCommand(groupId, base, rect), rect, base })
  }
  const commitGroupRect = (groupId: string, rect: CompositionRect) => {
    const base = groupBaseRef.current ?? groupBox
    setGroupDraft(null); groupBaseRef.current = null
    if (base) runCommand(groupRectCommand(groupId, base, rect))
  }
  const groupsHere = useMemo(() => {
    const map = new Map<string, { name: string; startUs: number; endUs: number; count: number }>()
    for (const group of project.groups ?? []) {
      const span = groupSpan(project, group.id)
      if (span) map.set(group.id, { name: group.name, ...span })
    }
    return map
  }, [project])

  const deleteSelection = (ripple: boolean) => {
    if (selection?.kind === 'group') return runCommand({ type: 'group-delete', groupId: selection.id })
    if (selection?.kind === 'clip') return deleteClip(ripple)
    if (selection?.kind === 'blur') return runCommand({ type: 'blur-delete', blurId: selection.id })
    if (selection?.kind === 'zoomRegion') return runCommand({ type: 'zoom-region-delete', zoomId: selection.id })
    if (selection?.kind === 'effect') return runCommand({ type: 'effect-delete', effectId: selection.id })
    if (selection?.kind === 'text') return runCommand({ type: 'text-delete', textId: selection.id })
    if (selection?.kind === 'shape') return runCommand({ type: 'shape-delete', shapeId: selection.id })
    if (ripple) return
    if (selectedWord) return deleteSelectedWord()
    return deleteSelectedCue()
  }

  const copySelection = () => {
    if (!selection) return setNotice({ tone: 'error', text: 'Select an item before copying it.' })
    if (selection.kind !== 'cue' && selection.kind !== 'clip' && selection.kind !== 'text' && selection.kind !== 'zoomRegion') {
      return setNotice({ tone: 'error', text: 'This item can’t be copied yet.' })
    }
    setClipboardItem({ kind: selection.kind, id: selection.id })
  }

  const pasteClipboard = () => {
    if (!clipboardItem) return setNotice({ tone: 'error', text: 'Copy an item before pasting it.' })
    if (clipboardItem.kind === 'cue') {
      const cue = project.cues.find((item) => item.id === clipboardItem.id)
      if (!cue) return setNotice({ tone: 'error', text: 'That caption no longer exists.' })
      runCommand({ type: 'duplicate', cueId: cue.id, duplicateId: crypto.randomUUID() })
    } else if (clipboardItem.kind === 'clip') {
      const clip = project.clips.find((item) => item.id === clipboardItem.id)
      if (!clip) return setNotice({ tone: 'error', text: 'That clip no longer exists.' })
      duplicateClip(clip)
    } else if (clipboardItem.kind === 'zoomRegion') {
      const region = project.zoomRegions.find((item) => item.id === clipboardItem.id)
      if (!region) return setNotice({ tone: 'error', text: 'That zoom region no longer exists.' })
      duplicateZoomRegion(region)
    } else {
      const overlay = project.textOverlays.find((item) => item.id === clipboardItem.id)
      if (!overlay) return setNotice({ tone: 'error', text: 'That text item no longer exists.' })
      runCommand({ type: 'text-duplicate', textId: overlay.id, duplicateId: crypto.randomUUID() })
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = shortcutForEvent(event, event.target)
      if (!action) return
      // Space must toggle exactly once: a held key auto-repeats keydown.
      if (action === 'toggle-playback' && event.repeat) return
      // A focused native button/link still gets its own Space activation (including the transport's
      // own Play/Pause button, which does the right thing either way). Timeline/caption `[role="button"]`
      // items no longer consume Space themselves (Enter selects instead), so Space reaches playback
      // even while a cue card, clip block or word is selected.
      if (action === 'toggle-playback' && event.target instanceof Element && event.target.closest('button, summary, a')) return
      event.preventDefault()
      const actions: Record<ShortcutAction, () => void> = {
        'toggle-playback': togglePlayback,
        'seek-backward': () => seekBy(-US_PER_SECOND),
        'seek-forward': () => seekBy(US_PER_SECOND),
        'split-cue': splitSelectedCue,
        'delete-cue': () => deleteSelection(false),
        'ripple-delete': () => deleteSelection(true),
        'split-clips': splitClips,
        'toggle-clip-enabled': toggleClipEnabled,
        'toggle-clip-link': toggleClipLink,
        'mark-in': markIn,
        'mark-out': markOut,
        'go-to-in': () => { if (activeRange) seekTo(activeRange.startUs) },
        'go-to-out': () => { if (activeRange) seekTo(activeRange.endUs) },
        'clear-range': clearRange,
        'trim-start-to-playhead': () => trimClipsTo('start'),
        'trim-end-to-playhead': () => trimClipsTo('end'),
        undo,
        redo,
        'previous-cue': () => selectAdjacentCue(-1),
        'next-cue': () => selectAdjacentCue(1),
        'show-shortcuts': () => setSettingsTab('shortcuts'),
        'copy-item': copySelection,
        'paste-item': pasteClipboard,
        'group-items': groupItems,
        'ungroup-items': () => ungroupItems(),
      }
      actions[action]()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  // Native menu commands run whatever the handlers are on the latest render.
  const menuHandlers = useRef<Record<MenuCommand, () => void>>(null!)
  menuHandlers.current = {
    'go-home': () => { if (view === 'editor') void goHome() },
    'new-project': () => view === 'home' ? startFromHome() : requestNewProject(),
    'open-video': () => void openVideo(), 'import-srt': () => void importSrt(), 'open-project': requestOpenProject,
    'save-project': () => void saveProject(), 'save-project-as': () => void saveProjectAs(),
    // The native accelerators fire even while typing; a focused field keeps its own edit history.
    undo: () => isEditableTarget(document.activeElement) ? void window.captionStudio?.editText('undo') : undo(),
    redo: () => isEditableTarget(document.activeElement) ? void window.captionStudio?.editText('redo') : redo(),
    'export-srt': () => { if (project.cues.length) void exportSrt() },
    'export-video': () => { if (exportVideoBlocker === null) setExportDialogOpen(true) },
    'remove-silence': () => { if (hasVideo) setSilenceDialogOpen(true) },
    'restore-cuts': () => restoreCuts(),
    settings: () => setSettingsTab('models'), shortcuts: () => setSettingsTab('shortcuts'),
  }
  // Editor-only commands do nothing while the start page is showing.
  useEffect(() => window.captionStudio?.onMenuCommand((command) => {
    if (viewRef.current === 'home' && !(['new-project', 'open-project', 'settings', 'shortcuts'] as MenuCommand[]).includes(command)) return
    menuHandlers.current[command]()
  }), [])

  const pickedReady = Boolean(pickedVideo?.fingerprint && media.urlOf(pickedVideo))
  const exportVideoBlocker = exportState.kind === 'running' ? 'An export is already running' : exportState.kind === 'unsupported' ? exportState.reason
    : exportState.kind === 'error' ? exportState.message
    : exportState.kind === 'checking-support' || exportState.kind === 'idle' ? 'Checking export support…'
    : !exportAssets.length && !project.clips.some((clip) => clip.kind === 'color') ? 'Add a video, image, sound or background to the timeline first'
    : !hasVideo && !project.format ? 'Add a video first: it sets the output size'
    : offlineAssets.length ? `Relink ${offlineAssets[0].name} first`
    : offlineLuts.length ? `Relink ${offlineLuts[0].name} before exporting`
    : null
  const shortcutLabel = (key: string) => `${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'}${key}`
  const fileEntries: MenuEntry[] = [
    { id: 'go-home', label: 'Home', onSelect: () => void goHome() },
    { id: 'new-project', label: 'New project', onSelect: requestNewProject, shortcut: shortcutLabel('N') },
    { id: 'sep-new', separator: true },
    { id: 'open-video', label: 'Import video…', onSelect: () => void openVideo(), shortcut: shortcutLabel('⇧O') },
    { id: 'import-srt', label: 'Import SRT…', onSelect: () => void importSrt(), shortcut: shortcutLabel('I') },
    { id: 'sep', separator: true },
    { id: 'open-project', label: 'Open project…', onSelect: requestOpenProject, shortcut: shortcutLabel('O') },
    { id: 'save-project', label: 'Save project', onSelect: () => void saveProject(), shortcut: shortcutLabel('S') },
    { id: 'save-project-as', label: 'Save project as…', onSelect: () => void saveProjectAs(), shortcut: shortcutLabel('⇧S') },
  ]
  const saveStatusText = !projectPath ? 'Not saved · autosave off'
    : migrationPending ? 'Migrated · save to enable autosave'
    : saveStatus?.kind === 'saving' ? 'Saving…'
    : saveStatus?.kind === 'error' ? 'Autosave failed'
    : saveStatus?.kind === 'saved' ? `Autosaved ${new Date(saveStatus.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Autosave on'
  const exportEntries: MenuEntry[] = [
    { id: 'export-video', label: 'Video with captions (MP4)…', onSelect: () => setExportDialogOpen(true), disabledReason: exportVideoBlocker, shortcut: shortcutLabel('E') },
    { id: 'export-srt-range', label: 'Subtitles for In–Out range (SRT)…', onSelect: () => void exportSrt(true), disabledReason: activeRange ? (project.cues.length ? null : 'No captions yet') : 'Mark In and Out first (I / O)' },
    { id: 'export-srt', label: 'Subtitles (SRT)…', onSelect: () => void exportSrt(), disabledReason: project.cues.length ? null : 'No captions yet', shortcut: shortcutLabel('⇧E') },
  ]
  // Timeline-level edits get their own menu rather than the text-editing 'Edit' menu the native
  // template already reserves for Undo/Cut/Paste.
  const timelineEntries: MenuEntry[] = [
    { id: 'add-image-overlay', label: 'Import image…', onSelect: () => void importImageToBin() },
    { id: 'split-clips', label: 'Split clips at playhead', onSelect: splitClips, disabledReason: canSplitClips ? null : 'No clip under the playhead', shortcut: shortcutLabel('B') },
    { id: 'toggle-clip-enabled', label: 'Disable / enable selected clip', onSelect: toggleClipEnabled, disabledReason: clipBase ? null : 'Select a clip first', shortcut: shortcutLabel('D') },
    { id: 'toggle-clip-link', label: 'Link / unlink video and audio', onSelect: toggleClipLink, disabledReason: clipBase && (clipBase.kind === 'video' || clipBase.kind === 'audio') ? null : 'Select a video or audio clip first' },
    { id: 'trim-start-to-playhead', label: 'Trim clip start to playhead', onSelect: () => trimClipsTo('start'), disabledReason: canSplitClips ? null : 'No clip under the playhead', shortcut: shortcutLabel('Q') },
    { id: 'trim-end-to-playhead', label: 'Trim clip end to playhead', onSelect: () => trimClipsTo('end'), disabledReason: canSplitClips ? null : 'No clip under the playhead', shortcut: shortcutLabel('W') },
    { id: 'add-video-track', label: 'Add video track', onSelect: () => trackActions.onAdd('video') },
    { id: 'add-audio-track', label: 'Add audio track', onSelect: () => trackActions.onAdd('audio') },
    { id: 'add-caption-track', label: 'Add caption track', onSelect: captionTrackActions.onAdd },
    { id: 'sep-silence', separator: true },
    { id: 'remove-silence', label: 'Remove silence…', onSelect: () => setSilenceDialogOpen(true), disabledReason: hasVideo ? null : 'Open a video first' },
    { id: 'restore-cuts', label: 'Restore removed ranges', onSelect: restoreCuts, disabledReason: hasTrimmedClips(project) ? null : 'No trimmed clips to restore' },
    { id: 'sep-sequence', separator: true },
    { id: 'sequence-settings', label: 'Sequence settings…', onSelect: () => setSequenceSettingsOpen(true), disabledReason: project.format ? null : 'Add a video first' },
  ]
  const contextEntries = (target: TimelineMenuTarget): MenuEntry[] => {
    const atPlayhead = (clip: Clip) => currentUs > clip.timelineStartUs && currentUs < clipEndUs(clip)
    switch (target.kind) {
      case 'clip': {
        const clip = clipBase
        if (!clip) return []
        const linkable = clip.kind === 'video' || clip.kind === 'audio'
        const playheadReason = atPlayhead(clip) ? null : 'Move the playhead onto this clip'
        return [
          { id: 'ctx-split', label: 'Split at playhead', onSelect: splitClips, disabledReason: playheadReason, shortcut: shortcutLabel('B') },
          { id: 'ctx-trim-start', label: 'Trim start to playhead', onSelect: () => trimClipsTo('start'), disabledReason: playheadReason, shortcut: shortcutLabel('Q') },
          { id: 'ctx-trim-end', label: 'Trim end to playhead', onSelect: () => trimClipsTo('end'), disabledReason: playheadReason, shortcut: shortcutLabel('W') },
          { id: 'ctx-sep-link', separator: true },
          { id: 'ctx-link', label: clipPartners.length ? `Unlink (${clipPartners.length + 1} clips)` : 'Link video and audio', onSelect: toggleClipLink,
            disabledReason: linkable ? null : 'Only video and audio clips can be linked', shortcut: shortcutLabel('⌥L') },
          { id: 'ctx-detach', label: 'Detach audio', onSelect: detachAudio, disabledReason: canDetachAudio ? null : 'Needs an unlinked video clip with an audio track' },
          { id: 'ctx-sep-edit', separator: true },
          { id: 'ctx-duplicate', label: 'Duplicate', onSelect: duplicateSelectedClip },
          { id: 'ctx-enabled', label: clip.enabled === false ? 'Enable' : 'Disable', onSelect: toggleClipEnabled, shortcut: shortcutLabel('D') },
          { id: 'ctx-delete', label: 'Delete', onSelect: () => deleteClip(false), shortcut: 'Del' },
          { id: 'ctx-ripple', label: 'Ripple delete', onSelect: () => deleteClip(true), shortcut: '⇧Del' },
        ]
      }
      case 'cue':
      case 'word': return [
        { id: 'ctx-cue-split', label: 'Split caption at playhead', onSelect: splitSelectedCue, disabledReason: canSplitSelected ? null : 'Move the playhead inside this caption' },
        { id: 'ctx-cue-merge', label: 'Merge with next caption', onSelect: mergeSelectedCue, disabledReason: canMergeSelected ? null : 'No caption after this one' },
        { id: 'ctx-cue-sep', separator: true },
        ...(target.kind === 'word' ? [{ id: 'ctx-word-delete', label: 'Delete word', onSelect: deleteSelectedWord, disabledReason: selectedWord ? null : 'Select a word first' }] : []),
        { id: 'ctx-cue-delete', label: 'Delete caption', onSelect: deleteSelectedCue },
      ]
      case 'text':
      case 'shape': {
        const own = (target.kind === 'text' ? project.textOverlays : project.shapes).find((item) => item.id === target.id)
        const groupId = own?.groupId
        const groupEntries: MenuEntry[] = groupId ? [
          { id: 'ctx-group-ungroup', label: 'Ungroup', onSelect: () => ungroupItems(groupId), shortcut: shortcutLabel('⇧G') },
          { id: 'ctx-group-duplicate', label: 'Duplicate group', onSelect: () => duplicateGroup(groupId) },
          { id: 'ctx-group-delete', label: 'Delete group', onSelect: () => runCommand({ type: 'group-delete', groupId }), shortcut: 'Del' },
          { id: 'ctx-group-sep', separator: true },
        ] : [
          { id: 'ctx-group-create', label: 'Group picked items', onSelect: groupItems, disabledReason: pendingItems.length >= 2 ? null : 'Ctrl/Shift-click two or more shapes or titles first', shortcut: shortcutLabel('G') },
          { id: 'ctx-group-sep', separator: true },
        ]
        return [...groupEntries, ...(target.kind === 'text' ? [
        { id: 'ctx-text-duplicate', label: 'Duplicate', onSelect: () => runCommand({ type: 'text-duplicate', textId: target.id, duplicateId: crypto.randomUUID() }) },
        { id: 'ctx-text-delete', label: groupId ? 'Delete item only' : 'Delete', onSelect: () => runCommand({ type: 'text-delete', textId: target.id }), shortcut: groupId ? undefined : 'Del' },
        ] : [
        { id: 'ctx-shape-duplicate', label: 'Duplicate', onSelect: () => runCommand({ type: 'shape-duplicate', shapeId: target.id, duplicateId: crypto.randomUUID() }) },
        { id: 'ctx-shape-delete', label: groupId ? 'Delete item only' : 'Delete', onSelect: () => runCommand({ type: 'shape-delete', shapeId: target.id }), shortcut: groupId ? undefined : 'Del' },
        ])]
      }
      case 'zoomRegion': {
        const region = project.zoomRegions.find((item) => item.id === target.id)
        return [
          { id: 'ctx-zoom-duplicate', label: 'Duplicate', onSelect: () => { if (region) duplicateZoomRegion(region) } },
          { id: 'ctx-zoom-delete', label: 'Delete', onSelect: () => runCommand({ type: 'zoom-region-delete', zoomId: target.id }), shortcut: 'Del' },
        ]
      }
      case 'blur': return [{ id: 'ctx-blur-delete', label: 'Delete', onSelect: () => runCommand({ type: 'blur-delete', blurId: target.id }), shortcut: 'Del' }]
      case 'effect': return [{ id: 'ctx-effect-delete', label: 'Delete', onSelect: () => runCommand({ type: 'effect-delete', effectId: target.id }), shortcut: 'Del' }]
      case 'empty': {
        const gap = target.trackId ? gapsOnTrack(project.clips, target.trackId).find((entry) => target.atUs >= entry.startUs && target.atUs < entry.endUs) : undefined
        const captionGap = target.captionLane ? (() => {
          const clicked = videoUnderPlayhead(target.atUs, project.tracks, project.clips)
          const assetId = clicked ? assetIdOf(clicked.clip) : null
          const durationUs = assetId ? assetById.get(assetId)?.metadata?.durationUs : undefined
          if (!clicked || !assetId || !durationUs) return null
          const range = captionGapAt(project.cues, assetId, durationUs, Math.round(sourceUsAt(clicked.clip, target.atUs)))
          return range ? { assetId, range } : null
        })() : null
        return [
          ...(captionGap ? [
            { id: 'ctx-transcribe-gap', label: `Transcribe this gap (${formatRangeTime(captionGap.range.startUs)}–${formatRangeTime(captionGap.range.endUs)})…`, onSelect: () => requestTranscribeGap(captionGap.assetId, captionGap.range) },
            { id: 'ctx-sep-transcribe', separator: true as const },
          ] : []),
          ...(gap && target.trackId ? [{ id: 'ctx-close-gap', label: 'Close gap', onSelect: () => runCommand({ type: 'gap-close', trackId: target.trackId!, atUs: gap.startUs }) }] : []),
          { id: 'ctx-split-all', label: 'Split all clips at playhead', onSelect: () => runCommand({ type: 'clip-split', atUs: Math.round(currentUs), idPrefix: crypto.randomUUID() }, () => null), disabledReason: canSplitClips ? null : 'No clip under the playhead', shortcut: shortcutLabel('B') },
          { id: 'ctx-sep-add', separator: true },
          { id: 'ctx-add-text', label: 'Add text at playhead', onSelect: () => addTextAtPlayhead() },
          { id: 'ctx-add-image', label: 'Import image…', onSelect: () => void importImageToBin() },
          { id: 'ctx-add-video-track', label: 'Add video track', onSelect: () => trackActions.onAdd('video') },
          { id: 'ctx-add-audio-track', label: 'Add audio track', onSelect: () => trackActions.onAdd('audio') },
          { id: 'ctx-add-caption-track', label: 'Add caption track', onSelect: captionTrackActions.onAdd },
        ]
      }
    }
  }
  const requestTranscribeGap = (assetId: string, range: SourceRange) => {
    setPickedVideoId(assetId)
    setRailTab('captions')
    setTranscribeRequest({ assetId, range, nonce: Date.now() })
  }
  const summaryAsset = underAsset ?? primary

  // Preview quality + sequence size, surfaced in the View menu and the transport-bar chip (they were
  // only reachable from the Timeline menu and 9px overlay chips on the video).
  const proxyStatus = playbackProxies.statusOf(summaryAsset)
  const proxyPreparing = proxyStatus?.state === 'queued' || proxyStatus?.state === 'generating'
  const proxyReady = proxyStatus?.state === 'ready'
  const proxyInUse = proxyReady && playbackProxies.override !== 'original' && playbackProxies.mode !== 'off'
  const previewReason = proxyReady ? null : proxyPreparing ? 'Proxy is still being prepared' : 'No playback proxy for this clip'
  const previewChipLabel = summaryAsset?.metadata
    ? `Preview: ${proxyInUse ? 'Proxy' : 'Original'}${proxyPreparing ? ' · preparing…' : ''} · ${project.format ? `${project.format.width}×${project.format.height}` : `${summaryAsset.metadata.width ?? '?'}×${summaryAsset.metadata.height ?? '?'}`}`
    : null
  const previewEntries: MenuEntry[] = [
    { id: 'preview-proxy', label: `${proxyInUse ? '✓ ' : ''}Preview with proxy (lighter, smoother)`, onSelect: () => playbackProxies.setOverride('proxy'), disabledReason: previewReason },
    { id: 'preview-original', label: `${proxyInUse ? '' : '✓ '}Preview with original (full quality)`, onSelect: () => playbackProxies.setOverride('original'), disabledReason: summaryAsset ? null : 'Add a video first' },
    { id: 'sep-preview-mode', separator: true },
    ...(['off', 'auto', 'always'] as const).map((mode): MenuEntry => ({ id: `proxy-mode-${mode}`,
      label: `${playbackProxies.mode === mode ? '✓ ' : ''}Proxies: ${mode === 'off' ? 'Off' : mode === 'auto' ? 'Auto (above 1080p or unplayable)' : 'Always'}`,
      onSelect: () => playbackProxies.setMode(mode) })),
    { id: 'sep-preview-settings', separator: true },
    { id: 'sequence-settings-preview', label: 'Sequence settings…', onSelect: () => setSequenceSettingsOpen(true), disabledReason: project.format ? null : 'Add a video first' },
    { id: 'playback-settings', label: 'Playback settings…', onSelect: () => setSettingsTab('playback') },
  ]
  const viewEntries: MenuEntry[] = [
    { id: 'sequence-settings-view', label: 'Sequence settings…', onSelect: () => setSequenceSettingsOpen(true), disabledReason: project.format ? null : 'Add a video first' },
    { id: 'sep-view', separator: true },
    ...previewEntries.filter((entry) => entry.id !== 'sequence-settings-preview' && entry.id !== 'sep-preview-settings'),
  ]
  // One-time heads-up when a large source is added, so the proxy/sequence controls are discoverable.
  const hintedLarge = useRef<Set<string>>(new Set())
  useEffect(() => {
    const key = summaryAsset?.fingerprint?.value
    const meta = summaryAsset?.metadata
    if (!key || !meta?.width || !meta.height || hintedLarge.current.has(key)) return
    if (Math.min(meta.width, meta.height) <= 1080) return
    hintedLarge.current.add(key)
    setNotice({ tone: 'info', text: `${meta.width}×${meta.height} source: preview uses a lighter proxy once ready. View › Sequence settings changes the output size.` })
  }, [summaryAsset?.fingerprint?.value, summaryAsset?.metadata])

  if (view === 'home') return <main className="home-shell">
    <HomeScreen onCreate={startFromHome} onOpenFile={() => void openProject()} onOpenRecent={(path) => void openProject(path)}
      onSettings={() => setSettingsTab('models')} onMessage={(tone, text) => setNotice({ tone, text })}
      resolve={{ connected: resolveStatus.state === 'connected', timelineName: resolveStatus.state === 'connected' ? (resolveStatus.timelineName ?? undefined) : undefined, onCreate: () => void createFromResolve() }} />
    <SettingsDialog tab={settingsTab} onTab={setSettingsTab} onClose={() => setSettingsTab(null)} providerKeys={providerKeys} onProviderKeys={setProviderKeys} transcriptionDefaults={transcriptionDefaults} onTranscriptionDefaults={setTranscriptionDefaults}
      playbackProxyMode={playbackProxies.mode} onPlaybackProxyMode={playbackProxies.setMode}
      onMessage={(tone, text) => setNotice({ tone, text })} />
    {resolveRender && <ResolveRenderProgress timelineName={resolveRender.timelineName} percent={resolveRender.percent} onCancel={cancelResolveRender} />}
    {notice && <div className={`notice ${notice.tone}`} role="status" aria-live="polite" onClick={() => setNotice(null)}>{notice.text}</div>}
  </main>

  return <main className="app-shell">
    <header className="topbar">
      <div className="topbar-left"><button className="icon-button" aria-label="Home" title="Home: all projects" onClick={() => void goHome()}><HomeIcon width={16} height={16} /></button>
      <div className="brand"><img className="brand-mark" src={brandIcon} alt="" aria-hidden="true" draggable={false} /><div><strong className="wordmark" title="KathaCut — Your local AI video toolkit." aria-label="KathaCut">Katha<span>Cut</span></strong><small title={project.title}>{project.title}</small></div></div></div>
      <div className="toolbar toolbar-workflow" role="group" aria-label="Captions">
        {pickedVideo && <AlignmentControls fingerprint={pickedVideo.fingerprint} mediaReady={pickedReady}
          cues={project.cues.filter((cue) => cue.mediaAssetId === pickedVideo.id || !cue.mediaAssetId)} keyConfigured={Boolean(geminiKey?.configured)}
          onNeedKey={() => { setSettingsTab('transcription'); setNotice({ tone: 'info', text: 'Add a Gemini API key to align audio.' }) }}
          onApply={(transcript, run, snapshot) => applyAlignedTiming(transcript, run, snapshot, pickedVideo.id)} onMessage={(tone, text) => setNotice({ tone, text })} />}
        {exportState.kind === 'running' && <span className="job-pill" role="status" title="Uses the project as it was when the export started. You can keep editing.">
          <span>{describeExport(exportState.job, exportRate).label}</span>
          <button onClick={cancelExportVideo}>Cancel</button>
        </span>}
        {offlineVideos.length > 0 && <button className="warning-chip" onClick={relinkOffline} title={`${offlineVideos.map((asset) => asset.name).join(', ')} not available at the stored location`}>Media offline · Relink</button>}
      </div>
      <div className="toolbar toolbar-file">
        {agentStatus?.running && <button className="agent-chip" onClick={() => setSettingsTab('agent')}
          title={agentStatus.connections ? `${agentStatus.connections} agent client connected` : 'Agent access is on; no client connected yet'}>
          Agent{agentStatus.connections ? ` · ${agentStatus.connections}` : ''}
        </button>}
        {project.resolveLink && (() => {
          const link = project.resolveLink
          const mismatched = resolveLiveTimelineId !== null && resolveLiveTimelineId !== link.timelineId
          const label = mismatched
            ? `Resolve has another timeline open — switch to “${link.timelineName}”`
            : `Linked to DaVinci: ${link.projectName} › ${link.timelineName}`
          const title = mismatched
            ? `Resolve has a different timeline open. Switch to '${link.timelineName}' in Resolve before syncing.`
            : label
          return <span className={`resolve-pill${mismatched ? ' warning' : ' connected'}`} title={title}>{label}</span>
        })()}
        {project.resolveLink && <ResolveSyncControl project={project} link={project.resolveLink} liveTimelineId={resolveLiveTimelineId}
          onMessage={(tone, text) => setNotice({ tone, text })}
          onSynced={(synced) => commit((current) => current.resolveLink ? { ...current, resolveLink: { ...current.resolveLink, synced } } : current)} />}
        <ResolveStatusPill onMessage={(tone, text) => setNotice({ tone, text })} />
        <span className={`save-status${saveStatus?.kind === 'error' ? ' save-status-error' : ''}`} role="status" title={projectPath ?? 'Save the project to enable autosave'}>{saveStatusText}</span>
        <MenuButton label="File" entries={fileEntries} />
        <MenuButton label="Timeline" entries={timelineEntries} />
        <MenuButton label="View" entries={viewEntries} title="Sequence size and preview quality" />
        <MenuButton label="Export" className="accent" entries={exportEntries} />
        <button className="icon-button" aria-label="Settings" title="Settings: speech models, transcription providers and API keys, playback proxies, AI agents, shortcuts" onClick={() => setSettingsTab('models')}><SettingsIcon width={16} height={16} /></button>
      </div>
    </header>
    <SettingsDialog tab={settingsTab} onTab={setSettingsTab} onClose={() => setSettingsTab(null)} providerKeys={providerKeys} onProviderKeys={setProviderKeys} transcriptionDefaults={transcriptionDefaults} onTranscriptionDefaults={setTranscriptionDefaults}
      playbackProxyMode={playbackProxies.mode} onPlaybackProxyMode={playbackProxies.setMode}
      onMessage={(tone, text) => setNotice({ tone, text })} />
    <ExportDialog open={exportDialogOpen} source={project.format ?? formatFromMedia(primaryVideoAsset(project)?.metadata)} durationUs={Math.max(0, ...project.clips.map(clipEndUs))} range={activeRange}
      onClose={() => setExportDialogOpen(false)} onExport={(settings) => { setExportDialogOpen(false); void startExportVideo(settings) }} />
    <SequenceSettingsDialog open={sequenceSettingsOpen} format={project.format ?? null}
      onClose={() => setSequenceSettingsOpen(false)} onApply={(format) => runCommand({ type: 'format-set', format })} />
    <SilenceRemovalDialog open={silenceDialogOpen} mediaReady={pickedReady} onClose={() => setSilenceDialogOpen(false)} videoName={silenceVideo?.name ?? null}
      picker={videoAssets(project).length > 1 ? <VideoPicker videos={videoAssets(project)} picked={pickedVideo} onPick={setPickedVideoId} label="Video" /> : null}
      onDetect={detectSilence} onCancelDetect={cancelSilenceDetection} onApply={applySilenceRemoval} hasExistingCuts={hasTrimmedClips(project)} />

    <section className="workspace">
      <LeftRail active={railTab} onChange={setRailTab} onSettings={() => setSettingsTab('models')} />
      <aside className="panel side-panel" aria-label={railTab === 'media' ? 'Media' : railTab === 'captions' ? 'Captions' : railTab === 'overlays' ? 'Overlays' : railTab === 'effects' ? 'Effects' : railTab === 'color' ? 'Color' : railTab === 'layers' ? 'Layers' : 'Titles'}>
        {railTab === 'media' && <MediaBin assets={project.assets} assetUrls={media.assetUrls} assetIssues={media.issues} useCountByAsset={useCountByAsset}
          videoReady={(asset) => media.urlOf(asset) !== null}
          onImportFiles={() => void importAssetFiles()} onDropFiles={(files) => inspectAndAdd(files)}
          onAddVideo={(asset) => addVideoClip(asset)} onAddOverlayAtPlayhead={addOverlayAtPlayhead} onAddSfxAtPlayhead={addSfxAtPlayhead}
          onRemoveAsset={removeAsset} onRelinkAsset={(assetId) => void relinkAsset(assetId)} />}
        {railTab === 'captions' && <CaptionsPanel allCues={project.cues} onTranslated={applyTranslations} cueCount={panelCues.length} totalCueCount={project.cues.length} visibleCues={panelCues} selectedCueId={selectedCueId}
          languageTab={captionLanguageTab} languages={languages} shownTranslation={shownLanguage(project.cues, project.shownTranslation)}
          onLanguageTab={setLanguageTab} onShowOnVideo={(language) => runCommand({ type: 'set-shown-translation', language })}
          onRebuildOriginal={pickedVideo && rebuildableRun(project, pickedVideo.id) ? () => {
            const rebuilt = rebuildOriginalCues(projectRef.current, pickedVideo.id, () => crypto.randomUUID())
            if (!rebuilt) return
            commit(() => rebuilt)
            setNotice({ tone: 'info', text: 'Rebuilt the original captions from the saved recognition.' })
          } : null}
          selectedWordId={selectedWord?.id ?? null} warningCueIds={warningCueIds}
          notInSequence={(cue) => hasVideo && (!cue.mediaAssetId || spansInSequence(cue, cue.mediaAssetId, captionVideo).length === 0)}
          videoNameOf={(cue) => cue.mediaAssetId ? assetById.get(cue.mediaAssetId)?.name ?? null : null}
          historyPastLength={history.past.length} historyFutureLength={history.future.length} onUndo={undo} onRedo={redo}
          effectiveStyle={effectiveStyle} selected={selected} captionDisplay={captionDisplay} onCaptionDisplay={setCaptionDisplay} onProjectStyle={commitStyle}
          onOverride={(override) => selected && runCommand({ type: 'set-motion-override', cueId: selected.id, override })}
          onResetOverrides={() => runCommand({ type: 'reset-motion-overrides' })}
          onPlacementOverride={(override) => selected && runCommand({ type: 'set-placement-override', cueId: selected.id, override })}
          onEstimate={() => selected && runCommand({ type: 'estimate-words', cueId: selected.id, idPrefix: crypto.randomUUID() })}
          onGroup={(options, all) => runCommand(all
            ? { type: 'regroup-many', cueIds: panelCues.map((cue) => cue.id), idPrefix: crypto.randomUUID(), estimateMissing: false, options }
            : selected ? { type: 'regroup', cueId: selected.id, idPrefix: crypto.randomUUID(), estimateMissing: false, options } : { type: 'regroup-many', cueIds: [], idPrefix: crypto.randomUUID(), estimateMissing: false, options })}
          onSelect={seek} onApplyEdits={(edits) => runCommand({ type: 'update-text-many', edits, estimateIfUntimed: crypto.randomUUID() }, () => ({ tone: 'info', text: `Updated ${edits.length} caption${edits.length === 1 ? '' : 's'}.` }))} onUpdateText={(cueId, text) => runCommand({ type: 'update-text', cueId, text, estimateIfUntimed: crypto.randomUUID() })} onSelectWord={onSelectSpan}
          onWordAction={(cueId, type, span) => {
            const command = wordActionCommand(cueId, type, span, () => crypto.randomUUID())
            if (command) runCommand(command)
            else setNotice({ tone: 'error', text: 'Estimate word timing for this caption first: this action needs the word’s timing.' })
          }}
          onEstimateMissing={() => selected && runCommand({ type: 'estimate-words', cueId: selected.id, idPrefix: crypto.randomUUID(), missingOnly: true })}
          cueButtonRefs={cueButtonRefs}
          videos={videoAssets(project)} pickedVideo={pickedVideo} onPickVideo={setPickedVideoId} mediaReady={pickedReady} onApplyTranscript={applyTranscript}
          providerKeys={providerKeys} transcriptionDefaults={transcriptionDefaults} onNeedGeminiKey={() => setSettingsTab('transcription')} onImportSrt={() => void importSrt()} transcribeContext={transcribeContext}
          runs={project.transcriptionRuns} openRequest={transcribeRequest} onOpenRequestIgnored={() => setNotice({ tone: 'info', text: 'A transcription is already running; the gap was not opened.' })} />}
        {railTab === 'overlays' && <OverlaysPanel assets={project.assets} assetUrls={media.assetUrls} onAddAtPlayhead={addOverlayAtPlayhead}
          onImportAndAdd={() => void importImageOverlay()} mediaReady onAddShape={addShapeAtPlayhead} onAddTemplate={(id, glass) => void addTemplateAtPlayhead(id, glass)} />}
        {railTab === 'titles' && <TitlesPanel style={effectiveStyle} cues={project.cues} activeCue={activeCue ?? null} presets={project.savedCaptionPresets ?? []} selectedText={selectedText} target={selectedText ? 'text' : 'captions'}
          onApplyTemplate={applyTemplate} onCommitMotion={(motion) => commitStyle({ ...effectiveStyle, motion, titleMotion: undefined })}
          onSavePreset={savePreset} onApplyPreset={applyPreset} onDeletePreset={deletePreset}
          onEstimate={selectedText ? undefined : activeCue ? () => runCommand({ type: 'estimate-words', cueId: activeCue.id, idPrefix: crypto.randomUUID() }) : undefined}
          onAddText={() => addTextAtPlayhead()} />}
        {railTab === 'effects' && <EffectsPanel onAddAtPlayhead={addEffectPreset} onAddBackground={(look) => addBackground(look, Math.round(currentUs))} />}
        {railTab === 'color' && <ColorPanel lutAssets={lutAssetsList} lutIssues={media.issues} frame={colorFrame} captureSource={() => captureFrame(underElement(), 320)}
          onSaveMatch={saveMatchLut} onAddAtPlayhead={(grade) => addAdjustment(grade, Math.round(currentUs), null)} onImportLut={() => void importLut()} onRelinkLut={(assetId) => void relinkLut(assetId)} />}
        {railTab === 'layers' && <LayersPanel rows={layerRows} groups={groupsHere} selectedGroupId={selection?.kind === 'group' ? selection.id : null}
          onSelectGroup={(groupId) => setSelection({ kind: 'group', id: groupId })} onRenameGroup={(groupId, name) => runCommand({ type: 'group-rename', groupId, name })} timeLabel={formatTimestamp(currentUs, ':')} units={captionComposition} focusKey={layerFocus}
          editing={editingMask !== null} drawing={editingMask?.drawing ?? false} offscreenSelection={offscreenSelection}
          onFocus={focusLayer} onAddMask={addMask} onEditOnStage={(row) => setMaskEdit({ key: row.key, drawing: false })} onStopEditing={() => setMaskEdit(null)}
          onDraft={draftMask} onCommit={commitMask} onLookDraft={draftLook} onLookCommit={commitLook} onBlendChange={changeBlend} onRemove={(row) => { setMaskEdit(null); commitMask(row, null) }} onReset={resetMask}
          onJumpToSelection={() => { const at = selection ? itemStartUs(project, selection) : null; if (at !== null) playback.seek(at) }} />}
      </aside>

      <section className="stage-panel" aria-label="Video preview and transport">
        <div ref={videoStageRef} className={`video-stage ${project.clips.length || project.cues.length ? '' : 'empty-stage'}`}
          onDragOver={(event) => { if (dropContent(event.dataTransfer)?.kind === 'files') { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
          onDrop={(event) => {
            const content = dropContent(event.dataTransfer)
            if (content?.kind !== 'files' || !content.files.length) return
            event.preventDefault()
            // Dropped on the preview: files only join the media bin; the user drags them to the timeline or presses Add.
            inspectAndAdd(content.files)
            setRailTab('media')
          }}>
          {project.clips.length || project.cues.length ? <div ref={videoFrameRef} className="video-frame" style={{ '--video-aspect': formatAspect(project.format), transform: stageView.scale === 1 ? undefined : `translate(${stageView.x}px, ${stageView.y}px) scale(${stageView.scale})` } as CSSProperties} onDoubleClick={addTextFromPreview}>
            <CaptionStage clock={clock} cues={visibleCues} dragPreview={dragPreview} composition={captionComposition} style={previewCaptionStyle} display={captionDisplay}
              tracks={visibleTracks} clips={lookDrafted(maskDrafted(visibleClips, 'clip'), 'clip')} assets={project.assets} blurRegions={maskDrafted(visibleBlurRegions, 'blur')} zoomRegions={visibleZoomRegions} effects={maskDrafted(visibleEffects, 'effect')} textOverlays={lookDrafted(maskDrafted(previewTexts, 'text'), 'text')} shapes={lookDrafted(maskDrafted(visibleShapes, 'shape'), 'shape')} captionTracks={lookDrafted(maskDrafted(project.captionTracks, 'captionTrack'), 'captionTrack')} urlOf={media.urlOf} lutCubes={lut.cubes}
              poolVersion={playback.poolVersion} elementFor={(trackId, assetId) => playback.transport.elementFor(trackId, assetId) as HTMLVideoElement | null}
              selectedCueId={selectedCueId} selectedTextId={selectedText?.id ?? null} selectedShapeId={selectedShape?.id ?? null} onSelectShape={(shapeId) => selectGraphic('shape', shapeId)} onSelectShapePart={(shapeId) => selectPart('shape', shapeId)} onSelectCue={setSelectedId} onSelectText={(textId) => selectGraphic('text', textId)} onTextLayout={captureTextBounds} onStyleDraft={draftStyle} onStyleCommit={commitStyle}
              editingTextId={editingText?.id ?? null} editingTextSelectAll={editingText?.selectAll ?? false}
              onEditText={(textId) => { selectPart('text', textId); setEditingText({ id: textId, selectAll: false }) }}
              onFinishTextEdit={() => setEditingText(null)} onCommitText={(textId, text) => runCommand({ type: 'text-update', textId, changes: { text } })}
              onCuePlacementCommit={(cueId, override) => runCommand({ type: 'set-placement-override', cueId, override })} />
            <ClipStageEditor tracks={visibleTracks} clips={visibleClips} composition={captionComposition} clock={clock}
              selectedId={selection?.kind === 'clip' ? selection.id : null}
              onSelect={(clipId) => setSelection({ kind: 'clip', id: clipId })}
              onRectDraft={(rect) => draftClip({ rect })} onRectCommit={(rect) => commitClip({ rect })}
              onCloneDraft={setCloneDraft} onCloneCommit={(clip) => { setCloneDraft(null); placeCopy(clip) }} />
            <RectStageEditor label="Zoom target" hitClassName="zoom-hit" keepAspect
              region={stageZoomRegion}
              composition={captionComposition} selected={selection?.kind === 'zoomRegion' && visibleZoomRegions.some((region) => region.id === selection.id && currentUs >= region.startUs && currentUs < region.endUs)}
              onSelect={(id) => setSelection({ kind: 'zoomRegion', id })}
              onDraft={(rect) => selection?.kind === 'zoomRegion' && (rect ? draftZoomRegion(selection.id, { [zoomRectKey]: rect }) : setZoomRegionDraft(null))}
              onCommit={(rect) => selection?.kind === 'zoomRegion' && commitZoomRegion(selection.id, { [zoomRectKey]: rect })} />
            <RectStageEditor label="Blur area" hitClassName="blur-hit" keepAspect={false}
              region={visibleBlurRegions.find((region) => currentUs >= region.startUs && currentUs < region.endUs) ?? null}
              composition={captionComposition} selected={selection?.kind === 'blur' && visibleBlurRegions.some((region) => region.id === selection.id && currentUs >= region.startUs && currentUs < region.endUs)}
              onSelect={(id) => setSelection({ kind: 'blur', id })}
              onDraft={(rect) => selection?.kind === 'blur' && (rect ? draftBlurRegion(selection.id, { rect }) : setBlurRegionDraft(null))}
              onCommit={(rect) => selection?.kind === 'blur' && commitBlurRegion(selection.id, { rect })} />
            {selectedGroup && groupBox && <RectStageEditor label="Group" hitClassName="group-hit" keepAspect
              region={{ id: selectedGroup.id, rect: groupDraft?.rect ?? groupBox }} composition={captionComposition} selected
              onSelect={(id) => setSelection({ kind: 'group', id })}
              onDraft={(rect) => draftGroupRect(selectedGroup.id, rect)}
              onCommit={(rect) => commitGroupRect(selectedGroup.id, rect)} />}
            {stageShape && (stageShape.geometry.kind === 'rect' || stageShape.geometry.kind === 'bubble' || stageShape.geometry.kind === 'ellipse' || stageShape.geometry.kind === 'highlight') && (() => {
              const geometry = stageShape.geometry
              return <RectStageEditor label="Shape" hitClassName="shape-hit" keepAspect={false}
                region={{ id: stageShape.id, rect: geometry.rect }} composition={captionComposition} selected
                onSelect={(id) => setSelection({ kind: 'shape', id })}
                onDraft={(rect) => setShapeDraft(rect ? { id: stageShape.id, geometry: { ...geometry, rect } } : null)}
                onCommit={(rect) => { setShapeDraft(null); runCommand({ type: 'shape-update', shapeId: stageShape.id, changes: { geometry: { ...geometry, rect } } }) }} />
            })()}
            {stageShape?.geometry.kind === 'bubble' && <BubbleTailHandle geometry={stageShape.geometry} composition={captionComposition}
              onDraft={(geometry) => setShapeDraft(geometry ? { id: stageShape.id, geometry } : null)}
              onCommit={(geometry) => { setShapeDraft(null); runCommand({ type: 'shape-update', shapeId: stageShape.id, changes: { geometry } }) }} />}
            {stageShape?.geometry.kind === 'line' && (() => {
              const geometry = stageShape.geometry
              void geometry
              return <LineStageEditor line={stageShape.geometry} composition={captionComposition}
                onDraft={(line) => setShapeDraft(line ? { id: stageShape.id, geometry: line } : null)}
                onCommit={(line) => { setShapeDraft(null); runCommand({ type: 'shape-update', shapeId: stageShape.id, changes: { geometry: line } }) }} />
            })()}
            {editingMask && focusedLayer && <MaskStageEditor composition={captionComposition} mask={focusedLayer.mask} drawing={editingMask.drawing}
              onDraft={(mask) => draftMask(focusedLayer, mask)} onCommit={(mask) => commitMask(focusedLayer, mask)}
              onCommitDrawn={(points) => finishDrawnMask(focusedLayer, points)} onExit={() => { setMaskEdit(null); setMaskDraft(null) }} />}
            <div className="safe-area" />
          </div> : <Empty title="Your video appears here" body="Import a local video, then drag it from the Media tab to the timeline (or press Add). You can also continue from subtitles or a saved project. Media stays on this device." action={<div className="empty-actions">
            <button className="accent" onClick={() => void openVideo()}>Import video</button>
            <button onClick={() => void importSrt()}>Import SRT</button>
            <button onClick={requestOpenProject}>Open project</button>
          </div>} />}
          {stageView.scale !== 1 && <button className="stage-zoom-reset" title="Reset preview zoom" onClick={() => setStageView({ scale: 1, x: 0, y: 0 })}>{Math.round(stageView.scale * 100)}% · Reset</button>}
          {selection?.kind === 'cue' && <CaptionShortcutHint />}
          {pendingItems.length >= 2 && <div className="group-pending-hint" role="status">{pendingItems.length} items picked · {shortcutLabel('G')} to group</div>}
          {summaryAsset?.metadata && <MediaSummary name={summaryAsset.name} metadata={summaryAsset.metadata} format={project.format ?? null} onEditFormat={() => setSequenceSettingsOpen(true)}
            proxyStatus={playbackProxies.statusOf(summaryAsset)} proxyOverride={playbackProxies.override}
            onToggleProxyOverride={() => playbackProxies.setOverride(playbackProxies.override === 'original' ? null : 'original')} />}
          {issueAsset && codecIssue && <div className="codec-diagnostic" role="status">
            <span>{issueAsset.name}: {codecIssue.kind === 'confirmed-unsupported' ? codecIssue.message : 'This media’s codec is likely unsupported by the embedded player.'}</span>
            {autoProxyPending && <span>Creating a playback proxy automatically…</span>}
            {proxyState.kind === 'ready' && !autoProxyPending && <button onClick={createProxy}>Save a playable copy…</button>}
            {proxyState.kind === 'creating' && <><span>{`Converting${proxyState.percent === null ? '…' : ` ${proxyState.percent}%`}`}</span><button onClick={cancelProxyCreation}>Cancel</button></>}
            {proxyState.kind === 'unsupported' && <span>{proxyState.reason}</span>}
            {proxyState.kind === 'error' && <span>{proxyState.message}</span>}
            {proxyState.kind === 'done' && <span>Proxy saved to {proxyState.path}</span>}
          </div>}
        </div>
        {/* The transport is the only one: with stacked tracks no single <video> owns playback. */}
        <div className="transport" role="group" aria-label="Playback transport"><span aria-label={`Current time ${formatClock(currentUs)}`}>{formatClock(currentUs)}</span><button onClick={togglePlayback} disabled={!project.clips.length && !project.cues.length} aria-label={playback.playing ? 'Pause' : 'Play'} title="Play or pause (Space)">{playback.playing ? 'Pause' : 'Play'}</button><button onClick={() => seekBy(-US_PER_SECOND)} aria-label="Seek backward one second" title="Seek backward (Left Arrow)">−1 s</button><RangeInput ariaLabel="Playhead position" min={0} max={durationUs} value={Math.min(currentUs, durationUs)} onChange={seekTo} /><button onClick={() => seekBy(US_PER_SECOND)} aria-label="Seek forward one second" title="Seek forward (Right Arrow)">+1 s</button><span aria-label={`Duration ${formatClock(durationUs)}`}>{formatClock(durationUs)}</span>{previewChipLabel && <MenuButton label={previewChipLabel} entries={previewEntries} className="preview-quality-chip" title="Preview quality and sequence settings" />}</div>
      </section>

      <aside className="panel inspector-panel" aria-labelledby="inspector-heading">
        <h2 id="inspector-heading" className="sr-only">Caption inspector</h2>
        <InspectorTabs active={inspectorTab} onChange={setInspectorTab}
          edit={<>
            {selectedClip ? <ClipInspector
              clip={selectedClip}
              asset={selectedClip.kind === 'color' || selectedClip.kind === 'adjustment' ? null : assetById.get(selectedClip.assetId) ?? null}
              assetIssue={selectedClip.kind === 'color' || selectedClip.kind === 'adjustment' ? null : media.issues.get(selectedClip.assetId) ?? null}
              track={project.tracks.find((track) => track.id === selectedClip.trackId) ?? null}
              trackLabel={(() => { const track = project.tracks.find((entry) => entry.id === selectedClip.trackId); return track ? trackLabel(track, project.tracks) : 'a missing track' })()}
              composition={captionComposition}
              onMove={(startUs) => moveClip(selectedClip.id, selectedClip.trackId, startUs)}
              onLength={(lengthUs) => trimClip(selectedClip.id, 'end', lengthUs - clipLengthUs(selectedClip))}
              onRectDraft={(rect) => draftClip({ rect })}
              onRectCommit={(rect) => commitClip({ rect })}
              onFit={(fit) => commitClip({ fit })}
              onOpacityDraft={(opacity) => draftClip({ opacity })}
              onOpacityCommit={(opacity) => commitClip({ opacity })}
              onGainDraft={(gain) => draftClip({ gain })}
              onGainCommit={(gain) => commitClip({ gain })}
              onEnabledChange={(enabled) => commitClip({ enabled })}
              linkedCount={clipPartners.length}
              onToggleLink={toggleClipLink}
              onDetachAudio={canDetachAudio ? detachAudio : null}
              onSpeedCommit={(speed) => commitClip({ speed })}
              onFillDraft={(fill) => draftClip({ fill })}
              onFillCommit={(fill) => commitClip({ fill })}
              onMotionDraft={(motion) => draftClip({ motion })}
              onMotionCommit={(motion) => commitClip({ motion })}
              lutAssets={lutAssetsList}
              onGradeDraft={(grade) => draftClip({ grade })}
              onGradeCommit={(grade) => commitClip({ grade })}
              onDuplicate={duplicateSelectedClip}
              onDelete={deleteClip}
              onRelink={() => { if (selectedClip.kind !== 'color' && selectedClip.kind !== 'adjustment') void relinkAsset(selectedClip.assetId) }}
              onInvalid={(text) => setNotice({ tone: 'error', text })}
            /> : selectedZoomRegion ? <ZoomInspector
              region={selectedZoomRegion}
              composition={captionComposition}
              onMove={(startUs) => moveZoomRegion(selectedZoomRegion.id, startUs)}
              onLength={(lengthUs) => trimZoomRegion(selectedZoomRegion.id, 'end', lengthUs - (selectedZoomRegion.endUs - selectedZoomRegion.startUs))}
              onEnabledChange={(enabled) => commitZoomRegion(selectedZoomRegion.id, { enabled })}
              onDraft={(changes) => draftZoomRegion(selectedZoomRegion.id, changes)}
              onCommit={(changes) => commitZoomRegion(selectedZoomRegion.id, changes)}
              onReset={() => commitZoomRegion(selectedZoomRegion.id, { rect: defaultZoomRect(captionComposition) })}
              framing={zoomRectKey === 'fromRect' ? 'start' : 'end'}
              onFramingChange={(framing) => { setPanFraming(framing); seekTo(framing === 'start' ? selectedZoomRegion.startUs : selectedZoomRegion.endUs - 1000) }}
              onDelete={() => runCommand({ type: 'zoom-region-delete', zoomId: selectedZoomRegion.id })}
              onInvalid={(text) => setNotice({ tone: 'error', text })}
            /> : selectedBlurRegion ? <BlurInspector
              region={selectedBlurRegion}
              onMove={(startUs) => moveBlurRegion(selectedBlurRegion.id, startUs)}
              onLength={(lengthUs) => trimBlurRegion(selectedBlurRegion.id, 'end', lengthUs - (selectedBlurRegion.endUs - selectedBlurRegion.startUs))}
              onEnabledChange={(enabled) => commitBlurRegion(selectedBlurRegion.id, { enabled })}
              onRadiusDraft={(radius) => draftBlurRegion(selectedBlurRegion.id, { radius })}
              onRadiusCommit={(radius) => commitBlurRegion(selectedBlurRegion.id, { radius })}
              onDelete={() => runCommand({ type: 'blur-delete', blurId: selectedBlurRegion.id })}
              onInvalid={(text) => setNotice({ tone: 'error', text })}
            /> : selectedEffect ? <EffectInspector
              effect={selectedEffect}
              onMove={(startUs) => moveEffect(selectedEffect.id, startUs)}
              onLength={(lengthUs) => trimEffect(selectedEffect.id, 'end', lengthUs - (selectedEffect.endUs - selectedEffect.startUs))}
              onEnabledChange={(enabled) => commitEffect(selectedEffect.id, { enabled })}
              onDraft={(changes) => draftEffect(selectedEffect.id, changes)}
              onCommit={(changes) => commitEffect(selectedEffect.id, changes)}
              onDelete={() => runCommand({ type: 'effect-delete', effectId: selectedEffect.id })}
              onInvalid={(text) => setNotice({ tone: 'error', text })}
            /> : selectedGroup ? (() => {
              const span = groupSpan(project, selectedGroup.id)
              return span ? <GroupInspector group={selectedGroup} members={groupMembers(project, selectedGroup.id)} startUs={span.startUs} endUs={span.endUs}
                onRename={(name) => runCommand({ type: 'group-rename', groupId: selectedGroup.id, name })}
                onMove={(startUs) => runCommand({ type: 'group-move', groupId: selectedGroup.id, startUs })}
                onSelectPart={(member: GroupMember) => selectPart(member.kind, member.item.id)}
                onUngroup={() => ungroupItems(selectedGroup.id)} onDuplicate={() => duplicateGroup(selectedGroup.id)}
                onDelete={() => runCommand({ type: 'group-delete', groupId: selectedGroup.id })}
                onInvalid={(text) => setNotice({ tone: 'error', text })} /> : null
            })() : selectedShape ? <ShapeInspector item={selectedShape}
              onUpdate={(changes) => runCommand({ type: 'shape-update', shapeId: selectedShape.id, changes })}
              onMove={(startUs) => runCommand({ type: 'shape-move', shapeId: selectedShape.id, startUs })}
              onLength={(lengthUs) => runCommand({ type: 'shape-trim', shapeId: selectedShape.id, edge: 'end', deltaUs: lengthUs - (selectedShape.endUs - selectedShape.startUs) })}
              onDuplicate={() => runCommand({ type: 'shape-duplicate', shapeId: selectedShape.id, duplicateId: crypto.randomUUID() })}
              onDelete={() => runCommand({ type: 'shape-delete', shapeId: selectedShape.id })}
              onInvalid={(text) => setNotice({ tone: 'error', text })} /> : selectedText ? <TextInspector item={selectedText}
              onUpdate={(changes) => runCommand({ type: 'text-update', textId: selectedText.id, changes })}
              onMove={(startUs) => runCommand({ type: 'text-move', textId: selectedText.id, startUs })}
              onLength={(lengthUs) => runCommand({ type: 'text-trim', textId: selectedText.id, edge: 'end', deltaUs: lengthUs - (selectedText.endUs - selectedText.startUs) })}
              onDuplicate={() => runCommand({ type: 'text-duplicate', textId: selectedText.id, duplicateId: crypto.randomUUID() })}
              onDelete={() => runCommand({ type: 'text-delete', textId: selectedText.id })}
              onInvalid={(text) => setNotice({ tone: 'error', text })} /> : selected ? <>
              <CueEditor
                cue={selected}
                onUpdateText={(text) => runCommand({ type: 'update-text', cueId: selected.id, text, estimateIfUntimed: crypto.randomUUID() })}
                onUpdateTime={(startUs, endUs) => runCommand({ type: 'update-time', cueId: selected.id, startUs, endUs })}
                onInvalid={(text) => setNotice({ tone: 'error', text })}
              />
              <WordEmphasisPanel cue={selected}
                onToggle={(textStart) => runCommand({ type: 'toggle-emphasis', cueId: selected.id, textStart })}
                onEstimate={() => runCommand({ type: 'estimate-words', cueId: selected.id, idPrefix: crypto.randomUUID() })} />
              <div className="grouping-actions">
                <p>Readable grouping: up to 7 words / 42 graphemes / 6 seconds; split at sentence endings or pauses of 0.8 seconds. Long words stay whole.</p>
                <button disabled={!selected.words.length || untimedTokenCount(selected) > 0} onClick={() => runCommand({ type: 'regroup', cueId: selected.id, idPrefix: crypto.randomUUID(), estimateMissing: false })}>Regroup using word timings</button>
                {untimedTokenCount(selected) > 0 && <><p>Estimation replaces this cue’s word timing with review-required estimates. Text stays exact; grouping changes cue boundaries. Undo restores the original.</p><button onClick={() => runCommand({ type: 'regroup', cueId: selected.id, idPrefix: crypto.randomUUID(), estimateMissing: true })}>Estimate all words &amp; group</button></>}
              </div>
              <div className="edit-actions">
                <button ref={addCueButtonRef} onClick={() => addCue()} disabled={!canAddCue}>Add at playhead</button>
                <button onClick={splitSelectedCue} disabled={!canSplitSelected} title="Split at playhead (S)">Split at playhead</button>
                <button onClick={mergeSelectedCue} disabled={!canMergeSelected}>Merge next</button>
                <button className="danger" onClick={deleteSelectedCue} title="Delete selected cue (Delete or Backspace)">Delete</button>
              </div>
            </> : <div className="no-selection"><Empty title="Nothing selected" body="Select a caption or a clip to edit it, or add a caption at the playhead." /><button ref={addCueButtonRef} onClick={() => addCue()} disabled={!canAddCue}>Add at playhead</button><button onClick={() => void importImageOverlay()} title="Add an image over the video at the playhead">Add image</button></div>}
            {validation.warnings.length > 0 && <div className="validation-warnings" role="status"><strong>{validation.warnings.length} timing warning{validation.warnings.length === 1 ? '' : 's'}</strong>{validation.warnings.map((warning, index) => <p key={`${warning.cueIds.join('-')}-${index}`}>{warning.message}</p>)}</div>}
          </>}
          style={<StylePanel style={effectiveStyle} onDraft={draftStyle} onCommit={commitStyle} />}
        />
        <div className="inspector-footer">
          {exportState.kind === 'running' ? <span className="export-progress" role="status">
            <span>{describeExport(exportState.job, exportRate).label}</span>
            <button onClick={cancelExportVideo}>Cancel</button>
          </span> : <button className="accent" disabled={!project.cues.length && exportVideoBlocker !== null}
            title={exportVideoBlocker === null ? 'Render the timeline with captions into a new MP4; source media is never modified' : 'Export an SRT subtitle file'}
            onClick={exportVideoBlocker === null ? () => setExportDialogOpen(true) : () => void exportSrt()}>Export</button>}
        </div>
      </aside>
    </section>

    <Timeline cues={timelineCues} tracks={project.tracks} captionTracks={project.captionTracks} clips={project.clips} zoomRegions={project.zoomRegions} blurRegions={project.blurRegions} effects={project.effects} textOverlays={project.textOverlays} shapes={project.shapes} assets={project.assets} currentUs={currentUs} range={activeRange} durationUs={timelineViewSpanUs(Math.max(durationUs, 1))} programUs={Math.max(durationUs, 1)}
      selection={selection} markers={project.markers} onSelectMarker={(markerId) => setSelection({ kind: 'marker', id: markerId })}
      warningCueIds={warningCueIds} waveforms={waveforms}
      waveformStatus={waveformsLoading > 0 ? 'Extracting waveforms…' : null}
      onCancelWaveform={waveformsLoading > 0 ? cancelWaveforms : undefined}
      onSeek={seekTo} onDragPreview={previewCueDrag} onDragCommit={commitCueDrag}
      editMode={editMode} onEditMode={setEditMode}
      onSelectClip={(clipId, options) => setSelection({ kind: 'clip', id: clipId, ...(options?.unlinked ? { unlinked: true } : {}) })}
      onClipMove={moveClip} onClipClone={(clip) => placeCopy(clip, clip.timelineStartUs, clip.trackId)} onClipTrim={trimClip}
      onSelectZoom={(zoomId) => setSelection({ kind: 'zoomRegion', id: zoomId })} onZoomMove={moveZoomRegion} onZoomClone={(region) => { runCommand({ type: 'zoom-region-add', region }) }} onZoomTrim={trimZoomRegion}
      onSelectBlur={(blurId) => setSelection({ kind: 'blur', id: blurId })} onBlurMove={moveBlurRegion} onBlurTrim={trimBlurRegion}
      onSelectEffect={(effectId) => setSelection({ kind: 'effect', id: effectId })} onEffectMove={moveEffect} onEffectTrim={trimEffect}
      onSelectText={(textId) => selectGraphic('text', textId)}
      onSelectShape={(shapeId) => selectGraphic('shape', shapeId)}
      groups={project.groups} pendingGroupIds={pendingItems.map((entry) => entry.id)}
      onShapeMove={(shapeId, startUs) => moveGraphic('shape', shapeId, startUs)}
      onShapeTrim={(shapeId, edge, deltaUs) => runCommand({ type: 'shape-trim', shapeId, edge, deltaUs })}
      onAddText={() => addTextAtPlayhead()}
      onContextMenu={(target, x, y) => setContextMenu({ x, y, target })}
      onTextMove={(textId, startUs) => moveGraphic('text', textId, startUs)}
      onTextTrim={(textId, edge, deltaUs) => runCommand({ type: 'text-trim', textId, edge, deltaUs })}
      onCloseGap={(trackId, atUs) => runCommand({ type: 'gap-close', trackId, atUs })}
      trackActions={trackActions} captionTrackActions={captionTrackActions} assetDurationUs={(assetId) => assetById.get(assetId)?.metadata?.durationUs ?? null}
      display={timelineDisplay} onDisplay={setTimelineDisplay} selectedWordId={selectedWord?.id ?? null} onSelectWord={onSelectWord}
      actions={{ addLine: addCue, addWord, merge: mergeSelectedCue, previous: () => selectAdjacentCue(-1), next: () => selectAdjacentCue(1) }}
      clipTools={{ markIn, markOut, clearRange, hasRange: activeRange !== null }}
      edit={editTools}
      canAdd={canAddCue} canMerge={canMergeSelected}
      onDropAsset={onTimelineDropAsset} onDropFiles={onTimelineDropFiles} onDropPreset={(payload, sequenceUs) => addEffectPreset(payload.preset, sequenceUs)} onDropBackground={(payload, sequenceUs, trackId) => addBackground(payload, sequenceUs, trackId)}
      onDropColor={(payload, sequenceUs, trackId) => addAdjustment(payload.grade, sequenceUs, trackId)} thumbnailQueue={thumbnailQueue} />
    {pendingAssetRelink && <RelinkReview title={pendingAssetRelink.asset.kind === 'video' ? 'Replacement video does not match' : 'Replacement file does not match'} candidate={pendingAssetRelink.candidate}
      onUse={() => { useAssetCandidate(pendingAssetRelink.asset, pendingAssetRelink.candidate); setPendingAssetRelink(null); setNotice({ tone: 'warning', text: `Using ${pendingAssetRelink.candidate.media.name} by your choice; stored identity was replaced with the selected media.` }) }}
      onChooseAgain={() => { const assetId = pendingAssetRelink.asset.id; setPendingAssetRelink(null); void relinkAsset(assetId) }}
      onCancel={() => setPendingAssetRelink(null)} />}
    {pendingSrt && <ReplaceCaptionsReview name={pendingSrt.name} existingCount={project.cues.length} importedCount={pendingSrt.parsed.cues.length}
      onCancel={() => setPendingSrt(null)} onReplace={() => { applyParsedSrt(pendingSrt.parsed); setPendingSrt(null) }} />}
    {pendingReset && <DiscardProjectReview kind={pendingReset.kind}
      onCancel={() => setPendingReset(null)} onSaveFirst={() => void saveThenResumePendingReset()} onDiscard={resumePendingReset} />}
    {notice && <div className={`notice ${notice.tone}`} role="status" aria-live="polite" onClick={() => setNotice(null)}>
      {notice.text}
      {notice.action && <button className="notice-action" onClick={(event) => { event.stopPropagation(); notice.action?.run() }}>{notice.action.label}</button>}
    </div>}
  {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} entries={contextEntries(contextMenu.target)} onClose={() => setContextMenu(null)} />}
  </main>
}

/** A transient top track for a stage Alt+drag clone, so the ghost paints above everything until it commits. */
const CLONE_TRACK: Track = { id: '__clone-preview__', kind: 'video', name: '', muted: true, hidden: false, locked: true }

/** Subscribes to the per-frame playback clock on its own, so a 60fps tick re-renders only this
 * small subtree — the transcript list, timeline body and waveform/thumbnails never re-render per
 * frame. It composites every visual clip under the playhead, back to front, then blur, then the
 * caption the one shared rule (`activeCueAt`) picks, evaluated at its own source time. */
function CaptionStage({ clock, cues, dragPreview, composition, style, display, tracks, clips, assets, blurRegions, zoomRegions, effects, textOverlays, shapes, captionTracks, urlOf, elementFor, lutCubes,
  selectedCueId, selectedTextId, selectedShapeId, onSelectShape, onSelectShapePart, onTextLayout, onSelectCue, onSelectText, onStyleDraft, onStyleCommit, onCuePlacementCommit,
  editingTextId, editingTextSelectAll, onEditText, onFinishTextEdit, onCommitText }: {
  /** Bumped when the transport creates a pooled element, so a new video layer finds it. */
  poolVersion: number
  clock: PlaybackClock; cues: readonly Cue[]; dragPreview: Cue | null
  composition: Size; style: CaptionStyle; display: CaptionDisplay
  tracks: readonly Track[]; clips: readonly Clip[]; assets: readonly ProjectAsset[]; blurRegions: readonly BlurRegion[]; zoomRegions: readonly ZoomRegion[]
  effects: readonly EffectRegion[]
  textOverlays: readonly TextOverlay[]
  shapes: readonly Shape[]
  captionTracks: readonly CaptionTrack[]
  urlOf: (asset: ProjectAsset | null | undefined) => string | null
  elementFor: (trackId: string, assetId: string) => HTMLVideoElement | null
  /** Resolved `.cube` content for every `lut`-kind asset this session knows (`useLutAssets`), for
   * baking a `grade.input: {type:'lut'}` into a graded picture layer's LUT. */
  lutCubes: ReadonlyMap<string, Cube3D>
  selectedCueId: string | null
  selectedTextId: string | null
  selectedShapeId: string | null
  onSelectShape: (shapeId: string) => void
  /** Double-click on a grouped shape: select the shape itself, not its group. */
  onSelectShapePart: (shapeId: string) => void
  onTextLayout: (textId: string, frame: CaptionFrame) => void
  onSelectCue: (cueId: string) => void
  onSelectText: (textId: string) => void
  onStyleDraft: (style: CaptionStyle) => void
  onStyleCommit: (style: CaptionStyle) => void
  onCuePlacementCommit: (cueId: string, override: Cue['placementOverride']) => void
  editingTextId: string | null
  editingTextSelectAll: boolean
  onEditText: (textId: string) => void
  onFinishTextEdit: () => void
  onCommitText: (textId: string, text: string) => void
}) {
  const frameUs = useSyncExternalStore(clock.subscribe, clock.getUs)
  const active = activeCueAt(frameUs, tracks, clips, cues)
  const lineCue = dragPreview ?? active?.cue ?? null
  const sourceUs = active && lineCue?.id === active.cue.id ? active.sourceUs : lineCue?.startUs ?? frameUs
  const wordIndex = display === 'word' && lineCue ? activeWordIndex(lineCue, sourceUs) : null
  // Memoized on (lineCue, wordIndex) so the shown cue keeps one stable reference for the whole
  // window a word is held — CaptionPreview's own layout/emphasis memo is keyed on cue identity.
  const shownCue = useMemo(() => wordIndex === null || !lineCue ? lineCue : wordDisplayCue(lineCue, wordIndex), [lineCue, wordIndex])
  const fallback = display === 'word' && lineCue && wordIndex === null && sourceUs >= lineCue.startUs && sourceUs < lineCue.endUs
    ? wordMotionAvailability(lineCue).explanation : null
  // Memoized on (style, lineCue) — both stay referentially stable tick to tick when nothing style- or
  // cue-related actually changes (see `shownCue`'s own comment above) — so `captionInputs` below keeps
  // skipping recomputation during ordinary playback, exactly as it did before this per-cue resolution
  // existed, rather than rebuilding the whole font/shadow/appearance object on every 60fps tick.
  const resolved = useMemo(() => resolveCaptionStyle(style, lineCue), [style, lineCue])
  // A live, uncommitted Alt-drag/resize/rotate on the caption's own per-cue override: layered on top
  // of `resolved` (which already carries any *committed* per-cue override) so a gesture in flight
  // paints immediately without writing project history on every pointer move — exactly the project
  // style's own `styleDraft` role, but scoped to one cue instead of the whole project.
  const [placementDraft, setPlacementDraft] = useState<{ cueId: string; patch: CaptionPlacementPatch } | null>(null)
  const draftedForThisCue = placementDraft && placementDraft.cueId === lineCue?.id ? placementDraft.patch : null
  const resolvedStyle = useMemo(() => draftedForThisCue ? { ...resolved, appearance: { ...resolved.appearance, ...draftedForThisCue } } : resolved,
    [resolved, draftedForThisCue])
  const captionInputs = useMemo(() => captionStyleInputs(resolvedStyle, composition), [resolvedStyle, composition])
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])
  // Adjustment layers grade the picture below them (Color tab); they are not a picture layer of their
  // own, so they never reach `visualLayers` — only `gradeStackFor`, below, reads them.
  const activeVisual = activeClipsAt(frameUs, tracks, clips.filter((clip) => clip.kind !== 'audio' && clip.kind !== 'adjustment'), { skipHidden: true })
    .filter((entry): entry is ActiveClip & { clip: Exclude<Clip, { kind: 'audio' | 'adjustment' }> } => entry.clip.kind !== 'adjustment')
  // The export host paints images only when every image track is above every video track. Mirror
  // that split in preview so those host-painted overlays stay pinned while the picture zooms.
  const trackOrder = new Map(tracks.map((track, index) => [track.id, index]))
  const hiddenGradeTracks = new Set(tracks.filter((track) => track.hidden).map((track) => track.id))
  const gradingClips = clips.filter((clip) => !hiddenGradeTracks.has(clip.trackId))
  const hasAdjustments = gradingClips.some((clip) => clip.kind === 'adjustment' && clip.enabled !== false)
  const hostPaintedImages = imagesHostPainted(clips, tracks, { adjustments: hasAdjustments })
  const missingLut = activeVisual.flatMap(({ clip }) => gradeStackFor(gradingClips, trackOrder, clip, frameUs))
    .map((adjustment) => adjustment.grade.input)
    .find((input) => input.type === 'lut' && !lutCubes.has(input.assetId))
  const visualLayers = activeVisual.map(({ clip, track }): CompositionLayer => {
      if (clip.kind === 'color') return { kind: 'color', id: clip.id, paint: paintAt(clip, frameUs), rect: clip.rect ?? null, opacity: clip.opacity, blendMode: clip.blendMode, mask: clip.mask }
      const asset = assetById.get(clip.assetId)
      const label = asset?.name ?? 'Missing file'
      // Color: adjustment layers (docs/EDITING.md) — the same bottom-up stack the export plan bakes,
      // resolved here from the live LUT-asset cache instead of an on-disk `.cube` file. `null` (no
      // adjustment layer above it right now) draws the plain, ungraded layer, same as before Slice 4.
      const grade = bakedGradeStack(gradeStackFor(gradingClips, trackOrder, clip, frameUs), lutCubes)
      if (clip.kind === 'video') return { kind: 'video', id: `${track.id}/${clip.assetId}`, element: elementFor(track.id, clip.assetId), label, rect: clip.rect ?? null, opacity: clip.opacity, blendMode: clip.blendMode, fit: clip.fit, mask: clip.mask, grade }
      return { kind: 'image', id: clip.id, url: urlOf(asset), label, rect: clip.kind === 'image' ? clip.rect ?? null : null, opacity: clip.kind === 'image' ? clip.opacity : 1, blendMode: clip.kind === 'image' ? clip.blendMode : undefined, fit: clip.kind === 'image' ? clip.fit : 'contain', mask: clip.kind === 'image' ? clip.mask : undefined, grade }
    })
  const pictureLayers: CompositionLayer[] = [
    ...visualLayers.filter((layer) => layer.kind !== 'image' || !hostPaintedImages),
    ...blurRegions.filter((region) => region.enabled && frameUs >= region.startUs && frameUs < region.endUs).map((region): CompositionLayer => ({ kind: 'blur', id: region.id, rect: region.rect, radius: region.radius, mask: region.mask })),
  ]
  // Frame-paint effects (docs/EDITING.md "Frame-paint effects"): vignette/letterbox stay pinned to
  // the output frame like a host-painted overlay, never zooming with the picture; fade paints over
  // everything, including captions, so it goes through `CaptionPreview`'s separate `overCaption` slot.
  const frameEffects = frameEffectsAt(effects, frameUs, composition)
  const pinnedLayers = [...(hostPaintedImages ? visualLayers.filter((layer) => layer.kind === 'image') : []), ...pinnedEffectLayers(frameEffects)]
  const fadeLayer = frameEffects.fade
    ? <CompositionLayers layers={[{ kind: 'fade', id: 'fade', color: frameEffects.fade.color, opacity: frameEffects.fade.opacity, mask: frameEffects.fade.mask }]} composition={composition} />
    : null
  const activeText = textOverlays.filter((item) => item.startUs <= frameUs && frameUs < item.endUs)
    .sort(compareLayered)
  const activeShapes = shapes.filter((item) => item.startUs <= frameUs && frameUs < item.endUs)
  const [textStageFrame, setTextStageFrame] = useState<{ id: string; frame: CaptionFrame | null } | null>(null)
  const captureTextStageFrame = (id: string, frame: CaptionFrame | null) => setTextStageFrame((current) =>
    current?.id === id && current.frame?.layout === frame?.layout ? current : { id, frame })
  // A press on an unselected title selects it and is handed to the selected title's stage editor as a
  // pending move, so select-and-drag is one gesture. Cleared on release if the drag never started.
  const [pendingPress, setPendingPress] = useState<{ textId: string; clientX: number; clientY: number; pointerId: number } | null>(null)
  useEffect(() => {
    if (!pendingPress) return
    const clear = () => setPendingPress(null)
    window.addEventListener('pointerup', clear); window.addEventListener('pointercancel', clear)
    return () => { window.removeEventListener('pointerup', clear); window.removeEventListener('pointercancel', clear) }
  }, [pendingPress])
  const titleHitsAt = (clientX: number, clientY: number) => document.elementsFromPoint(clientX, clientY)
    .flatMap((element) => { const id = element.getAttribute('data-text-overlay-hit'); return id ? [id] : [] })
  const beginTitlePress = (textId: string, event: { button: number; clientX: number; clientY: number; pointerId: number }) => {
    onSelectText(textId)
    if (event.button === 0) setPendingPress({ textId, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId })
  }
  const textActor = (item: TextOverlay) => <TextOverlayActor key={item.id} item={item} timestampUs={frameUs} composition={composition}
    onFrame={item.id === selectedTextId ? (frame) => captureTextStageFrame(item.id, frame) : undefined} editing={item.id === editingTextId}
    onLayout={item.groupId ? (frame) => onTextLayout(item.id, frame) : undefined}
    onPointerDown={(event) => beginTitlePress(item.id, event)} onDoubleClick={() => onEditText(item.id)} />
  const shapeActor = (item: Shape) => <ShapeActor key={item.id} shape={item} timestampUs={frameUs} composition={composition}
    onPointerDown={() => onSelectShape(item.id)} onDoubleClick={() => onSelectShapePart(item.id)} />
  // Text and shapes interleave by one shared layer order, the same sort the export host uses.
  const graphics = [
    ...activeText.map((item) => ({ order: item, node: textActor(item) })),
    ...activeShapes.map((item) => ({ order: item, node: shapeActor(item) })),
  ].sort((a, b) => compareLayered(a.order, b.order))
  const belowText = graphics.filter((entry) => belowCaptions(entry.order)).map((entry) => entry.node)
  const aboveText = graphics.filter((entry) => !belowCaptions(entry.order)).map((entry) => entry.node)
  const editingTextItem = activeText.find((item) => item.id === editingTextId) ?? null
  const selectedStageText = activeText.find((item) => item.id === selectedTextId) ?? null
  const selectedTextFrame = selectedStageText && textStageFrame?.id === selectedStageText.id ? textStageFrame.frame : null
  const editingFrame = editingTextItem && textStageFrame?.id === editingTextItem.id ? textStageFrame.frame : null
  // A bypassed zoom region is still selectable and editable (RectStageEditor, below, reads from
  // `visibleZoomRegions` directly, not this filtered view) — only the picture crop itself skips it.
  const zoomRect = zoomRectAt(zoomRegions.filter((region) => region.enabled), frameUs, composition)
  const zoomStyle: CSSProperties = zoomRect
    ? { position: 'absolute', inset: 0, overflow: 'hidden' }
    : { position: 'absolute', inset: 0 }
  const pictureStyle: CSSProperties = zoomRect
    ? { position: 'absolute', inset: 0, transform: `scale(${composition.width / zoomRect.width}) translate(${-zoomRect.x}px, ${-zoomRect.y}px)`, transformOrigin: 'top left' }
    : { position: 'absolute', inset: 0 }
  // Picture effects (glow) filter the picture after zoom, wrapping it so pinned layers and
  // captions stay outside the filter — mirroring the export chain's position after `zoomPictureChain`.
  const pictureEffects = pictureEffectsAt(effects, frameUs)
  const glowFilter = pictureEffects.glow ? glowFilterStyle(pictureEffects.glow, compositionScale(composition), 'picture-glow') : null
  const [stageFrame, setStageFrame] = useState<CaptionFrame | null>(null)
  const draftPlacement = (patch: CaptionPlacementPatch, scope: 'project' | 'cue') => {
    if (scope === 'project') return onStyleDraft({ ...style, appearance: { ...style.appearance, ...patch } })
    if (lineCue) setPlacementDraft({ cueId: lineCue.id, patch })
  }
  const commitPlacement = (patch: CaptionPlacementPatch, scope: 'project' | 'cue') => {
    if (scope === 'project') return onStyleCommit({ ...style, appearance: { ...style.appearance, ...patch } })
    if (!lineCue) return
    setPlacementDraft(null)
    onCuePlacementCommit(lineCue.id, { ...(lineCue.placementOverride ?? {}), ...patch })
  }
  return <>
    <CaptionPreview cue={shownCue} timestampUs={sourceUs} composition={composition} inputs={captionInputs} motion={resolvedStyle.motion} motionSpeed={resolvedStyle.motionSpeed} fontSample={lineCue?.text}
      captionMask={captionTracks.find((track) => track.id === lineCue?.captionTrackId)?.mask}
      captionOpacity={captionTracks.find((track) => track.id === lineCue?.captionTrackId)?.opacity}
      onFrame={setStageFrame} layers={<><div style={{ position: 'absolute', inset: 0, ...glowFilter?.style }}>{glowFilter?.defs}<div style={zoomStyle}><div style={pictureStyle}>{hasBlendedLayer(pictureLayers) ? <div style={BLEND_BACKDROP_STYLE}><CompositionLayers layers={pictureLayers} composition={composition} /></div> : <CompositionLayers layers={pictureLayers} composition={composition} />}</div></div></div><CompositionLayers layers={pinnedLayers} composition={composition} />{belowText}</>}
      overCaption={<>{aboveText}{fadeLayer}</>} />
    {selectedStageText ? <CaptionStageEditor frame={selectedTextFrame} composition={composition} appearance={selectedStageText.style.appearance}
      selected onSelect={() => onSelectText(selectedStageText.id)} onDoubleClick={() => onEditText(selectedStageText.id)} fixedScope="project"
      pendingPress={pendingPress?.textId === selectedStageText.id ? pendingPress : null} onPressConsumed={() => setPendingPress(null)}
      onClickThrough={(clientX, clientY) => {
        const ids = titleHitsAt(clientX, clientY)
        if (ids.length > 1) onSelectText(ids[(Math.max(0, ids.indexOf(selectedStageText.id)) + 1) % ids.length])
      }}
      onDraft={(patch) => onStyleDraft({ ...selectedStageText.style, appearance: { ...selectedStageText.style.appearance, ...patch } })}
      onCommit={(patch) => onStyleCommit({ ...selectedStageText.style, appearance: { ...selectedStageText.style.appearance, ...patch } })} />
      : <CaptionStageEditor frame={stageFrame} composition={composition} appearance={resolvedStyle.appearance}
        selected={lineCue !== null && selectedCueId === lineCue.id}
        onSelect={() => lineCue && onSelectCue(lineCue.id)} onDraft={draftPlacement} onCommit={commitPlacement}
        onPressThrough={(event) => {
          const [textId] = titleHitsAt(event.clientX, event.clientY)
          if (!textId) return false
          beginTitlePress(textId, event)
          return true
        }} />}
    {editingTextItem && <TextStageInput key={editingTextItem.id} item={editingTextItem} frame={editingFrame} composition={composition}
      selectAll={editingTextSelectAll} onFinish={onFinishTextEdit} onCommit={(text) => onCommitText(editingTextItem.id, text)} />}
    {fallback && <span role="status" data-word-display-notice style={{ position: 'absolute', bottom: 8, right: 8, maxWidth: '40%',
      fontSize: 12, color: '#ffda8b', background: '#101010cc', padding: 4, zIndex: 2 }}>Showing the full caption: {fallback}</span>}
    {missingLut && <span role="status" style={{ position: 'absolute', top: 8, right: 8, fontSize: 12,
      color: '#ffda8b', background: '#101010cc', padding: 4, zIndex: 2 }}>Grade unavailable: relink the missing LUT</span>}
  </>
}

function rateText(rate: MediaMetadata['frameRate']): string {
  return rate ? `${rate.numerator}/${rate.denominator} fps` : 'frame rate unknown'
}

function MediaSummary({ name, metadata, format, onEditFormat, proxyStatus, proxyOverride, onToggleProxyOverride }: {
  name: string; metadata: MediaMetadata; format: CaptionProject['format'] | null; onEditFormat: () => void
  proxyStatus: PlaybackProxyStatus | undefined; proxyOverride: PlaybackProxyOverride; onToggleProxyOverride: () => void
}) {
  const codecs = metadata.streams.map((stream) => `${stream.kind}: ${stream.codec.name}`).join(' · ')
  return <div className="media-summary" aria-label="Probed media metadata">
    <span title={name}>{metadata.width ?? '?'}×{metadata.height ?? '?'}</span>
    <span>{rateText(metadata.frameRate)}</span>
    <span>{metadata.rotationDegrees == null ? 'rotation unknown' : `${metadata.rotationDegrees}° rotation`}</span>
    <span>{codecs || 'no streams reported'}</span>
    {format && <button type="button" className="media-summary-format" title="The output frame every clip is fitted into — click to change" onClick={onEditFormat}>Sequence {format.width}×{format.height} · {rateText(format.frameRate)}</button>}
    {proxyStatus?.state === 'ready' && <button type="button" className="media-summary-format"
      title="Preview plays a lighter local proxy for smoother scrubbing; export always uses the original file. Click to check full-quality framing."
      onClick={onToggleProxyOverride}>{proxyOverride === 'original' ? 'Preview: original quality' : 'Preview: proxy quality'}</button>}
    {(proxyStatus?.state === 'queued' || proxyStatus?.state === 'generating') && <span>Preparing playback proxy…</span>}
  </div>
}

/** Shown whenever a caption is selected, so the stage's drag/resize/rotate/nudge gestures — easy to
 * miss, since nothing else in the UI names them — are discoverable right where they're used. */
function CaptionShortcutHint() {
  return <div className="caption-shortcut-hint" role="note" aria-label="Caption placement shortcuts">
    <strong>Move this caption</strong>
    <dl>
      <dt>Drag</dt><dd>Move</dd>
      <dt>Corner handle</dt><dd>Resize</dd>
      <dt>Top handle</dt><dd>Rotate (Shift snaps to 15°)</dd>
      <dt>Arrow keys</dt><dd>Nudge (Shift = ×10)</dd>
      <dt>Alt + drag</dt><dd>This caption only</dd>
      <dt>Esc</dt><dd>Cancel the drag</dd>
    </dl>
  </div>
}

function ResolveRenderProgress({ timelineName, percent, onCancel }: { timelineName: string; percent: number; onCancel: () => void }) {
  return <div className="relink-backdrop"><section className="relink-review" role="dialog" aria-modal="true" aria-labelledby="resolve-render-title">
    <small>DAVINCI RESOLVE</small><h2 id="resolve-render-title">Rendering “{timelineName}”… {percent}%</h2>
    <p>KathaCut changes the render format on Resolve's Deliver page for this render and sets it back afterwards.</p>
    <div><button onClick={onCancel}>Cancel</button></div>
  </section></div>
}

function RelinkReview({ candidate, title = 'Replacement does not match', onUse, onChooseAgain, onCancel }: { candidate: MediaCandidate; title?: string; onUse: () => void; onChooseAgain: () => void; onCancel: () => void }) {
  return <div className="relink-backdrop"><section className="relink-review" role="dialog" aria-modal="true" aria-labelledby="relink-title">
    <small>MEDIA IDENTITY CHECK</small><h2 id="relink-title">{title}</h2>
    <p><strong>{candidate.media.name}</strong> can still be used intentionally. Review what differs:</p>
    <ul>{candidate.mismatches.map((mismatch) => <li key={mismatch}>{mismatch}</li>)}</ul>
    <div><button onClick={onCancel}>Cancel</button><button onClick={onChooseAgain}>Choose another</button><button className="accent" onClick={onUse}>Use replacement anyway</button></div>
  </section></div>
}

/** An imported SRT never silently replaces existing work (AGENTS.md); shown whenever the project
 * already has captions, whether the import came from the File menu, a bin pick, or a drop. */
function ReplaceCaptionsReview({ name, existingCount, importedCount, onCancel, onReplace }: { name: string; existingCount: number; importedCount: number; onCancel: () => void; onReplace: () => void }) {
  return <div className="relink-backdrop"><section className="relink-review" role="dialog" aria-modal="true" aria-labelledby="replace-captions-title">
    <small>IMPORT SRT</small><h2 id="replace-captions-title">Replace existing captions?</h2>
    <p>Importing <strong>{name}</strong> will replace {existingCount} existing caption{existingCount === 1 ? '' : 's'} with {importedCount} imported caption{importedCount === 1 ? '' : 's'}. This can be undone.</p>
    <div><button onClick={onCancel}>Cancel</button><button className="accent" onClick={onReplace}>Replace captions</button></div>
  </section></div>
}

/** New Project / Open Project both discard the current project outright; shown only when it holds
 * work not yet written to disk (`hasUnsavedWork`). Undo cannot help here — the whole history resets. */
function DiscardProjectReview({ kind, onCancel, onSaveFirst, onDiscard }: { kind: 'new' | 'open' | 'home'; onCancel: () => void; onSaveFirst: () => void; onDiscard: () => void }) {
  return <div className="relink-backdrop"><section className="relink-review" role="dialog" aria-modal="true" aria-labelledby="discard-project-title">
    <small>{kind === 'new' ? 'NEW PROJECT' : kind === 'open' ? 'OPEN PROJECT' : 'BACK TO HOME'}</small><h2 id="discard-project-title">Discard unsaved work?</h2>
    <p>{kind === 'new' ? 'Starting a new project' : kind === 'open' ? 'Opening another project' : 'Going back to Home'} will close this one. Anything not yet saved will be lost; this cannot be undone.</p>
    <div><button onClick={onCancel}>Cancel</button><button onClick={onSaveFirst}>Save first…</button><button className="accent" onClick={onDiscard}>Discard</button></div>
  </section></div>
}

function CueEditor({ cue, onUpdateText, onUpdateTime, onInvalid }: { cue: Cue; onUpdateText: (text: string) => boolean; onUpdateTime: (startUs: number, endUs: number) => boolean; onInvalid: (message: string) => void }) {
  const [text, setText] = useState(cue.text)
  const [start, setStart] = useState(formatTimestamp(cue.startUs, ':'))
  const [end, setEnd] = useState(formatTimestamp(cue.endUs, ':'))
  useEffect(() => { setText(cue.text); setStart(formatTimestamp(cue.startUs, ':')); setEnd(formatTimestamp(cue.endUs, ':')) }, [cue.id, cue.text, cue.startUs, cue.endUs])
  const changeTime = () => {
    const startUs = parseEditedTimestamp(start, cue.startUs)
    const endUs = parseEditedTimestamp(end, cue.endUs)
    if (startUs === null || endUs === null) {
      onInvalid('Use HH:MM:SS:mmm timestamps.')
      setStart(formatTimestamp(cue.startUs, ':')); setEnd(formatTimestamp(cue.endUs, ':'))
    } else if (!onUpdateTime(startUs, endUs)) {
      setStart(formatTimestamp(cue.startUs, ':')); setEnd(formatTimestamp(cue.endUs, ':'))
    }
  }
  return <div className="editor-form">
    <label htmlFor="cue-text">Text<textarea id="cue-text" aria-describedby="cue-provenance" value={text} lang="ml" onChange={(event) => setText(event.target.value)} onBlur={() => { if (text !== cue.text && !onUpdateText(text)) setText(cue.text) }} /></label>
    <TimeFields fields={[
      { id: 'cue-start', label: 'Start', value: start, ariaLabel: 'Cue start timestamp in its video, HH hours MM minutes SS seconds milliseconds', onChange: setStart, onBlur: changeTime },
      { id: 'cue-end', label: 'End', value: end, ariaLabel: 'Cue end timestamp in its video, HH hours MM minutes SS seconds milliseconds', onChange: setEnd, onBlur: changeTime },
    ]} />
    <TimingProvenance cue={cue} />
  </div>
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty"><div className="empty-icon">✦</div><strong>{title}</strong><p>{body}</p>{action}</div>
}
