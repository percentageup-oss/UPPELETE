import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { CaptionProject } from '../src/core/model'
import type { ProjectMedia } from '../src/core/media'
import type { AssetResolution, MediaCandidate } from './projectMedia'
import type { ProjectAsset } from '../src/core/edit'
import type { InspectedFile } from '../src/core/assetImport'
import type { ProgressMessage } from '../workers/media/protocol'
import type { WaveformLoadRequest, WaveformLoadResult } from '../src/core/waveform'
import type { SilenceDetectRequest, SilenceDetectResult } from '../src/core/silenceIpc'
import type { ThumbnailLoadRequest, ThumbnailLoadResult } from '../src/core/thumbnails'
import type { ProxyCreateRequest, ProxySupport } from '../src/core/proxy'

import { modelStateSchema, type ManagedModelId, type ModelListing, type ModelState } from '../src/core/modelCatalog'
import { transcriptionProgressSchema, type TranscriptionAvailability, type TranscriptionOutcome, type TranscriptionProgress, type TranscriptionStartRequest } from '../src/core/transcriptionIpc'
import { exportProgressSchema, type ExportOutcome, type ExportProgress, type ExportStartRequest } from '../src/export/ipc'
import type { ExportSupport } from '../src/core/exportSupport'
import { isMenuCommand, type MenuCommand } from '../src/core/menuCommands'
import { alignmentProgressSchema, type AlignmentOutcome, type AlignmentProgress, type AlignmentSettingsStatus, type AlignmentStartRequest } from '../src/core/alignmentIpc'

export type OperationResult<T> = { ok: true } & T | { ok: false; message: string }
export type OpenedVideo = OperationResult<{ candidate: MediaCandidate }>
export type OpenedText = { path: string; content: string }
export type SaveRequest = { content: string; defaultName: string }
export type OpenedProject = OperationResult<{ path: string; project: CaptionProject; migratedFrom: 1 | 2 | 3 | null; assets: AssetResolution[] }>
export type ImportedAsset = OperationResult<{ media: ProjectMedia; url: string }>
export type AssetRelinkResult = OperationResult<{ candidate: MediaCandidate }>
export type SavedProject = { path: string; project: CaptionProject }
export type WaveformProgress = { requestId: string; progress: ProgressMessage['progress'] }
export type SilenceProgress = { requestId: string; progress: ProgressMessage['progress'] }
export type ThumbnailsProgress = { requestId: string; progress: ProgressMessage['progress'] }
export type ProxyProgress = { requestId: string; progress: ProgressMessage['progress'] }
export type ProxyCreateResult = { path: string; durationUs: number }
export type ExportProgressEvent = ExportProgress

