/**
 * Drag payload for dragging a bin row onto the timeline or stage. `dragover` handlers cannot call
 * `DataTransfer.getData` (browsers withhold it until `drop`, for cross-origin-drag safety), so the
 * live payload also lives in this module-level variable, set on `dragstart` and cleared on `dragend`.
 * `setData` is still called too, so a drop still works if it ever comes from outside this window.
 */
export const ASSET_DRAG_TYPE = 'application/x-caption-studio-asset'
/** A preset dropped from a rail panel that creates its own item rather than importing media — the
 * Effects panel's tiles (docs/EDITING.md "Zoom regions", "Blur regions"). */
export const PRESET_DRAG_TYPE = 'application/x-caption-studio-preset'

export type AssetDragPayload = {
  source: 'bin'
  assetId: string
  kind: 'image' | 'audio' | 'video'
  name: string
  durationUs: number | null
}

export type EffectPreset = 'zoom-in' | 'zoom-out' | 'pan' | 'ken-burns' | 'blur-area' | 'blur-frame'
  | 'vignette' | 'letterbox-239' | 'letterbox-185' | 'fade-in' | 'fade-out' | 'fade-dip' | 'flash'
export type PresetDragPayload = { source: 'preset'; preset: EffectPreset }

let current: AssetDragPayload | PresetDragPayload | null = null

export function setDragPayload(payload: AssetDragPayload | PresetDragPayload): void {
  current = payload
}

export function getDragPayload(): AssetDragPayload | PresetDragPayload | null {
  return current
}

export function clearDragPayload(): void {
  current = null
}

export type DropContent = { kind: 'asset'; payload: AssetDragPayload } | { kind: 'preset'; payload: PresetDragPayload } | { kind: 'files'; files: File[] }

/** What a `DataTransfer` (from `dragover`/`drop`) would yield: a bin asset, a panel preset, dropped
 * files, or neither. `dragover` never has `dataTransfer.files` populated, so file drags are
 * recognised there by the `Files` type instead — `dropContent` handles both call sites uniformly. */
export function dropContent(dataTransfer: DataTransfer | null): DropContent | null {
  if (!dataTransfer) return null
  const types = Array.from(dataTransfer.types ?? [])
  if (types.includes(ASSET_DRAG_TYPE) || types.includes(PRESET_DRAG_TYPE) || current) {
    if (current) return current.source === 'preset' ? { kind: 'preset', payload: current } : { kind: 'asset', payload: current }
    try {
      if (types.includes(PRESET_DRAG_TYPE)) {
        const raw = dataTransfer.getData(PRESET_DRAG_TYPE)
        if (raw) return { kind: 'preset', payload: JSON.parse(raw) as PresetDragPayload }
      } else {
        const raw = dataTransfer.getData(ASSET_DRAG_TYPE)
        if (raw) return { kind: 'asset', payload: JSON.parse(raw) as AssetDragPayload }
      }
    } catch { /* fall through to files/null below */ }
  }
  if (dataTransfer.files?.length) return { kind: 'files', files: Array.from(dataTransfer.files) }
  if (types.includes('Files')) return { kind: 'files', files: [] }
  return null
}
