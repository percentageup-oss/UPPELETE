import { TimingProvenance } from './TimingProvenance'
import { untimedTokenCount } from './core/wordTiming'
import { parseEditedTimestamp } from './core/time'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import { validateCaptions, type ValidationIssue } from './core/captionCommands'
import { applyEditCommand, type CommandContext, type EditCommand } from './core/commands'
import { validateItems } from './core/itemCommands'
import { summarizeCue, summarizeProject, type CommandOutcome, type ProjectSummary } from './core/agentProtocol'
import { useAgentBridge, type AgentBridgeHandlers } from './agent/useAgentBridge'
import {
  activeClipsAt, activeCueAt, captionClips, clipEndUs, clipLengthUs, cuesInSequence, firstSequenceUsOf, sequenceDurationUs, sourceUsOfAssetAt,
  spansInSequence, trackLabel, videoUnderPlayhead,
} from './core/timelineModel'
import type { Selection } from './core/timelineItems'
import { formatAspect } from './core/format'
import { compositionFor } from './core/composition'
import { commitHistory, createHistory, redoHistory, undoHistory } from './core/history'
import { createProject, projectSchema, PROJECT_FILE_EXTENSION, type CaptionProject, type CaptionWord, type Cue, type MigrationNote } from './core/model'
import type { JobSnapshot, JobStructuredError } from './core/jobs'
import { parseSrt, serializeSrt } from './core/srt'
import { formatClock, formatTimestamp, US_PER_SECOND } from './core/time'
import { isEditableTarget, shortcutForEvent, type ShortcutAction } from './core/shortcuts'
import { trimToPlayhead, type CueDragMode } from './core/timeline'
import type { PlaybackClock } from './core/playbackClock'
import { MenuButton, type MenuEntry } from './MenuButton'
import { SettingsDialog, type SettingsTab } from './SettingsDialog'
import type { McpStatus } from '../electron/mcp/config'
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
import { assetUsers, bindUnboundItems, clipCountByAsset, hasTrimmedClips, primaryVideoAsset, videoAssets } from './core/projectClips'
import { TIMELINE_WAVEFORM_PEAKS, type WaveformData } from './core/waveform'
import { containerPlaybackHint, describeMediaError, describePlayFailure } from './core/codecSupport'
import { CaptionPreview } from './captions/CaptionPreview'
import { CompositionLayers, type CompositionLayer } from './captions/CompositionLayers'
import { ClipInspector } from './ClipInspector'
import { ClipStageEditor } from './ClipStageEditor'
import { defaultOverlayRect } from './core/overlayDefaults'
import type { Clip, ClipFit, CompositionRect, ProjectAsset, Track, VisualClip } from './core/edit'
import { freeTrackFor, trackEndUs, type ClipEdge, type EditMode } from './core/clipEdits'
import type { TrackFlags } from './core/trackCommands'
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
import { CaptionsPanel, VideoPicker } from './CaptionsPanel'
import { wordActionCommand, type TranscriptSpan } from './transcript'
import { OverlaysPanel } from './OverlaysPanel'
import { TransitionsPanel } from './TransitionsPanel'
import { dropContent } from './core/dragPayload'
import type { AssetDragPayload } from './core/dragPayload'
import { DEFAULT_IMAGE_CLIP_US, dropPlanForAsset } from './core/timelineDrop'
import { findAssetByFingerprint, type InspectedFile } from './core/assetImport'
import { useAssetUrls } from './app/useAssetUrls'
import { useProjectPlayback } from './app/useProjectPlayback'
import { createThumbnailQueue } from './timeline/thumbnailQueue'