contextBridge.exposeInMainWorld('captionStudio', {
  onMenuCommand: (callback: (command: MenuCommand) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => { if (isMenuCommand(value)) callback(value) }
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
  listModels: (): Promise<ModelListing> => ipcRenderer.invoke('models:list'),
  downloadModel: (id: ManagedModelId): Promise<ModelState> => ipcRenderer.invoke('models:download', id),
  cancelModelDownload: (id: ManagedModelId): Promise<void> => ipcRenderer.invoke('models:cancel', id),
  removeModel: (id: ManagedModelId): Promise<ModelState> => ipcRenderer.invoke('models:remove', id),
  onModelState: (callback: (state: ModelState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = modelStateSchema.safeParse(value)
      if (parsed.success) callback(parsed.data)
    }
    ipcRenderer.on('models:state', listener)
    return () => ipcRenderer.removeListener('models:state', listener)
  },
  transcriptionAvailability: (modelId: ManagedModelId): Promise<TranscriptionAvailability> => ipcRenderer.invoke('transcription:availability', modelId),
  startTranscription: (request: TranscriptionStartRequest): Promise<TranscriptionOutcome> => ipcRenderer.invoke('transcription:start', request),
  cancelTranscription: (requestId: string): Promise<void> => ipcRenderer.invoke('transcription:cancel', requestId),
  onTranscriptionProgress: (callback: (message: TranscriptionProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = transcriptionProgressSchema.safeParse(value)
      if (parsed.success) callback(parsed.data)
    }
    ipcRenderer.on('transcription:progress', listener)
    return () => ipcRenderer.removeListener('transcription:progress', listener)
  },
  alignmentSettingsStatus: (): Promise<AlignmentSettingsStatus> => ipcRenderer.invoke('alignment:settings-status'),
  saveGeminiApiKey: (apiKey: string): Promise<AlignmentSettingsStatus> => ipcRenderer.invoke('alignment:settings-save', apiKey),
  removeGeminiApiKey: (): Promise<AlignmentSettingsStatus> => ipcRenderer.invoke('alignment:settings-remove'),
  startAlignment: (request: AlignmentStartRequest): Promise<AlignmentOutcome> => ipcRenderer.invoke('alignment:start', request),
  cancelAlignment: (requestId: string): Promise<void> => ipcRenderer.invoke('alignment:cancel', requestId),
  onAlignmentProgress: (callback: (message: AlignmentProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = alignmentProgressSchema.safeParse(value)
      if (parsed.success) callback(parsed.data)
    }
    ipcRenderer.on('alignment:progress', listener)
    return () => ipcRenderer.removeListener('alignment:progress', listener)
  },
  openVideo: (): Promise<OpenedVideo | null> => ipcRenderer.invoke('dialog:open-video'),
  openText: (): Promise<OpenedText | null> => ipcRenderer.invoke('dialog:open-text'),
  saveText: (request: SaveRequest): Promise<{ path: string } | null> => ipcRenderer.invoke('dialog:save-text', request),
  openProject: (): Promise<OpenedProject | null> => ipcRenderer.invoke('project:open'),
  saveProject: (request: { project: CaptionProject; defaultName: string }): Promise<SavedProject | null> => ipcRenderer.invoke('project:save', request),
  writeProject: (request: { project: CaptionProject; path: string }): Promise<SavedProject> => ipcRenderer.invoke('project:write', request),
  editText: (action: 'undo' | 'redo'): Promise<void> => ipcRenderer.invoke('edit:text', action),
  importAsset: (kind: 'image' | 'audio'): Promise<ImportedAsset | null> => ipcRenderer.invoke('assets:import', kind),
  relinkAsset: (expected: ProjectAsset): Promise<AssetRelinkResult | null> => ipcRenderer.invoke('assets:relink', expected),
  importAssetFiles: (): Promise<InspectedFile[] | null> => ipcRenderer.invoke('assets:import-files'),
  // The renderer only ever holds `File` objects from a drop event; the path is resolved here, inside
  // the sandboxed preload, so no filesystem path ever crosses into renderer-controlled code.
  inspectDroppedFiles: (files: File[]): Promise<InspectedFile[]> =>
    ipcRenderer.invoke('assets:inspect-dropped', files.map((file) => webUtils.getPathForFile(file))),
  loadWaveform: (request: WaveformLoadRequest): Promise<WaveformLoadResult> => ipcRenderer.invoke('media:waveform-load', request),
  cancelWaveform: (requestId: string): Promise<void> => ipcRenderer.invoke('media:waveform-cancel', requestId),
  onWaveformProgress: (callback: (message: WaveformProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: WaveformProgress) => callback(message)
    ipcRenderer.on('media:waveform-progress', listener)
    return () => ipcRenderer.removeListener('media:waveform-progress', listener)
  },
  detectSilence: (request: SilenceDetectRequest): Promise<SilenceDetectResult> => ipcRenderer.invoke('media:silence-detect', request),
  cancelSilenceDetection: (requestId: string): Promise<void> => ipcRenderer.invoke('media:silence-cancel', requestId),
  onSilenceProgress: (callback: (message: SilenceProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: SilenceProgress) => callback(message)
    ipcRenderer.on('media:silence-progress', listener)
    return () => ipcRenderer.removeListener('media:silence-progress', listener)
  },
  loadThumbnails: (request: ThumbnailLoadRequest): Promise<ThumbnailLoadResult> => ipcRenderer.invoke('media:thumbnails-load', request),
  cancelThumbnails: (requestId: string): Promise<void> => ipcRenderer.invoke('media:thumbnails-cancel', requestId),
  onThumbnailsProgress: (callback: (message: ThumbnailsProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: ThumbnailsProgress) => callback(message)
    ipcRenderer.on('media:thumbnails-progress', listener)
    return () => ipcRenderer.removeListener('media:thumbnails-progress', listener)
  },
  checkProxySupport: (): Promise<ProxySupport> => ipcRenderer.invoke('media:proxy-support'),
  createProxy: (request: ProxyCreateRequest): Promise<ProxyCreateResult | null> => ipcRenderer.invoke('media:proxy-create', request),
  cancelProxy: (requestId: string): Promise<void> => ipcRenderer.invoke('media:proxy-cancel', requestId),
  onProxyProgress: (callback: (message: ProxyProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: ProxyProgress) => callback(message)
    ipcRenderer.on('media:proxy-progress', listener)
    return () => ipcRenderer.removeListener('media:proxy-progress', listener)
  },
  checkExportSupport: (): Promise<ExportSupport> => ipcRenderer.invoke('export:support'),
  startExport: (request: ExportStartRequest): Promise<ExportOutcome | null> => ipcRenderer.invoke('export:start', request),
  cancelExport: (requestId: string): Promise<void> => ipcRenderer.invoke('export:cancel', requestId),
  onExportProgress: (callback: (message: ExportProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = exportProgressSchema.safeParse(value)
      if (parsed.success) callback(parsed.data)
    }
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },
})
