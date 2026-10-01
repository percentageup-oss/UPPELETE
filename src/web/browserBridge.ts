import { MODEL_CATALOG } from '../core/modelCatalog'
import type { ManagedModelId, ModelListing, ModelState } from '../core/modelCatalog'
import type { CaptionProject } from '../core/model'
import { clipEndUs } from '../core/timelineModel'
import type { InspectedFile } from '../core/assetImport'
import type { ProjectMedia } from '../core/media'
import type { ProjectAsset } from '../core/edit'
import type { WaveformLoadRequest, WaveformLoadResult } from '../core/waveform'
import type { SilenceDetectRequest, SilenceDetectResult } from '../core/silenceIpc'
import type { ThumbnailLoadRequest, ThumbnailLoadResult } from '../core/thumbnails'
import type { ProxyCreateRequest, ProxySupport, PlaybackProxyEnsureRequest, PlaybackProxyStatus } from '../core/proxy'
import type { ExportSupport } from '../core/exportSupport'
import type { ExportOutcome, ExportStartRequest } from '../export/ipc'
import type { TranscriptionAvailability, TranscriptionOutcome, TranscriptionProgress, TranscriptionStartRequest } from '../core/transcriptionIpc'
import type { CaptionTranslationOutcome, CaptionTranslationProgress, CaptionTranslationRequest } from '../core/captionTranslationIpc'
import type { AlignmentOutcome, AlignmentProgress, AlignmentSettingsStatus, AlignmentStartRequest } from '../core/alignmentIpc'
import type { CloudProviderId, ProviderKeyStatus, ProviderKeyStatuses } from '../core/transcriptionProviders'
import type { AgentRequest, AgentResponse } from '../core/agentProtocol'
import type { McpSettingsView, McpStatus } from '../../electron/mcp/config'
import type { RecentProjectView } from '../../electron/projectLibrary'
import type { MediaCandidate } from '../../electron/projectMedia'
import type {
  ResolveImportEditProgress, ResolveImportEditResult, ResolveProxyDone, ResolveProxyProgress, ResolvePushProgress, ResolvePushTimelineRequest, ResolvePushTimelineResult,
  ResolveStatus, ResolveSyncApplyRequest, ResolveSyncPreview, ResolveSyncPreviewRequest, ResolveSyncProgress, ResolveSyncResult, ResolveTimelineInfo,
} from '../core/resolveIpc'
import type { ResolvePluginInfo } from '../../electron/resolve/install'
import type { AssetRelinkResult, ExportProgressEvent, ImportedAsset, LutImportResult, OpenedProject, OpenedText, OpenedVideo, ProxyCreateResult, RecentProjectAction, ProxyProgress, SaveRequest, SavedProject, SilenceProgress, ThumbnailsProgress, WaveformProgress } from '../../electron/preload'
import { serializeSrt } from '../core/srt'

interface StoredProjectEntry {
  path: string
  project: CaptionProject
  savedAt: number
  openedAt: number
  thumbnailDataUrl?: string
}

const STORAGE_KEY_PROJECTS = 'kathacut.saved_projects'
const STORAGE_KEY_GEMINI = 'kathacut.gemini_key'
const fileRegistry = new Map<string, { file: File; url: string; media: ProjectMedia }>()

function getStoredProjects(): StoredProjectEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROJECTS)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveStoredProjects(list: StoredProjectEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(list))
  } catch (e) {
    console.warn('Could not save projects to localStorage', e)
  }
}

function downloadFile(content: BlobPart, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.display = 'none'

    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      input.remove()
      resolve(files)
    }

    input.oncancel = () => {
      input.remove()
      resolve([])
    }

    document.body.appendChild(input)
    input.click()
  })
}

