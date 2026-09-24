/**
 * Look thumbnails: a small picture of what a bundled look does, for its tile in the Color panel.
 * The real picture is the frame under the playhead (captured by `app/useColorFrame.ts`); with no
 * clip, `sampleScene` stands in — a drawn scene (sky, foliage, skin, neon, deep shadow) chosen so a
 * look's hue pushes, contrast and matte all show. Grading goes through `bakeGrade` + `sampleLut`,
 * the same evaluation and interpolation the preview and export use, on a coarse 17^3 lattice —
 * plenty for a 160px tile, and cheap enough to run for every look without touching the UI thread's
 * frame budget (the caller still spreads it across idle time).
 */

import { bakeGrade, NEUTRAL_GRADE, sampleLut } from './bake'
import type { Cube3D } from './cube'
import type { RGB } from './primaries'
import type { PixelImage } from './referenceMatch'

export const THUMB_WIDTH = 160
export const THUMB_HEIGHT = 90
const LATTICE = 17

const cubes = new Map<string, Cube3D>()

/** The baked lattice of one bundled look at full strength, cached for the session (looks are static). */
export function lookCube(lookId: string): Cube3D {
  let cube = cubes.get(lookId)
  if (!cube) { cube = bakeGrade({ ...NEUTRAL_GRADE, look: { id: lookId, strength: 1 } }, LATTICE); cubes.set(lookId, cube) }
  return cube
}

/** RGBA bytes of `image` through `cube`. Alpha is preserved. */
export function gradePixels(image: PixelImage, cube: Cube3D): Uint8ClampedArray {
  const out = new Uint8ClampedArray(image.width * image.height * 4)
  for (let i = 0; i < out.length; i += 4) {
    const [r, g, b] = sampleLut(cube, [image.data[i] / 255, image.data[i + 1] / 255, image.data[i + 2] / 255])
    out[i] = r * 255; out[i + 1] = g * 255; out[i + 2] = b * 255; out[i + 3] = image.data[i + 3]
  }
  return out
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

function scenePixel(u: number, v: number): RGB {
  if (u < 0.1) return v < 0.5 ? [0.9, 0.2, 0.7] : [0.1, 0.8, 0.9] // neon strips
  const horizon = 0.55
  let color: RGB = v < horizon ? mix([0.3, 0.5, 0.9], [0.8, 0.86, 0.92], v / horizon) : mix([0.3, 0.5, 0.24], [0.1, 0.22, 0.1], (v - horizon) / (1 - horizon))
  const dx = (u - 0.55) / 0.17, dy = (v - 0.5) / 0.3
  if (dx * dx + dy * dy < 1) color = mix([0.92, 0.7, 0.58], [0.5, 0.33, 0.27], Math.min(1, Math.max(0, (dx + 1) / 2))) // skin, lit from the left
  if (v > 0.88) color = mix(color, [0.02, 0.02, 0.03], Math.min(1, (v - 0.88) / 0.08)) // deep shadow band
  return color
}

/** A drawn sample scene, RGBA, gamma-encoded — the no-clip fallback thumbnail source. */
export function sampleScene(width = THUMB_WIDTH, height = THUMB_HEIGHT): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = scenePixel((x + 0.5) / width, (y + 0.5) / height)
    const i = (y * width + x) * 4
    data[i] = r * 255; data[i + 1] = g * 255; data[i + 2] = b * 255; data[i + 3] = 255
  }
  return { data, width, height }
}
