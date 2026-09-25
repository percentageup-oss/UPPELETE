/** How the export host hands each caption-layer frame to FFmpeg. `raw` is the premultiplied BGRA paint
 * bitmap as-is; `png` is the original path, kept as the fallback. Mask images are always PNG. */
export type FrameTransport = 'png' | 'raw'

/**
 * PNG is the default, and `CAPTION_STUDIO_EXPORT_TRANSPORT=raw` opts in to the raw bitmap, mirroring
 * `CAPTION_STUDIO_EXPORT_ENCODER` in `exportEncoderSelect.ts`. Raw is not the default because its
 * composite is not yet within ±1 of the PNG path (docs/STATUS.md, "Export speed 03"): FFmpeg's own
 * un-premultiply renders opaque white as 253 and shifts semi-transparent edges, while it only pays off
 * when most frames are painted (+26 % fps at 67 % painted, −32 % at 7 %, 1080p Windows).
 */
export function selectFrameTransport(env: NodeJS.ProcessEnv = process.env): FrameTransport {
  return env.CAPTION_STUDIO_EXPORT_TRANSPORT === 'raw' ? 'raw' : 'png'
}

/**
 * The label the caption layer is overlaid from. Chromium paint bitmaps are premultiplied, but FFmpeg's
 * `overlay=alpha=premultiplied` blends premultiplied *YUV* without accounting for the limited-range
 * black offset, which measurably shifts semi-transparent caption pixels. Raw frames are therefore
 * un-premultiplied inside the graph (lossless bgra -> gbrap reorder, then `unpremultiply`) and
 * overlaid with the same straight-alpha overlay the PNG path uses.
 */
export function captionLayerLabel(transport: FrameTransport, input: string, chains: string[]): string {
  if (transport === 'png') return input
  chains.push(`${input}format=gbrap,unpremultiply=inplace=1[caption]`)
  return '[caption]'
}

/** The pipe input options for the caption layer (everything before `-i pipe:0`). */
export function captionPipeInputArguments(transport: FrameTransport, rate: string, width: number, height: number): string[] {
  return transport === 'raw'
    ? ['-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${width}x${height}`, '-framerate', rate]
    : ['-f', 'image2pipe', '-framerate', rate, '-c:v', 'png']
}
