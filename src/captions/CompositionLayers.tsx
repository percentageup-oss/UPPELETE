import type { CSSProperties } from 'react'
import type { CompositionRect } from '../core/edit'
import { compositionScale } from '../core/composition'
import type { Size } from './renderer'

/** One already-visible-at-this-instant image, resolved to a concrete URL (or `null` for a missing
 * asset, shown as a placeholder in the editor preview — the export harness never sees `null`,
 * since export refuses before the job starts when an overlay's asset is not registered). */
export type CompositionLayerImage = {
  id: string
  url: string | null
  label: string
  rect: CompositionRect
  opacity: number
  fit: 'contain' | 'cover' | 'stretch'
}

/**
 * Image overlays (V2), positioned in the same composition-unit space `CaptionView` draws in. The
 * caller does the time-visibility filtering and asset lookup (`App.tsx`'s `CaptionStage` for the
 * live preview, `frameHarness.tsx` from the already-resolved export frame request) so this stays a
 * pure paint of whatever list it is given. `composition` may be the fixed 1080-unit preview space
 * (scale 1) or an export harness's output-pixel composition (`compositionScale`, matching
 * `compositionToPixels`).
 */
export function CompositionLayers({ images, composition }: { images: readonly CompositionLayerImage[]; composition: Size }) {
  const scale = compositionScale(composition)
  if (!images.length) return null
  return <>{images.map((image) => {
    const style: CSSProperties = {
      position: 'absolute', left: image.rect.x * scale, top: image.rect.y * scale,
      width: image.rect.width * scale, height: image.rect.height * scale, opacity: image.opacity,
      objectFit: image.fit === 'stretch' ? 'fill' : image.fit,
    }
    if (!image.url) return <div key={image.id} data-overlay-missing={image.id} style={{ ...style, boxSizing: 'border-box',
      border: '1px dashed #ffda8b', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      color: '#ffda8b', fontSize: 11, textAlign: 'center', background: '#10101066' }}>{image.label}</div>
    return <img key={image.id} data-overlay-id={image.id} src={image.url} draggable={false} alt="" style={style} />
  })}</>
}
