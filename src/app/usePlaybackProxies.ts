import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectAsset } from '../core/edit'
import {
  playbackProxyModeSchema, playbackUrlFor, shouldRequestPlaybackProxy,
  type PlaybackProxyMode, type PlaybackProxyOverride, type PlaybackProxyStatus,
} from '../core/proxy'

const MODE_STORAGE_KEY = 'caption-studio:playback-proxy-mode'

function loadMode(): PlaybackProxyMode {
  try {
    const parsed = playbackProxyModeSchema.safeParse(localStorage.getItem(MODE_STORAGE_KEY))
    return parsed.success ? parsed.data : 'auto'
  } catch { return 'auto' }
}

/**
 * Automatic playback proxies (docs/STATUS.md "Playback performance"): tracks per-video proxy
 * status, requests one (at most once per fingerprint) for each video asset that qualifies under
 * the current mode, and exposes a replacement `urlOf` for preview only. This is the one adapter
 * that ever sees a proxy URL — export, transcription, waveform extraction, thumbnails and export
 * parity all keep resolving media through `useAssetUrls`'s own `urlOf` directly and never call
 * anything here, so they always read the original source file.
 */
export function usePlaybackProxies(assets: ProjectAsset[], originalUrlOf: (asset: ProjectAsset | null | undefined) => string | null) {
  const [mode, setModeState] = useState<PlaybackProxyMode>(loadMode)
  const [override, setOverride] = useState<PlaybackProxyOverride>(null)
  const [statuses, setStatuses] = useState<Map<string, PlaybackProxyStatus>>(new Map())
  const requested = useRef<Set<string>>(new Set())

  const setMode = useCallback((next: PlaybackProxyMode) => {
    setModeState(next)
    try { localStorage.setItem(MODE_STORAGE_KEY, next) } catch { /* a convenience only */ }
  }, [])

  useEffect(() => window.captionStudio?.onPlaybackProxyStatus((status) => {
    setStatuses((map) => new Map(map).set(status.fingerprint.value, status))
  }), [])

  // Requests a proxy for each qualifying, playable video exactly once per fingerprint per app
  // session; main dedupes further and re-answers instantly from disk if one already exists there.
  useEffect(() => {
    const api = window.captionStudio
    if (!api || mode === 'off') return
    for (const asset of assets) {
      if (asset.kind !== 'video' || !asset.fingerprint || !asset.metadata?.durationUs) continue
      if (!originalUrlOf(asset)) continue
      if (!shouldRequestPlaybackProxy(mode, asset.metadata)) continue
      const key = asset.fingerprint.value
      if (requested.current.has(key)) continue
      requested.current.add(key)
      api.ensurePlaybackProxy({ fingerprint: asset.fingerprint, durationUs: asset.metadata.durationUs })
    }
  }, [assets, mode, originalUrlOf])

  const urlOf = useCallback((asset: ProjectAsset | null | undefined): string | null => {
    const original = originalUrlOf(asset)
    if (!asset || asset.kind !== 'video' || !asset.fingerprint) return original
    return playbackUrlFor(original, statuses.get(asset.fingerprint.value), mode, override)
  }, [originalUrlOf, statuses, mode, override])

  const statusOf = useCallback((asset: ProjectAsset | null | undefined): PlaybackProxyStatus | undefined =>
    asset?.kind === 'video' && asset.fingerprint ? statuses.get(asset.fingerprint.value) : undefined, [statuses])

  return { mode, setMode, override, setOverride, urlOf, statusOf }
}
