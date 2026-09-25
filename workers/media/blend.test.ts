import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BLEND_FFMPEG, captionPipeRate, exportFilterGraphV3, v3Route } from './exportArguments'
import { exportManifestV3Schema, type ManifestClip } from '../../src/export/plan'
import { DEFAULT_CAPTION_STYLE } from '../../src/captions/style'
import { BLEND_MODES, type BlendMode } from '../../src/core/edit'
import { graphicsPasses } from '../../src/core/graphicsPasses'
import { defaultShape } from '../../src/core/shapeCommands'

/**
 * Renders the exact blend chain (`exportFilterGraphV3`) with the project's own FFmpeg build over grids of
 * solid colours, and compares each pixel with the W3C Compositing and Blending formulas that the
 * preview's CSS `mix-blend-mode` implements. A mode FFmpeg cannot match within tolerance must not ship.
 * Skipped when the local FFmpeg build is not present (it is never committed).
 */
const TOOLS = path.join(__dirname, '../../.tools/ffmpeg-win64-lgpl/bin')
const FFMPEG = [path.join(TOOLS, 'ffmpeg.exe'), path.join(TOOLS, 'ffmpeg')].find((candidate) => existsSync(candidate))
const FPS = 30, US = 1_000_000, SIZE = 1080, TILE = 30, LEVELS = [0, 51, 102, 153, 204, 255], N = LEVELS.length

type Rgb = [number, number, number]
const hex = (rgb: Rgb) => `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`

// W3C Compositing and Blending Level 1, separable modes, channels in 0..1. `b` is the backdrop, `s` the source.
const hardLight = (b: number, s: number) => s <= 0.5 ? b * 2 * s : b + (2 * s - 1) - b * (2 * s - 1)
const REFERENCE: Record<Exclude<BlendMode, 'normal'>, (b: number, s: number) => number> = {
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => hardLight(s, b),
  darken: Math.min,
  lighten: Math.max,
  'hard-light': hardLight,
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
}

/** Backdrop and source colour of tile (i, j): every (backdrop, source) level pair occurs in each channel. */
const backdropAt = (i: number, j: number): Rgb => [LEVELS[i], LEVELS[j], LEVELS[(i + j) % N]]
const sourceAt = (i: number, j: number): Rgb => [LEVELS[j], LEVELS[i], LEVELS[(2 * i + j) % N]]

function render(mode: BlendMode, opacity: number): Buffer {
  const tiles = Array.from({ length: N * N }, (_, index) => ({ i: Math.floor(index / N), j: index % N }))
  const clip = (id: string, trackIndex: number, color: Rgb, { i, j }: { i: number; j: number }, extra: Partial<ManifestClip>): ManifestClip => ({
    id, kind: 'color', trackIndex, timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 2 * US, fill: { type: 'solid', color: hex(color) },
    rect: { x: j * TILE, y: i * TILE, width: TILE, height: TILE }, opacity: 1, fit: 'contain', gain: 0, ...extra,
  })
  const clips = [
    ...tiles.map((tile) => clip(`b${tile.i}-${tile.j}`, 0, backdropAt(tile.i, tile.j), tile, {})),
    ...tiles.map((tile) => clip(`s${tile.i}-${tile.j}`, 1, sourceAt(tile.i, tile.j), tile, { blendMode: mode, opacity })),
  ]
  const manifest = exportManifestV3Schema.parse({
    version: 3, cues: [], style: DEFAULT_CAPTION_STYLE, format: { width: SIZE, height: SIZE, frameRate: { numerator: FPS, denominator: 1 } },
    sequenceDurationUs: 2 * US, inputs: [], overlays: [], blurRegions: [], clips,
  })
  expect(v3Route(manifest)).toBe('stacked')
  const graph = exportFilterGraphV3(manifest, []).filterComplex.replace('format=yuv420p[outv]', 'format=rgb24[outv]')
  // The export's caption layer is input 0 here: a transparent stand-in for the pipe.
  const result = spawnSync(FFMPEG!, ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `color=c=black@0:s=${SIZE}x${SIZE}:r=${FPS}:d=2,format=rgba`,
    '-filter_complex', graph, '-map', '[outv]', '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr.toString())
  return result.stdout
}

const CHECKED_MODES = BLEND_MODES.filter((mode): mode is Exclude<BlendMode, 'normal'> => mode !== 'normal')

/** The largest per-channel error (0..255) between the render and the reference over every tile. */
function worstError(mode: Exclude<BlendMode, 'normal'>, opacity: number) {
  const data = render(mode, opacity)
  let worst = 0, at = ''
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const backdrop = backdropAt(i, j), source = sourceAt(i, j)
    const offset = ((i * TILE + TILE / 2) * SIZE + j * TILE + TILE / 2) * 3
    for (let channel = 0; channel < 3; channel++) {
      const b = backdrop[channel] / 255, s = source[channel] / 255
      const expected = ((1 - opacity) * b + opacity * REFERENCE[mode](b, s)) * 255
      const error = Math.abs(data[offset + channel] - expected)
      if (error > worst) { worst = error; at = `tile ${i},${j} channel ${channel}: backdrop ${backdrop[channel]} source ${source[channel]} got ${data[offset + channel]} expected ${expected.toFixed(1)}` }
    }
  }
  return { worst, at }
}