async function computeSampledHash(file: File): Promise<string> {
  const sampleSize = Math.min(file.size, 65536)
  const head = await file.slice(0, sampleSize).arrayBuffer()
  const tail = await file.slice(Math.max(0, file.size - sampleSize)).arrayBuffer()
  const info = new TextEncoder().encode(`${file.name}:${file.size}:${sampleSize}`)
  const combined = new Uint8Array(head.byteLength + tail.byteLength + info.byteLength)
  combined.set(new Uint8Array(head), 0)
  combined.set(new Uint8Array(tail), head.byteLength)
  combined.set(info, head.byteLength + tail.byteLength)

  const hashBuffer = await crypto.subtle.digest('SHA-256', combined)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function inspectBrowserFile(file: File): Promise<InspectedFile> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'srt' || ext === 'vtt') {
    const content = await file.text()
    return { ok: true, kind: 'subtitle', name: file.name, content }
  }

  const hash = await computeSampledHash(file)
  const objectUrl = URL.createObjectURL(file)

  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'].includes(ext)) {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth || 1920, height: img.naturalHeight || 1080 })
      img.onerror = () => resolve({ width: 1920, height: 1080 })
      img.src = objectUrl
    })

    const media: ProjectMedia = {
      name: file.name,
      reference: { relativePath: file.name, absolutePath: null },
      fingerprint: {
        algorithm: 'sha256-sampled-v1',
        value: hash,
        sizeBytes: file.size,
        sampledBytes: Math.min(file.size, 65536),
      },
      metadata: {
        durationUs: null,
        width: dimensions.width,
        height: dimensions.height,
        rotationDegrees: null,
        frameRate: null,
        nominalFrameRate: null,
        streams: [{
          index: 0,
          kind: 'video',
          codec: { name: 'png', longName: 'PNG image', profile: null, level: null, tag: null },
          timeBase: null,
          startUs: 0,
          durationUs: null,
          width: dimensions.width,
          height: dimensions.height,
          rotationDegrees: null,
          averageFrameRate: null,
          nominalFrameRate: null,
          sampleRate: null,
          channels: null,
        }],
      },
    }

    fileRegistry.set(hash, { file, url: objectUrl, media })
    return { ok: true, kind: 'image', media, url: objectUrl }
  }

  if (file.type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) {
    const durationUs = await new Promise<number>((resolve) => {
      const audio = new Audio(objectUrl)
      audio.onloadedmetadata = () => resolve(Math.round((audio.duration || 10) * 1_000_000))
      audio.onerror = () => resolve(10_000_000)
    })

    const media: ProjectMedia = {
      name: file.name,
      reference: { relativePath: file.name, absolutePath: null },
      fingerprint: {
        algorithm: 'sha256-sampled-v1',
        value: hash,
        sizeBytes: file.size,
        sampledBytes: Math.min(file.size, 65536),
      },
      metadata: {
        durationUs,
        width: null,
        height: null,
        rotationDegrees: null,
        frameRate: null,
        nominalFrameRate: null,
        streams: [{
          index: 0,
          kind: 'audio',
          codec: { name: 'audio', longName: 'Audio asset', profile: null, level: null, tag: null },
          timeBase: { numerator: 1, denominator: 48000 },
          startUs: 0,
          durationUs,
          width: null,
          height: null,
          rotationDegrees: null,
          averageFrameRate: null,
          nominalFrameRate: null,
          sampleRate: 48000,
          channels: 2,
        }],
      },
    }

    fileRegistry.set(hash, { file, url: objectUrl, media })
    return { ok: true, kind: 'audio', media, url: objectUrl }
  }

  // Video by default
  const meta = await new Promise<{ durationUs: number; width: number; height: number }>((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      resolve({
        durationUs: Math.round((video.duration || 10) * 1_000_000),
        width: video.videoWidth || 1920,
        height: video.videoHeight || 1080,
      })
    }
    video.onerror = () => resolve({ durationUs: 10_000_000, width: 1920, height: 1080 })
    video.src = objectUrl
  })

  const media: ProjectMedia = {
    name: file.name,
    reference: { relativePath: file.name, absolutePath: null },
    fingerprint: {
      algorithm: 'sha256-sampled-v1',
      value: hash,
      sizeBytes: file.size,
      sampledBytes: Math.min(file.size, 65536),
    },
    metadata: {
      durationUs: meta.durationUs,
      width: meta.width,
      height: meta.height,
      rotationDegrees: null,
      frameRate: { numerator: 30, denominator: 1 },
      nominalFrameRate: { numerator: 30, denominator: 1 },
      streams: [
        {
          index: 0,
          kind: 'video',
          codec: { name: 'h264', longName: 'H.264 / AVC', profile: null, level: null, tag: null },
          timeBase: { numerator: 1, denominator: 30000 },
          startUs: 0,
          durationUs: meta.durationUs,
          width: meta.width,
          height: meta.height,
          rotationDegrees: null,
          averageFrameRate: { numerator: 30, denominator: 1 },
          nominalFrameRate: { numerator: 30, denominator: 1 },
          sampleRate: null,
          channels: null,
        },
        {
          index: 1,
          kind: 'audio',
          codec: { name: 'aac', longName: 'AAC', profile: null, level: null, tag: null },
          timeBase: { numerator: 1, denominator: 48000 },
          startUs: 0,
          durationUs: meta.durationUs,
          width: null,
          height: null,
          rotationDegrees: null,
          averageFrameRate: null,
          nominalFrameRate: null,
          sampleRate: 48000,
          channels: 2,
        },
      ],
    },
  }

  fileRegistry.set(hash, { file, url: objectUrl, media })
  return { ok: true, kind: 'video', media, url: objectUrl }
}

