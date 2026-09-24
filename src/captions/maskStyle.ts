import type { CSSProperties } from 'react'
import { COMPOSITION_WIDTH, type CompositionRect, type LayerMask } from '../core/edit'
import { compositionScale } from '../core/composition'
import { activeMask, maskImageUrl } from '../core/layerMask'
import type { Size } from './renderer'

const cache = new Map<string, string>()

/**
 * The CSS that masks one painted element (docs/EDITING.md "Layer masks"): the same generated SVG
 * (`layerMask.ts`) as a `mask-image`, sized to the whole composition and offset so it lines up with
 * the frame even when the element only covers `rect`. Applied to the element itself — a wrapper
 * would become a backdrop root and break `backdrop-filter` blur. `composition` is the painted size
 * (the 1080-unit preview space or the export host's output pixels); returns `{}` for no/disabled mask.
 */
export function maskStyle(mask: LayerMask | undefined | null, composition: Size, rect: CompositionRect | null): CSSProperties {
  const active = activeMask(mask)
  if (!active) return {}
  const scale = compositionScale(composition)
  const key = JSON.stringify([active, composition.width, composition.height])
  let url = cache.get(key)
  if (!url) {
    url = maskImageUrl(active, { width: COMPOSITION_WIDTH, height: composition.height / scale }, composition)
    if (cache.size > 64) cache.clear()
    cache.set(key, url)
  }
  const size = `${composition.width}px ${composition.height}px`
  const position = `${-(rect ? rect.x * scale : 0)}px ${-(rect ? rect.y * scale : 0)}px`
  return { maskImage: url, WebkitMaskImage: url, maskSize: size, WebkitMaskSize: size, maskPosition: position, WebkitMaskPosition: position, maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' }
}
