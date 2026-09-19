import { TimingProvenance } from './TimingProvenance'
import { untimedTokenCount } from './core/wordTiming'
import { parseEditedTimestamp } from './core/time'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import { validateCaptions, type ValidationIssue } from './core/captionCommands'
import { applyEditCommand, type CommandContext, type EditCommand } from './core/commands'
import { validateItems } from './core/itemCommands'
import { cuesInSequenceForClips, sequenceDurationUs, sequenceToSource, sourceToSequence } from './core/sequence'
import type { Selection } from './core/timelineItems'
import { createCutPlaybackController } from './core/playbackController'
import { compositionFor, displayAspect } from './core/composition'
import { commitHistory, createHistory, redoHistory, undoHistory } from './core/history'
import { createProject, projectSchema, PROJECT_FILE_EXTENSION, type CaptionProject, type CaptionWord, type Cue } from './core/model'
import type { JobSnapshot } from './core/jobs'
import { parseSrt, serializeSrt } from './core/srt'
import { formatClock, formatTimestamp, US_PER_SECOND } from './core/time'
import { isEditableTarget, shortcutForEvent, type ShortcutAction } from './core/shortcuts'
import { trimToPlayhead, type CueDragMode } from './core/timeline'
import { createPlaybackClock, type PlaybackClock } from './core/playbackClock'
import { MenuButton, type MenuEntry } from './MenuButton'
import { SettingsDialog, type SettingsTab } from './SettingsDialog'
import { SilenceRemovalDialog } from './SilenceRemovalDialog'
import type { SilenceDetectionOptions } from './core/silenceRemoval'
import type { AlignmentSettingsStatus } from './core/alignmentIpc'
import type { MenuCommand } from './core/menuCommands'
import { describeJob, type ApplyTranscript } from './TranscriptionPanel'
import { applyTranscription } from './core/transcriptionApply'
import { translationTargetLabel } from './core/translationLanguages'
import { Timeline } from './Timeline'
import type { MediaCandidate } from '../electron/projectMedia'
import type { MediaMetadata, ProjectMedia } from './core/media'
import { bindUnboundItems, hasCuts, legacySegmentsOf, primaryVideoAsset } from './core/projectClips'
import { TIMELINE_WAVEFORM_PEAKS, type WaveformData } from './core/waveform'
import { containerPlaybackHint, describeMediaError, describePlayFailure } from './core/codecSupport'
import { CaptionPreview } from './captions/CaptionPreview'
import { CompositionLayers, type CompositionLayerImage } from './captions/CompositionLayers'
import { OverlayInspector } from './OverlayInspector'
import { OverlayStageEditor } from './OverlayStageEditor'
import { defaultOverlayRange, defaultOverlayRect } from './core/overlayDefaults'
import type { AudioClip, ImageOverlay, ProjectAsset } from './core/edit'
import { SfxInspector } from './SfxInspector'
import { clipDurationUs, clipRange, defaultClipAt, droppedSoundEffects } from './core/sfxClip'
import { createSfxScheduler, type SfxClipSpec } from './playback/SfxScheduler'
import { wordMotionAvailability, type LayoutInputs, type Size } from './captions/renderer'
import { activeWordIndex, wordDisplayCue, type CaptionDisplay } from './captions/wordDisplay'
import { applyCaptionPreset, deleteCaptionPreset, saveCaptionPreset } from './captions/presets'
import { captionStyleInputs, DEFAULT_CAPTION_STYLE, resolveCaptionMotion, type CaptionStyle } from './captions/style'
import { StylePanel } from './StylePanel'
import { WordEmphasisPanel } from './WordEmphasisPanel'
import { InspectorTabs, type InspectorTab } from './InspectorTabs'
import { AlignmentControls } from './AlignmentControls'
import { applyAlignment } from './core/alignment'
import { LeftRail, type RailTab } from './LeftRail'
import { MediaBin } from './MediaBin'
import { CaptionsPanel } from './CaptionsPanel'
import { OverlaysPanel } from './OverlaysPanel'
import { TransitionsPanel } from './TransitionsPanel'
import { dropContent } from './core/dragPayload'
import type { AssetDragPayload } from './core/dragPayload'
import { dropPlanForAsset } from './core/timelineDrop'
import { findAssetByFingerprint, type InspectedFile } from './core/assetImport'

type Notice = { tone: 'info' | 'error' | 'warning'; text: string } | null
type SaveStatus = { kind: 'saved'; at: number } | { kind: 'saving' } | { kind: 'error'; message: string }
/** Changes settle for this long before a named project is rewritten; a window blur flushes sooner. */
const AUTOSAVE_DELAY_MS = 1000
type WaveformState =
  | { kind: 'idle' }
  | { kind: 'loading'; requestId: string; percent: number | null }
  | { kind: 'ready'; data: WaveformData; cache: 'hit' | 'generated' }
  | { kind: 'error'; message: string }
type CodecDiagnostics =
  | { kind: 'unknown' }
  | { kind: 'checking' }
  | { kind: 'likely-unsupported' }
  | { kind: 'confirmed-unsupported'; message: string }
  | { kind: 'playable' }
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

const initial = createProject()

