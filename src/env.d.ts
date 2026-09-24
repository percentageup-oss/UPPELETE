import type { AssetRelinkResult, ExportProgressEvent, ImportedAsset, LutImportResult, OpenedProject, OpenedText, OpenedVideo, ProxyCreateResult, ProxyProgress, SaveRequest, SavedProject, SilenceProgress, ThumbnailsProgress, WaveformProgress } from '../electron/preload'
import type { CaptionProject } from './core/model'
import type { ProjectMedia } from './core/media'
import type { ProjectAsset } from './core/edit'
import type { InspectedFile } from './core/assetImport'
import type { WaveformLoadRequest, WaveformLoadResult } from './core/waveform'
import type { SilenceDetectRequest, SilenceDetectResult } from './core/silenceIpc'
import type { ThumbnailLoadRequest, ThumbnailLoadResult } from './core/thumbnails'
import type { ProxyCreateRequest, ProxySupport, PlaybackProxyEnsureRequest, PlaybackProxyStatus } from './core/proxy'
import type { ExportSupport } from './core/exportSupport'
import type { ExportOutcome, ExportStartRequest } from './export/ipc'

import type { ManagedModelId, ModelListing, ModelState } from './core/modelCatalog'
import type { TranscriptionAvailability, TranscriptionOutcome, TranscriptionProgress, TranscriptionStartRequest } from './core/transcriptionIpc'
import type { MenuCommand } from './core/menuCommands'
import type { AlignmentOutcome, AlignmentProgress, AlignmentSettingsStatus, AlignmentStartRequest } from './core/alignmentIpc'
import type { AgentRequest, AgentResponse } from './core/agentProtocol'
import type { McpSettingsView, McpStatus } from '../electron/mcp/config'

/** Chromium Local Font Access API (not yet in TS lib.dom). Offline, requires transient user
 * activation and the 'local-fonts' permission; no font is bundled, downloaded or sent anywhere. */
declare global {
  interface LocalFontData {
    readonly family: string
    readonly fullName: string
    readonly postscriptName: string
    readonly style: string
  }

  interface Window {
    queryLocalFonts?(options?: { postscriptNames?: string[] }): Promise<LocalFontData[]>
    captionStudio?: {
      onMenuCommand(callback: (command: MenuCommand) => void): () => void
      listModels(): Promise<ModelListing>
      downloadModel(id: ManagedModelId): Promise<ModelState>
      cancelModelDownload(id: ManagedModelId): Promise<void>
      removeModel(id: ManagedModelId): Promise<ModelState>
      onModelState(callback: (state: ModelState) => void): () => void
      transcriptionAvailability(modelId: ManagedModelId): Promise<TranscriptionAvailability>
      startTranscription(request: TranscriptionStartRequest): Promise<TranscriptionOutcome>
      cancelTranscription(requestId: string): Promise<void>
      onTranscriptionProgress(callback: (message: TranscriptionProgress) => void): () => void
      alignmentSettingsStatus(): Promise<AlignmentSettingsStatus>
      saveGeminiApiKey(apiKey: string): Promise<AlignmentSettingsStatus>
      removeGeminiApiKey(): Promise<AlignmentSettingsStatus>
      startAlignment(request: AlignmentStartRequest): Promise<AlignmentOutcome>
      cancelAlignment(requestId: string): Promise<void>
      onAlignmentProgress(callback: (message: AlignmentProgress) => void): () => void
      openVideo(): Promise<OpenedVideo | null>
      openText(): Promise<OpenedText | null>
      saveText(request: SaveRequest): Promise<{ path: string } | null>
      openProject(): Promise<OpenedProject | null>
      saveProject(request: { project: CaptionProject; defaultName: string }): Promise<SavedProject | null>
      writeProject(request: { project: CaptionProject; path: string }): Promise<SavedProject>
      editText(action: 'undo' | 'redo'): Promise<void>
      importAsset(kind: 'image' | 'audio'): Promise<ImportedAsset | null>
      relinkAsset(expected: ProjectAsset): Promise<AssetRelinkResult | null>
      importLut(): Promise<LutImportResult | null>
      saveGeneratedLut(request: { text: string; name: string; defaultDir: string | null }): Promise<LutImportResult | null>
      importAssetFiles(): Promise<InspectedFile[] | null>
      inspectDroppedFiles(files: File[]): Promise<InspectedFile[]>
      loadWaveform(request: WaveformLoadRequest): Promise<WaveformLoadResult>
      cancelWaveform(requestId: string): Promise<void>
      onWaveformProgress(callback: (message: WaveformProgress) => void): () => void
      detectSilence(request: SilenceDetectRequest): Promise<SilenceDetectResult>
      cancelSilenceDetection(requestId: string): Promise<void>
      onSilenceProgress(callback: (message: SilenceProgress) => void): () => void
      loadThumbnails(request: ThumbnailLoadRequest): Promise<ThumbnailLoadResult>
      cancelThumbnails(requestId: string): Promise<void>
      onThumbnailsProgress(callback: (message: ThumbnailsProgress) => void): () => void
      checkProxySupport(): Promise<ProxySupport>
      createProxy(request: ProxyCreateRequest): Promise<ProxyCreateResult | null>
      cancelProxy(requestId: string): Promise<void>
      onProxyProgress(callback: (message: ProxyProgress) => void): () => void
      ensurePlaybackProxy(request: PlaybackProxyEnsureRequest): void
      onPlaybackProxyStatus(callback: (status: PlaybackProxyStatus) => void): () => void
      checkExportSupport(): Promise<ExportSupport>
      startExport(request: ExportStartRequest): Promise<ExportOutcome | null>
      cancelExport(requestId: string): Promise<void>
      onExportProgress(callback: (message: ExportProgressEvent) => void): () => void
      onAgentRequest(callback: (request: AgentRequest) => void): () => void
      respondAgentRequest(response: AgentResponse): void
      agentStatus(): Promise<McpStatus>
      onAgentStatus(callback: (status: McpStatus) => void): () => void
      agentSettings(): Promise<McpSettingsView>
      setAgentEnabled(enabled: boolean): Promise<McpSettingsView>
      rotateAgentToken(): Promise<McpSettingsView>
    }
  }
}

export {}
