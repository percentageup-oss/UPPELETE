import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportFilterGraphV3 } from './exportArguments'
import { exportManifestV3Schema, type ManifestClip } from '../../src/export/plan'
import { DEFAULT_CAPTION_STYLE } from '../../src/captions/style'
import { easedPhase, gradientLine, paintAt } from '../../src/core/fill'
import { flatGridCoverage, flatGridMetrics, flatScrollPx, perspectiveConvergingAlpha, perspectiveGeometry, perspectiveRowAlpha } from '../../src/core/gridFill'
import type { ColorClip, Fill } from '../../src/core/edit'

/** Renders background filter graphs with the project's own FFmpeg build and checks pixels against the
 * shared math (`src/core/fill.ts`) — the same numbers the preview paints. Skipped when the local
 * FFmpeg build is not present (it is never committed). */
const FFMPEG = path.join(__dirname, '../../.tools/ffmpeg-9.0.1/ffmpeg')
const FPS = 30, US = 1_000_000

function render(clip: Partial<ManifestClip>, frames: number, W = 200, H = 100): Buffer {
  const manifest = exportManifestV3Schema.parse({
    version: 3, cues: [], style: DEFAULT_CAPTION_STYLE, format: { width: W, height: H, frameRate: { numerator: FPS, denominator: 1 } },
    sequenceDurationUs: 4 * US, inputs: [], overlays: [], blurRegions: [],
    clips: [{ id: 'bg', kind: 'color', trackIndex: 0, timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 4 * US, opacity: 1, fit: 'contain', gain: 0, ...clip }],
  })
  // The export's caption layer is input 0 here: a transparent stand-in for the pipe.
  const graph = exportFilterGraphV3(manifest, []).filterComplex.replace('format=yuv420p[outv]', 'format=rgb24[outv]')
  const result = spawnSync(FFMPEG, ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `color=c=black@0:s=${W}x${H}:r=${FPS}:d=4,format=rgba`,
    '-filter_complex', graph, '-map', '[outv]', '-frames:v', String(frames), '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr.toString())
  return result.stdout
}
const pixel = (data: Buffer, frame: number, x: number, y: number, W = 200, H = 100) => { const o = ((frame * H + y) * W + x) * 3; return [data[o], data[o + 1], data[o + 2]] }
const near = (actual: number[], expected: number[], tolerance = 2) => actual.forEach((value, index) => expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(tolerance))

describe.skipIf(!existsSync(FFMPEG))('background clips rendered by FFmpeg', () => {
  it('paints a solid exactly', () => {
    near(pixel(render({ fill: { type: 'solid', color: '#ff8000' } }, 2), 1, 17, 63), [255, 128, 0], 1)
  })

  it('paints a gradient along the same line the preview uses', () => {
    const fill = { type: 'gradient' as const, from: '#102030', to: '#f0e0d0', angle: 135 }
    const data = render({ fill }, 1)
    const { ax, ay, c } = gradientLine(135, 200, 100)
    for (const [x, y] of [[0, 0], [50, 20], [100, 50], [170, 90], [199, 99]]) {
      const t = Math.max(0, Math.min(1, ax * (x + 0.5) + ay * (y + 0.5) + c))
      near(pixel(data, 0, x, y), [0x10, 0x20, 0x30].map((from, index) => Math.round(from + ([0xf0, 0xe0, 0xd0][index] - from) * t)))
    }
  })

  it('shifts between two fills by the eased phase', () => {
    const data = render({ fill: { type: 'solid', color: '#ff0000' }, motion: { type: 'shift', to: { type: 'solid', color: '#0000ff' }, periodUs: 4 * US } }, 90)
    for (const frame of [0, 15, 30, 60, 89]) {
      const k = easedPhase(4 * US, (frame / FPS) * US)
      near(pixel(data, frame, 10, 10), [Math.round(255 * (1 - k)), 0, Math.round(255 * k)])
    }
  })

  it('pulses toward black by depth × phase', () => {
    const data = render({ fill: { type: 'solid', color: '#ff0000' }, motion: { type: 'pulse', toward: 'black', depth: 0.5, periodUs: 4 * US } }, 61)
    for (const frame of [0, 30, 60]) near(pixel(data, frame, 3, 3), [Math.round(255 * (1 - 0.5 * easedPhase(4 * US, (frame / FPS) * US))), 0, 0])
  })

  it('drifts a gradient so the pan matches the preview offsets', () => {
    const data = render({ fill: { type: 'gradient', from: '#000000', to: '#ffffff', angle: 90 }, motion: { type: 'drift', direction: 90, periodUs: 4 * US } }, 61)
    // Oversized 1.5× gradient, crop window at (iw-ow)/2 − ow·0.25·p with p = −cos(2πt/T), direction 90° (→ +x).
    for (const frame of [0, 30, 60]) {
      const p = -Math.cos(2 * Math.PI * (frame / FPS) / 4)
      const cropX = (200 * 1.5 - 200) / 2 - 200 * 0.25 * p
      for (const x of [0, 100, 199]) near(pixel(data, frame, x, 50), Array(3).fill(Math.round(255 * ((cropX + x + 0.5) / (200 * 1.5)))), 3)
    }
  })

  it('blends large frames at reduced size (for speed) with the same result to within a few levels', () => {
    const [w, h] = [640, 480]
    const data = render({ fill: { type: 'gradient', from: '#000000', to: '#ffffff', angle: 135 },
      motion: { type: 'shift', to: { type: 'solid', color: '#ff0000' }, periodUs: 4 * US } }, 61, w, h)
    const { ax, ay, c } = gradientLine(135, w, h)
    for (const frame of [0, 30, 60]) {
      const k = easedPhase(4 * US, (frame / FPS) * US)
      for (const [x, y] of [[0, 0], [320, 240], [639, 479], [100, 400]]) {
        const t = Math.max(0, Math.min(1, ax * (x + 0.5) + ay * (y + 0.5) + c))
        const base = 255 * t
        near(pixel(data, frame, x, y, w, h), [base * (1 - k) + 255 * k, base * (1 - k), base * (1 - k)].map(Math.round), 4)
      }
    }
  })

  describe('grid backgrounds', () => {
    type Grid = Extract<Fill, { type: 'grid' }>
    const W = 216, H = 384, SCALE = W / 1080 // a 1080-wide composition exported at 216 px
    const grid = (extra: Partial<Grid> = {}): Grid => ({ type: 'grid', pattern: 'lines', background: '#102040', line: '#f0c060', cell: 240, thickness: 10, ...extra })
    const bytes = (color: string) => [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16))
    const mix = (fill: Grid, coverage: number) => bytes(fill.background).map((low, index) => Math.round(low + (bytes(fill.line)[index] - low) * coverage))
    const frameClip = (fill: Grid, motion?: ColorClip['motion']) => ({ fill, ...(motion ? { motion } : {}) })
    const sample = (fill: Grid, frames: number, motion?: ColorClip['motion']) => render(frameClip(fill, motion), frames, W, H)
    const expectedFlat = (fill: Grid, frame: number, x: number, y: number, motion?: ColorClip['motion']) => {
      const metrics = flatGridMetrics(fill, SCALE)
      const scroll = motion ? paintAt({ kind: 'color', id: 'bg', trackId: 'V1', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 4 * US, opacity: 1, fit: 'contain', fill, motion }, (frame / FPS) * US).scroll : null
      const offset = flatScrollPx(scroll, metrics.cell)
      const u = ((x - offset.x) % metrics.cell + metrics.cell) % metrics.cell, v = ((y - offset.y) % metrics.cell + metrics.cell) % metrics.cell
      return mix(fill, flatGridCoverage(fill.pattern as 'lines' | 'dots', metrics, u, v))
    }
    const everyPixel = (check: (x: number, y: number) => void) => { for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) check(x, y) }

    it('draws flat lines on exactly the pixels the preview math says', () => {
      const fill = grid()
      const data = sample(fill, 1)
      everyPixel((x, y) => near(pixel(data, 0, x, y, W, H), expectedFlat(fill, 0, x, y), 1))
    })

    it('draws dots with the same soft rim as the preview', () => {
      const fill = grid({ pattern: 'dots', cell: 60, thickness: 40 })
      const data = sample(fill, 1)
      everyPixel((x, y) => near(pixel(data, 0, x, y, W, H), expectedFlat(fill, 0, x, y), 2))
    })

    it('scrolls a flat grid by whole pixels, frame by frame, with no seam', () => {
      const fill = grid()
      const motion = { type: 'scroll' as const, direction: 135, periodUs: 1_500_000 }
      const data = sample(fill, 91, motion)
      for (const frame of [0, 7, 30, 44, 90]) everyPixel((x, y) => near(pixel(data, frame, x, y, W, H), expectedFlat(fill, frame, x, y, motion), 1))
    })

    it('scrolls a straight-across grid without creeping vertically', () => {
      const fill = grid({ cell: 200, thickness: 20 })
      const motion = { type: 'scroll' as const, direction: 90, periodUs: 250_000 }
      const data = sample(fill, 91, motion)
      // 90° is exactly horizontal: the horizontal lines never move, however long it runs.
      for (const frame of [0, 45, 90]) for (const x of [5, 100]) near(pixel(data, frame, x, 1, W, H), mix(fill, 1), 1)
    })

    const floor = (extra: Partial<Grid> = {}) => grid({ pattern: 'perspective', background: '#160a2e', line: '#ff3ea5', cell: 300, thickness: 12, ...extra })
    const floorAlpha = (fill: Grid, frame: number, x: number, y: number, phaseRate: number) => {
      const geometry = perspectiveGeometry(fill, W, H, SCALE)
      const a = perspectiveConvergingAlpha(geometry, x, y), b = perspectiveRowAlpha(geometry, y, phaseRate * (frame / FPS))
      return 1 - (1 - a) * (1 - b)
    }

    it('draws the perspective floor from the shared analytic model', () => {
      const fill = floor()
      const data = sample(fill, 1)
      let worst = 0
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
        const expected = mix(fill, floorAlpha(fill, 0, x, y, 0))
        worst = Math.max(worst, ...pixel(data, 0, x, y, W, H).map((value, index) => Math.abs(value - expected[index])))
      }
      // Two 8-bit alpha layers composited in sequence differ from the exact product by a few levels.
      expect(worst).toBeLessThanOrEqual(6)
    })

    it('scrolls the floor toward the viewer by the vertical part of the direction', () => {
      const fill = floor()
      const motion = { type: 'scroll' as const, direction: 180, periodUs: 2 * US }
      const data = sample(fill, 61, motion)
      let worst = 0
      for (const frame of [0, 12, 30, 60]) for (let y = 160; y < H; y += 2) for (const x of [10, 108, 200]) {
        const expected = mix(fill, floorAlpha(fill, frame, x, y, 1 / 2))
        worst = Math.max(worst, ...pixel(data, frame, x, y, W, H).map((value, index) => Math.abs(value - expected[index])))
      }
      expect(worst).toBeLessThanOrEqual(6)
    })

    it('shifts one grid to another by the eased phase, at full size', () => {
      const from = grid(), to = grid({ background: '#301040', line: '#40e0a0' })
      const data = render({ fill: from, motion: { type: 'shift', to, periodUs: 4 * US } }, 61, W, H)
      for (const frame of [0, 30, 60]) {
        const k = easedPhase(4 * US, (frame / FPS) * US)
        for (const [x, y] of [[3, 3], [100, 200], [150, 5]]) {
          const a = expectedFlat(from, 0, x, y), b = expectedFlat(to, 0, x, y)
          near(pixel(data, frame, x, y, W, H), a.map((value, index) => Math.round(value * (1 - k) + b[index] * k)), 2)
        }
      }
    })
  })
})