const graphManifest = (blend: Partial<ManifestClip>, rect?: ManifestClip['rect']) => exportManifestV3Schema.parse({
  version: 3, cues: [], style: DEFAULT_CAPTION_STYLE, format: { width: 1280, height: 720, frameRate: { numerator: 25, denominator: 1 } },
  sequenceDurationUs: 10 * US, inputs: [{ path: '/m/a.mp4', kind: 'video' }, { path: '/m/b.mp4', kind: 'video' }], overlays: [], blurRegions: [],
  clips: [
    { id: 'a', inputIndex: 0, assetId: 'a', kind: 'video', trackIndex: 0, timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 10 * US, opacity: 1, fit: 'contain', gain: 1 },
    { id: 'b', inputIndex: 1, assetId: 'b', kind: 'video', trackIndex: 1, timelineStartUs: 2 * US, sourceStartUs: 0, sourceEndUs: 3 * US, opacity: 0.5, fit: 'cover', gain: 0, rect, ...blend },
  ],
})

describe('blend graph', () => {
  it('builds a Multiply picture-in-picture as a full-frame, full-length layer blended onto the picture below', () => {
    const chains = exportFilterGraphV3(graphManifest({ blendMode: 'multiply' }, { x: 800, y: 40, width: 400, height: 225 }), [true, false]).filterComplex.split(';')
    expect(chains.slice(3, 9)).toEqual([
      '[1:v:0]trim=duration=3.000000,setpts=PTS-STARTPTS,fps=fps=25/1:start_time=0,format=rgba,scale=400:225:force_original_aspect_ratio=increase:reset_sar=1,crop=400:225,setsar=1,colorchannelmixer=aa=0.500000,'
        + 'pad=1280:720:800:40:color=black@0,tpad=start_duration=2.000000:start_mode=add:color=black@0,tpad=stop_duration=5.000000:stop_mode=add:color=black@0[c1]',
      '[b0]split[pa1][pb1]',
      '[c1]format=gbrap[ct1]',
      '[pa1]format=gbrap[pt1]',
      '[ct1][pt1]blend=c0_mode=multiply:c1_mode=multiply:c2_mode=multiply:c3_mode=normal:shortest=1[bl1]',
      '[pb1][bl1]overlay=0:0:format=auto[b1]',
    ])
  })

  it('leaves a normal-only stack exactly as before and stacks a blending clip on an otherwise flat timeline', () => {
    const plain = exportFilterGraphV3(graphManifest({}, { x: 800, y: 40, width: 400, height: 225 }), [true, false]).filterComplex
    expect(plain).not.toMatch(/blend|gbrap|split/)
    expect(plain).toContain('[b0][c1]overlay=800:40:format=auto:eof_action=pass:repeatlast=0[b1]')
    const flat = exportManifestV3Schema.parse({ ...graphManifest({}), clips: [{ ...graphManifest({}).clips[0] }], inputs: [{ path: '/m/a.mp4', kind: 'video' }] })
    expect(v3Route(flat)).toBe('flat')
    expect(v3Route({ ...flat, clips: [{ ...flat.clips[0], blendMode: 'screen' }] })).toBe('stacked')
  })

  it('names an FFmpeg mode for every editor mode', () => {
    for (const mode of BLEND_MODES) expect(BLEND_FFMPEG[mode]).toBeTruthy()
  })
})

describe.skipIf(!FFMPEG)('blend modes rendered by FFmpeg match the W3C formulas', { timeout: 60_000 }, () => {
  for (const mode of CHECKED_MODES) {
    it(`${mode} at full opacity`, () => {
      const { worst, at } = worstError(mode, 1)
      expect(worst, at).toBeLessThanOrEqual(2)
    })
  }
  it('overlay at 60% opacity composites over the backdrop', () => {
    const { worst, at } = worstError('overlay', 0.6)
    expect(worst, at).toBeLessThanOrEqual(2)
  })
})

