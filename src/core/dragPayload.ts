import type { BackgroundMotion, Fill, Grade } from './edit'

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

/** A background (solid color or gradient, optionally animated) dragged from the Effects panel: it
 * becomes a generated `color` clip, so the payload carries the look rather than an asset id. */
export const BACKGROUND_DRAG_TYPE = 'application/x-caption-studio-background'
export type BackgroundDragPayload = { source: 'background'; fill: Fill; motion?: BackgroundMotion }

/** A Color panel tile (an adjustment-layer preset, a log profile, a look, or an imported LUT)
 * dragged from the rail: it becomes an `adjustment` clip carrying `grade` (docs/EDITING.md "Color:
 * adjustment layers"), so the payload carries the grade itself rather than an asset id. */
export const COLOR_DRAG_TYPE = 'application/x-caption-studio-color'
export type ColorDragPayload = { source: 'color'; grade: Grade }

export type AssetDragPayload = {
  source: 'bin'
  assetId: string
  kind: 'image' | 'audio' | 'video'
  name: string
  durationUs: number | null
}

export type EffectPreset = 'zoom-in' | 'zoom-out' | 'pan' | 'ken-burns' | 'blur-area' | 'blur-frame'
  | 'vignette' | 'letterbox-239' | 'letterbox-185' | 'fade-in' | 'fade-out' | 'fade-dip' | 'flash' | 'film-grain' | 'vhs' | 'light-particles' | 'dreamy-glow'
export type PresetDragPayload = { source: 'preset'; preset: EffectPreset }

type AnyDragPayload = AssetDragPayload | PresetDragPayload | BackgroundDragPayload | ColorDragPayload
let current: AnyDragPayload | null = null

export function setDragPayload(payload: AnyDragPayload): void {
  current = payload
}

export function getDragPayload(): AnyDragPayload | null {
  return current
}

export function clearDragPayload(): void {
  current = null
}

export type DropContent = { kind: 'asset'; payload: AssetDragPayload } | { kind: 'preset'; payload: PresetDragPayload } | { kind: 'background'; payload: BackgroundDragPayload } | { kind: 'color'; payload: ColorDragPayload } | { kind: 'files'; files: File[] }

/** What a `DataTransfer` (from `dragover`/`drop`) would yield: a bin asset, a panel preset, dropped
 * files, or neither. `dragover` never has `dataTransfer.files` populated, so file drags are
 * recognised there by the `Files` type instead — `dropContent` handles both call sites uniformly. */
export function dropContent(dataTransfer: DataTransfer | null): DropContent | null {
  if (!dataTransfer) return null
  const types = Array.from(dataTransfer.types ?? [])
  if (types.includes(ASSET_DRAG_TYPE) || types.includes(PRESET_DRAG_TYPE) || types.includes(BACKGROUND_DRAG_TYPE) || types.includes(COLOR_DRAG_TYPE) || current) {
    if (current) {
      return current.source === 'preset' ? { kind: 'preset', payload: current }
        : current.source === 'background' ? { kind: 'background', payload: current }
        : current.source === 'color' ? { kind: 'color', payload: current }
        : { kind: 'asset', payload: current }
    }
    try {
      if (types.includes(BACKGROUND_DRAG_TYPE)) {
        const raw = dataTransfer.getData(BACKGROUND_DRAG_TYPE)
        if (raw) return { kind: 'background', payload: JSON.parse(raw) as BackgroundDragPayload }
      } else if (types.includes(COLOR_DRAG_TYPE)) {
        const raw = dataTransfer.getData(COLOR_DRAG_TYPE)
        if (raw) return { kind: 'color', payload: JSON.parse(raw) as ColorDragPayload }
      } else if (types.includes(PRESET_DRAG_TYPE)) {
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
