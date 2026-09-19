import path from 'node:path'
import { classifyMedia, isSubtitleFileName } from '../src/core/assetKind'
import type { InspectedFile } from '../src/core/assetImport'
import type { MediaCandidate } from './projectMedia'

/** Subtitle files are read as plain text, never probed by the media worker — the size cap keeps a
 * huge or non-text file from being read into memory whole. */
export const MAX_SUBTITLE_BYTES = 4 * 1024 * 1024

export type AssetInspectDeps = {
  inspect(filePath: string): Promise<MediaCandidate>
  readText(filePath: string): Promise<{ content: string; sizeBytes: number }>
}

/**
 * Classifies one file dropped or picked for the media bin. A `.srt` is read as text and never
 * probed; everything else goes through the media worker probe (which also registers its
 * fingerprint for later transcription/export/waveform lookups) and is classified from its actual
 * streams — an unusable file (real video with unreadable streams, a document, etc.) is refused by
 * name rather than silently skipped.
 */
export async function inspectFileForBin(filePath: string, deps: AssetInspectDeps): Promise<InspectedFile> {
  const name = path.basename(filePath)
  if (isSubtitleFileName(name)) {
    const { content, sizeBytes } = await deps.readText(filePath)
    if (sizeBytes > MAX_SUBTITLE_BYTES) return { ok: false, name, message: `${name} is too large to import as subtitles.` }
    return { ok: true, kind: 'subtitle', name, content }
  }
  try {
    const candidate = await deps.inspect(filePath)
    const kind = candidate.media.metadata ? classifyMedia(candidate.media.metadata) : null
    if (!kind) return { ok: false, name, message: `${name} could not be recognized as a usable image, audio or video file.` }
    return { ok: true, kind, media: candidate.media, url: candidate.url }
  } catch (error) {
    return { ok: false, name, message: error instanceof Error ? error.message : `${name} could not be read.` }
  }
}
