import type { CSSProperties } from 'react'

/**
 * The complete inline style a mounter applies to a pooled `<video>` (owned by `VideoPool`, moved
 * between `VideoSlot` and `GradedVideo`). Every mounter sets every property, so nothing a previous
 * mounter left behind — notably `GradedVideo`'s `opacity: 0` — can leak into the next one and blank
 * the preview.
 */
export function pooledVideoStyle(fit: 'contain' | 'cover' | 'stretch', visible: boolean): Pick<CSSProperties, 'width' | 'height' | 'display' | 'objectFit' | 'opacity'> {
  return { width: '100%', height: '100%', display: 'block', objectFit: fit === 'stretch' ? 'fill' : fit, opacity: visible ? 1 : 0 }
}
