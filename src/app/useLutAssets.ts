import { useCallback, useState } from 'react'
import { parseCube, type Cube3D } from '../color/cube'

/**
 * Parsed `.cube` content for every `lut`-kind project asset this session has resolved — a grade's
 * `input: {type:'lut', assetId}` (docs/EDITING.md "Color: adjustment layers") is only ever evaluated
 * against this cache; nothing in the renderer reads a LUT file from disk directly (only main-process
 * IPC does — `window.captionStudio.importLut`, `project:open`). An asset absent from `cubes` — never
 * imported this session, still missing, or a file that failed to parse — bakes to no grade for any
 * stack that needs it (`bakedGradeStack`), so callers render that layer ungraded with a warning
 * rather than guessing at missing data.
 */
export function useLutAssets() {
  const [cubes, setCubes] = useState<Map<string, Cube3D>>(new Map())

  /** Parses `text` and remembers it under `assetId`; drops any previous entry if it fails to parse. */
  const register = useCallback((assetId: string, text: string) => {
    setCubes((current) => {
      const next = new Map(current)
      try { next.set(assetId, parseCube(text)) } catch { next.delete(assetId) }
      return next
    })
  }, [])

  const clear = useCallback((assetId: string) => setCubes((current) => {
    if (!current.has(assetId)) return current
    const next = new Map(current)
    next.delete(assetId)
    return next
  }), [])

  /** Replaces everything at once — what opening a project does, from `project:open`'s per-asset
   * `.cube` text (already read and validated in the main process alongside the rest of asset
   * resolution). A LUT whose text fails to parse here (should not happen, since the main process
   * validates it first) is simply left out rather than thrown. */
  const hydrate = useCallback((texts: Readonly<Record<string, string>>) => {
    const next = new Map<string, Cube3D>()
    for (const [assetId, text] of Object.entries(texts)) { try { next.set(assetId, parseCube(text)) } catch { /* left absent */ } }
    setCubes(next)
  }, [])

  return { cubes, register, clear, hydrate }
}
