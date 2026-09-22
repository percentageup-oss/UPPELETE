import { useCallback, useState } from 'react'
import type { ProjectAsset } from '../core/edit'
import type { ProjectMedia } from '../core/media'

export type AssetIssue = 'missing' | 'mismatch'

/**
 * Where each asset can be played from this session — runtime `media://` URLs the renderer never
 * persists — and a per-asset issue badge for a missing or mismatched file. A video's URL is keyed by
 * its file fingerprint rather than its asset id, so undoing a relink immediately points playback
 * back at the right file; every other asset is keyed by id.
 */
export function useAssetUrls() {
  const [videoUrls, setVideoUrls] = useState<Map<string, string>>(new Map())
  const [assetUrls, setAssetUrls] = useState<Map<string, string>>(new Map())
  const [issues, setIssues] = useState<Map<string, AssetIssue>>(new Map())

  const urlOf = useCallback((asset: ProjectAsset | null | undefined): string | null => {
    if (!asset) return null
    if (asset.kind === 'video') return asset.fingerprint ? videoUrls.get(asset.fingerprint.value) ?? null : null
    return assetUrls.get(asset.id) ?? null
  }, [videoUrls, assetUrls])

  /** Remembers where a probed file can be played from. */
  const register = useCallback((asset: Pick<ProjectAsset, 'id' | 'kind'> & Pick<ProjectMedia, 'fingerprint'>, url: string) => {
    if (asset.kind === 'video') {
      const key = asset.fingerprint?.value
      if (key) setVideoUrls((urls) => new Map(urls).set(key, url))
    } else setAssetUrls((urls) => new Map(urls).set(asset.id, url))
  }, [])

  const clearIssue = useCallback((assetId: string) => setIssues((current) => {
    if (!current.has(assetId)) return current
    const next = new Map(current)
    next.delete(assetId)
    return next
  }), [])

  /** Replaces everything at once — what opening a project does. */
  const reset = useCallback((videos: Map<string, string>, urls: Map<string, string>, nextIssues: Map<string, AssetIssue>) => {
    setVideoUrls(videos)
    setAssetUrls(urls)
    setIssues(nextIssues)
  }, [])

  return { urlOf, register, issues, clearIssue, reset, assetUrls, videoUrls }
}
