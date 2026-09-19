import { nativeImage } from 'electron'

/** A compositor-visible token correlates a paint with a committed request, even for static frames. */
export function markedBitmap(image, composition, marker) {
  const size = image.getSize()
  if (size.width !== composition.width || size.height !== composition.height) throw new Error(`Unexpected pixel dimensions: ${JSON.stringify(size)}`)
  const bitmap = image.toBitmap()
  if (bitmap.length !== size.width * size.height * 4) throw new Error('Unexpected bitmap size')
  const index = bitmap.length - 4
  if (bitmap[index] !== (marker >> 16 & 255) || bitmap[index + 1] !== (marker >> 8 & 255)
    || bitmap[index + 2] !== (marker & 255) || bitmap[index + 3] !== 255) return null
  // Marker occupies the reserved bottom-right pixel outside the caption safe area. Never export it.
  bitmap.fill(0, index)
  return bitmap
}

export async function renderOffscreen(window, request, marker) {
  const wc = window.webContents
  let committed = false, stalePaints = 0
  let resolvePaint, rejectPaint
  const painted = new Promise((resolve, reject) => { resolvePaint = resolve; rejectPaint = reject })
  // Attach before dispatch; uncommitted paints are never accepted.
  const listener = (_event, _dirty, image) => {
    if (!committed) { stalePaints++; return }
    try {
      const bitmap = markedBitmap(image, request.composition, marker)
      if (bitmap) resolvePaint(bitmap)
      else stalePaints++
    } catch (error) { rejectPaint(error) }
  }
  wc.on('paint', listener)
  const timer = setTimeout(() => rejectPaint(new Error('Offscreen committed paint timeout')), 15000)
  // Handle rejection immediately, including failures while awaiting font readiness.
  painted.catch(() => {})
  try {
    const result = await wc.executeJavaScript(`window.x1.render(${JSON.stringify(request)}, ${marker})`)
    committed = true
    wc.invalidate() // Chromium emits no paint for unchanged pages without explicit invalidation.
    return { ...result, bitmap: await painted, stalePaints }
  } finally { clearTimeout(timer); wc.removeListener('paint', listener) }
}

export async function renderPreview(window, request, marker) {
  const result = await window.webContents.executeJavaScript(`window.x1.render(${JSON.stringify(request)}, ${marker})`)
  const deadline = performance.now() + 15000
  while (performance.now() < deadline) {
    const bitmap = markedBitmap(await window.webContents.capturePage(), request.composition, marker)
    if (bitmap) return { ...result, bitmap }
  }
  throw new Error('Preview committed capture timeout')
}

export function toPng(bitmap, composition) {
  return nativeImage.createFromBitmap(bitmap, composition).toPNG()
}

export function alphaStats(bitmap) {
  let clear = 0, partial = 0, opaque = 0, nonzeroRgbUnderClear = 0
  for (let i = 0; i < bitmap.length; i += 4) {
    if (bitmap[i + 3] === 0) { clear++; if (bitmap[i] || bitmap[i + 1] || bitmap[i + 2]) nonzeroRgbUnderClear++ }
    else if (bitmap[i + 3] === 255) opaque++
    else partial++
  }
  return { clear, partial, opaque, nonzeroRgbUnderClear }
}