type Notice = { tone: 'info' | 'error' | 'warning'; text: string } | null
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
  const primary = useMemo(() => primaryVideoAsset(project), [project.assets, project.clips])
  const assetById = useMemo(() => new Map(project.assets.map((asset) => [asset.id, asset])), [project.assets])
  const [pendingAssetRelink, setPendingAssetRelink] = useState<{ asset: ProjectAsset; candidate: MediaCandidate } | null>(null)
  // One draft clip substituted into the visible list, for the inspector's and the stage editor's
  // live rect/opacity/gain drafts — exactly `dragPreview`'s role for captions.
  const [clipDraft, setClipDraft] = useState<Clip | null>(null)
  // An Alt+drag clone on the stage, previewed on a transient track above everything until it commits.
  const [cloneDraft, setCloneDraft] = useState<VisualClip | null>(null)
  const [waveforms, setWaveforms] = useState<Map<string, WaveformData>>(new Map())
  const [waveformsLoading, setWaveformsLoading] = useState(0)
  // One selection for every kind of timeline item (one ID namespace). `selectedCueId` keeps every
  // caption read site unchanged.
  const [selection, setSelection] = useState<Selection | null>(null)
  const selectedCueId = selection?.kind === 'cue' ? selection.id : null
  const setSelectedId = (id: string | null) => setSelection(id === null ? null : { kind: 'cue', id })
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<Cue | null>(null)
  const [focusCueId, setFocusCueId] = useState<string | null | undefined>(undefined)
  const [notice, setNotice] = useState<Notice>({ tone: 'info', text: 'Open a video to transcribe it, or import an SRT file.' })
  const [codecIssues, setCodecIssues] = useState<Map<string, CodecIssue>>(new Map())
  const [proxyState, setProxyState] = useState<ProxyState>({ kind: 'idle' })
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' })
  const addCueButtonRef = useRef<HTMLButtonElement>(null)
  const cueButtonRefs = useRef(new Map<string, HTMLElement>())
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('edit')
  // The left rail's active panel. `initial` (module scope) never has media, so 'media' is always
  // the correct default at first mount, matching a fresh project with nothing to caption yet.
  const [railTab, setRailTab] = useState<RailTab>('media')
  const [pendingSrt, setPendingSrt] = useState<{ name: string; parsed: ReturnType<typeof parseSrt> } | null>(null)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  const [silenceDialogOpen, setSilenceDialogOpen] = useState(false)
  const [geminiKey, setGeminiKey] = useState<AlignmentSettingsStatus | null>(null)
  const [editMode, setEditModeState] = useState<EditMode>(storedEditMode)
  const setEditMode = (mode: EditMode) => { setEditModeState(mode); try { localStorage.setItem(EDIT_MODE_STORAGE_KEY, mode) } catch { /* a convenience only */ } }
  // The video transcription, alignment and silence removal work on: `null` follows the playhead.
  const [pickedVideoId, setPickedVideoId] = useState<string | null>(null)
  useEffect(() => { void window.captionStudio?.alignmentSettingsStatus().then(setGeminiKey).catch(() => setGeminiKey({ configured: false, source: 'keychain' })) }, [])
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
  const playback = useProjectPlayback(project, durationUs, media.urlOf, {
    onPlayError: (error, element) => {
      // AbortError (play superseded by a pause/seek/load) is not an error; anything else is reported.
      const text = describePlayFailure(error, element.error)
      if (!text) return
      console.error('video.play() rejected', error, { mediaError: element.error, readyState: element.readyState })
      setNotice({ tone: 'error', text })
    },
    onMediaError: (assetId, element) => setCodecIssues((issues) => new Map(issues).set(assetId, { kind: 'confirmed-unsupported', message: describeMediaError(element.error) ?? 'The embedded player could not play this media.' })),
    onMediaReady: (assetId) => setCodecIssues((issues) => { if (!issues.has(assetId)) return issues; const next = new Map(issues); next.delete(assetId); return next }),
    onSoundIssue: (message) => setNotice({ tone: 'warning', text: `A sound could not be decoded: ${message}` }),
  })
  const { clock, currentUs } = playback
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
  const visibleCues = useMemo(() => dragPreview ? project.cues.map((cue) => cue.id === dragPreview.id ? dragPreview : cue) : project.cues, [project.cues, dragPreview])
  const selected = visibleCues.find((cue) => cue.id === selectedCueId) ?? null
  const visibleClips = useMemo(() => {
    let clips = clipDraft ? project.clips.map((clip) => clip.id === clipDraft.id ? clipDraft : clip) : project.clips
    if (cloneDraft) clips = [...clips, { ...cloneDraft, trackId: CLONE_TRACK.id }]
    return clips
  }, [project.clips, clipDraft, cloneDraft])
  const visibleTracks = useMemo(() => cloneDraft ? [...project.tracks, CLONE_TRACK] : project.tracks, [project.tracks, cloneDraft])
  const clipBase = selection?.kind === 'clip' ? project.clips.find((clip) => clip.id === selection.id) ?? null : null
  const selectedClip = clipBase && clipDraft?.id === clipBase.id ? clipDraft : clipBase
  const captionVideo = useMemo(() => captionClips(project.tracks, project.clips), [project.tracks, project.clips])
  const under = useMemo(() => videoUnderPlayhead(currentUs, project.tracks, project.clips), [currentUs, project.tracks, project.clips])
  const underAsset = under ? assetById.get(under.clip.assetId) ?? null : null
  const pickedVideo = (pickedVideoId ? assetById.get(pickedVideoId) : undefined) ?? underAsset ?? primary
  const activeCue = activeCueAt(currentUs, project.tracks, project.clips, visibleCues)?.cue
  const timelineDisplay: CaptionDisplay = project.timelineDisplay ?? 'line'
  const captionDisplay: CaptionDisplay = project.captionDisplay ?? 'line'
  // Derived, not cleared by an effect: a stale selectedWordId simply stops matching once the
  // selected cue's words change (e.g. after delete/undo/re-estimate) and disappears on its own.
  const selectedWord = selected?.words.find((word) => word.id === selectedWordId) ?? null

  // Style is project state so it saves/reopens and is undoable; a live draft feeds the preview
  // immediately while dragging a control, and one history commit lands per finished gesture.
  const [styleDraft, setStyleDraft] = useState<CaptionStyle | null>(null)
  const savedStyle = project.captionStyle ?? DEFAULT_CAPTION_STYLE
  const effectiveStyle = styleDraft ?? savedStyle
  const captionInputs = useMemo(() => captionStyleInputs(effectiveStyle, captionComposition), [effectiveStyle, captionComposition])
  useEffect(() => setStyleDraft(null), [project.id])

  // Every command and validation shares this: new unbound captions belong to the video under the
  // playhead, and a project with no video bounds its captions by the timeline shown.
  const commandContext = useMemo<CommandContext>(() => ({
    mediaDurationUs: hasVideo ? null : durationUs,
    defaultAssetId: under?.clip.assetId ?? null,
    compositionHeight: captionComposition.height,
  }), [hasVideo, durationUs, under?.clip.assetId, captionComposition.height])
  const validation = useMemo(() => {
    const captions = validateCaptions(visibleCues, commandContext)
    const items = validateItems(project, commandContext)
    return { errors: [...captions.errors, ...items.errors], warnings: [...captions.warnings, ...items.warnings] }
  }, [visibleCues, project, commandContext])
  const warningCueIds = useMemo(() => new Set(validation.warnings.flatMap((warning) => warning.cueIds)), [validation.warnings])

  // A project with video needs every caption bound to one; stamp any that a direct commit created
  // (SRT import) with the video under the playhead. Commands do this themselves.
  const bindToVideo = (next: CaptionProject) => bindUnboundItems(next, videoUnderPlayhead(clock.getUs(), next.tracks, next.clips)?.clip.assetId ?? primaryVideoAsset(next)?.id)
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
  /** A job's `diagnostic` carries the encoder's own stderr or a worker exit code. It used to be
   * dropped here, leaving a one-line message that could not be acted on; a trimmed tail of it now
   * reaches the notice, and the whole of it is in the export log. */
  const exportErrorText = (error: JobStructuredError) => {
    const diagnostic = error.diagnostic?.trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(-300)
    return diagnostic ? `${error.message} — ${diagnostic}` : error.message
  }
  const migrationNote = (from: 1 | 2 | 3 | 4 | null) => from ? ` and migrated from schema ${from} — autosave starts once you save it in the current format (⌘/Ctrl+S)` : ''
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
  useEffect(() => window.captionStudio?.onExportProgress((message) => {
    exportStartedRef.current = message.requestId
    setExportState((state) => state.kind === 'running' && state.requestId === message.requestId ? { ...state, job: message.job } : state)
  }), [])

  // Every file the export would read, and which of them are not playable this session.
  const hidden = new Set(project.tracks.filter((track) => track.hidden).map((track) => track.id))
  const exportAssets = [...new Set(project.clips.filter((clip) => !hidden.has(clip.trackId)).map((clip) => clip.assetId))].flatMap((id) => assetById.get(id) ?? [])
  const offlineAssets = exportAssets.filter((asset) => !media.urlOf(asset))
  const offlineVideos = videoAssets(project).filter((asset) => project.clips.some((clip) => clip.assetId === asset.id) && !media.urlOf(asset))

  const startExportVideo = async () => {
    if (!window.captionStudio) return
    const requestId = crypto.randomUUID()
    setExportState({ kind: 'running', requestId, job: null })
    try {
      const outcome = await window.captionStudio.startExport({ requestId, project })
      setExportState({ kind: 'ready' })
      if (!outcome) {
        // No outcome and no job: the user dismissed the save dialog, which needs no message.
        if (exportStartedRef.current !== requestId) return
        setNotice({ tone: 'error', text: 'The export stopped without reporting a result. Check the export log in the app data folder.' })
        return
      }
      if (outcome.state === 'succeeded') setNotice({ tone: 'info', text: `Exported video to ${outcome.path}. Source media was not modified.` })
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
  useEffect(() => {
    const api = window.captionStudio
    if (!api) return
    for (const asset of project.assets) {
      if (asset.kind === 'image' || !asset.fingerprint || !asset.metadata?.durationUs || !media.urlOf(asset)) continue
      if (loadedWaveformsRef.current.has(asset.id)) continue
      loadedWaveformsRef.current.add(asset.id)
      const assetId = asset.id
      setWaveformsLoading((count) => count + 1)
      void api.loadWaveform({ requestId: crypto.randomUUID(), fingerprint: asset.fingerprint, range: { startUs: 0, endUs: asset.metadata.durationUs }, maxPeaks: TIMELINE_WAVEFORM_PEAKS })
        .then((result) => setWaveforms((map) => new Map(map).set(assetId, result.waveform)))
        .catch((error) => {
          loadedWaveformsRef.current.delete(assetId)
          setNotice({ tone: 'warning', text: `Waveform unavailable for ${asset.name}: ${errorText(error)}` })
        })
        .finally(() => setWaveformsLoading((count) => count - 1))
    }
  }, [project.assets, media.urlOf])

  /** Registers a relinked asset's runtime URL and rewrites its stored media fields in one undo step
   * (an initial open patches the project directly — see `openProject` — since there is nothing yet
   * to undo back to). A video's URL is keyed by fingerprint, so undoing this restores the old file. */
  const useAssetCandidate = (asset: ProjectAsset, candidate: MediaCandidate) => {
    media.register({ id: asset.id, kind: asset.kind, fingerprint: candidate.media.fingerprint }, candidate.url)
    media.clearIssue(asset.id)
    setCodecIssues((issues) => { if (!issues.has(asset.id)) return issues; const next = new Map(issues); next.delete(asset.id); return next })
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
  const runCommands = (commands: EditCommand[]): { outcomes: CommandOutcome[]; failedIndex: number | null; state: ProjectSummary } => {
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
      setNotice({ tone: 'info', text: `Agent applied ${commands.length} edit${commands.length === 1 ? '' : 's'}.` })
    }
    return { outcomes, failedIndex, state: summarizeAgentState(working, nextSelection) }
  }

  // One undoable history step; human-authored captions are only replaced by an explicit choice (applyTranscription).
  const applyTranscript: ApplyTranscript = (result, choice) => {
    try {
      const { run, transcript, translation, assetId } = result
      const applied = applyTranscription(projectRef.current, transcript, run, choice, () => crypto.randomUUID(), translation, assetId)
      setHistory((state) => commitHistory(state, { ...applied.project, updatedAt: new Date().toISOString() }))
      setSelectedId(applied.project.cues.find((cue) => cue.transcriptionRunId === run.id)?.id ?? selectedCueId)
      const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
      const parts = [transcript.segments.length ? `added ${plural(applied.summary.added, 'caption')}` : 'no speech was recognized, so no captions were added']
      if (applied.summary.removed) parts.push(`replaced ${plural(applied.summary.removed, 'existing caption')}`)
      if (applied.summary.skippedOverlapping) parts.push(`skipped ${plural(applied.summary.skippedOverlapping, 'segment')} overlapping kept captions`)
      if (run.adjustedSegmentCount) parts.push(`${plural(run.adjustedSegmentCount, 'caption')} with adjusted timing marked Needs review`)
      if (translation) parts.push(`translated to ${translationTargetLabel(translation.targetLanguage)} (${translation.model}), word timing estimated and marked Needs review`)
      const language = run.language ? `, language ${run.language}` : ''
      const name = assetById.get(assetId)?.name
      const how = 'provider' in run
        ? `Transcribed${name ? ` ${name}` : ''} with Gemini (${run.model.id}, ${plural(run.chunkCount, 'speech chunk')} uploaded${language})`
        : `Transcribed${name ? ` ${name}` : ''} locally (${run.engine.id} ${run.engine.version}, ${run.model.fileName}, ${run.backends.join(' + ') || 'recognizer not run'}${language})`
      setNotice({ tone: applied.summary.skippedOverlapping || run.adjustedSegmentCount || translation ? 'warning' : 'info', text: `${how}: ${parts.join('; ')}.` })
      return { ok: true }
    } catch (error) { return { ok: false, message: errorText(error) } }
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
   * format); otherwise it is appended to the end of V1.
   */
  const addVideoClip = (asset: ProjectAsset, mediaAsset?: ProjectAsset, at?: { startUs: number; trackId: string | null }) => {
    const current = projectRef.current
    const durationUs = asset.metadata?.durationUs ?? null
    if (durationUs === null) { setNotice({ tone: 'error', text: `${asset.name}’s duration could not be read, so it cannot be placed on the timeline.` }); return false }
    const v1 = current.tracks.find((track) => track.kind === 'video' && !track.locked)
    const track = at?.trackId ? undefined : v1 ? undefined : newTrack('video')
    const trackId = at?.trackId ?? v1?.id ?? track!.id
    const startUs = at?.startUs ?? trackEndUs(current.clips, trackId)
    const clip: Clip = { kind: 'video', id: crypto.randomUUID(), trackId, assetId: asset.id, timelineStartUs: startUs, sourceStartUs: 0, sourceEndUs: durationUs, opacity: 1, fit: 'contain', gain: 1 }
    const first = !current.clips.some((candidate) => candidate.kind === 'video')
    if (!runCommand({ type: 'clip-add', clip, asset: mediaAsset, track, mode: at ? editMode : 'overwrite', idPrefix: crypto.randomUUID() })) return false
    // The first video starts a captioning session: nothing selected, playhead at the start.
    if (first) { playback.seek(0); setSelection(null) }
    else if (!at) setNotice({ tone: 'info', text: `Added ${asset.name} to the end of ${trackLabel(current.tracks.find((entry) => entry.id === trackId) ?? track!, current.tracks)}.` })
    return true
  }

  const openVideoMedia = (probed: ProjectMedia, url: string, retitle = false): boolean => {
    const current = projectRef.current
    const existing = findAssetByFingerprint(current.assets.filter((asset) => asset.kind === 'video'), probed)
    const asset: ProjectAsset = existing ?? { id: crypto.randomUUID(), kind: 'video', ...probed }
    media.register({ id: asset.id, kind: 'video', fingerprint: probed.fingerprint }, url)
    const first = !current.clips.some((clip) => clip.kind === 'video')
    if (!addVideoClip(asset, existing ? undefined : asset)) return false
    if (retitle && first) retitleProject(probed.name.replace(/\.[^.]+$/, ''))
    return true
  }

  const openVideo = async () => {
    if (!window.captionStudio) return setNotice({ tone: 'error', text: 'Native dialogs are available in the desktop app.' })
    setNotice({ tone: 'info', text: 'Reading media metadata and fingerprint…' })
    try {
      const result = await window.captionStudio.openVideo()
      if (!result) return setNotice(null)
      if (!result.ok) return setNotice({ tone: 'error', text: result.message })
      const { candidate } = result
      const first = !projectRef.current.clips.some((clip) => clip.kind === 'video')
      if (openVideoMedia(candidate.media, candidate.url, true) && first) setNotice({ tone: 'info', text: `Opened ${candidate.media.name}; metadata and fingerprint stored locally.` })
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
  const addAssetsFromInspected = (results: InspectedFile[], placement?: { sequenceUs: number; trackId: string | null; appendVideos?: boolean }) => {
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
        const plan = placement && !placement.appendVideos ? dropPlanForAsset({ kind: 'video', durationUs: asset.metadata?.durationUs ?? null }, placement.sequenceUs, current.tracks, current.clips, placement.trackId) : null
        const ok = plan?.kind === 'clip'
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

  const inspectAndAdd = (files: File[], placement?: { sequenceUs: number; trackId: string | null; appendVideos?: boolean }) => {
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
      projectRef.current = opened
      lastSavedProject.current = opened
      setProjectPath(result.path)
      setMigrationPending(result.migratedFrom !== null)
      setSaveStatus({ kind: 'saved', at: Date.now() })
      setSelectedId(opened.cues[0]?.id ?? null)
      playback.pause()
      playback.seek(0)
      setWaveforms(new Map())
      loadedWaveformsRef.current = new Set()
      setCodecIssues(new Map())
      setClipDraft(null)
      setPendingAssetRelink(null)
      setPickedVideoId(null)
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
      const migration = describeMigration(result.migrationNotes)
      const onTimeline = new Set(opened.clips.map((clip) => clip.assetId))
      const mismatched = result.assets.find((entry) => entry.resolution.kind === 'mismatch' && onTimeline.has(entry.id))
      const missing = opened.assets.filter((asset) => onTimeline.has(asset.id) && issues.get(asset.id) === 'missing')
      if (mismatched && mismatched.resolution.kind === 'mismatch') {
        setPendingAssetRelink({ asset: opened.assets.find((asset) => asset.id === mismatched.id)!, candidate: mismatched.resolution.candidate })
        setNotice({ tone: 'warning', text: `A file on the timeline does not match this project. Review the differences before using it.${migration}` })
      } else if (missing.length) {
        setNotice({ tone: 'warning', text: `Project loaded${migrationNote(result.migratedFrom)}, but ${missing.map((asset) => asset.name).join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing. Relink from the media bin.${migration}` })
      } else setNotice({ tone: result.migrationNotes.length ? 'warning' : 'info', text: `Project loaded${migrationNote(result.migratedFrom)}${opened.assets.length ? '; media fingerprints verified' : ''}.${migration}` })
    } catch (error) { setNotice({ tone: 'error', text: errorText(error) }) }
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
  const draftClip = (changes: Partial<{ rect: CompositionRect; opacity: number; gain: number }>) => {
    if (!clipBase) return
    setClipDraft({ ...(clipDraft ?? clipBase), ...changes } as Clip)
  }
  const commitClip = (changes: { rect?: CompositionRect | null; opacity?: number; fit?: ClipFit; gain?: number }) => {
    if (!clipBase) return
    setClipDraft(null)
    runCommand({ type: 'clip-update', clipId: clipBase.id, changes })
  }
  const deleteClip = (ripple: boolean) => {
    if (!clipBase) return
    runCommand({ type: 'clip-delete', clipId: clipBase.id, mode: ripple ? 'ripple' : 'overwrite' })
  }
  /** A copy of a clip at the same time goes on a free track of its kind (a new one if none is free). */
  const placeCopy = (clip: Clip, startUs = clip.timelineStartUs, preferTrackId: string | null = null) => {
    const range = { startUs, endUs: startUs + clipLengthUs(clip) }
    const { trackId, track } = placementTrack(clip.kind, range, preferTrackId)
    return runCommand({ type: 'clip-add', clip: { ...clip, id: crypto.randomUUID(), trackId, timelineStartUs: startUs }, track, idPrefix: crypto.randomUUID() })
  }
  const duplicateSelectedClip = () => {
    if (!clipBase) return
    const offset = clipBase.kind !== 'audio' && clipBase.rect ? { ...clipBase, rect: { ...clipBase.rect, x: Math.min(clipBase.rect.x + 24, 1080 - clipBase.rect.width), y: clipBase.rect.y + 24 } } as Clip : clipBase
    placeCopy(offset)
  }
  const splitClips = () => {
    const onlyIds = clipBase && currentUs > clipBase.timelineStartUs && currentUs < clipEndUs(clipBase) ? [clipBase.id] : undefined
    runCommand({ type: 'clip-split', atUs: Math.round(currentUs), clipIds: onlyIds, idPrefix: crypto.randomUUID() }, () => null)
  }
  const canSplitClips = project.clips.some((clip) => currentUs > clip.timelineStartUs && currentUs < clipEndUs(clip)
    && !project.tracks.find((track) => track.id === clip.trackId)?.locked)
  const moveClip = (clipId: string, trackId: string, startUs: number) => runCommand({ type: 'clip-move', clipId, trackId, startUs, mode: editMode, idPrefix: crypto.randomUUID() })
  const trimClip = (clipId: string, edge: ClipEdge, deltaUs: number) => runCommand({ type: 'clip-trim', clipId, edge, deltaUs, mode: editMode })
  const trackActions = {
    onUpdate: (trackId: string, changes: TrackFlags) => runCommand({ type: 'track-update', trackId, changes }),
    onReorder: (trackId: string, direction: 'forward' | 'backward') => runCommand({ type: 'track-reorder', trackId, direction }),
    onRemove: (trackId: string) => runCommand({ type: 'track-remove', trackId }),
    onAdd: (kind: Track['kind']) => runCommand({ type: 'track-add', track: newTrack(kind) }),
  }

  const exportSrt = async () => {
    if (!window.captionStudio) return
    // Captions are stored in their video's source time; SRT for the timeline must speak sequence
    // time — what the viewer of the *exported* video actually sees.
    const cues = cuesInSequence(project.cues, captionVideo)
    const result = await window.captionStudio.saveText({ content: serializeSrt(cues), defaultName: `${project.title}.srt` })
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
  const agentHandlers: AgentBridgeHandlers = {
    getState: () => summarizeAgentState(projectRef.current, selectionRef.current),
    getCaptions: ({ range, cueIds }) => {
      const idSet = cueIds ? new Set(cueIds) : null
      const cues = projectRef.current.cues.filter((cue) =>
        (!idSet || idSet.has(cue.id)) && (!range || (cue.startUs < range.endUs && cue.endUs > range.startUs)))
      return { cues, total: cues.length }
    },
    runCommands,
    seek: (sequenceUs) => { seekTo(sequenceUs); return summarizeAgentState(projectRef.current, selectionRef.current) },
    select: (nextSelection) => { selectionRef.current = nextSelection; setSelection(nextSelection); return summarizeAgentState(projectRef.current, nextSelection) },
    undo: () => agentUndoRedo(undoHistory),
    redo: () => agentUndoRedo(redoHistory),
  }
  useAgentBridge(agentHandlers)

  const togglePlayback = () => {
    if (!project.clips.length && !project.cues.length) return setNotice({ tone: 'error', text: 'Open a video or import captions before playing.' })
    if (playback.playing) playback.pause()
    else playback.play()
  }

  const seekBy = (deltaUs: number) => seekTo(Math.max(0, Math.min(durationUs, currentUs + deltaUs)))

  const selectAdjacentCue = (direction: -1 | 1) => {
    if (!project.cues.length) return
    const selectedIndex = project.cues.findIndex((cue) => cue.id === selectedCueId)
    const nextIndex = selectedIndex < 0 ? (direction > 0 ? 0 : project.cues.length - 1) : Math.max(0, Math.min(project.cues.length - 1, selectedIndex + direction))
    const cue = project.cues[nextIndex]
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

  const trimSelectedCue = () => {
    if (!selected) return setNotice({ tone: 'error', text: 'Select a cue before trimming it.' })
    if (selectedSourceUs === null) return setNotice({ tone: 'error', text: 'Move the playhead over the caption’s video to trim it there.' })
    const next = trimToPlayhead(selected, selectedSourceUs)
    runCommand({ type: 'update-time', cueId: selected.id, startUs: next.startUs, endUs: next.endUs })
  }

  // A caption is added in the source time of the video under the playhead (or, with no video at
  // all, in sequence time), and never runs past the end of the clip it starts in.
  const canAddCue = hasVideo ? under !== null : currentUs < durationUs
  const canSplitSelected = selected !== null && selectedSourceUs !== null && selectedSourceUs > selected.startUs && selectedSourceUs < selected.endUs
  const canMergeSelected = selected !== null && project.cues.at(-1)?.id !== selected.id

  const addCue = (lengthUs = 2 * US_PER_SECOND) => {
    if (hasVideo && !under) { setNotice({ tone: 'error', text: 'Move the playhead over a video to add a caption there.' }); return }
    const startUs = Math.round(under ? under.sourceUs : currentUs)
    const limitUs = under ? under.clip.sourceEndUs : durationUs
    if (startUs >= limitUs) { setNotice({ tone: 'error', text: 'Move the playhead before the end of the media to add a cue.' }); return }
    const endUs = Math.min(startUs + lengthUs, limitUs)
    runCommand({ type: 'add', cue: { id: crypto.randomUUID(), ...(under ? { mediaAssetId: under.clip.assetId } : {}), startUs, endUs, text: '', timingSource: 'manual', needsReview: false, textSource: 'user', words: [] } })
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

  const deleteSelection = (ripple: boolean) => {
    if (selection?.kind === 'clip') return deleteClip(ripple)
    if (selection?.kind === 'blur') return runCommand({ type: 'blur-delete', blurId: selection.id })
    if (ripple) return
    if (selectedWord) return deleteSelectedWord()
    return deleteSelectedCue()
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = shortcutForEvent(event, event.target)
      if (!action) return
      // Space must toggle exactly once: a held key auto-repeats keydown.
      if (action === 'toggle-playback' && event.repeat) return
      if (action === 'toggle-playback' && event.target instanceof Element && event.target.closest('button, summary, a, video, [role="button"]')) return
      event.preventDefault()
      const actions: Record<ShortcutAction, () => void> = {
        'toggle-playback': togglePlayback,
        'seek-backward': () => seekBy(-US_PER_SECOND),
        'seek-forward': () => seekBy(US_PER_SECOND),
        'split-cue': splitSelectedCue,
        'delete-cue': () => deleteSelection(false),
        'ripple-delete': () => deleteSelection(true),
        'split-clips': splitClips,
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
    'remove-silence': () => { if (hasVideo) setSilenceDialogOpen(true) },
    'restore-cuts': () => restoreCuts(),
    settings: () => setSettingsTab('models'), shortcuts: () => setSettingsTab('shortcuts'),
  }
  useEffect(() => window.captionStudio?.onMenuCommand((command) => menuHandlers.current[command]()), [])

  const pickedReady = Boolean(pickedVideo?.fingerprint && media.urlOf(pickedVideo))
  const exportVideoBlocker = exportState.kind === 'running' ? 'An export is already running' : exportState.kind === 'unsupported' ? exportState.reason
    : exportState.kind === 'error' ? exportState.message
    : exportState.kind === 'checking-support' || exportState.kind === 'idle' ? 'Checking export support…'
    : !exportAssets.length ? 'Add a video, image or sound to the timeline first'
    : offlineAssets.length ? `Relink ${offlineAssets[0].name} first`
    : null
  const shortcutLabel = (key: string) => `${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'}${key}`
  const fileEntries: MenuEntry[] = [
    { id: 'open-video', label: hasVideo ? 'Add video…' : 'Open video…', onSelect: () => void openVideo(), shortcut: shortcutLabel('⇧O') },
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
  // Timeline-level edits get their own menu rather than the text-editing 'Edit' menu the native
  // template already reserves for Undo/Cut/Paste.
  const timelineEntries: MenuEntry[] = [
    { id: 'add-image-overlay', label: 'Add image…', onSelect: () => void importImageOverlay() },
    { id: 'split-clips', label: 'Split clips at playhead', onSelect: splitClips, disabledReason: canSplitClips ? null : 'No clip under the playhead', shortcut: shortcutLabel('B') },
    { id: 'add-video-track', label: 'Add video track', onSelect: () => trackActions.onAdd('video') },
    { id: 'add-audio-track', label: 'Add audio track', onSelect: () => trackActions.onAdd('audio') },
    { id: 'sep-silence', separator: true },
    { id: 'remove-silence', label: 'Remove silence…', onSelect: () => setSilenceDialogOpen(true), disabledReason: hasVideo ? null : 'Open a video first' },
    { id: 'restore-cuts', label: 'Restore removed ranges', onSelect: restoreCuts, disabledReason: hasTrimmedClips(project) ? null : 'No trimmed clips to restore' },
  ]
  const summaryAsset = underAsset ?? primary

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">C</span><div><strong>Caption Studio</strong><small title={project.title}>{project.title}</small></div></div>
      <div className="toolbar toolbar-workflow" role="group" aria-label="Captions">
        {pickedVideo && <AlignmentControls fingerprint={pickedVideo.fingerprint} mediaReady={pickedReady}
          cues={project.cues.filter((cue) => cue.mediaAssetId === pickedVideo.id || !cue.mediaAssetId)} keyConfigured={Boolean(geminiKey?.configured)}
          onNeedKey={() => { setSettingsTab('gemini'); setNotice({ tone: 'info', text: 'Add a Gemini API key to align audio.' }) }}
          onApply={(transcript, run, snapshot) => applyAlignedTiming(transcript, run, snapshot, pickedVideo.id)} onMessage={(tone, text) => setNotice({ tone, text })} />}
        {exportState.kind === 'running' && <span className="job-pill" role="status">
          <span>Exporting · {describeJob(exportState.job).label}{describeJob(exportState.job).percent === null ? '' : ` ${describeJob(exportState.job).percent}%`}</span>
          <button onClick={cancelExportVideo}>Cancel</button>
        </span>}
        {offlineVideos.length > 0 && <button className="warning-chip" onClick={relinkOffline} title={`${offlineVideos.map((asset) => asset.name).join(', ')} not available at the stored location`}>Media offline · Relink</button>}
      </div>
      <div className="toolbar toolbar-file">
        {agentStatus?.running && <button className="agent-chip" onClick={() => setSettingsTab('agent')}
          title={agentStatus.connections ? `${agentStatus.connections} agent client connected` : 'Agent access is on; no client connected yet'}>
          🤖 Agent{agentStatus.connections ? ` · ${agentStatus.connections}` : ''}
        </button>}
        <span className={`save-status${saveStatus?.kind === 'error' ? ' save-status-error' : ''}`} role="status" title={projectPath ?? 'Save the project to enable autosave'}>{saveStatusText}</span>
        <MenuButton label="File" entries={fileEntries} />
        <MenuButton label="Timeline" entries={timelineEntries} />
        <MenuButton label="Export" className="accent" entries={exportEntries} />
        <button className="icon-button" aria-label="Settings" title="Settings: speech models, Gemini API key, AI agents, shortcuts" onClick={() => setSettingsTab('models')}>⚙</button>
      </div>
    </header>
    <SettingsDialog tab={settingsTab} onTab={setSettingsTab} onClose={() => setSettingsTab(null)} geminiKey={geminiKey} onGeminiKey={setGeminiKey}
      onMessage={(tone, text) => setNotice({ tone, text })} />
    <SilenceRemovalDialog open={silenceDialogOpen} mediaReady={pickedReady} onClose={() => setSilenceDialogOpen(false)} videoName={silenceVideo?.name ?? null}
      picker={videoAssets(project).length > 1 ? <VideoPicker videos={videoAssets(project)} picked={pickedVideo} onPick={setPickedVideoId} label="Video" /> : null}
      onDetect={detectSilence} onCancelDetect={cancelSilenceDetection} onApply={applySilenceRemoval} hasExistingCuts={hasTrimmedClips(project)} />

    <section className="workspace">
      <LeftRail active={railTab} onChange={setRailTab} onSettings={() => setSettingsTab('models')} />
      <aside className="panel side-panel" aria-label={railTab === 'media' ? 'Media' : railTab === 'captions' ? 'Captions' : railTab === 'overlays' ? 'Overlays' : 'Transitions'}>
        {railTab === 'media' && <MediaBin assets={project.assets} assetUrls={media.assetUrls} assetIssues={media.issues} useCountByAsset={useCountByAsset}
          videoReady={(asset) => media.urlOf(asset) !== null}
          onImportFiles={() => void importAssetFiles()} onDropFiles={(files) => inspectAndAdd(files)}
          onAddVideo={(asset) => addVideoClip(asset)} onAddOverlayAtPlayhead={addOverlayAtPlayhead} onAddSfxAtPlayhead={addSfxAtPlayhead}
          onRemoveAsset={removeAsset} onRelinkAsset={(assetId) => void relinkAsset(assetId)} />}
        {railTab === 'captions' && <CaptionsPanel cueCount={project.cues.length} visibleCues={visibleCues} selectedCueId={selectedCueId}
          selectedWordId={selectedWord?.id ?? null} warningCueIds={warningCueIds}
          notInSequence={(cue) => hasVideo && (!cue.mediaAssetId || spansInSequence(cue, cue.mediaAssetId, captionVideo).length === 0)}
          videoNameOf={(cue) => cue.mediaAssetId ? assetById.get(cue.mediaAssetId)?.name ?? null : null}
          historyPastLength={history.past.length} historyFutureLength={history.future.length} onUndo={undo} onRedo={redo}
          effectiveStyle={effectiveStyle} selected={selected} captionDisplay={captionDisplay} onCaptionDisplay={setCaptionDisplay} onProjectStyle={commitStyle}
          onOverride={(override) => selected && runCommand({ type: 'set-motion-override', cueId: selected.id, override })}
          onResetOverrides={() => runCommand({ type: 'reset-motion-overrides' })}
          onEstimate={() => selected && runCommand({ type: 'estimate-words', cueId: selected.id, idPrefix: crypto.randomUUID() })}
          onGroup={(options, all) => runCommand(all
            ? { type: 'regroup-many', cueIds: project.cues.map((cue) => cue.id), idPrefix: crypto.randomUUID(), estimateMissing: false, options }
            : selected ? { type: 'regroup', cueId: selected.id, idPrefix: crypto.randomUUID(), estimateMissing: false, options } : { type: 'regroup-many', cueIds: [], idPrefix: crypto.randomUUID(), estimateMissing: false, options })}
          onSelect={seek} onUpdateText={(cueId, text) => runCommand({ type: 'update-text', cueId, text })} onSelectWord={onSelectSpan}
          onWordAction={(cueId, type, span) => {
            const command = wordActionCommand(cueId, type, span, () => crypto.randomUUID())
            if (command) runCommand(command)
            else setNotice({ tone: 'error', text: 'Estimate word timing for this caption first: this action needs the word’s timing.' })
          }}
          onEstimateMissing={() => selected && runCommand({ type: 'estimate-words', cueId: selected.id, idPrefix: crypto.randomUUID(), missingOnly: true })}
          cueButtonRefs={cueButtonRefs}
          videos={videoAssets(project)} pickedVideo={pickedVideo} onPickVideo={setPickedVideoId} mediaReady={pickedReady} onApplyTranscript={applyTranscript}
          geminiKeyConfigured={Boolean(geminiKey?.configured)} onNeedGeminiKey={() => setSettingsTab('gemini')} onImportSrt={() => void importSrt()} />}
        {railTab === 'overlays' && <OverlaysPanel assets={project.assets} assetUrls={media.assetUrls} onAddAtPlayhead={addOverlayAtPlayhead}
          onImportAndAdd={() => void importImageOverlay()} mediaReady />}
        {railTab === 'transitions' && <TransitionsPanel style={effectiveStyle} cues={project.cues} activeCue={activeCue ?? null} presets={project.savedCaptionPresets ?? []}
          onApplyTemplate={applyTemplate} onCommitMotion={(motion) => commitStyle({ ...effectiveStyle, motion })}
          onSavePreset={savePreset} onApplyPreset={applyPreset} onDeletePreset={deletePreset}
          onEstimate={activeCue ? () => runCommand({ type: 'estimate-words', cueId: activeCue.id, idPrefix: crypto.randomUUID() }) : undefined} />}
      </aside>

      <section className="stage-panel" aria-label="Video preview and transport">
        <div className={`video-stage ${project.clips.length || project.cues.length ? '' : 'empty-stage'}`}
          onDragOver={(event) => { if (dropContent(event.dataTransfer)?.kind === 'files') { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
          onDrop={(event) => {
            const content = dropContent(event.dataTransfer)
            if (content?.kind !== 'files' || !content.files.length) return
            event.preventDefault()
            // Dropped on the preview: images and sounds land at the playhead; a video never covers
            // what is already there — it joins the end of V1, like the media bin's Add.
            inspectAndAdd(content.files, { sequenceUs: currentUs, trackId: null, appendVideos: true })
          }}>
          {project.clips.length || project.cues.length ? <div className="video-frame" style={{ '--video-aspect': formatAspect(project.format) } as CSSProperties}>
            <CaptionStage clock={clock} cues={visibleCues} dragPreview={dragPreview} composition={captionComposition} inputs={captionInputs} style={effectiveStyle} display={captionDisplay}
              tracks={visibleTracks} clips={visibleClips} assets={project.assets} blurRegions={project.blurRegions} urlOf={media.urlOf}
              poolVersion={playback.poolVersion} elementFor={(trackId, assetId) => playback.transport.elementFor(trackId, assetId) as HTMLVideoElement | null} />
            <ClipStageEditor tracks={visibleTracks} clips={visibleClips} composition={captionComposition} clock={clock}
              selectedId={selection?.kind === 'clip' ? selection.id : null}
              onSelect={(clipId) => setSelection({ kind: 'clip', id: clipId })}
              onRectDraft={(rect) => draftClip({ rect })} onRectCommit={(rect) => commitClip({ rect })}
              onCloneDraft={setCloneDraft} onCloneCommit={(clip) => { setCloneDraft(null); placeCopy(clip) }} />
            <div className="safe-area" />
          </div> : <Empty title="Your video appears here" body="Open a local video to start, or continue from subtitles or a saved project. Media stays on this device." action={<div className="empty-actions">
            <button className="accent" onClick={() => void openVideo()}>Open video</button>
            <button onClick={() => void importSrt()}>Import SRT</button>
            <button onClick={() => void openProject()}>Open project</button>
          </div>} />}
          {summaryAsset?.metadata && <MediaSummary name={summaryAsset.name} metadata={summaryAsset.metadata} format={project.format ?? null} />}
          {issueAsset && codecIssue && <div className="codec-diagnostic" role="status">
            <span>{issueAsset.name}: {codecIssue.kind === 'confirmed-unsupported' ? codecIssue.message : 'This media’s codec is likely unsupported by the embedded player.'}</span>
            {proxyState.kind === 'ready' && <button onClick={createProxy}>Create local proxy</button>}
            {proxyState.kind === 'creating' && <><span>{`Converting${proxyState.percent === null ? '…' : ` ${proxyState.percent}%`}`}</span><button onClick={cancelProxyCreation}>Cancel</button></>}
            {proxyState.kind === 'unsupported' && <span>{proxyState.reason}</span>}
            {proxyState.kind === 'error' && <span>{proxyState.message}</span>}
            {proxyState.kind === 'done' && <span>Proxy saved to {proxyState.path}</span>}
          </div>}
        </div>
        {/* The transport is the only one: with stacked tracks no single <video> owns playback. */}
        <div className="transport" role="group" aria-label="Playback transport"><span aria-label={`Current time ${formatClock(currentUs)}`}>{formatClock(currentUs)}</span><button onClick={togglePlayback} disabled={!project.clips.length && !project.cues.length} aria-label={playback.playing ? 'Pause' : 'Play'} title="Play or pause (Space)">{playback.playing ? 'Pause' : 'Play'}</button><button onClick={() => seekBy(-US_PER_SECOND)} aria-label="Seek backward one second" title="Seek backward (Left Arrow)">−1 s</button><input aria-label="Playhead position" type="range" min="0" max={durationUs} value={Math.min(currentUs, durationUs)} onChange={(event) => seekTo(Number(event.target.value))} /><button onClick={() => seekBy(US_PER_SECOND)} aria-label="Seek forward one second" title="Seek forward (Right Arrow)">+1 s</button><span aria-label={`Duration ${formatClock(durationUs)}`}>{formatClock(durationUs)}</span></div>
      </section>

      <aside className="panel inspector-panel" aria-labelledby="inspector-heading">
        <h2 id="inspector-heading" className="sr-only">Caption inspector</h2>
        <InspectorTabs active={inspectorTab} onChange={setInspectorTab}
          edit={<>
            {selectedClip ? <ClipInspector
              clip={selectedClip}
              asset={assetById.get(selectedClip.assetId) ?? null}
              assetIssue={media.issues.get(selectedClip.assetId) ?? null}
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
              onDuplicate={duplicateSelectedClip}
              onDelete={deleteClip}
              onRelink={() => void relinkAsset(selectedClip.assetId)}
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
            <span>{describeJob(exportState.job).label}{describeJob(exportState.job).percent === null ? '' : ` ${describeJob(exportState.job).percent}%`}</span>
            <button onClick={cancelExportVideo}>Cancel</button>
          </span> : <button className="accent" disabled={!project.cues.length && exportVideoBlocker !== null}
            title={exportVideoBlocker === null ? 'Render the timeline with captions into a new MP4; source media is never modified' : 'Export an SRT subtitle file'}
            onClick={exportVideoBlocker === null ? startExportVideo : exportSrt}>Export</button>}
        </div>
      </aside>
    </section>

    <Timeline cues={project.cues} tracks={project.tracks} clips={project.clips} assets={project.assets} currentUs={currentUs} durationUs={Math.max(durationUs, 1)}
      selection={selection} markers={project.markers} onSelectMarker={(markerId) => setSelection({ kind: 'marker', id: markerId })}
      warningCueIds={warningCueIds} waveforms={waveforms}
      waveformStatus={waveformsLoading > 0 ? 'Extracting waveforms…' : null}
      onSeek={seekTo} onDragPreview={previewCueDrag} onDragCommit={commitCueDrag}
      editMode={editMode} onEditMode={setEditMode}
      onSelectClip={(clipId) => setSelection({ kind: 'clip', id: clipId })}
      onClipMove={moveClip} onClipClone={(clip) => placeCopy(clip, clip.timelineStartUs, clip.trackId)} onClipTrim={trimClip}
      onCloseGap={(trackId, atUs) => runCommand({ type: 'gap-close', trackId, atUs })}
      trackActions={trackActions} assetDurationUs={(assetId) => assetById.get(assetId)?.metadata?.durationUs ?? null}
      display={timelineDisplay} onDisplay={setTimelineDisplay} selectedWordId={selectedWord?.id ?? null} onSelectWord={onSelectWord}
      actions={{ addLine: addCue, addWord, merge: mergeSelectedCue, previous: () => selectAdjacentCue(-1), next: () => selectAdjacentCue(1), delete: () => selectedWord ? deleteSelectedWord() : deleteSelectedCue(), split: splitSelectedCue, trim: trimSelectedCue }}
      clipTools={{ split: splitClips, canSplit: canSplitClips, remove: deleteClip, hasClip: clipBase !== null }}
      canAdd={canAddCue} canSplit={canSplitSelected} canMerge={canMergeSelected} hasSelectedWord={selectedWord !== null}
      onDropAsset={onTimelineDropAsset} onDropFiles={onTimelineDropFiles} thumbnailQueue={thumbnailQueue} />
    {pendingAssetRelink && <RelinkReview title={pendingAssetRelink.asset.kind === 'video' ? 'Replacement video does not match' : 'Replacement file does not match'} candidate={pendingAssetRelink.candidate}
      onUse={() => { useAssetCandidate(pendingAssetRelink.asset, pendingAssetRelink.candidate); setPendingAssetRelink(null); setNotice({ tone: 'warning', text: `Using ${pendingAssetRelink.candidate.media.name} by your choice; stored identity was replaced with the selected media.` }) }}
      onChooseAgain={() => { const assetId = pendingAssetRelink.asset.id; setPendingAssetRelink(null); void relinkAsset(assetId) }}
      onCancel={() => setPendingAssetRelink(null)} />}
    {pendingSrt && <ReplaceCaptionsReview name={pendingSrt.name} existingCount={project.cues.length} importedCount={pendingSrt.parsed.cues.length}
      onCancel={() => setPendingSrt(null)} onReplace={() => { applyParsedSrt(pendingSrt.parsed); setPendingSrt(null) }} />}
    {notice && <div className={`notice ${notice.tone}`} role="status" aria-live="polite" onClick={() => setNotice(null)}>{notice.text}</div>}
  </main>
}

/** A transient top track for a stage Alt+drag clone, so the ghost paints above everything until it commits. */
const CLONE_TRACK: Track = { id: '__clone-preview__', kind: 'video', name: '', muted: true, hidden: false, locked: true }

/** Subscribes to the per-frame playback clock on its own, so a 60fps tick re-renders only this
 * small subtree — the transcript list, timeline body and waveform/thumbnails never re-render per
 * frame. It composites every visual clip under the playhead, back to front, then blur, then the
 * caption the one shared rule (`activeCueAt`) picks, evaluated at its own source time. */
function CaptionStage({ clock, cues, dragPreview, composition, inputs, style, display, tracks, clips, assets, blurRegions, urlOf, elementFor }: {
  /** Bumped when the transport creates a pooled element, so a new video layer finds it. */
  poolVersion: number
  clock: PlaybackClock; cues: readonly Cue[]; dragPreview: Cue | null
  composition: Size; inputs: LayoutInputs; style: CaptionStyle; display: CaptionDisplay
  tracks: readonly Track[]; clips: readonly Clip[]; assets: readonly ProjectAsset[]; blurRegions: CaptionProject['blurRegions']
  urlOf: (asset: ProjectAsset | null | undefined) => string | null
  elementFor: (trackId: string, assetId: string) => HTMLVideoElement | null
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
  const resolved = resolveCaptionMotion(style, lineCue?.motionOverride)
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])
  const layers: CompositionLayer[] = [
    ...activeClipsAt(frameUs, tracks, clips.filter((clip) => clip.kind !== 'audio'), { skipHidden: true }).map(({ clip, track }): CompositionLayer => {
      const asset = assetById.get(clip.assetId)
      const label = asset?.name ?? 'Missing file'
      if (clip.kind === 'video') return { kind: 'video', id: `${track.id}/${clip.assetId}`, element: elementFor(track.id, clip.assetId), label, rect: clip.rect ?? null, opacity: clip.opacity, fit: clip.fit }
      return { kind: 'image', id: clip.id, url: urlOf(asset), label, rect: clip.kind === 'image' ? clip.rect ?? null : null, opacity: clip.kind === 'image' ? clip.opacity : 1, fit: clip.kind === 'image' ? clip.fit : 'contain' }
    }),
    ...blurRegions.filter((region) => frameUs >= region.startUs && frameUs < region.endUs).map((region): CompositionLayer => ({ kind: 'blur', id: region.id, rect: region.rect, radius: region.radius })),
  ]
  return <>
    <CaptionPreview cue={shownCue} timestampUs={sourceUs} composition={composition} inputs={inputs} motion={resolved.motion} motionSpeed={resolved.motionSpeed} fontSample={lineCue?.text}
      layers={<CompositionLayers layers={layers} composition={composition} />} />
    {fallback && <span role="status" data-word-display-notice style={{ position: 'absolute', bottom: 8, right: 8, maxWidth: '40%',
      fontSize: 12, color: '#ffda8b', background: '#101010cc', padding: 4, zIndex: 2 }}>Showing the full caption: {fallback}</span>}
  </>
}

function rateText(rate: MediaMetadata['frameRate']): string {
  return rate ? `${rate.numerator}/${rate.denominator} fps` : 'frame rate unknown'
}

function MediaSummary({ name, metadata, format }: { name: string; metadata: MediaMetadata; format: CaptionProject['format'] | null }) {
  const codecs = metadata.streams.map((stream) => `${stream.kind}: ${stream.codec.name}`).join(' · ')
  return <div className="media-summary" aria-label="Probed media metadata">
    <span title={name}>{metadata.width ?? '?'}×{metadata.height ?? '?'}</span>
    <span>{rateText(metadata.frameRate)}</span>
    <span>{metadata.rotationDegrees == null ? 'rotation unknown' : `${metadata.rotationDegrees}° rotation`}</span>
    <span>{codecs || 'no streams reported'}</span>
    {format && <span title="The output frame every clip is fitted into">Sequence {format.width}×{format.height} · {rateText(format.frameRate)}</span>}
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
    <div className="time-fields"><label htmlFor="cue-start">Start<input id="cue-start" aria-label="Cue start timestamp in its video, HH hours MM minutes SS seconds milliseconds" value={start} onChange={(event) => setStart(event.target.value)} onBlur={changeTime} /></label><label htmlFor="cue-end">End<input id="cue-end" aria-label="Cue end timestamp in its video, HH hours MM minutes SS seconds milliseconds" value={end} onChange={(event) => setEnd(event.target.value)} onBlur={changeTime} /></label></div>
    <TimingProvenance cue={cue} />
  </div>
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty"><div className="empty-icon">✦</div><strong>{title}</strong><p>{body}</p>{action}</div>
}