function toMediaCandidate(media: ProjectMedia, url: string, pathName = media.name): MediaCandidate {
  return {
    path: pathName,
    url,
    media,
    mismatches: [],
  }
}

export function createBrowserCaptionStudio(): NonNullable<Window['captionStudio']> {
  return {
    onMenuCommand: () => () => {},
    listModels: async (): Promise<ModelListing> => {
      const states: ModelState[] = MODEL_CATALOG.map((m) => ({
        id: m.id,
        location: '',
        partialLocation: '',
        status: 'absent',
        installed: false,
        partialPresent: false,
        downloadedBytes: 0,
        cancelRequested: false,
        error: null,
      }))
      return { catalog: MODEL_CATALOG, states, backendAvailable: false }
    },
    downloadModel: async (id: ManagedModelId): Promise<ModelState> => ({
      id,
      location: '',
      partialLocation: '',
      status: 'installed',
      installed: true,
      partialPresent: false,
      downloadedBytes: 1000,
      cancelRequested: false,
      error: null,
    }),
    cancelModelDownload: async () => {},
    removeModel: async (id: ManagedModelId): Promise<ModelState> => ({
      id,
      location: '',
      partialLocation: '',
      status: 'absent',
      installed: false,
      partialPresent: false,
      downloadedBytes: 0,
      cancelRequested: false,
      error: null,
    }),
    onModelState: () => () => {},
    transcriptionAvailability: async (): Promise<TranscriptionAvailability> => ({
      available: false,
      reason: 'Local Whisper models run in desktop mode. For web, you can import SRT subtitles or configure Gemini API.',
    }),
    startTranscription: async (): Promise<TranscriptionOutcome> => ({
      state: 'failed',
      error: { code: 'MODEL_UNAVAILABLE', message: 'Local Whisper engine is not available in web mode.', retryable: false },
    }),
    cancelTranscription: async () => {},
    onTranscriptionProgress: () => () => {},
    translateCaptions: async (): Promise<CaptionTranslationOutcome> => ({
      state: 'failed',
      error: { code: 'UNSUPPORTED_OPTION', message: 'Caption translation requires configured cloud provider.', retryable: false },
    }),
    cancelCaptionTranslation: async () => {},
    onCaptionTranslationProgress: () => () => {},
    alignmentSettingsStatus: async (): Promise<AlignmentSettingsStatus> => ({
      configured: Boolean(localStorage.getItem(STORAGE_KEY_GEMINI)),
      source: 'keychain',
    }),
    saveGeminiApiKey: async (apiKey: string): Promise<AlignmentSettingsStatus> => {
      if (apiKey.trim()) localStorage.setItem(STORAGE_KEY_GEMINI, apiKey.trim())
      return { configured: Boolean(apiKey.trim()), source: 'keychain' }
    },
    removeGeminiApiKey: async (): Promise<AlignmentSettingsStatus> => {
      localStorage.removeItem(STORAGE_KEY_GEMINI)
      return { configured: false, source: 'keychain' }
    },
    providerKeyStatuses: async (): Promise<ProviderKeyStatuses> => {
      const configured = Boolean(localStorage.getItem(STORAGE_KEY_GEMINI))
      const geminiStatus: ProviderKeyStatus = { configured, source: 'keychain' }
      const missingStatus: ProviderKeyStatus = { configured: false, source: 'keychain' }
      return {
        gemini: geminiStatus,
        openai: missingStatus,
        elevenlabs: missingStatus,
      }
    },
    saveProviderApiKey: async (provider: CloudProviderId, apiKey: string): Promise<ProviderKeyStatuses> => {
      if (provider === 'gemini' && apiKey.trim()) localStorage.setItem(STORAGE_KEY_GEMINI, apiKey.trim())
      const configured = Boolean(localStorage.getItem(STORAGE_KEY_GEMINI))
      return {
        gemini: { configured, source: 'keychain' },
        openai: { configured: false, source: 'keychain' },
        elevenlabs: { configured: false, source: 'keychain' },
      }
    },
    removeProviderApiKey: async (provider: CloudProviderId): Promise<ProviderKeyStatuses> => {
      if (provider === 'gemini') localStorage.removeItem(STORAGE_KEY_GEMINI)
      return {
        gemini: { configured: false, source: 'keychain' },
        openai: { configured: false, source: 'keychain' },
        elevenlabs: { configured: false, source: 'keychain' },
      }
    },
    startAlignment: async (): Promise<AlignmentOutcome> => ({
      state: 'failed',
      error: { code: 'UNSUPPORTED_OPTION', message: 'Alignment is available with Gemini API configured.', retryable: false },
    }),
    cancelAlignment: async () => {},
    onAlignmentProgress: () => () => {},

    openVideo: async (): Promise<OpenedVideo | null> => {
      const files = await pickFiles('video/*', false)
      if (!files.length) return null
      const inspected = await inspectBrowserFile(files[0])
      if (!inspected.ok || inspected.kind !== 'video') {
        return { ok: false, message: 'Could not read selected video file.' }
      }
      return {
        ok: true,
        candidate: toMediaCandidate(inspected.media, inspected.url, files[0].name),
      }
    },

    openText: async (): Promise<OpenedText | null> => {
      const files = await pickFiles('.srt,.txt,.vtt', false)
      if (!files.length) return null
      const content = await files[0].text()
      return { path: files[0].name, content }
    },

    saveText: async (request: SaveRequest): Promise<{ path: string } | null> => {
      downloadFile(request.content, request.defaultName, 'text/plain')
      return { path: request.defaultName }
    },

    openProject: async (): Promise<OpenedProject | null> => {
      const files = await pickFiles('.cstudio,.json', false)
      if (!files.length) return null
      try {
        const text = await files[0].text()
        const project = JSON.parse(text)
        return {
          ok: true,
          path: files[0].name,
          project,
          migratedFrom: null,
          migrationBackup: null,
          migrationNotes: [],
          assets: [],
          lutTexts: {},
        }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'Invalid project JSON' }
      }
    },

    saveProject: async (request: { project: CaptionProject; defaultName: string }): Promise<SavedProject | null> => {
      const path = request.defaultName || `${request.project.title}.cstudio`
      const projects = getStoredProjects().filter((p) => p.path !== path)
      projects.unshift({ path, project: request.project, savedAt: Date.now(), openedAt: Date.now() })
      saveStoredProjects(projects)
      downloadFile(JSON.stringify(request.project, null, 2), path, 'application/json')
      return { path, project: request.project }
    },

    writeProject: async (request: { project: CaptionProject; path: string }): Promise<SavedProject> => {
      const projects = getStoredProjects().filter((p) => p.path !== request.path)
      projects.unshift({ path: request.path, project: request.project, savedAt: Date.now(), openedAt: Date.now() })
      saveStoredProjects(projects)
      return { path: request.path, project: request.project }
    },

    createManagedProject: async (request: { project: CaptionProject }): Promise<SavedProject> => {
      const path = `${request.project.title}.cstudio`
      const projects = getStoredProjects().filter((p) => p.path !== path)
      projects.unshift({ path, project: request.project, savedAt: Date.now(), openedAt: Date.now() })
      saveStoredProjects(projects)
      return { path, project: request.project }
    },

    listRecentProjects: async (): Promise<RecentProjectView[]> => {
      const projects = getStoredProjects()
      return projects.map((item) => {
        let maxUs = 0
        for (const clip of item.project.clips) {
          const end = clipEndUs(clip)
          if (end > maxUs) maxUs = end
        }
        return {
          path: item.path,
          title: item.project.title || item.path.replace(/\.[^.]+$/, ''),
          exists: true,
          savedAt: item.savedAt,
          openedAt: item.openedAt,
          durationUs: maxUs,
          thumbnail: item.thumbnailDataUrl ?? null,
        }
      })
    },

    openRecentProject: async (request: { path: string }): Promise<OpenedProject> => {
      const projects = getStoredProjects()
      const found = projects.find((p) => p.path === request.path)
      if (!found) {
        return { ok: false, message: `Project ${request.path} not found in browser storage.` }
      }
      return {
        ok: true,
        path: found.path,
        project: found.project,
        migratedFrom: null,
        migrationBackup: null,
        migrationNotes: [],
        assets: [],
        lutTexts: {},
      }
    },

    setProjectThumbnail: async (request: { path: string; dataUrl: string }): Promise<boolean> => {
      const projects = getStoredProjects()
      const found = projects.find((p) => p.path === request.path)
      if (found) {
        found.thumbnailDataUrl = request.dataUrl
        saveStoredProjects(projects)
        return true
      }
      return false
    },

    recentProjectAction: async (request: RecentProjectAction): Promise<{ ok: true } | { ok: false; message: string }> => {
      const projects = getStoredProjects()
      if (request.action === 'remove' || request.action === 'trash') {
        saveStoredProjects(projects.filter((p) => p.path !== request.path))
        return { ok: true }
      }
      if (request.action === 'rename') {
        const found = projects.find((p) => p.path === request.path)
        if (found) {
          found.project.title = request.title
          saveStoredProjects(projects)
          return { ok: true }
        }
      }
      return { ok: true }
    },

    editText: async () => {},

    importAsset: async (kind: 'image' | 'audio'): Promise<ImportedAsset | null> => {
      const accept = kind === 'image' ? 'image/*' : 'audio/*'
      const files = await pickFiles(accept, false)
      if (!files.length) return null
      const inspected = await inspectBrowserFile(files[0])
      if (!inspected.ok || (inspected.kind !== 'image' && inspected.kind !== 'audio')) {
        return { ok: false, message: 'Could not import asset.' }
      }
      return { ok: true, media: inspected.media, url: inspected.url }
    },

    relinkAsset: async (expected: ProjectAsset): Promise<AssetRelinkResult | null> => {
      const accept = expected.kind === 'video' ? 'video/*' : expected.kind === 'image' ? 'image/*' : 'audio/*'
      const files = await pickFiles(accept, false)
      if (!files.length) return null
      const inspected = await inspectBrowserFile(files[0])
      if (!inspected.ok || inspected.kind === 'subtitle') {
        return { ok: false, message: 'Could not relink asset.' }
      }
      return { ok: true, candidate: toMediaCandidate(inspected.media, inspected.url, files[0].name) }
    },

    importLut: async (): Promise<LutImportResult | null> => {
      const files = await pickFiles('.cube', false)
      if (!files.length) return null
      const text = await files[0].text()
      const url = URL.createObjectURL(files[0])
      const hash = await computeSampledHash(files[0])
      const media: ProjectMedia = {
        name: files[0].name,
        reference: { relativePath: files[0].name, absolutePath: null },
        fingerprint: { algorithm: 'sha256-sampled-v1', value: hash, sizeBytes: files[0].size, sampledBytes: Math.min(files[0].size, 65536) },
        metadata: null,
      }
      const candidate: MediaCandidate = {
        path: files[0].name,
        url,
        media,
        mismatches: [],
        text,
      }
      return { ok: true, candidate }
    },

    saveGeneratedLut: async (request: { text: string; name: string; defaultDir: string | null; silent?: boolean }): Promise<LutImportResult | null> => {
      const fileName = `${request.name}.cube`
      downloadFile(request.text, fileName, 'text/plain')
      const blob = new Blob([request.text], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const media: ProjectMedia = {
        name: fileName,
        reference: { relativePath: fileName, absolutePath: null },
        fingerprint: null,
        metadata: null,
      }
      const candidate: MediaCandidate = {
        path: fileName,
        url,
        media,
        mismatches: [],
        text: request.text,
      }
      return { ok: true, candidate }
    },

    importAssetFiles: async (): Promise<InspectedFile[] | null> => {
      const files = await pickFiles('video/*,audio/*,image/*,.srt,.vtt', true)
      if (!files.length) return null
      const results: InspectedFile[] = []
      for (const file of files) {
        results.push(await inspectBrowserFile(file))
      }
      return results
    },

    inspectDroppedFiles: async (files: File[]): Promise<InspectedFile[]> => {
      const results: InspectedFile[] = []
      for (const file of files) {
        results.push(await inspectBrowserFile(file))
      }
      return results
    },

    loadWaveform: async (request: WaveformLoadRequest): Promise<WaveformLoadResult> => {
      const entry = fileRegistry.get(request.fingerprint.value)
      const peakCount = Math.min(request.maxPeaks || 1024, 2048)
      let peaks: number[] = []

      if (entry && typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
          const ctx = new AudioContextClass()
          const buffer = await entry.file.arrayBuffer()
          const audioBuffer = await ctx.decodeAudioData(buffer.slice(0))
          const channelData = audioBuffer.getChannelData(0)
          const step = Math.max(1, Math.floor(channelData.length / peakCount))
          for (let i = 0; i < peakCount; i++) {
            let max = 0
            const start = i * step
            const end = Math.min(channelData.length, start + step)
            for (let j = start; j < end; j += 4) {
              const val = Math.abs(channelData[j])
              if (val > max) max = val
            }
            peaks.push(Math.min(1, Math.max(0.02, max)))
          }
        } catch {
          // Fallback to synthetic peaks
        }
      }

      if (peaks.length === 0) {
        // Deterministic synthetic waveform from hash
        let seed = 0
        for (let i = 0; i < request.fingerprint.value.length; i++) seed += request.fingerprint.value.charCodeAt(i)
        peaks = Array.from({ length: peakCount }, (_, i) => {
          const wave = Math.abs(Math.sin((i + seed) * 0.08) * Math.cos((i + seed) * 0.03))
          return Math.max(0.05, Math.min(1, wave * 0.8 + 0.1))
        })
      }

      return {
        waveform: {
          range: request.range,
          peaks,
        },
        cache: 'generated',
        extractionVersion: 'ffmpeg-f32le-mono-peaks-v1',
      }
    },

    cancelWaveform: async () => {},
    onWaveformProgress: () => () => {},

    detectSilence: async (request: SilenceDetectRequest): Promise<SilenceDetectResult> => ({
      durationUs: 10_000_000,
      silences: [],
      speechGating: 'adaptive-v1',
    }),
    cancelSilenceDetection: async () => {},
    onSilenceProgress: () => () => {},

    loadThumbnails: async (request: ThumbnailLoadRequest): Promise<ThumbnailLoadResult> => {
      const entry = fileRegistry.get(request.fingerprint.value)
      const w = Math.min(request.width || 140, 240)
      const h = Math.round((w * 9) / 16)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#171a21'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#6a58fc'
        ctx.beginPath()
        ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.2, 0, Math.PI * 2)
        ctx.fill()
      }
      const dummyUrl = canvas.toDataURL('image/jpeg', 0.6)

      return {
        thumbnails: request.timestampsUs.map((ts) => ({
          requestedUs: ts,
          actualUs: ts,
          width: w,
          height: h,
          dataUrl: dummyUrl,
        })),
        extractionVersion: 'ffmpeg-mjpeg-showinfo-v1',
      }
    },

    cancelThumbnails: async () => {},
    onThumbnailsProgress: () => () => {},

    checkProxySupport: async (): Promise<ProxySupport> => ({
      supported: false,
      reason: 'Playback proxies are handled automatically in modern browsers.',
    }),
    createProxy: async (): Promise<ProxyCreateResult | null> => null,
    cancelProxy: async () => {},
    onProxyProgress: () => () => {},
    ensurePlaybackProxy: () => {},
    onPlaybackProxyStatus: () => () => {},

    checkExportSupport: async (): Promise<ExportSupport> => ({
      supported: true,
      reason: null,
    }),

    startExport: async (request: ExportStartRequest): Promise<ExportOutcome | null> => {
      const srt = serializeSrt(request.project.cues)
      const fileName = `${request.project.title || 'captions'}.srt`
      downloadFile(srt, fileName, 'text/plain')
      return {
        state: 'succeeded',
        path: fileName,
        durationUs: 10_000_000,
        frameCount: 300,
      }
    },

    cancelExport: async () => {},
    revealExport: async () => ({ ok: true }),
    onExportProgress: () => () => {},

    onAgentRequest: () => () => {},
    respondAgentRequest: () => {},
    agentStatus: async (): Promise<McpStatus> => ({ enabled: false, running: false, port: null, connections: 0 }),
    onAgentStatus: () => () => {},
    agentSettings: async (): Promise<McpSettingsView> => ({ enabled: false, running: false, port: null, connections: 0, token: 'browser-mode', desktopConfig: null }),
    setAgentEnabled: async (enabled: boolean): Promise<McpSettingsView> => ({ enabled, running: false, port: null, connections: 0, token: 'browser-mode', desktopConfig: null }),
    rotateAgentToken: async (): Promise<McpSettingsView> => ({ enabled: false, running: false, port: null, connections: 0, token: 'browser-mode-rotated', desktopConfig: null }),

    resolveStatus: async (): Promise<ResolveStatus> => ({ state: 'disconnected' }),
    onResolveStatus: () => () => {},
    resolvePluginInfo: async (): Promise<ResolvePluginInfo> => ({ supported: false, installed: false, upToDate: false, scriptPath: null }),
    installResolvePlugin: async (): Promise<ResolvePluginInfo> => ({ supported: false, installed: false, upToDate: false, scriptPath: null }),
    uninstallResolvePlugin: async (): Promise<ResolvePluginInfo> => ({ supported: false, installed: false, upToDate: false, scriptPath: null }),
    resolveTimelineInfo: async (): Promise<ResolveTimelineInfo> => {
      throw new Error('DaVinci Resolve integration is available in the desktop application.')
    },
    resolveDisconnect: async () => {},
    resolveCreateProxyStart: async () => {
      throw new Error('DaVinci Resolve proxy is available in desktop app.')
    },
    resolveCreateProxyCancel: async () => {},
    onResolveProxyProgress: () => () => {},
    onResolveProxyDone: () => () => {},
    resolveImportEdit: async (): Promise<ResolveImportEditResult> => {
      throw new Error('DaVinci Resolve edit import is available in desktop app.')
    },
    onResolveImportEditProgress: () => () => {},
    resolveSyncPreview: async (): Promise<ResolveSyncPreview> => {
      throw new Error('DaVinci Resolve sync is available in desktop app.')
    },
    resolveSyncApply: async (): Promise<ResolveSyncResult> => {
      throw new Error('DaVinci Resolve sync is available in desktop app.')
    },
    resolveJumpTo: async () => {},
    onResolveSyncProgress: () => () => {},
    resolvePushTimeline: async (): Promise<ResolvePushTimelineResult> => {
      throw new Error('DaVinci Resolve push is available in desktop app.')
    },
    onResolvePushProgress: () => () => {},
  }
}
