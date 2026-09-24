import { LutRenderer } from '../src/color/webglLut'
import type { Cube3D } from '../src/color/cube'

declare global {
  interface Window {
    renderColorParity(videoUrl: string, cube: Omit<Cube3D, 'data'> & { data: number[] }): Promise<number[]>
  }
}

window.renderColorParity = async (videoUrl, serialized) => {
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = videoUrl
  document.body.append(video)
  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true })
    video.addEventListener('error', () => reject(new Error(video.error?.message ?? 'Video decode failed')), { once: true })
  })
  video.currentTime = 0.5
  await new Promise<void>((resolve) => video.addEventListener('seeked', () => resolve(), { once: true }))
  const canvas = document.querySelector('canvas')!
  const renderer = new LutRenderer(canvas)
  renderer.uploadLut({ ...serialized, data: Float32Array.from(serialized.data) })
  renderer.draw(video, video.videoWidth, video.videoHeight)
  const gl = canvas.getContext('webgl2')!
  const pixels = new Uint8Array(canvas.width * canvas.height * 4)
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL readPixels failed')
  renderer.dispose()
  video.remove()
  return Array.from(pixels)
}