export default function App() {
  const [history, setHistory] = useState(() => createHistory(initial))
  // Runtime `media://` URLs of the project's video files, keyed by the file's fingerprint rather than
  // its asset id, so undoing a relink or replace immediately points the player back at the right file.
  const [videoUrls, setVideoUrls] = useState<Map<string, string>>(new Map())
  // Set by Save As / Open. Once known, every history change autosaves there (see the effect below `saveProjectAs`).
  const [projectPath, setProjectPath] = useState<string | null>(null)
  // A schema-migrated project is never rewritten silently: autosave waits for an explicit Save so the original file survives.
  const [migrationPending, setMigrationPending] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null)
  const lastSavedProject = useRef<CaptionProject | null>(null)
  // Writes to one file are serialized so a slow earlier write can never land after a newer one.
  const writeQueue = useRef(Promise.resolve())
  // Asset state (V2): runtime `media://` URLs the renderer never persists, plus a per-asset issue
  // badge for a missing/mismatched file, exactly parallel to the single source-media relink flow.
  // What the `<video>` element measured, used only when the probe reported no duration.
  const [measuredDurationUs, setMeasuredDurationUs] = useState<number | null>(null)
  const project = history.present
  // Single-clip-era shim (docs/EDITING.md, ticket V7): the UI still plays one video and speaks kept
  // `segments`; both are views over schema 4's video asset + clips until the timeline learns clips.
  const primary = useMemo(() => primaryVideoAsset(project), [project.assets, project.clips])
  const segments = useMemo(() => legacySegmentsOf(project), [project.assets, project.clips])
  const videoUrl = primary?.fingerprint ? videoUrls.get(primary.fingerprint.value) ?? null : null
  const mediaDurationUs = primary?.metadata?.durationUs ?? measuredDurationUs
  useEffect(() => setMeasuredDurationUs(null), [primary?.fingerprint?.value])
  const [assetUrls, setAssetUrls] = useState<Map<string, string>>(new Map())
  const [assetIssues, setAssetIssues] = useState<Map<string, 'missing' | 'mismatch'>>(new Map())
  const [pendingAssetRelink, setPendingAssetRelink] = useState<{ asset: ProjectAsset; candidate: MediaCandidate } | null>(null)
  // One draft overlay substituted into the visible list, shared by the timeline drag preview and
  // the inspector's live rect/opacity draft — exactly `dragPreview`'s role for captions.
  const [overlayDraft, setOverlayDraft] = useState<ImageOverlay | null>(null)
  // Same draft/commit role as `overlayDraft`, for the SFX timeline drag preview and the
  // inspector's live gain draft (V3).
  const [sfxDraft, setSfxDraft] = useState<AudioClip | null>(null)
  // Per-asset waveforms for the SFX track, keyed by asset id — separate from `waveform` (the
  // source media's own), reusing the same `loadWaveform` IPC by the asset's own fingerprint.
  const [assetWaveforms, setAssetWaveforms] = useState<Map<string, WaveformData>>(new Map())
  // One selection for every kind of timeline item (schema 3 shares a single ID namespace).
  // `selectedCueId` keeps every existing caption read site unchanged.
  const [selection, setSelection] = useState<Selection | null>(null)
  const selectedCueId = selection?.kind === 'cue' ? selection.id : null
  const setSelectedId = (id: string | null) => setSelection(id === null ? null : { kind: 'cue', id })
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null)
  const [currentUs, setCurrentUs] = useState(0)
  const [dragPreview, setDragPreview] = useState<Cue | null>(null)
  const [focusCueId, setFocusCueId] = useState<string | null | undefined>(undefined)
  const [notice, setNotice] = useState<Notice>({ tone: 'info', text: 'Open a video to transcribe it, or import an SRT file.' })
  const [waveform, setWaveform] = useState<WaveformState>({ kind: 'idle' })
  const [codecDiagnostics, setCodecDiagnostics] = useState<CodecDiagnostics>({ kind: 'unknown' })
  const [proxyState, setProxyState] = useState<ProxyState>({ kind: 'idle' })
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' })
  const cancelledWaveformRequest = useRef<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const addCueButtonRef = useRef<HTMLButtonElement>(null)
  const cueButtonRefs = useRef(new Map<string, HTMLElement>())
  const [measuredAspect, setMeasuredAspect] = useState<number | null>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('edit')
  // The left rail's active panel. `initial` (module scope) never has media, so 'media' is always
  // the correct default at first mount, matching a fresh project with nothing to caption yet.
  const [railTab, setRailTab] = useState<RailTab>(initial.clips.length ? 'captions' : 'media')
  const [pendingSrt, setPendingSrt] = useState<{ name: string; parsed: ReturnType<typeof parseSrt> } | null>(null)
  const [pendingReplaceSource, setPendingReplaceSource] = useState<{ media: ProjectMedia; url: string } | null>(null)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  const [silenceDialogOpen, setSilenceDialogOpen] = useState(false)
  const [geminiKey, setGeminiKey] = useState<AlignmentSettingsStatus | null>(null)
  useEffect(() => { void window.captionStudio?.alignmentSettingsStatus().then(setGeminiKey).catch(() => setGeminiKey({ configured: false, source: 'keychain' })) }, [])
  // The only prior playback clock was <video onTimeUpdate>, which Chromium fires ~4x/second —
  // far coarser than a word (150-400ms) or word-pop's own 200ms curve, which is why word-by-word
  // motion looked broken: the highlight skipped words and pop was never sampled mid-animation.
  // This clock ticks once per presented video frame; only the caption preview/playhead subscribe
  // to it, so the rest of the app does not re-render at frame rate.
  const clock = useMemo(() => createPlaybackClock(), [])
  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoUrl) return
    clock.attach(video)
    return () => clock.detach()
  }, [videoUrl, clock])
  // Sound effects (V3): scheduled against the same `<video>` element, independent of the frame
  // clock above — see `docs/EDITING.md`'s "Preview compositing and playback".
  const sfx = useMemo(() => createSfxScheduler({
    createContext: () => new AudioContext(),
    fetchArrayBuffer: (url) => fetch(url).then((response) => response.arrayBuffer()),
    onIssue: (clipId, message) => setNotice({ tone: 'warning', text: `Sound effect could not be decoded: ${message}` }),
  }), [])
  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoUrl) return
    sfx.attach(video)
    return () => sfx.detach()
  }, [videoUrl, sfx])
  const projectRef = useRef(project)
  projectRef.current = project
  // Cut-skipping playback rides the same per-frame clock. It reads the live project on each frame,
  // so undoing a cut takes effect immediately, and with no segments it never does anything at all.
  const cutPlaybackRef = useRef<{ mediaDurationUs: number | null }>({ mediaDurationUs: null })
  useEffect(() => {
    const controller = createCutPlaybackController({
      clock,
      segments: () => legacySegmentsOf(projectRef.current),
      mediaDurationUs: () => cutPlaybackRef.current.mediaDurationUs,
      playing: () => videoRef.current ? !videoRef.current.paused : false,
      seek: (sourceUs) => {
        setCurrentUs(sourceUs)
        clock.set(sourceUs)
        if (videoRef.current) videoRef.current.currentTime = sourceUs / US_PER_SECOND
      },
      pause: () => videoRef.current?.pause(),
    })
    return controller.start()
  }, [clock])
  useEffect(() => setMeasuredAspect(null), [videoUrl])
  // The same rotation rule main uses to build the export manifest (src/core/composition.ts).
  const fallbackAspect = useMemo(() => displayAspect(primary?.metadata), [primary?.metadata])
  const videoAspect = measuredAspect ?? fallbackAspect ?? 16 / 9
  const captionComposition = useMemo(() => compositionFor(videoAspect), [videoAspect])
  const visibleCues = useMemo(() => dragPreview ? project.cues.map((cue) => cue.id === dragPreview.id ? dragPreview : cue) : project.cues, [project.cues, dragPreview])
  const selected = visibleCues.find((cue) => cue.id === selectedCueId) ?? null
  // `overlayDraft.id` is absent from `project.overlays` while an Alt-drag clone is in progress
  // (`beginCloneDraft`/`OverlayStageEditor`) — the ghost is appended rather than replacing anything,
  // so it paints and hit-tests alongside the untouched original until the clone commits.
  const visibleOverlays = useMemo(() => {
    if (!overlayDraft) return project.overlays
    return project.overlays.some((overlay) => overlay.id === overlayDraft.id)
      ? project.overlays.map((overlay) => overlay.id === overlayDraft.id ? overlayDraft : overlay)
      : [...project.overlays, overlayDraft]
  }, [project.overlays, overlayDraft])
  const overlayBase = selection?.kind === 'overlay' ? project.overlays.find((overlay) => overlay.id === selection.id) ?? null : null
  const selectedOverlay = overlayBase && overlayDraft?.id === overlayBase.id ? overlayDraft : overlayBase
  const visibleAudioClips = useMemo(() => {
    if (!sfxDraft) return project.audioClips
    return project.audioClips.some((clip) => clip.id === sfxDraft.id)
      ? project.audioClips.map((clip) => clip.id === sfxDraft.id ? sfxDraft : clip)
      : [...project.audioClips, sfxDraft]
  }, [project.audioClips, sfxDraft])
  const sfxBase = selection?.kind === 'audio' ? project.audioClips.find((clip) => clip.id === selection.id) ?? null : null
  const selectedClip = sfxBase && sfxDraft?.id === sfxBase.id ? sfxDraft : sfxBase
  const activeCue = dragPreview ?? visibleCues.find((cue) => currentUs >= cue.startUs && currentUs < cue.endUs)
  const timelineDisplay: CaptionDisplay = project.timelineDisplay ?? 'line'
  const captionDisplay: CaptionDisplay = project.captionDisplay ?? 'line'
  // Derived, not cleared by an effect: an effect keyed on selection would race the click that sets
  // both the selection and selectedWordId together. A stale selectedWordId simply stops matching once
  // the selected cue's words change (e.g. after delete/undo/re-estimate) and disappears on its own.
  // Transcript words remain actionable in either timeline display mode. Tying this lookup to the
  // WORD timeline toggle made a click appear to do nothing in LINE mode and forced users back to
  // the row's double-click editor just to reach the caption actions.
  const selectedWord = selected?.words.find((word) => word.id === selectedWordId) ?? null

  // Style is project state so it saves/reopens and is undoable; a live draft feeds the preview
  // immediately while dragging a control, and one history commit lands per finished gesture.
  const [styleDraft, setStyleDraft] = useState<CaptionStyle | null>(null)
  const savedStyle = project.captionStyle ?? DEFAULT_CAPTION_STYLE
  const effectiveStyle = styleDraft ?? savedStyle
  const captionInputs = useMemo(() => captionStyleInputs(effectiveStyle, captionComposition), [effectiveStyle, captionComposition])
  useEffect(() => setStyleDraft(null), [project.id])

  // Source time: the real media length, used for clamping edits and every media-worker request.
  const sourceDurationUs = mediaDurationUs ?? Math.max(...project.cues.map((cue) => cue.endUs), 60 * US_PER_SECOND)
  // Sequence time: the output timeline the ruler, playhead, transport and scrubber all speak.
  const durationUs = useMemo(() => sequenceDurationUs(segments, sourceDurationUs), [segments, sourceDurationUs])
  const toSequence = (sourceUs: number) => sourceToSequence(sourceUs, segments, sourceDurationUs).sequenceUs
  const toSource = (sequenceUs: number) => segments?.length ? sequenceToSource(sequenceUs, segments, sourceDurationUs) : sequenceUs
  const currentSequenceUs = toSequence(currentUs)
  cutPlaybackRef.current.mediaDurationUs = sourceDurationUs
  // Every command and validation shares this: the primary video's duration may come from the element
  // (probe reported none), and new unbound captions/items belong to the video being edited.
  const commandContext = useMemo<CommandContext>(() => ({
    mediaDurationUs,
    assetDurationUs: (assetId) => assetId === primary?.id ? mediaDurationUs : undefined,
    defaultAssetId: primary?.id ?? null,
    compositionHeight: captionComposition.height,
  }), [mediaDurationUs, primary?.id, captionComposition.height])
  const validation = useMemo(() => {
    const captions = validateCaptions(visibleCues, commandContext)
    const items = validateItems(project, commandContext)
    return { errors: [...captions.errors, ...items.errors], warnings: [...captions.warnings, ...items.warnings] }
  }, [visibleCues, project, commandContext])
  const warningCueIds = useMemo(() => new Set(validation.warnings.flatMap((warning) => warning.cueIds)), [validation.warnings])

  // A project with clips needs every caption bound to a video; stamp any that a direct commit created
  // (SRT import, transcription) with the video being edited. Commands do this themselves.
  const bindToPrimary = (next: CaptionProject) => bindUnboundItems(next, primaryVideoAsset(next)?.id)
  const commit = (update: (project: CaptionProject) => CaptionProject) => setHistory((state) => commitHistory(state, {
    ...bindToPrimary(update(state.present)),
    updatedAt: new Date().toISOString(),
  }))

  // The title is not undoable state worth a history step of its own: opening a video names an
  // untitled project after it in every snapshot, so undo never resurrects the placeholder name.
  const retitleProject = (title: string) => setHistory((state) => {
    const update = (snapshot: CaptionProject): CaptionProject => ({ ...snapshot, title })
    return { past: state.past.map(update), present: update(state.present), future: state.future.map(update) }
  })

  const errorText = (error: unknown) => error instanceof Error ? error.message : 'The operation failed.'
  const migrationNote = (from: 1 | 2 | 3 | null) => from ? ` and migrated from schema ${from} — autosave starts once you save it in the current format (⌘/Ctrl+S)` : ''

  useEffect(() => {
    setProxyState({ kind: 'idle' })
    if (!videoUrl) { setCodecDiagnostics({ kind: 'unknown' }); return }
    const hint = containerPlaybackHint(primary?.name ?? '', (type) => videoRef.current?.canPlayType(type) ?? '')
    setCodecDiagnostics(hint.checked && hint.verdict === '' ? { kind: 'likely-unsupported' } : { kind: 'checking' })
  }, [videoUrl, primary?.name])

  useEffect(() => {
    const needsProxyCheck = codecDiagnostics.kind === 'likely-unsupported' || codecDiagnostics.kind === 'confirmed-unsupported'
    if (!needsProxyCheck || !window.captionStudio || proxyState.kind !== 'idle') return
    setProxyState({ kind: 'checking-support' })
    window.captionStudio.checkProxySupport()
      .then((support) => setProxyState(support.supported ? { kind: 'ready' } : { kind: 'unsupported', reason: support.reason ?? 'Local proxy conversion is unavailable.' }))
      .catch((error) => setProxyState({ kind: 'error', message: errorText(error) }))
  }, [codecDiagnostics.kind, proxyState.kind])

  useEffect(() => window.captionStudio?.onProxyProgress((message) => {
    setProxyState((state) => {
      if (state.kind !== 'creating' || state.requestId !== message.requestId) return state
      if (message.progress.kind !== 'measured' || message.progress.phase !== 'proxy') return state
      return { ...state, percent: Math.round(message.progress.completed / message.progress.total * 100) }
    })
  }), [])

  const createProxy = async () => {
    if (!window.captionStudio || !primary?.fingerprint) return
    const requestId = crypto.randomUUID()
    setProxyState({ kind: 'creating', requestId, percent: null })
    try {
      const result = await window.captionStudio.createProxy({ requestId, fingerprint: primary.fingerprint })
      if (!result) { setProxyState({ kind: 'ready' }); return }
      setProxyState({ kind: 'done', path: result.path })
      setNotice({ tone: 'info', text: `Created a playable local proxy at ${result.path}. Source media was not modified.` })
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

  useEffect(() => window.captionStudio?.onExportProgress((message) => {
    setExportState((state) => state.kind === 'running' && state.requestId === message.requestId ? { ...state, job: message.job } : state)
  }), [])

  const startExportVideo = async () => {
    if (!window.captionStudio || !primary?.fingerprint) return
    const requestId = crypto.randomUUID()
    setExportState({ kind: 'running', requestId, job: null })
    try {
      const outcome = await window.captionStudio.startExport({ requestId, fingerprint: primary.fingerprint, project })
      if (!outcome) { setExportState({ kind: 'ready' }); return } // the user dismissed the save dialog
      setExportState({ kind: 'ready' })
      if (outcome.state === 'succeeded') setNotice({ tone: 'info', text: `Exported video to ${outcome.path}. Source media was not modified.` })
      else if (outcome.state === 'cancelled') setNotice({ tone: 'info', text: 'Export cancelled.' })
      else setNotice({ tone: 'error', text: outcome.error.message })
    } catch (error) { setExportState({ kind: 'ready' }); setNotice({ tone: 'error', text: errorText(error) }) }
  }

  const cancelExportVideo = () => {
    if (exportState.kind !== 'running' || !window.captionStudio) return
    void window.captionStudio.cancelExport(exportState.requestId)
  }

  useEffect(() => window.captionStudio?.onWaveformProgress((message) => {
    setWaveform((state) => {
      if (state.kind !== 'loading' || state.requestId !== message.requestId) return state
      if (message.progress.kind !== 'measured' || message.progress.phase !== 'waveform') return state
      return { ...state, percent: Math.round(message.progress.completed / message.progress.total * 100) }
    })
  }), [])

  useEffect(() => {
    const api = window.captionStudio
    const fingerprint = primary?.fingerprint
    const duration = primary?.metadata?.durationUs ?? null
    if (!api || !videoUrl || !fingerprint || !duration) {
      setWaveform({ kind: 'idle' })
      return
    }
    const requestId = crypto.randomUUID()
    let disposed = false
    cancelledWaveformRequest.current = null
    setWaveform({ kind: 'loading', requestId, percent: null })
    void api.loadWaveform({ requestId, fingerprint, range: { startUs: 0, endUs: duration }, maxPeaks: TIMELINE_WAVEFORM_PEAKS })
      .then((result) => {
        if (!disposed && cancelledWaveformRequest.current !== requestId) setWaveform({ kind: 'ready', data: result.waveform, cache: result.cache })
      })
      .catch((error) => {
        if (disposed || cancelledWaveformRequest.current === requestId) return
        const message = errorText(error)
        setWaveform({ kind: 'error', message })
        setNotice({ tone: 'warning', text: `Waveform unavailable: ${message}` })
      })
    return () => {
      disposed = true
      void api.cancelWaveform(requestId).catch(() => {})
    }
  }, [videoUrl, primary?.fingerprint?.value, primary?.metadata?.durationUs])

  // Per-asset waveforms for the SFX track (V3), by the asset's own fingerprint — no new IPC beyond
  // the source media's own `loadWaveform`. Requested once per asset id, not re-requested on every
  // render; a failed request is retried the next time this effect runs (e.g. after a relink).
  const loadedAssetWaveformsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const api = window.captionStudio
    if (!api) return
    for (const asset of project.assets) {
      if (asset.kind !== 'audio' || !asset.fingerprint || !asset.metadata?.durationUs) continue
      if (loadedAssetWaveformsRef.current.has(asset.id)) continue
      loadedAssetWaveformsRef.current.add(asset.id)
      const assetId = asset.id
      void api.loadWaveform({ requestId: crypto.randomUUID(), fingerprint: asset.fingerprint, range: { startUs: 0, endUs: asset.metadata.durationUs }, maxPeaks: TIMELINE_WAVEFORM_PEAKS })
        .then((result) => setAssetWaveforms((map) => new Map(map).set(assetId, result.waveform)))
        .catch(() => { loadedAssetWaveformsRef.current.delete(assetId) })
    }
  }, [project.assets])

  // Hands the scheduler resolved clip specs whenever what it needs to know changes: which clips
  // exist (including the live drag/gain draft), which assets they resolve to, and how cuts remap
  // their anchors. A clip with no known URL yet (asset not resolved this session) is silently
  // omitted from preview — the same "missing" state the inspector's badge and export both surface.
  useEffect(() => {
    const specs: SfxClipSpec[] = visibleAudioClips.flatMap((clip) => {
      const url = assetUrls.get(clip.assetId)
      if (!url) return []
      const asset = project.assets.find((candidate) => candidate.id === clip.assetId) ?? null
      return [{ id: clip.id, url, atUs: clip.atUs, inPointUs: clip.inPointUs, durationUs: clipDurationUs(clip, asset), gain: clip.gain }]
    })
    sfx.setClips(specs, segments, sourceDurationUs)
  }, [visibleAudioClips, project.assets, assetUrls, segments, sourceDurationUs, sfx])

  /** Remembers where a probed video file can be played from. */
  const registerVideoUrl = (media: ProjectMedia, url: string) => {
    const key = media.fingerprint?.value
    if (key) setVideoUrls((urls) => new Map(urls).set(key, url))
  }

  /** Registers a relinked asset's runtime URL and rewrites its stored media fields in one undo step
   * (an initial open patches the project directly — see `openProject` — since there is nothing yet
   * to undo back to). A video's URL is keyed by fingerprint, so undoing this restores the old player. */
  const useAssetCandidate = (asset: ProjectAsset, candidate: MediaCandidate) => {
    if (asset.kind === 'video') { registerVideoUrl(candidate.media, candidate.url); setCurrentUs(0) }
    else setAssetUrls((urls) => new Map(urls).set(asset.id, candidate.url))
    setAssetIssues((issues) => { if (!issues.has(asset.id)) return issues; const next = new Map(issues); next.delete(asset.id); return next })
    runCommand({ type: 'asset-update', assetId: asset.id, changes: candidate.media })
  }

  /**
   * Opens a probed video file. With no video yet it becomes the first clip — one undoable step that
   * also binds any captions imported before it. With a video already open it replaces that video's
   * file under the same asset id, so captions and items keep their timing (the same undoable
   * `asset-update` a relink uses); inserting a further clip arrives with the multi-clip timeline.
   */
  const openVideoMedia = (media: ProjectMedia, url: string, retitle = false): boolean => {
    if (primary) {
      useAssetCandidate(primary, { path: media.reference.absolutePath ?? '', url, media, mismatches: [] })
    } else {
      const durationUs = media.metadata?.durationUs ?? null
      if (durationUs === null) { setNotice({ tone: 'error', text: `${media.name}’s duration could not be read, so it cannot be opened as a video.` }); return false }
      const asset: ProjectAsset = { id: crypto.randomUUID(), kind: 'video', ...media }
      if (!runCommand({ type: 'clip-add', clip: { id: crypto.randomUUID(), assetId: asset.id, startUs: 0, endUs: durationUs }, asset })) return false
      registerVideoUrl(media, url)
      setSelection(null)
      setCurrentUs(0)
    }
    setWaveform({ kind: 'idle' })
    if (retitle) retitleProject(media.name.replace(/\.[^.]+$/, ''))
    return true
  }

  useEffect(() => {
    if (focusCueId === undefined) return
    const target = (focusCueId ? cueButtonRefs.current.get(focusCueId) : undefined) ?? addCueButtonRef.current
    requestAnimationFrame(() => target?.focus())
    setFocusCueId(undefined)
  }, [focusCueId, project.cues])

  // `describe` overrides the default notice for commands (like set-display) whose outcome the
  // caller can explain more usefully than the generic overlap warning.
  const runCommand = (command: EditCommand, describe?: (warnings: ValidationIssue[]) => Notice) => {
    const result = applyEditCommand(project, command, commandContext)
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.errors.map((issue) => issue.message).join(' ') })
      return false
    }
    if (result.project === project) return true
    setHistory((state) => commitHistory(state, { ...result.project, updatedAt: new Date().toISOString() }))
    if (result.selection !== undefined) setSelection(result.selection)
    else if (result.selectedId !== undefined) setSelectedId(result.selectedId)
    if (command.type === 'delete') setFocusCueId(result.selectedId ?? null)
    setNotice(describe ? describe(result.warnings) : result.warnings.length ? { tone: 'warning', text: 'Edit applied. Overlapping cues were preserved and are flagged.' } : null)
    return true
  }

  // One undoable history step; human-authored captions are only replaced by an explicit choice (applyTranscription).
  const applyTranscript: ApplyTranscript = (result, choice) => {
    try {
      const { run, transcript, translation } = result
      const applied = applyTranscription(projectRef.current, transcript, run, choice, () => crypto.randomUUID(), translation)
      setHistory((state) => commitHistory(state, { ...bindToPrimary(applied.project), updatedAt: new Date().toISOString() }))
      setSelectedId(applied.project.cues.find((cue) => cue.transcriptionRunId === run.id)?.id ?? selectedCueId)
      const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
      const parts = [transcript.segments.length ? `added ${plural(applied.summary.added, 'caption')}` : 'no speech was recognized, so no captions were added']
      if (applied.summary.removed) parts.push(`replaced ${plural(applied.summary.removed, 'existing caption')}`)
      if (applied.summary.skippedOverlapping) parts.push(`skipped ${plural(applied.summary.skippedOverlapping, 'segment')} overlapping kept captions`)
      if (run.adjustedSegmentCount) parts.push(`${plural(run.adjustedSegmentCount, 'caption')} with adjusted timing marked Needs review`)
      if (translation) parts.push(`translated to ${translationTargetLabel(translation.targetLanguage)} (${translation.model}), word timing estimated and marked Needs review`)
      const language = run.language ? `, language ${run.language}` : ''
      const how = 'provider' in run
        ? `Transcribed with Gemini (${run.model.id}, ${plural(run.chunkCount, 'speech chunk')} uploaded${language})`
        : `Transcribed locally (${run.engine.id} ${run.engine.version}, ${run.model.fileName}, ${run.backends.join(' + ') || 'recognizer not run'}${language})`
      setNotice({ tone: applied.summary.skippedOverlapping || run.adjustedSegmentCount || translation ? 'warning' : 'info', text: `${how}: ${parts.join('; ')}.` })
      return { ok: true }
    } catch (error) { return { ok: false, message: errorText(error) } }
  }

  const applyAlignedTiming = (transcript: Parameters<typeof applyAlignment>[1], run: Parameters<typeof applyAlignment>[2], snapshot: { id: string; startUs: number; endUs: number; text: string }[]) => {
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
      const aligned = applyAlignment(current, filtered, { ...run, sourceRange, segmentCount: filtered.segments.length }, () => crypto.randomUUID())
      setHistory((state) => commitHistory(state, aligned))
      const appliedRun = aligned.alignmentRuns?.at(-1)
      const skipped = transcript.segments.length - filtered.segments.length
      setNotice({ tone: appliedRun?.estimatedWordCount || skipped ? 'warning' : 'info', text: `Audio aligned: ${appliedRun?.alignedWordCount ?? 0} words matched${appliedRun?.estimatedWordCount ? `; ${appliedRun.estimatedWordCount} remain estimated` : ''}${skipped ? `; ${skipped} changed caption${skipped === 1 ? '' : 's'} skipped` : ''}.` })
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
  }

  const openVideo = async () => {
    if (!window.captionStudio) return setNotice({ tone: 'error', text: 'Native dialogs are available in the desktop app.' })
    setNotice({ tone: 'info', text: 'Reading media metadata and fingerprint…' })
    try {
      const result = await window.captionStudio.openVideo()
      if (!result) return setNotice(null)
      if (!result.ok) return setNotice({ tone: 'error', text: result.message })
      const { candidate } = result
      if (openVideoMedia(candidate.media, candidate.url, true)) setNotice({ tone: 'info', text: `Opened ${candidate.media.name}; metadata and fingerprint stored locally.` })
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

  const overlayAtSequence = (assetId: string, metadata: MediaMetadata | null, sequenceUs: number): ImageOverlay => ({
    id: crypto.randomUUID(), ...defaultOverlayRange(toSource(sequenceUs), mediaDurationUs),
    assetId, rect: defaultOverlayRect(metadata, captionComposition), opacity: 1, fit: 'contain',
  })

  /** Imports/places every file the media bin, an OS drop, or the stage resolved. `placement` is the
   * sequence-time drop point; only an image is placed there (as an overlay) — audio placement isn't
   * offered yet (ticket V3) and video always goes through the replace-source confirmation instead. */
  const addAssetsFromInspected = (results: InspectedFile[], placement?: { sequenceUs: number }) => {
    const fragments: string[] = []
    let tone: 'info' | 'warning' | 'error' = 'info'
    for (const result of results) {
      if (!result.ok) { fragments.push(result.message); tone = 'error'; continue }
      if (result.kind === 'subtitle') { importSrtContent(result.name, result.content); continue }
      if (result.kind === 'video') {
        if (primary) setPendingReplaceSource({ media: result.media, url: result.url })
        else if (openVideoMedia(result.media, result.url)) fragments.push(`opened ${result.media.name}`)
        continue
      }
      const existing = findAssetByFingerprint(project.assets, result.media)
      if (existing) {
        setAssetUrls((urls) => new Map(urls).set(existing.id, result.url))
        if (placement && result.kind === 'image') runCommand({ type: 'overlay-add', overlay: overlayAtSequence(existing.id, existing.metadata, placement.sequenceUs) })
        else fragments.push(`${result.media.name} is already in the project`)
        continue
      }
      const asset: ProjectAsset = { id: crypto.randomUUID(), kind: result.kind, ...result.media }
      const ok = placement && result.kind === 'image'
        ? runCommand({ type: 'overlay-add', overlay: overlayAtSequence(asset.id, result.media.metadata, placement.sequenceUs), asset })
        : runCommand({ type: 'asset-add', asset })
      if (!ok) continue
      setAssetUrls((urls) => new Map(urls).set(asset.id, result.url))
      fragments.push(`added ${result.media.name}`)
    }
    if (fragments.length) setNotice({ tone, text: `${fragments.join('; ')}.` })
  }

  const importAssetFiles = async () => {
    if (!window.captionStudio) return setNotice({ tone: 'error', text: 'Native dialogs are available in the desktop app.' })
    const results = await window.captionStudio.importAssetFiles()
    if (results) addAssetsFromInspected(results)
  }

  const inspectAndAdd = (files: File[], placement?: { sequenceUs: number }) => {
    if (!window.captionStudio || !files.length) return
    void window.captionStudio.inspectDroppedFiles(files).then((results) => addAssetsFromInspected(results, placement))
  }

  const onTimelineDropAsset = (payload: AssetDragPayload, sequenceUs: number) => {
    const plan = dropPlanForAsset(payload.kind, sequenceUs, toSource, mediaDurationUs)
    if (plan.kind === 'refused') { setNotice({ tone: 'warning', text: plan.reason }); return }
    if (plan.kind === 'replace-source') { setNotice({ tone: 'info', text: 'This is already the open video.' }); return }
    const asset = project.assets.find((candidate) => candidate.id === payload.assetId)
    if (!asset) return
    runCommand({ type: 'overlay-add', overlay: overlayAtSequence(asset.id, asset.metadata, sequenceUs) })
  }
  const onTimelineDropFiles = (files: File[], sequenceUs: number) => inspectAndAdd(files, { sequenceUs })

  const addOverlayAtPlayhead = (asset: ProjectAsset) => {
    if (runCommand({ type: 'overlay-add', overlay: { id: crypto.randomUUID(), ...defaultOverlayRange(currentUs, mediaDurationUs), assetId: asset.id, rect: defaultOverlayRect(asset.metadata, captionComposition), opacity: 1, fit: 'contain' } })) setInspectorTab('edit')
  }
  const addSfxAtPlayhead = (asset: ProjectAsset) => {
    if (runCommand({ type: 'audio-add', clip: defaultClipAt(crypto.randomUUID(), asset.id, currentUs) })) setInspectorTab('edit')
  }

  const overlayCountByAsset = useMemo(() => {
    const map = new Map<string, number>()
    for (const overlay of project.overlays) map.set(overlay.assetId, (map.get(overlay.assetId) ?? 0) + 1)
    return map
  }, [project.overlays])
  const audioCountByAsset = useMemo(() => {
    const map = new Map<string, number>()
    for (const clip of project.audioClips) map.set(clip.assetId, (map.get(clip.assetId) ?? 0) + 1)
    return map
  }, [project.audioClips])

  /** Removing an asset never drops its cached runtime URL — Undo must restore a working overlay/clip
   * immediately, without asking the user to relink a file that never actually left the project. */
  const removeAsset = (assetId: string) => {
    if (!runCommand({ type: 'asset-remove', assetId })) return
    setAssetIssues((issues) => { if (!issues.has(assetId)) return issues; const next = new Map(issues); next.delete(assetId); return next })
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

  const saveProjectAs = async () => {
    if (!window.captionStudio) return
    try {
      const result = await window.captionStudio.saveProject({ project, defaultName: projectPath ?? `${project.title}.${PROJECT_FILE_EXTENSION}` })
      if (result) {
        lastSavedProject.current = result.project
        setHistory((state) => ({ ...state, present: result.project }))
        setProjectPath(result.path)
        setMigrationPending(false)
        setSaveStatus({ kind: 'saved', at: Date.now() })
        setNotice({ tone: 'info', text: `Saved project to ${result.path}. Changes now autosave there.` })
      }
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
  }

  const saveProject = async () => {
    if (!autosaveEnabled || !projectPath) return saveProjectAs()
    await writeProject(projectPath, project, true)
    if (lastSavedProject.current === project) setNotice({ tone: 'info', text: `Saved project to ${projectPath}` })
  }

  const openProject = async () => {
    if (!window.captionStudio) return
    try {
      const result = await window.captionStudio.openProject()
      if (!result) return
      if (!result.ok) return setNotice({ tone: 'error', text: result.message })
      const opened = projectSchema.parse(result.project)
      setHistory(createHistory(opened))
      lastSavedProject.current = opened
      setProjectPath(result.path)
      setMigrationPending(result.migratedFrom !== null)
      setSaveStatus({ kind: 'saved', at: Date.now() })
      setSelectedId(opened.cues[0]?.id ?? null)
      setMeasuredDurationUs(null)
      setCurrentUs(0)
      setWaveform({ kind: 'idle' })
      setOverlayDraft(null)
      setPendingAssetRelink(null)
      // Every asset — the video included — resolves the same way. A resolved file gets its runtime URL; a
      // missing or mismatched one only gets an issue badge, and a mismatched *video* opens the review
      // dialog straight away (exactly like an explicit Relink…) because nothing plays without it.
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
      setVideoUrls(videos)
      setAssetUrls(urls)
      setAssetIssues(issues)
      const opening = primaryVideoAsset(opened)
      const openingResolution = opening ? result.assets.find((entry) => entry.id === opening.id)?.resolution : undefined
      if (openingResolution?.kind === 'resolved') {
        setNotice({ tone: 'info', text: `Project loaded${migrationNote(result.migratedFrom)}; media fingerprint verified.` })
      } else if (opening && openingResolution?.kind === 'mismatch') {
        setPendingAssetRelink({ asset: opening, candidate: openingResolution.candidate })
        setNotice({ tone: 'warning', text: 'The media at the stored path does not match this project. Review the differences before using it.' })
      } else if (opening && openingResolution?.kind === 'missing') {
        setNotice({ tone: 'warning', text: `Project loaded, but ${opening.name} is missing. Choose Relink media to locate it.` })
      } else setNotice({ tone: 'info', text: `Project loaded${migrationNote(result.migratedFrom)}.` })
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
  }

  const relinkMedia = () => primary ? relinkAsset(primary.id) : Promise.resolve()

  const importImageOverlay = async () => {
    if (!window.captionStudio) return
    try {
      const result = await window.captionStudio.importAsset('image')
      if (!result) return
      if (!result.ok) return setNotice({ tone: 'error', text: result.message })
      const asset: ProjectAsset = { id: crypto.randomUUID(), kind: 'image', ...result.media }
      const overlay: ImageOverlay = {
        id: crypto.randomUUID(), ...defaultOverlayRange(currentUs, mediaDurationUs),
        assetId: asset.id, rect: defaultOverlayRect(result.media.metadata, captionComposition), opacity: 1, fit: 'contain',
      }
      if (!runCommand({ type: 'overlay-add', overlay, asset })) return
      setAssetUrls((urls) => new Map(urls).set(asset.id, result.url))
      setInspectorTab('edit')
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
        setNotice({ tone: 'warning', text: 'The replacement differs from the stored asset. Review the details below.' })
      } else {
        useAssetCandidate(asset, result.candidate)
        setNotice({ tone: 'info', text: `Relinked ${result.candidate.media.name}; fingerprint verified.` })
      }
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
  }

  const deleteSelectedOverlay = () => {
    if (!overlayBase) return
    runCommand({ type: 'item-delete', kind: 'overlay', id: overlayBase.id })
  }

  const draftOverlay = (changes: Partial<Omit<ImageOverlay, 'id'>>) => {
    if (!overlayBase) return
    setOverlayDraft({ ...(overlayDraft ?? overlayBase), ...changes })
  }
  const commitOverlay = (changes: Partial<Omit<ImageOverlay, 'id'>>) => {
    if (!overlayBase) return
    setOverlayDraft(null)
    runCommand({ type: 'overlay-update', overlayId: overlayBase.id, changes })
  }

  const previewOverlayDrag = (overlay: ImageOverlay | null, seekUs?: number) => {
    setOverlayDraft(overlay)
    if (seekUs !== undefined) seekTo(seekUs)
  }
  const commitOverlayDrag = (original: ImageOverlay, preview: ImageOverlay, mode: CueDragMode, options?: { clone?: boolean }) => {
    if (options?.clone) { runCommand({ type: 'overlay-add', overlay: preview }); return }
    if (mode === 'move') runCommand({ type: 'item-move', kind: 'overlay', id: original.id, deltaUs: preview.startUs - original.startUs })
    else runCommand({ type: 'item-resize', kind: 'overlay', id: original.id, startUs: preview.startUs, endUs: preview.endUs })
  }

  // Alt+drag on the stage (OverlayStageEditor): a ghost overlay with its own id, appended by
  // `visibleOverlays` rather than replacing the original. `null` clears it (drag ended or cancelled).
  const draftOverlayClone = (overlay: ImageOverlay | null) => setOverlayDraft(overlay)
  const commitOverlayClone = (overlay: ImageOverlay) => { setOverlayDraft(null); runCommand({ type: 'overlay-add', overlay }) }

  const duplicateSelectedOverlay = () => {
    if (!overlayBase) return
    const rect = { ...overlayBase.rect, x: overlayBase.rect.x + 24, y: overlayBase.rect.y + 24 }
    runCommand({ type: 'overlay-add', overlay: { ...overlayBase, id: crypto.randomUUID(), rect } })
  }
  const reorderSelectedOverlay = (direction: 'forward' | 'backward') => {
    if (!overlayBase) return
    runCommand({ type: 'overlay-reorder', overlayId: overlayBase.id, direction })
  }

  // Sound effects (V3): mirrors `importImageOverlay` — one undo step imports the asset and places
  // the clip at the playhead together.
  const importSoundEffect = async () => {
    if (!window.captionStudio) return
    try {
      const result = await window.captionStudio.importAsset('audio')
      if (!result) return
      if (!result.ok) return setNotice({ tone: 'error', text: result.message })
      const asset: ProjectAsset = { id: crypto.randomUUID(), kind: 'audio', ...result.media }
      const clip = defaultClipAt(crypto.randomUUID(), asset.id, currentUs)
      if (!runCommand({ type: 'audio-add', clip, asset })) return
      setAssetUrls((urls) => new Map(urls).set(asset.id, result.url))
      setInspectorTab('edit')
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
  }

  const deleteSelectedSfx = () => {
    if (!sfxBase) return
    runCommand({ type: 'item-delete', kind: 'audio', id: sfxBase.id })
  }
  const draftSfx = (changes: Partial<Omit<AudioClip, 'id'>>) => {
    if (!sfxBase) return
    setSfxDraft({ ...(sfxDraft ?? sfxBase), ...changes })
  }
  const commitSfx = (changes: Partial<Omit<AudioClip, 'id'>>) => {
    if (!sfxBase) return
    setSfxDraft(null)
    runCommand({ type: 'audio-update', clipId: sfxBase.id, changes })
  }
  const previewSfxDrag = (clip: AudioClip | null, seekUs?: number) => {
    setSfxDraft(clip)
    if (seekUs !== undefined) seekTo(seekUs)
  }
  const commitSfxDrag = (original: AudioClip, preview: AudioClip, mode: CueDragMode) => {
    if (mode === 'move') runCommand({ type: 'item-move', kind: 'audio', id: original.id, deltaUs: preview.atUs - original.atUs })
    else {
      const asset = project.assets.find((candidate) => candidate.id === original.assetId) ?? null
      const range = clipRange(original, asset)
      const startUs = mode === 'start' ? preview.atUs : range.startUs
      const endUs = mode === 'end' ? preview.atUs + clipDurationUs(preview, asset) : range.endUs
      runCommand({ type: 'item-resize', kind: 'audio', id: original.id, startUs, endUs })
    }
  }

  const exportSrt = async () => {
    if (!window.captionStudio) return
    // Cuts are stored as source-time segments (docs/EDITING.md); SRT for a cut project must speak
    // sequence time — the timeline the viewer of the *exported* video actually sees.
    const cues = hasCuts(project) ? cuesInSequenceForClips(project.cues, project.clips) : project.cues
    const result = await window.captionStudio.saveText({ content: serializeSrt(cues), defaultName: `${project.title}.srt` })
    if (result) setNotice({ tone: 'info', text: `Exported SRT to ${result.path}` })
  }

  /** One detection request/response round trip for the Remove Silence dialog; `App.tsx` owns the
   * fingerprint and IPC bridge so the dialog itself stays a pure "options in, ranges out" form. */
  const detectSilence = async (requestId: string, options: SilenceDetectionOptions, onProgress: (percent: number | null) => void) => {
    if (!window.captionStudio || !primary?.fingerprint) throw new Error('Open or relink the video before detecting silence.')
    const unsubscribe = window.captionStudio.onSilenceProgress((message) => {
      if (message.requestId !== requestId) return
      onProgress(message.progress.kind === 'measured' ? Math.round(message.progress.completed / message.progress.total * 100) : null)
    })
    try {
      const result = await window.captionStudio.detectSilence({ requestId, fingerprint: primary.fingerprint, thresholdDbfs: options.thresholdDbfs, minSilenceMs: options.minSilenceMs })
      return { durationUs: result.durationUs, silences: result.silences }
    } finally { unsubscribe() }
  }
  const cancelSilenceDetection = (requestId: string) => void window.captionStudio?.cancelSilenceDetection(requestId)

  const applySilenceRemoval = (ranges: { startUs: number; endUs: number }[]) => {
    if (!primary) return
    runCommand({ type: 'clips-set', keptByAsset: [{ assetId: primary.id, ranges }], idPrefix: crypto.randomUUID() }, (warnings) => {
      const removedUs = sourceDurationUs - ranges.reduce((total, range) => total + (range.endUs - range.startUs), 0)
      return { tone: warnings.length ? 'warning' : 'info', text: removedUs > 0
        ? `Removed ${formatClock(removedUs)} of silence; new length ${formatClock(sequenceDurationUs(ranges, sourceDurationUs))}.`
        : 'No silence removed; the project is unchanged.' }
    })
    // A removed range can no longer contain the playhead once the cut lands — collapse it to the
    // nearest kept instant exactly as scrubbing past a cut already does. `ranges` (not the stale
    // `segments` this closure captured before the command committed) is the mapping that
    // now applies.
    const collapsed = sourceToSequence(currentUs, ranges, sourceDurationUs)
    seekTo(sequenceToSource(collapsed.sequenceUs, ranges, sourceDurationUs))
  }

  const restoreCuts = () => {
    if (!hasCuts(project)) return
    runCommand({ type: 'clips-restore' }, () => ({ tone: 'info', text: 'Restored the full, uncut timeline.' }))
  }

  const seek = (cue: Cue) => {
    seekTo(cue.startUs, cue.id)
  }

  /** `timeUs` is **source** time, which is what every caption, word and item is stored in. */
  const seekTo = (timeUs: number, cueId?: string) => {
    if (cueId !== undefined) setSelectedId(cueId)
    setCurrentUs(timeUs)
    clock.set(timeUs)
    if (videoRef.current) videoRef.current.currentTime = timeUs / US_PER_SECOND
  }

  /** The timeline, ruler and transport scrubber all speak sequence time; map it back here. */
  const seekToSequence = (sequenceUs: number, cueId?: string) => seekTo(toSource(sequenceUs), cueId)

  const previewCueDrag = (cue: Cue | null, seekUs?: number) => {
    setDragPreview(cue)
    if (seekUs !== undefined) seekTo(seekUs, cue?.id)
  }

  const commitCueDrag = (original: Cue, preview: Cue, mode: CueDragMode) => {
    if (mode === 'move') {
      runCommand({ type: 'shift-time', cueId: original.id, deltaUs: preview.startUs - original.startUs })
    } else {
      runCommand({ type: 'update-time', cueId: original.id, startUs: preview.startUs, endUs: preview.endUs })
    }
  }

  const undo = () => setHistory((state) => undoHistory(state))
  const redo = () => setHistory((state) => redoHistory(state))

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return setNotice({ tone: 'error', text: 'Open a video before using playback controls.' })
    if (video.paused) {
      // A swallowed rejection made every failure read the same. AbortError (play superseded by a
      // pause/seek/load) is not an error; anything else is reported with its real name and cause.
      void video.play().catch((error: unknown) => {
        const text = describePlayFailure(error, video.error)
        if (!text) return
        console.error('video.play() rejected', error, { mediaError: video.error, readyState: video.readyState, networkState: video.networkState })
        setNotice({ tone: 'error', text })
      })
    } else {
      video.pause()
    }
  }

  // Stepping moves along the output timeline, so a step never lands inside a removed range.
  const seekBy = (deltaUs: number) => seekToSequence(Math.max(0, Math.min(durationUs, currentSequenceUs + deltaUs)))

  const cancelWaveform = () => {
    if (waveform.kind !== 'loading' || !window.captionStudio) return
    const requestId = waveform.requestId
    cancelledWaveformRequest.current = requestId
    setWaveform({ kind: 'idle' })
    void window.captionStudio.cancelWaveform(requestId)
  }

  const selectAdjacentCue = (direction: -1 | 1) => {
    if (!project.cues.length) return
    const selectedIndex = project.cues.findIndex((cue) => cue.id === selectedCueId)
    const nextIndex = selectedIndex < 0 ? (direction > 0 ? 0 : project.cues.length - 1) : Math.max(0, Math.min(project.cues.length - 1, selectedIndex + direction))
    const cue = project.cues[nextIndex]
    seek(cue)
    setFocusCueId(cue.id)
  }

  const splitSelectedCue = () => {
    if (!selected) return setNotice({ tone: 'error', text: 'Select a cue before splitting it.' })
    runCommand({ type: 'split', cueId: selected.id, atUs: Math.round(currentUs), rightCueId: crypto.randomUUID() })
  }

  const deleteSelectedCue = () => {
    if (!selected) return setNotice({ tone: 'error', text: 'Select a cue before deleting it.' })
    runCommand({ type: 'delete', cueId: selected.id })
  }

  const mergeSelectedCue = () => {
    if (!selected) return setNotice({ tone: 'error', text: 'Select a cue before merging it.' })
    runCommand({ type: 'merge-next', cueId: selected.id })
  }

  const trimSelectedCue = () => {
    if (!selected) return setNotice({ tone: 'error', text: 'Select a cue before trimming it.' })
    const next = trimToPlayhead(selected, currentUs)
    runCommand({ type: 'update-time', cueId: selected.id, startUs: next.startUs, endUs: next.endUs })
  }

  const canAddCue = mediaDurationUs === null || currentUs < mediaDurationUs
  const canSplitSelected = selected !== null && currentUs > selected.startUs && currentUs < selected.endUs
  const canMergeSelected = selected !== null && project.cues.at(-1)?.id !== selected.id

  const addCue = (durationUs = 2 * US_PER_SECOND) => {
    if (mediaDurationUs !== null && currentUs >= mediaDurationUs) {
      setNotice({ tone: 'error', text: 'Move the playhead before the end of the media to add a cue.' })
      return
    }
    const endUs = mediaDurationUs === null ? currentUs + durationUs : Math.min(currentUs + durationUs, mediaDurationUs)
    runCommand({ type: 'add', cue: { id: crypto.randomUUID(), startUs: Math.round(currentUs), endUs: Math.round(endUs), text: '', timingSource: 'manual', needsReview: false, textSource: 'user', words: [] } })
  }
  const addWord = () => addCue(600_000)

  const onSelectWord = (cue: Cue, word: CaptionWord) => {
    seekTo(word.startUs, cue.id)
    setSelectedWordId(word.id)
  }

  const deleteSelectedWord = () => {
    if (!selected || !selectedWord) return
    const index = selected.words.findIndex((word) => word.id === selectedWord.id)
    // delete-word never assigns new ids to the words it keeps (only offsets shift), so the
    // remaining list is exactly today's list minus the deleted word — no need to wait for the
    // command's deferred state update to know what to select next.
    const remaining = selected.words.filter((word) => word.id !== selectedWord.id)
    if (!runCommand({ type: 'delete-word', cueId: selected.id, wordId: selectedWord.id })) return
    setSelectedWordId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null)
  }

  const setTimelineDisplay = (next: CaptionDisplay) => {
    setSelectedWordId(null)
    runCommand({ type: 'set-timeline-display', display: next })
  }
  const setCaptionDisplay = (next: CaptionDisplay) => runCommand({ type: 'set-caption-display', display: next })

  const draftStyle = (style: CaptionStyle) => setStyleDraft(style)
  const commitStyle = (style: CaptionStyle) => { setStyleDraft(null); commit((state) => ({ ...state, captionStyle: style })) }
  const applyTemplate = (style: CaptionStyle) => {
    setStyleDraft(null)
    const needsEstimates = ['active-word-highlight', 'word-pop', 'progressive-word-reveal'].includes(style.motion)
      && project.cues.some((cue) => untimedTokenCount(cue) > 0)
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
  const savePreset = (name: string) => { setStyleDraft(null); commit((state) => saveCaptionPreset(state, name, effectiveStyle, () => crypto.randomUUID())) }
  const applyPreset = (id: string) => { setStyleDraft(null); commit((state) => applyCaptionPreset(state, id)) }
  const deletePreset = (id: string) => commit((state) => deleteCaptionPreset(state, id))

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = shortcutForEvent(event, event.target)
      if (!action) return
      // Space must toggle exactly once. A held key auto-repeats keydown, and a focused <video controls>
      // handles Space itself; either way a second toggle calls pause() right behind play(), which
      // rejects the play promise (AbortError) and left playback looking broken.
      if (action === 'toggle-playback' && event.repeat) return
      if (action === 'toggle-playback' && event.target instanceof Element && event.target.closest('button, summary, a, video, [role="button"]')) return
      event.preventDefault()
      const actions: Record<ShortcutAction, () => void> = {
        'toggle-playback': togglePlayback,
        'seek-backward': () => seekBy(-US_PER_SECOND),
        'seek-forward': () => seekBy(US_PER_SECOND),
        'split-cue': splitSelectedCue,
        'delete-cue': () => selection?.kind === 'overlay' ? deleteSelectedOverlay() : selectedWord ? deleteSelectedWord() : deleteSelectedCue(),
        undo,
        redo,
        'previous-cue': () => selectAdjacentCue(-1),
        'next-cue': () => selectAdjacentCue(1),
        'show-shortcuts': () => setSettingsTab('shortcuts'),
      }
      actions[action]()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  // Native menu commands run whatever the handlers are on the latest render.
  const menuHandlers = useRef<Record<MenuCommand, () => void>>(null!)
  menuHandlers.current = {
    'open-video': () => void openVideo(), 'import-srt': () => void importSrt(), 'open-project': () => void openProject(),
    'save-project': () => void saveProject(), 'save-project-as': () => void saveProjectAs(),
    // The native accelerators fire even while typing; a focused field keeps its own edit history.
    undo: () => isEditableTarget(document.activeElement) ? void window.captionStudio?.editText('undo') : undo(),
    redo: () => isEditableTarget(document.activeElement) ? void window.captionStudio?.editText('redo') : redo(),
    'export-srt': () => { if (project.cues.length) void exportSrt() },
    'export-video': () => { if (exportVideoBlocker === null) void startExportVideo() },
    'remove-silence': () => { if (mediaReady) setSilenceDialogOpen(true) },
    'restore-cuts': () => restoreCuts(),
    settings: () => setSettingsTab('models'), shortcuts: () => setSettingsTab('shortcuts'),
  }
  useEffect(() => window.captionStudio?.onMenuCommand((command) => menuHandlers.current[command]()), [])

  const mediaReady = Boolean(videoUrl && primary?.fingerprint)
  const exportVideoBlocker = exportState.kind === 'running' ? 'An export is already running' : exportState.kind === 'unsupported' ? exportState.reason
    : exportState.kind === 'error' ? exportState.message
    : exportState.kind === 'checking-support' || exportState.kind === 'idle' ? 'Checking export support…'
    : !mediaReady ? 'Open or relink the video first'
    : null
  const shortcutLabel = (key: string) => `${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'}${key}`
  const fileEntries: MenuEntry[] = [
    { id: 'open-video', label: 'Open video…', onSelect: () => void openVideo(), shortcut: shortcutLabel('⇧O') },
    { id: 'import-srt', label: 'Import SRT…', onSelect: () => void importSrt(), shortcut: shortcutLabel('I') },
    { id: 'sep', separator: true },
    { id: 'open-project', label: 'Open project…', onSelect: () => void openProject(), shortcut: shortcutLabel('O') },
    { id: 'save-project', label: 'Save project', onSelect: () => void saveProject(), shortcut: shortcutLabel('S') },
    { id: 'save-project-as', label: 'Save project as…', onSelect: () => void saveProjectAs(), shortcut: shortcutLabel('⇧S') },
  ]
  const saveStatusText = !projectPath ? 'Not saved · autosave off'
    : migrationPending ? 'Migrated · save to enable autosave'
    : saveStatus?.kind === 'saving' ? 'Saving…'
    : saveStatus?.kind === 'error' ? 'Autosave failed'
    : saveStatus?.kind === 'saved' ? `Autosaved ${new Date(saveStatus.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Autosave on'
  const exportEntries: MenuEntry[] = [
    { id: 'export-video', label: 'Video with captions (MP4)…', onSelect: () => void startExportVideo(), disabledReason: exportVideoBlocker, shortcut: shortcutLabel('E') },
    { id: 'export-srt', label: 'Subtitles (SRT)…', onSelect: () => void exportSrt(), disabledReason: project.cues.length ? null : 'No captions yet', shortcut: shortcutLabel('⇧E') },
  ]
  // Video-level edits (cuts today; trim/overlays/blur later — docs/EDITING.md) get their own menu
  // rather than the text-editing 'Edit' menu the native template already reserves for Undo/Cut/Paste.
  const timelineEntries: MenuEntry[] = [
    { id: 'add-image-overlay', label: 'Add image overlay…', onSelect: () => void importImageOverlay(), disabledReason: mediaReady ? null : 'Open or relink the video first' },
    { id: 'remove-silence', label: 'Remove silence…', onSelect: () => setSilenceDialogOpen(true), disabledReason: mediaReady ? null : 'Open or relink the video first' },
    { id: 'restore-cuts', label: 'Restore removed ranges', onSelect: restoreCuts, disabledReason: hasCuts(project) ? null : 'No cuts to restore' },
  ]

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">C</span><div><strong>Caption Studio</strong><small title={project.title}>{primary?.name ?? project.title}</small></div></div>
      <div className="toolbar toolbar-workflow" role="group" aria-label="Captions">
        <AlignmentControls fingerprint={primary?.fingerprint} mediaReady={mediaReady} cues={project.cues} keyConfigured={Boolean(geminiKey?.configured)}
          onNeedKey={() => { setSettingsTab('gemini'); setNotice({ tone: 'info', text: 'Add a Gemini API key to align audio.' }) }}
          onApply={applyAlignedTiming} onMessage={(tone, text) => setNotice({ tone, text })} />
        {exportState.kind === 'running' && <span className="job-pill" role="status">
          <span>Exporting · {describeJob(exportState.job).label}{describeJob(exportState.job).percent === null ? '' : ` ${describeJob(exportState.job).percent}%`}</span>
          <button onClick={cancelExportVideo}>Cancel</button>
        </span>}
        {primary && !videoUrl && <button className="warning-chip" onClick={relinkMedia} title={`${primary.name} is not available at its stored location`}>Media offline · Relink</button>}
      </div>
      <div className="toolbar toolbar-file">
        <span className={`save-status${saveStatus?.kind === 'error' ? ' save-status-error' : ''}`} role="status" title={projectPath ?? 'Save the project to enable autosave'}>{saveStatusText}</span>
        <MenuButton label="File" entries={fileEntries} />
        <MenuButton label="Timeline" entries={timelineEntries} />
        <MenuButton label="Export" className="accent" entries={exportEntries} />
        <button className="icon-button" aria-label="Settings" title="Settings: speech models, Gemini API key, shortcuts" onClick={() => setSettingsTab('models')}>⚙</button>
      </div>
    </header>
    <SettingsDialog tab={settingsTab} onTab={setSettingsTab} onClose={() => setSettingsTab(null)} geminiKey={geminiKey} onGeminiKey={setGeminiKey}
      onMessage={(tone, text) => setNotice({ tone, text })} />
    <SilenceRemovalDialog open={silenceDialogOpen} mediaReady={mediaReady} onClose={() => setSilenceDialogOpen(false)}
      onDetect={detectSilence} onCancelDetect={cancelSilenceDetection} onApply={applySilenceRemoval} hasExistingCuts={hasCuts(project)} />

    <section className="workspace">
      <LeftRail active={railTab} onChange={setRailTab} onSettings={() => setSettingsTab('models')} />
      <aside className="panel side-panel" aria-label={railTab === 'media' ? 'Media' : railTab === 'captions' ? 'Captions' : railTab === 'overlays' ? 'Overlays' : 'Transitions'}>
        {railTab === 'media' && <MediaBin media={primary} videoReady={Boolean(videoUrl)} mediaDurationUs={mediaDurationUs}
          assets={project.assets} assetUrls={assetUrls} assetIssues={assetIssues}
          overlayCountByAsset={overlayCountByAsset} audioCountByAsset={audioCountByAsset}
          onImportFiles={() => void importAssetFiles()} onDropFiles={(files) => inspectAndAdd(files)}
          onAddOverlayAtPlayhead={addOverlayAtPlayhead} onAddSfxAtPlayhead={addSfxAtPlayhead}
          onRemoveAsset={removeAsset} onRelinkAsset={(assetId) => void relinkAsset(assetId)} onRelinkMedia={() => void relinkMedia()} />}
        {railTab === 'captions' && <CaptionsPanel cueCount={project.cues.length} visibleCues={visibleCues} selectedCueId={selectedCueId}
          selectedWordId={selectedWord?.id ?? null} warningCueIds={warningCueIds} segments={segments} sourceDurationUs={sourceDurationUs}
          historyPastLength={history.past.length} historyFutureLength={history.future.length} onUndo={undo} onRedo={redo}
          effectiveStyle={effectiveStyle} selected={selected} captionDisplay={captionDisplay} onCaptionDisplay={setCaptionDisplay} onProjectStyle={commitStyle}
          onOverride={(override) => selected && runCommand({ type: 'set-motion-override', cueId: selected.id, override })}
          onResetOverrides={() => runCommand({ type: 'reset-motion-overrides' })}
          onEstimate={() => selected && runCommand({ type: 'estimate-words', cueId: selected.id, idPrefix: crypto.randomUUID() })}
          onGroup={(options, all) => runCommand(all
            ? { type: 'regroup-many', cueIds: project.cues.map((cue) => cue.id), idPrefix: crypto.randomUUID(), estimateMissing: false, options }
            : selected ? { type: 'regroup', cueId: selected.id, idPrefix: crypto.randomUUID(), estimateMissing: false, options } : { type: 'regroup-many', cueIds: [], idPrefix: crypto.randomUUID(), estimateMissing: false, options })}
          onSelect={seek} onUpdateText={(cueId, text) => runCommand({ type: 'update-text', cueId, text })} onSelectWord={onSelectWord}
          onWordAction={(cueId, type, word) => {
            if (type === 'emphasis') runCommand({ type: 'toggle-emphasis', cueId, textStart: word.textStart ?? 0 })
            else if (type === 'line-break') runCommand({ type: 'line-break-before-word', cueId, wordId: word.id })
            else if (type === 'split') runCommand({ type: 'split-before-word', cueId, wordId: word.id, rightCueId: crypto.randomUUID() })
            else if (type === 'next') runCommand({ type: 'move-from-word-to-next', cueId, wordId: word.id })
            else if (type === 'delete') runCommand({ type: 'delete-word', cueId, wordId: word.id })
            else runCommand({ type: 'move-through-word-to-previous', cueId, wordId: word.id })
          }} cueButtonRefs={cueButtonRefs}
          media={primary} mediaReady={mediaReady} onApplyTranscript={applyTranscript}
          geminiKeyConfigured={Boolean(geminiKey?.configured)} onNeedGeminiKey={() => setSettingsTab('gemini')} onImportSrt={() => void importSrt()} />}
        {railTab === 'overlays' && <OverlaysPanel assets={project.assets} assetUrls={assetUrls} onAddAtPlayhead={addOverlayAtPlayhead}
          onImportAndAdd={() => void importImageOverlay()} mediaReady={mediaReady} />}
        {railTab === 'transitions' && <TransitionsPanel style={effectiveStyle} cues={project.cues} activeCue={activeCue ?? null} presets={project.savedCaptionPresets ?? []}
          onApplyTemplate={applyTemplate} onCommitMotion={(motion) => commitStyle({ ...effectiveStyle, motion })}
          onSavePreset={savePreset} onApplyPreset={applyPreset} onDeletePreset={deletePreset}
          onEstimate={activeCue ? () => runCommand({ type: 'estimate-words', cueId: activeCue.id, idPrefix: crypto.randomUUID() }) : undefined} />}
      </aside>

      <section className="stage-panel" aria-label="Video preview and transport">
        <div className={`video-stage ${videoUrl ? '' : 'empty-stage'}`}
          onDragOver={(event) => { if (dropContent(event.dataTransfer)?.kind === 'files') { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
          onDrop={(event) => {
            const content = dropContent(event.dataTransfer)
            if (content?.kind !== 'files' || !content.files.length) return
            event.preventDefault()
            inspectAndAdd(content.files, { sequenceUs: currentSequenceUs })
          }}>
          {videoUrl ? <div className="video-frame" style={{ '--video-aspect': videoAspect } as CSSProperties}>
            <video ref={videoRef} src={videoUrl} controls onTimeUpdate={(event) => {
              const us = Math.round(event.currentTarget.currentTime * US_PER_SECOND)
              setCurrentUs(us); clock.set(us)
            }} onPause={(event) => setCurrentUs(Math.round(event.currentTarget.currentTime * US_PER_SECOND))} onLoadedMetadata={(event) => {
              const { videoWidth, videoHeight } = event.currentTarget
              if (videoWidth > 0 && videoHeight > 0) setMeasuredAspect(videoWidth / videoHeight)
              if (primary?.metadata?.durationUs == null) setMeasuredDurationUs(Math.round(event.currentTarget.duration * US_PER_SECOND))
            }} onLoadedData={() => setCodecDiagnostics({ kind: 'playable' })} onError={(event) => {
              const message = describeMediaError(event.currentTarget.error) ?? 'The embedded player could not play this media.'
              setCodecDiagnostics({ kind: 'confirmed-unsupported', message })
            }} />
            <CaptionStage clock={clock} cues={visibleCues} dragPreview={dragPreview} composition={captionComposition} inputs={captionInputs} style={effectiveStyle} display={captionDisplay}
              overlays={visibleOverlays} assets={project.assets} assetUrls={assetUrls} />
            {project.overlays.length > 0 && <OverlayStageEditor overlays={visibleOverlays} composition={captionComposition} clock={clock}
              selectedId={selection?.kind === 'overlay' ? selection.id : null}
              onSelect={(overlayId) => setSelection({ kind: 'overlay', id: overlayId })}
              onRectDraft={(rect) => draftOverlay({ rect })} onRectCommit={(rect) => commitOverlay({ rect })}
              onCloneDraft={draftOverlayClone} onCloneCommit={commitOverlayClone} />}
            <div className="safe-area" />
          </div> : <Empty title={primary ? 'Media is offline' : 'Your video appears here'} body={primary ? `Relink ${primary.name} to resume playback.` : 'Open a local video to start, or continue from subtitles or a saved project. Media stays on this device.'} action={primary ? <button className="accent" onClick={relinkMedia}>Relink media</button> : <div className="empty-actions">
            <button className="accent" onClick={() => void openVideo()}>Open video</button>
            <button onClick={() => void importSrt()}>Import SRT</button>
            <button onClick={() => void openProject()}>Open project</button>
          </div>} />}
          {primary?.metadata && <MediaSummary metadata={primary.metadata} />}
          {videoUrl && (codecDiagnostics.kind === 'likely-unsupported' || codecDiagnostics.kind === 'confirmed-unsupported') && <div className="codec-diagnostic" role="status">
            <span>{codecDiagnostics.kind === 'confirmed-unsupported' ? codecDiagnostics.message : 'This media’s codec is likely unsupported by the embedded player.'}</span>
            {proxyState.kind === 'ready' && <button onClick={createProxy}>Create local proxy</button>}
            {proxyState.kind === 'creating' && <><span>{`Converting${proxyState.percent === null ? '…' : ` ${proxyState.percent}%`}`}</span><button onClick={cancelProxyCreation}>Cancel</button></>}
            {proxyState.kind === 'unsupported' && <span>{proxyState.reason}</span>}
            {proxyState.kind === 'error' && <span>{proxyState.message}</span>}
            {proxyState.kind === 'done' && <span>Proxy saved to {proxyState.path}</span>}
          </div>}
        </div>
        <div className="transport" role="group" aria-label="Playback transport"><span aria-label={`Current time ${formatClock(currentSequenceUs)}`}>{formatClock(currentSequenceUs)}</span><button onClick={togglePlayback} disabled={!videoUrl} aria-label="Play or pause video" title="Play or pause (Space)">Play/Pause</button><button onClick={() => seekBy(-US_PER_SECOND)} aria-label="Seek backward one second" title="Seek backward (Left Arrow)">−1 s</button><input aria-label="Playhead position" type="range" min="0" max={durationUs} value={Math.min(currentSequenceUs, durationUs)} onChange={(event) => seekToSequence(Number(event.target.value))} /><button onClick={() => seekBy(US_PER_SECOND)} aria-label="Seek forward one second" title="Seek forward (Right Arrow)">+1 s</button><span aria-label={`Duration ${formatClock(durationUs)}`}>{formatClock(durationUs)}</span></div>
      </section>

      <aside className="panel inspector-panel" aria-labelledby="inspector-heading">
        <h2 id="inspector-heading" className="sr-only">Caption inspector</h2>
        <InspectorTabs active={inspectorTab} onChange={setInspectorTab}
          edit={<>
            {selectedOverlay ? <OverlayInspector
              overlay={selectedOverlay}
              asset={project.assets.find((asset) => asset.id === selectedOverlay.assetId) ?? null}
              assetIssue={assetIssues.get(selectedOverlay.assetId) ?? null}
              composition={captionComposition}
              layerIndex={project.overlays.findIndex((overlay) => overlay.id === selectedOverlay.id)}
              overlayCount={project.overlays.length}
              onUpdateTime={(startUs, endUs) => runCommand({ type: 'item-resize', kind: 'overlay', id: selectedOverlay.id, startUs, endUs })}
              onRectDraft={(rect) => draftOverlay({ rect })}
              onRectCommit={(rect) => commitOverlay({ rect })}
              onFit={(fit) => commitOverlay({ fit })}
              onOpacityDraft={(opacity) => draftOverlay({ opacity })}
              onOpacityCommit={(opacity) => commitOverlay({ opacity })}
              onReorder={reorderSelectedOverlay}
              onDuplicate={duplicateSelectedOverlay}
              onAddImage={() => void importImageOverlay()}
              onRelink={() => void relinkAsset(selectedOverlay.assetId)}
              onDelete={deleteSelectedOverlay}
              onInvalid={(text) => setNotice({ tone: 'error', text })}
            /> : selected ? <>
              <CueEditor
                cue={selected}
                onUpdateText={(text) => runCommand({ type: 'update-text', cueId: selected.id, text })}
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
                <button ref={addCueButtonRef} onClick={() => addCue()}>Add at playhead</button>
                <button onClick={splitSelectedCue} disabled={!canSplitSelected} title="Split at playhead (S)">Split at playhead</button>
                <button onClick={mergeSelectedCue} disabled={!canMergeSelected}>Merge next</button>
                <button className="danger" onClick={deleteSelectedCue} title="Delete selected cue (Delete or Backspace)">Delete</button>
              </div>
            </> : <div className="no-selection"><Empty title="Nothing selected" body="Select a caption to edit it, or add one at the playhead." /><button ref={addCueButtonRef} onClick={() => addCue()}>Add at playhead</button><button onClick={() => void importImageOverlay()} disabled={!mediaReady} title={mediaReady ? 'Add an image overlay at the playhead' : 'Open or relink the video first'}>Add image overlay</button></div>}
            {validation.warnings.length > 0 && <div className="validation-warnings" role="status"><strong>{validation.warnings.length} timing warning{validation.warnings.length === 1 ? '' : 's'}</strong>{validation.warnings.map((warning, index) => <p key={`${warning.cueIds.join('-')}-${index}`}>{warning.message}</p>)}</div>}
          </>}
          style={<StylePanel style={effectiveStyle} onDraft={draftStyle} onCommit={commitStyle} />}
        />
        <div className="inspector-footer">
          {exportState.kind === 'running' ? <span className="export-progress" role="status">
            <span>{describeJob(exportState.job).label}{describeJob(exportState.job).percent === null ? '' : ` ${describeJob(exportState.job).percent}%`}</span>
            <button onClick={cancelExportVideo}>Cancel</button>
          </span> : <button className="accent" disabled={!project.cues.length}
            title={exportState.kind === 'ready' && videoUrl && primary?.fingerprint ? 'Render captions into a new MP4; source media is never modified' : 'Export an SRT subtitle file'}
            onClick={exportState.kind === 'ready' && videoUrl && primary?.fingerprint ? startExportVideo : exportSrt}>Export</button>}
        </div>
      </aside>
    </section>

    <Timeline cues={project.cues} currentUs={currentSequenceUs} durationUs={durationUs} mediaDurationUs={sourceDurationUs} segments={segments} fingerprint={primary?.fingerprint ?? null} selection={selection} warningCueIds={warningCueIds} mediaName={primary?.name ?? 'No media selected'} waveform={waveform.kind === 'ready' ? waveform.data : null} waveformStatus={waveform.kind === 'loading' ? `Extracting waveform${waveform.percent === null ? '…' : ` ${waveform.percent}%`}` : waveform.kind === 'error' ? 'Waveform unavailable' : null} onCancelWaveform={waveform.kind === 'loading' ? cancelWaveform : undefined} onSeek={seekToSequence} onDragPreview={previewCueDrag} onDragCommit={commitCueDrag}
      overlays={project.overlays} assets={project.assets} onOverlayDragPreview={previewOverlayDrag} onOverlayDragCommit={commitOverlayDrag} onSelectOverlay={(overlayId) => setSelection({ kind: 'overlay', id: overlayId })}
      display={timelineDisplay} onDisplay={setTimelineDisplay} selectedWordId={selectedWord?.id ?? null} onSelectWord={onSelectWord}
      actions={{ addLine: addCue, addWord, merge: mergeSelectedCue, previous: () => selectAdjacentCue(-1), next: () => selectAdjacentCue(1), delete: () => selectedWord ? deleteSelectedWord() : deleteSelectedCue(), split: splitSelectedCue, trim: trimSelectedCue }}
      canAdd={canAddCue} canSplit={canSplitSelected} canMerge={canMergeSelected} hasSelectedWord={selectedWord !== null}
      onDropAsset={onTimelineDropAsset} onDropFiles={onTimelineDropFiles} />
    {pendingAssetRelink && <RelinkReview title={pendingAssetRelink.asset.kind === 'video' ? 'Replacement video does not match' : 'Asset replacement does not match'} candidate={pendingAssetRelink.candidate}
      onUse={() => { useAssetCandidate(pendingAssetRelink.asset, pendingAssetRelink.candidate); setPendingAssetRelink(null); setNotice({ tone: 'warning', text: `Using ${pendingAssetRelink.candidate.media.name} by your choice; stored identity was replaced with the selected media.` }) }}
      onChooseAgain={() => { const assetId = pendingAssetRelink.asset.id; setPendingAssetRelink(null); void relinkAsset(assetId) }}
      onCancel={() => setPendingAssetRelink(null)} />}
    {pendingSrt && <ReplaceCaptionsReview name={pendingSrt.name} existingCount={project.cues.length} importedCount={pendingSrt.parsed.cues.length}
      onCancel={() => setPendingSrt(null)} onReplace={() => { applyParsedSrt(pendingSrt.parsed); setPendingSrt(null) }} />}
    {pendingReplaceSource && <ReplaceVideoReview name={pendingReplaceSource.media.name} currentName={primary?.name ?? null}
      onCancel={() => setPendingReplaceSource(null)}
      onReplace={() => { openVideoMedia(pendingReplaceSource.media, pendingReplaceSource.url); setPendingReplaceSource(null) }} />}
    {notice && <div className={`notice ${notice.tone}`} role="status" aria-live="polite" onClick={() => setNotice(null)}>{notice.text}</div>}
  </main>
}

/** Subscribes to the per-frame playback clock on its own, so a 60fps tick re-renders only this
 * small subtree — the transcript list, timeline body and waveform/thumbnails never re-render
 * per frame — while still finding the active cue at true frame-accurate source time. */
function CaptionStage({ clock, cues, dragPreview, composition, inputs, style, display, overlays, assets, assetUrls }: {
  clock: PlaybackClock; cues: readonly Cue[]; dragPreview: Cue | null
  composition: Size; inputs: LayoutInputs; style: CaptionStyle; display: CaptionDisplay
  overlays: readonly ImageOverlay[]; assets: readonly ProjectAsset[]; assetUrls: Map<string, string>
}) {
  const frameUs = useSyncExternalStore(clock.subscribe, clock.getUs)
  const lineCue = dragPreview ?? cues.find((cue) => frameUs >= cue.startUs && frameUs < cue.endUs) ?? null
  const wordIndex = display === 'word' && lineCue ? activeWordIndex(lineCue, frameUs) : null
  // Memoized on (lineCue, wordIndex) so the shown cue keeps one stable reference for the whole
  // window a word is held — CaptionPreview's own layout/emphasis memo is keyed on cue identity, and
  // rebuilding a fresh object every frame tick would defeat it.
  const shownCue = useMemo(() => wordIndex === null || !lineCue ? lineCue : wordDisplayCue(lineCue, wordIndex), [lineCue, wordIndex])
  const fallback = display === 'word' && lineCue && wordIndex === null && frameUs >= lineCue.startUs && frameUs < lineCue.endUs
    ? wordMotionAvailability(lineCue).explanation : null
  const resolved = resolveCaptionMotion(style, lineCue?.motionOverride)
  const overlayImages: CompositionLayerImage[] = useMemo(() => overlays
    .filter((overlay) => frameUs >= overlay.startUs && frameUs < overlay.endUs)
    .map((overlay) => ({ id: overlay.id, url: assetUrls.get(overlay.assetId) ?? null,
      label: assets.find((asset) => asset.id === overlay.assetId)?.name ?? 'Missing asset',
      rect: overlay.rect, opacity: overlay.opacity, fit: overlay.fit })),
    [overlays, frameUs, assets, assetUrls])
  return <>
    <CaptionPreview cue={shownCue} timestampUs={frameUs} composition={composition} inputs={inputs} motion={resolved.motion} motionSpeed={resolved.motionSpeed} fontSample={lineCue?.text}
      layers={<CompositionLayers images={overlayImages} composition={composition} />} />
    {fallback && <span role="status" data-word-display-notice style={{ position: 'absolute', bottom: 8, right: 8, maxWidth: '40%',
      fontSize: 12, color: '#ffda8b', background: '#101010cc', padding: 4, zIndex: 2 }}>Showing the full caption: {fallback}</span>}
  </>
}

function rateText(rate: MediaMetadata['frameRate']): string {
  return rate ? `${rate.numerator}/${rate.denominator} fps` : 'frame rate unknown'
}

function MediaSummary({ metadata }: { metadata: MediaMetadata }) {
  const codecs = metadata.streams.map((stream) => `${stream.kind}: ${stream.codec.name}`).join(' · ')
  return <div className="media-summary" aria-label="Probed media metadata">
    <span>{metadata.width ?? '?'}×{metadata.height ?? '?'}</span>
    <span>{rateText(metadata.frameRate)}</span>
    <span>{metadata.rotationDegrees == null ? 'rotation unknown' : `${metadata.rotationDegrees}° rotation`}</span>
    <span>{codecs || 'no streams reported'}</span>
  </div>
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

/** A video picked or dropped into the media bin/stage/timeline while a different video is already
 * open. Phase 1 has one project source, so this always fully replaces it rather than inserting a
 * clip (docs/EDITING.md; Phase 2 changes this to a real multi-clip insert). */
function ReplaceVideoReview({ name, currentName, onCancel, onReplace }: { name: string; currentName: string | null; onCancel: () => void; onReplace: () => void }) {
  return <div className="relink-backdrop"><section className="relink-review" role="dialog" aria-modal="true" aria-labelledby="replace-video-title">
    <small>REPLACE VIDEO</small><h2 id="replace-video-title">Replace the open video?</h2>
    <p>Opening <strong>{name}</strong> will replace {currentName ? <strong>{currentName}</strong> : 'the current video'} as this project’s source. Captions and other items keep their timing; undo restores the previous video.</p>
    <div><button onClick={onCancel}>Cancel</button><button className="accent" onClick={onReplace}>Replace video</button></div>
  </section></div>
}

function CueEditor({ cue, onUpdateText, onUpdateTime, onInvalid }: { cue: Cue; onUpdateText: (text: string) => boolean; onUpdateTime: (startUs: number, endUs: number) => boolean; onInvalid: (message: string) => void }) {
  const [text, setText] = useState(cue.text)
  const [start, setStart] = useState(formatTimestamp(cue.startUs, ':'))
  const [end, setEnd] = useState(formatTimestamp(cue.endUs, ':'))
  useEffect(() => { setText(cue.text); setStart(formatTimestamp(cue.startUs, ':')); setEnd(formatTimestamp(cue.endUs, ':')) }, [cue.id, cue.text, cue.startUs, cue.endUs])
  const changeTime = (_event: ChangeEvent<HTMLInputElement>) => {
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
    <div className="time-fields"><label htmlFor="cue-start">Start<input id="cue-start" aria-label="Cue start timestamp, HH hours MM minutes SS seconds milliseconds" value={start} onChange={(event) => setStart(event.target.value)} onBlur={changeTime} /></label><label htmlFor="cue-end">End<input id="cue-end" aria-label="Cue end timestamp, HH hours MM minutes SS seconds milliseconds" value={end} onChange={(event) => setEnd(event.target.value)} onBlur={changeTime} /></label></div>
    <TimingProvenance cue={cue} />
  </div>
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty"><div className="empty-icon">✦</div><strong>{title}</strong><p>{body}</p>{action}</div>
}
