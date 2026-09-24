import type { PixelImage } from './referenceMatch'

/** Reads a picked image asset's pixels (scaled to `width`) through its `media:` (CORS-enabled) or `data:` URL. */
export function loadReferencePixels(url: string, width = 320): Promise<PixelImage> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      const height = Math.max(1, Math.round((width * image.naturalHeight) / image.naturalWidth))
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return reject(new Error('The image could not be read.'))
      context.drawImage(image, 0, 0, width, height)
      try { resolve(context.getImageData(0, 0, width, height)) } catch { reject(new Error('The image could not be read.')) }
    }
    image.onerror = () => reject(new Error('The image could not be loaded.'))
    image.src = url
  })
}