describe.skipIf(!FFMPEG)('shape-blend export passes render real frames (docs/plans/shape-blend/02)', { timeout: 60_000 }, () => {
  const PASS_SIZE = 48
  const pixelAt = (data: Buffer, x: number, y: number): Rgb => {
    const offset = (y * PASS_SIZE + x) * 3
    return [data[offset], data[offset + 1], data[offset + 2]]
  }
  /** A raw BGRA sub-frame: `color` opaque either everywhere or only in the top-left quarter (the
   * "normal band with a colour square"), `null` fully transparent (the "empty band"). */
  function passFrame(color: Rgb | null, quarterOnly: boolean): Buffer {
    const frame = Buffer.alloc(PASS_SIZE * PASS_SIZE * 4)
    if (!color) return frame
    for (let y = 0; y < PASS_SIZE; y++) for (let x = 0; x < PASS_SIZE; x++) {
      if (quarterOnly && (x >= PASS_SIZE / 2 || y >= PASS_SIZE / 2)) continue
      const offset = (y * PASS_SIZE + x) * 4
      frame[offset] = color[2]; frame[offset + 1] = color[1]; frame[offset + 2] = color[0]; frame[offset + 3] = 255
    }
    return frame
  }

  it('pipes 2 output frames x 3 raw passes (a normal band, the blend-shape band, an empty band) over a solid picture', () => {
    const BACKDROP: Rgb = [200, 100, 50], SRC0: Rgb = [30, 200, 10], SRC1: Rgb = [90, 40, 220]
    const shape = { ...defaultShape('box', 'blend-1', 0, 2 * US), layerOrder: 1, blendMode: 'multiply' as const }
    const backdrop: ManifestClip = { id: 'bg', kind: 'color', trackIndex: 0, timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 2 * US,
      fill: { type: 'solid', color: hex(BACKDROP) }, opacity: 1, fit: 'contain', gain: 0 }
    const manifest = exportManifestV3Schema.parse({
      version: 3, cues: [], style: DEFAULT_CAPTION_STYLE, format: { width: PASS_SIZE, height: PASS_SIZE, frameRate: { numerator: 2, denominator: 1 } },
      sequenceDurationUs: 1 * US, inputs: [], overlays: [], blurRegions: [], clips: [backdrop], shapes: [shape],
    })
    expect(graphicsPasses(manifest.shapes).count).toBe(3)
    expect(captionPipeRate(manifest)).toBe('6/1')
    // The export's caption pipe (input 0, since there is no real clip input here) carries K=3
    // BGRA sub-frames per output frame, in pass order: normal band, blend-shape band, empty band.
    const graph = exportFilterGraphV3(manifest, [], undefined, 'raw').filterComplex.replace('format=yuv420p[outv]', 'format=rgb24[outv]')
    const oneOutputFrame = Buffer.concat([passFrame(SRC0, true), passFrame(SRC1, false), passFrame(null, false)])
    const result = spawnSync(FFMPEG!, ['-v', 'error', '-nostdin', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${PASS_SIZE}x${PASS_SIZE}`, '-framerate', captionPipeRate(manifest), '-i', 'pipe:0',
      '-filter_complex', graph, '-map', '[outv]', '-frames:v', '2', '-f', 'rawvideo', '-'],
    { input: Buffer.concat([oneOutputFrame, oneOutputFrame]), maxBuffer: 64 * 1024 * 1024 })
    if (result.status !== 0) throw new Error(result.stderr.toString())
    // Exactly 2 frames produced: the empty (fully transparent) third band never stalls or duplicates the graph.
    expect(result.stdout.length).toBe(2 * PASS_SIZE * PASS_SIZE * 3)
    for (const frameIndex of [0, 1]) {
      const data = result.stdout.subarray(frameIndex * PASS_SIZE * PASS_SIZE * 3, (frameIndex + 1) * PASS_SIZE * PASS_SIZE * 3)
      // Inside the square: the normal band's colour multiplies with the blend shape. Outside it: the backdrop does.
      for (const [x, y, bottom] of [[2, 2, SRC0], [PASS_SIZE - 2, PASS_SIZE - 2, BACKDROP]] as [number, number, Rgb][]) {
        const got = pixelAt(data, x, y)
        for (let channel = 0; channel < 3; channel++) {
          const expected = (bottom[channel] / 255) * (SRC1[channel] / 255) * 255
          expect(Math.abs(got[channel] - expected), `frame ${frameIndex} (${x},${y}) channel ${channel}: got ${got[channel]} expected ${expected.toFixed(1)}`).toBeLessThanOrEqual(2)
        }
      }
    }
  })
})
