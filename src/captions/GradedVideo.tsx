import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Cube3D } from '../color/cube'
import { LutRenderer } from '../color/webglLut'

/** Not every TS DOM lib version this app builds against types the Media Capture callback yet — the
 * same optional extension `src/playback/videoPool.ts`'s `VideoLike` declares. */
type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?(callback: (now: number, metadata: { mediaTime: number }) => void): number
  cancelVideoFrameCallback?(handle: number): void
}

export type GradedSource = { kind: 'video'; element: HTMLVideoElement | null } | { kind: 'image'; url: string }

/**
 * Mounts a graded picture layer: a video or image source drawn through a baked 3D LUT (`grade`) in
 * WebGL2 — the preview half of `docs/EDITING.md` "Color: adjustment layers"; the export worker
 * samples the same baked cube through FFmpeg's `lut3d` filter, so the two read identical data the
 * same way. For a video, this takes over `VideoSlot`'s job of mounting the pooled `<video>` element
 * (owned and moved between slots by `VideoPool`, never created here) — it stays mounted underneath
 * the canvas at `opacity: 0` (never `display: none`) so it keeps decoding — and moves it back to
 * plain, visible playback if WebGL2 is unavailable or its context is lost, with a "Grade unavailable"
 * badge so that fallback is never silent.
 */
export function GradedVideo({ source, grade, fit, style }: {
  source: GradedSource
  grade: Cube3D
  fit: 'contain' | 'cover' | 'stretch'
  style: CSSProperties
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<LutRenderer | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const objectFit = fit === 'stretch' ? 'fill' : fit
  const element = source.kind === 'video' ? source.element : null

  // Mounts the pooled `<video>` element into this layer, exactly like `VideoSlot` — appending it
  // (never creating or destroying it) keeps it decoding across layer-list changes and grade toggles.
  useLayoutEffect(() => {
    const parent = hostRef.current
    if (!parent || !element) return
    Object.assign(element.style, { width: '100%', height: '100%', display: 'block', objectFit, opacity: unavailable ? '1' : '0' })
    parent.insertBefore(element, parent.firstChild)
    return () => { if (element.parentNode === parent) parent.removeChild(element) }
  }, [element, objectFit, unavailable])

  // One GL context per mounted canvas, recreated after a context loss. `webglcontextlost` must call
  // `preventDefault()` or the browser never fires `webglcontextrestored` (the WebGL spec's own rule).
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const create = () => {
      try { rendererRef.current = new LutRenderer(canvas); setUnavailable(false) }
      catch { rendererRef.current = null; setUnavailable(true) }
    }
    const onLost = (event: Event) => { event.preventDefault(); rendererRef.current = null; setUnavailable(true) }
    const onRestored = () => create()
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    create()
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  const draw = (media: TexImageSource, width: number, height: number) => {
    const renderer = rendererRef.current
    if (!renderer || width <= 0 || height <= 0) return
    try { renderer.uploadLut(grade); renderer.draw(media, width, height) }
    catch { rendererRef.current = null; setUnavailable(true) }
  }

  // Video: redraw every presented frame via `requestVideoFrameCallback` (arms/disarms exactly like
  // the playback transport's own master clock, `src/playback/transport.ts`) — this fires again while
  // paused too, whenever a seek delivers a new frame, so scrubbing stays graded without needing a
  // separate "redraw once" path. No `requestVideoFrameCallback` (unsupported host) falls back to
  // drawing once from whatever frame is already decoded; live grading then needs playback to advance.
  useEffect(() => {
    if (unavailable || !element) return
    const video = element as FrameCallbackVideo
    if (!video.requestVideoFrameCallback) {
      if (video.readyState >= 2) draw(video, video.videoWidth, video.videoHeight)
      return
    }
    let handle: number | null = null
    const onFrame = () => {
      draw(video, video.videoWidth, video.videoHeight)
      handle = video.requestVideoFrameCallback!(onFrame)
    }
    handle = video.requestVideoFrameCallback(onFrame)
    return () => { if (handle !== null) video.cancelVideoFrameCallback?.(handle) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element, grade, unavailable])

  // Image: one draw per grade change (and once the file finishes loading) — no continuous clock.
  useEffect(() => {
    if (unavailable || source.kind !== 'image') return
    const image = new Image()
    image.onload = () => draw(image, image.naturalWidth, image.naturalHeight)
    image.src = source.url
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.kind, source.kind === 'image' ? source.url : null, grade, unavailable])

  return <div ref={hostRef} style={{ ...style, position: 'relative', overflow: 'hidden' }}>
    {source.kind === 'image' && <img src={source.url} draggable={false} alt="" style={{ width: '100%', height: '100%', objectFit, display: 'block', opacity: unavailable ? 1 : 0, position: unavailable ? 'static' : 'absolute', inset: 0 }} />}
    <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit, display: 'block', position: 'absolute', inset: 0, opacity: unavailable ? 0 : 1, pointerEvents: 'none' }} />
    {unavailable && <span style={{ position: 'absolute', right: 4, bottom: 4, padding: '2px 6px', borderRadius: 3, fontSize: 10,
      background: '#10101099', color: '#ffda8b', border: '1px solid #ffda8b55' }}>Grade unavailable</span>}
  </div>
}
