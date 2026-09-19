import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { describeMediaMismatches, type ProjectMedia } from '../src/core/media'
import type { CaptionProject } from '../src/core/model'
import type { ResultFor } from '../workers/media/protocol'

export type MediaCandidate = {
  path: string
  url: string
  media: ProjectMedia
  mismatches: string[]
}

export type ProjectMediaResolution =
  | { kind: 'none' }
  | { kind: 'missing'; triedPaths: string[] }
  | { kind: 'resolved'; candidate: MediaCandidate }
  | { kind: 'mismatch'; candidate: MediaCandidate }

/** One asset's resolution against disk, reported by `project:open` for every asset, video included. */
export type AssetResolution = { id: string; resolution: ProjectMediaResolution }

export function mediaFromProbe(filePath: string, probe: ResultFor<{ operation: 'probe'; inputPath: string }>): ProjectMedia {
  return {
    name: path.basename(filePath),
    reference: { relativePath: null, absolutePath: filePath },
    fingerprint: probe.fingerprint,
    metadata: probe.metadata,
  }
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

export function portableMediaReference(projectPath: string, mediaPath: string) {
  const projectDirectory = path.dirname(path.resolve(projectPath))
  const absoluteMediaPath = path.resolve(mediaPath)
  const relative = path.relative(projectDirectory, absoluteMediaPath)
  const relativePath = isInside(projectDirectory, absoluteMediaPath)
    ? relative.split(path.sep).join('/')
    : null
  return { relativePath, absolutePath: absoluteMediaPath }
}

/**
 * Rewrites every stored asset reference relative to the project file when it sits below the project
 * directory, so moving the pair to another machine keeps them linked. Video, image and audio assets
 * are all `projectMediaSchema` records, so they go through exactly the same `portableMediaReference`;
 * an asset with no absolute path on record is left untouched rather than guessed at.
 */
export function projectForSave(project: CaptionProject, projectPath: string): CaptionProject {
  const assets = project.assets.map((asset) => {
    const assetPath = asset.reference.absolutePath
    return assetPath ? { ...asset, reference: portableMediaReference(projectPath, assetPath) } : asset
  })
  return { ...project, assets }
}

function relativeCandidate(projectPath: string, relativePath: string): string {
  return path.resolve(path.dirname(projectPath), ...relativePath.split('/'))
}

async function existingRegularFile(candidate: string, containmentRoot?: string): Promise<string | null> {
  try {
    const resolved = await realpath(candidate)
    if (containmentRoot) {
      const resolvedRoot = await realpath(containmentRoot)
      if (!isInside(resolvedRoot, resolved)) return null
    }
    return (await stat(resolved)).isFile() ? resolved : null
  } catch { return null }
}

export async function candidatePaths(projectPath: string, media: ProjectMedia): Promise<{ existing: string | null; tried: string[] }> {
  const tried: string[] = []
  if (media.reference.relativePath) {
    const candidate = relativeCandidate(projectPath, media.reference.relativePath)
    tried.push(candidate)
    const existing = await existingRegularFile(candidate, path.dirname(projectPath))
    if (existing) return { existing, tried }
  }
  const absolute = media.reference.absolutePath
  if (absolute && path.isAbsolute(absolute) && !tried.includes(absolute)) {
    tried.push(absolute)
    const existing = await existingRegularFile(absolute)
    if (existing) return { existing, tried }
  }
  return { existing: null, tried }
}

/**
 * A page loaded from the Vite dev server (http://localhost) cannot fetch file:// URLs at all —
 * Chromium blocks cross-scheme local-file loads regardless of CSP, so the embedded <video> would
 * report a generic "format/codec unsupported" error for every file even though it plays fine once
 * packaged (file:// origin). The `media:` scheme is served by protocol.handle in main.ts instead,
 * which works from both the dev-server and packaged origins and forwards Range requests for seeking.
 */
export function mediaUrlForPath(filePath: string): string {
  return `media://local/${encodeURIComponent(path.resolve(filePath))}`
}

/** Inverse of `mediaUrlForPath`; returns null for anything that is not a well-formed `media://local/<path>` URL. */
export function mediaPathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'media:' || parsed.hostname !== 'local') return null
    return path.resolve(decodeURIComponent(parsed.pathname.slice(1)))
  } catch { return null }
}

export function candidateFromProbe(filePath: string, expected: ProjectMedia | null, probe: ResultFor<{ operation: 'probe'; inputPath: string }>): MediaCandidate {
  const media = mediaFromProbe(filePath, probe)
  return {
    path: filePath,
    url: mediaUrlForPath(filePath),
    media,
    mismatches: expected ? describeMediaMismatches(expected, media) : [],
  }
}
