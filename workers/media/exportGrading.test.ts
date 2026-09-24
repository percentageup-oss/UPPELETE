import { describe, expect, it } from 'vitest'
import { exportFilterGraphV3 } from './exportArguments'
import { exportManifestV3Schema, type ExportManifestV3, type ManifestClip } from '../../src/export/plan'
import { DEFAULT_CAPTION_STYLE } from '../../src/captions/style'

const US = 1_000_000
const clip = (id: string, inputIndex: number, extra: Partial<ManifestClip> = {}): ManifestClip => ({
  id, inputIndex, assetId: `asset-${inputIndex}`, kind: 'video', trackIndex: 0, timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 2 * US,
  opacity: 1, fit: 'contain', gain: 1, ...extra,
})
const manifest = (clips: ManifestClip[], luts: ExportManifestV3['luts'] = []): ExportManifestV3 => exportManifestV3Schema.parse({
  version: 3, cues: [], style: DEFAULT_CAPTION_STYLE, format: { width: 1280, height: 720, frameRate: { numerator: 25, denominator: 1 } },
  sequenceDurationUs: 2 * US, inputs: [{ path: '/m/a.mp4', kind: 'video' }], clips, overlays: [], blurRegions: [], luts,
})

const LUT = { id: 'lut-1', size: 2, data: 'AAAAAAAAAAA=' }

describe('exportFilterGraphV3: grading', () => {
  it('a clip with no lutId produces exactly the same chain whether or not a lutPaths map is passed', () => {
    const flat = manifest([clip('a', 0)])
    expect(exportFilterGraphV3(flat, [false]).filterComplex).toBe(exportFilterGraphV3(flat, [false], new Map([['lut-1', '/tmp/lut-1.cube']])).filterComplex)
  })

  it('inserts the lut3d chain right after retiming and before the fit scale, on the flat route', () => {
    const graded = manifest([clip('a', 0, { lutId: 'lut-1' })], [LUT])
    const chains = exportFilterGraphV3(graded, [false], new Map([['lut-1', '/tmp/job/lut-1.cube']])).filterComplex.split(';')
    expect(chains[0]).toBe(
      "[0:v:0]trim=duration=2.000000,setpts=PTS-STARTPTS,scale=in_color_matrix=bt709:in_range=tv,format=gbrp16le,lut3d=file='/tmp/job/lut-1.cube':interp=trilinear,"
      + 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v0]',
    )
  })

  it('inserts the lut3d chain right after retiming and before the rgba conversion, on the stacked route', () => {
    const graded = manifest([clip('a', 0, { lutId: 'lut-1', opacity: 0.5 })], [LUT])
    const chains = exportFilterGraphV3(graded, [false], new Map([['lut-1', '/tmp/job/lut-1.cube']])).filterComplex.split(';')
    const clipChain = chains.find((chain) => chain.startsWith('[0:v:0]'))!
    expect(clipChain).toBe(
      "[0:v:0]trim=duration=2.000000,setpts=PTS-STARTPTS,scale=in_color_matrix=bt709:in_range=tv,format=gbrp16le,lut3d=file='/tmp/job/lut-1.cube':interp=trilinear,"
      + 'fps=fps=25/1:start_time=0,format=rgba,scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,'
      + 'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,colorchannelmixer=aa=0.500000[c0]',
    )
  })

  it('a lutId with no matching path (should not happen once export.ts writes every lut) degrades to no grading rather than a broken filter', () => {
    const graded = manifest([clip('a', 0, { lutId: 'lut-1' })], [LUT])
    const chains = exportFilterGraphV3(graded, [false], new Map()).filterComplex.split(';')
    expect(chains[0]).not.toContain('lut3d')
  })

  it('quotes a path with a single quote and a backslash (a Windows temp dir under a display name) safely', () => {
    const graded = manifest([clip('a', 0, { lutId: 'lut-1' })], [LUT])
    const winPath = String.raw`C:\Users\O'Brien\AppData\Local\Temp\job\lut-1.cube`
    const chain = exportFilterGraphV3(graded, [false], new Map([['lut-1', winPath]])).filterComplex.split(';')[0]
    expect(chain).toContain(String.raw`lut3d=file='C:\\Users\\O'\''Brien\\AppData\\Local\\Temp\\job\\lut-1.cube':interp=trilinear`)
  })
})
