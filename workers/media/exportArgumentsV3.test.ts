import { describe, expect, it } from 'vitest'
import { captionPipeRate, exportArgumentsV3, exportFilterGraphV3, maskTargets, v3Route } from './exportArguments'
import { exportManifestV3Schema, type ExportManifestV3, type ManifestClip } from '../../src/export/plan'
import { DEFAULT_CAPTION_STYLE } from '../../src/captions/style'
import { defaultShape } from '../../src/core/shapeCommands'
import type { Shape } from '../../src/core/edit'

const US = 1_000_000
const clip = (id: string, inputIndex: number, extra: Partial<ManifestClip> = {}): ManifestClip => ({
  id, inputIndex, assetId: `asset-${inputIndex}`, kind: 'video', trackIndex: 0, timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 2 * US,
  opacity: 1, fit: 'contain', gain: 1, ...extra,
})
const manifest = (clips: ManifestClip[], inputs: ExportManifestV3['inputs'], sequenceDurationUs: number): ExportManifestV3 => exportManifestV3Schema.parse({
  version: 3, cues: [], style: DEFAULT_CAPTION_STYLE, format: { width: 1280, height: 720, frameRate: { numerator: 25, denominator: 1 } },
  sequenceDurationUs, inputs, clips, overlays: [], blurRegions: [],
})

/** Two different videos back to back on one track: the most wanted case. */
const backToBack = manifest(
  [clip('a', 0, { sourceStartUs: 1 * US, sourceEndUs: 4 * US }), clip('b', 1, { timelineStartUs: 3 * US, sourceStartUs: 0, sourceEndUs: 2 * US })],
  [{ path: '/m/a.mp4', kind: 'video' }, { path: '/m/b.mov', kind: 'video' }], 5 * US,
)
/** A gap, a picture-in-picture on V2 and an image under nothing: every stacked feature at once. */
const stacked = manifest([
  clip('a', 0, { sourceEndUs: 3 * US }),
  clip('b', 1, { timelineStartUs: 5 * US, sourceEndUs: 2 * US }),
  clip('pip', 2, { trackIndex: 1, timelineStartUs: 6 * US, sourceStartUs: 1 * US, sourceEndUs: 3 * US, rect: { x: 800, y: 40, width: 400, height: 225 }, opacity: 0.5, gain: 0.5 }),
  clip('logo', 3, { kind: 'image', trackIndex: 0, timelineStartUs: 8 * US, sourceEndUs: 1 * US, rect: { x: 100, y: 100, width: 200, height: 200 }, fit: 'stretch', gain: 0 }),
  clip('bed', 4, { kind: 'audio', trackIndex: 3, timelineStartUs: 0, sourceEndUs: 4 * US, gain: 0.8 }),
], [{ path: '/m/a.mp4', kind: 'video' }, { path: '/m/b.mp4', kind: 'video' }, { path: '/m/a.mp4', kind: 'video' }, { path: '/m/logo.png', kind: 'image' }, { path: '/m/bed.wav', kind: 'audio' }], 10 * US)

describe('manifest v3 routes', () => {
  it('concats a gapless single-track sequence and stacks everything else', () => {
    expect(v3Route(backToBack)).toBe('flat')
    expect(v3Route(stacked)).toBe('stacked')
    expect(v3Route({ ...backToBack, sequenceDurationUs: 6 * US })).toBe('stacked')
    expect(v3Route({ ...backToBack, clips: [backToBack.clips[0], { ...backToBack.clips[1], timelineStartUs: 4 * US }] })).toBe('stacked')
  })

  it('opens every clip as its own input at its source range, so no decoder is shared', () => {
    const args = exportArgumentsV3(stacked, '/out/x.mp4.tmp', [true, true, true, false, true])
    const inputs = args.slice(args.indexOf('0.25') + 1, args.indexOf('-thread_queue_size'))
    expect(inputs).toEqual([
      '-ss', '0.000000', '-t', '3.000000', '-autorotate', '-i', '/m/a.mp4',
      '-ss', '0.000000', '-t', '2.000000', '-autorotate', '-i', '/m/b.mp4',
      '-ss', '1.000000', '-t', '2.000000', '-autorotate', '-i', '/m/a.mp4',
      '-loop', '1', '-framerate', '25/1', '-t', '1.000000', '-i', '/m/logo.png',
      '-ss', '0.000000', '-t', '4.000000', '-i', '/m/bed.wav',
    ])
    // The caption/overlay layer comes last, after every clip input.
    expect(args.slice(args.indexOf('-thread_queue_size'), args.indexOf('pipe:0') + 1)).toEqual(['-thread_queue_size', '8', '-f', 'image2pipe', '-framerate', '25/1', '-c:v', 'png', '-i', 'pipe:0'])
    expect(args.slice(args.indexOf('-frames:v'), args.indexOf('-frames:v') + 4)).toEqual(['-frames:v', '250', '-t', '10.000000'])
    expect(args.at(-1)).toBe('/out/x.mp4.tmp')
  })

  it('builds the flat route as normalise-then-concat with one CFR conversion, exactly', () => {
    const graph = exportFilterGraphV3(backToBack, [true, false])
    expect(graph.filterComplex.split(';')).toEqual([
      '[0:v:0]trim=duration=3.000000,setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v0]',
      '[1:v:0]trim=duration=2.000000,setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v1]',
      '[v0][v1]concat=n=2:v=1:a=0,fps=fps=25/1:start_time=0[v]',
      '[v][2:v:0]overlay=0:0:alpha=straight:format=auto:eof_action=endall:shortest=1,format=yuv420p[outv]',
      'anullsrc=r=48000:cl=stereo,atrim=duration=5.000000,aformat=sample_fmts=fltp:channel_layouts=stereo[abase]',
      // Only the first video has sound; the second is silence under the mix, not a missing stream.
      '[0:a:0]atrim=duration=3.000000,asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=delays=0S:all=1,volume=1.000000[s0]',
      '[abase][s0]amix=inputs=2:normalize=0:duration=first[outa]',
    ])
    expect(graph.hasAudioOut).toBe(true)
  })

  it('builds the stacked route on a black canvas: back to front, transparent letterbox, tpad before and pass after', () => {
    const chains = exportFilterGraphV3(stacked, [true, true, true, false, true]).filterComplex.split(';')
    expect(chains[0]).toBe('color=c=black:s=1280x720:r=25/1:d=10.000000,format=rgba[base]')
    // V1's clips before V2's; the image shares V1's index but starts later.
    expect(chains.filter((chain) => chain.includes('overlay=') && !chain.includes('[5:v:0]')).map((chain) => chain.slice(0, chain.indexOf('overlay')))).toEqual(['[base][c0]', '[b0][c1]', '[b1][c2]', '[b2][c3]'])
    expect(chains[1]).toBe('[0:v:0]trim=duration=3.000000,setpts=PTS-STARTPTS,fps=fps=25/1:start_time=0,format=rgba,scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1[c0]')
    expect(chains[3]).toContain(',tpad=start_duration=5.000000:start_mode=add:color=black@0[c1]')
    expect(chains[2]).toBe('[base][c0]overlay=0:0:format=auto:eof_action=pass:repeatlast=0[b0]')
    expect(chains[4]).toBe('[b0][c1]overlay=0:0:format=auto:eof_action=pass:repeatlast=0[b1]')
    // The image (V1, later) paints before the picture-in-picture (V2).
    const image = chains.find((chain) => chain.startsWith('[3:v:0]'))!
    expect(image).toContain('scale=200:200:reset_sar=1')
    expect(image.endsWith('[c2]')).toBe(true)
    expect(chains).toContain('[b1][c2]overlay=100:100:format=auto:eof_action=pass:repeatlast=0[b2]')
    expect(chains).toContain('[b2][c3]overlay=800:40:format=auto:eof_action=pass:repeatlast=0[b3]')
    const pip = chains.find((chain) => chain.startsWith('[2:v:0]'))!
    expect(pip).toContain('scale=400:225:force_original_aspect_ratio=decrease')
    expect(pip).toContain(',colorchannelmixer=aa=0.500000,tpad=start_duration=6.000000')
    expect(chains).toContain('[b3][5:v:0]overlay=0:0:alpha=straight:format=auto:eof_action=endall:shortest=1,format=yuv420p[outv]')
  })

  it('mixes each clip’s own sound at its position and gain, skipping silent, muted and image inputs', () => {
    const chains = exportFilterGraphV3(stacked, [true, false, true, false, true]).filterComplex.split(';')
    const sounds = chains.filter((chain) => /^\[\d+:a:0\]/.test(chain))
    expect(sounds.map((chain) => chain.slice(0, chain.indexOf(']') + 1))).toEqual(['[0:a:0]', '[2:a:0]', '[4:a:0]'])
    expect(sounds[1]).toContain('adelay=delays=288000S:all=1,volume=0.500000')
    expect(chains.at(-1)).toBe('[abase][s0][s1][s2]amix=inputs=4:normalize=0:duration=first[outa]')
    expect(exportFilterGraphV3(stacked, [false, false, false, false, false]).hasAudioOut).toBe(false)
  })

  it('blurs before the zoom crop on the flat route, converting to rgba only when a region is present (V4)', () => {
    const region = { id: 'b', sequence: { startUs: 0, endUs: US }, rect: { x: 0, y: 0, width: 10, height: 10 }, sigmaPx: 4 }
    const graph = exportFilterGraphV3({ ...backToBack, blurRegions: [region] }, [true, true]).filterComplex
    expect(graph).toContain(',format=rgba[vraw]')
    expect(graph).toContain('[vraw]split=2[bl0src][bl0copy]')
    expect(graph).toContain('[bl0copy]crop=w=10:h=10:x=0:y=0:exact=1,gblur=sigma=4.000000:steps=2[bl0blur]')
    expect(graph).toContain("[bl0src][bl0blur]overlay=x=0:y=0:format=auto:enable='between(t,0.000000,1.000000)'[blout0]")
    expect(graph.indexOf('[bl0src]')).toBeLessThan(graph.indexOf('overlay=0:0:alpha=straight'))
    // Blur-free flat exports keep the original `[v]` label and never gain a format=rgba step.
    const plain = exportFilterGraphV3(backToBack, [true, true]).filterComplex
    expect(plain).not.toContain('format=rgba')
    expect(plain).toContain('fps=fps=25/1:start_time=0[v]')
  })

  it('chains lutrgb/gblur/screen-blend per glow region after zoom, and leaves glow-free graphs unchanged', () => {
    const glow = { id: 'g', kind: 'glow' as const, sequence: { startUs: US, endUs: 3 * US }, sigmaPx: 24, amount: 0.5, threshold: 0.6 }
    const plain = exportFilterGraphV3(backToBack, [true, true]).filterComplex
    expect(exportFilterGraphV3({ ...backToBack, pictureEffects: [] }, [true, true]).filterComplex).toBe(plain)
    const graph = exportFilterGraphV3({ ...backToBack, pictureEffects: [glow] }, [true, true]).filterComplex
    const lut = 'clip((val-153)*255/102,0,255)'
    expect(graph).toContain(`[gl0copy]lutrgb=r='${lut}':g='${lut}':b='${lut}',gblur=sigma=24.000000:steps=2[gl0bloom]`)
    expect(graph).toContain("[gl0src][gl0bloom]blend=all_mode=screen:all_opacity=0.500000:enable='between(t,1.000000,3.000000)'[glout0]")
    expect(graph.indexOf('[glout0]')).toBeLessThan(graph.indexOf('overlay=0:0:alpha=straight'))
    const two = exportFilterGraphV3({ ...backToBack, pictureEffects: [glow, { ...glow, id: 'h', sequence: { startUs: 4 * US, endUs: 5 * US } }] }, [true, true]).filterComplex
    expect(two).toContain('[glout0]format=rgba,split=2[gl1src][gl1copy]')
  })

  it('emits a whole-region lerp for a pan (no ease branches), and leaves a plain zoom graph unchanged', () => {
    const rect = { x: 320, y: 90, width: 640, height: 360 }
    const plainZoom = { id: 'z', sequence: { startUs: US, endUs: 3 * US }, rect, easeInUs: 0, easeOutUs: 0 }
    const pan = { ...plainZoom, fromRect: { x: 0, y: 0, width: 1280, height: 720 } }
    const zoomGraph = exportFilterGraphV3({ ...backToBack, zoomRegions: [plainZoom] }, [true, true]).filterComplex
    const panGraph = exportFilterGraphV3({ ...backToBack, zoomRegions: [pan] }, [true, true]).filterComplex
    expect(panGraph).toContain('scale=w=')
    expect(panGraph).toContain('(t-1.000000)/2.000000')
    expect(panGraph).not.toBe(zoomGraph)
    // Removing `fromRect` returns to byte-identical plain-zoom output.
    expect(exportFilterGraphV3({ ...backToBack, zoomRegions: [{ ...pan, fromRect: undefined }] }, [true, true]).filterComplex).toBe(zoomGraph)
  })

  it('blurs the already-rgba stacked canvas with no extra format conversion (V4)', () => {
    const region = { id: 'b', sequence: { startUs: 0, endUs: 4 * US }, rect: { x: 0, y: 0, width: 20, height: 20 }, sigmaPx: 6 }
    const plain = exportFilterGraphV3(stacked, [true, false, true, false, true]).filterComplex
    const graph = exportFilterGraphV3({ ...stacked, blurRegions: [region] }, [true, false, true, false, true]).filterComplex
    expect(graph).toContain('[bl0copy]crop=w=20:h=20:x=0:y=0:exact=1,gblur=sigma=6.000000:steps=2[bl0blur]')
    // The stacked canvas and every clip on it are already rgba, so blur adds no format=rgba of its own.
    const countRgba = (text: string) => text.split(';').filter((chain) => chain.includes('format=rgba')).length
    expect(countRgba(graph)).toBe(countRgba(plain))
  })
})

describe('layer masks in the FFmpeg graph', () => {
  const mask = { enabled: true, invert: false, feather: 4, density: 1, shape: { kind: 'ellipse' as const, rect: { x: 100, y: 50, width: 300, height: 200 } } }
  const masked = exportManifestV3Schema.parse({
    ...stacked, blurRegions: [{ id: 'blur', sequence: { startUs: 0, endUs: 2 * US }, rect: { x: 10, y: 20, width: 300, height: 200 }, sigmaPx: 8, mask }],
    clips: stacked.clips.map((entry) => entry.id === 'pip' ? { ...entry, mask } : entry),
  })

  it('leaves a mask-free graph and its arguments untouched', () => {
    expect(maskTargets(stacked)).toEqual([])
    expect(exportFilterGraphV3(stacked, [true, true, true, false, true]).filterComplex).not.toContain('alphamerge')
  })

  it('multiplies the fitted clip and the blurred crop by the rasterized mask, after the caption pipe', () => {
    const targets = maskTargets(masked)
    expect(targets.map((target) => [target.kind, target.id, target.lengthUs])).toEqual([['clip', 'pip', 2 * US], ['blur', 'blur', 10 * US]])
    const graph = exportFilterGraphV3(masked, [true, true, true, false, true]).filterComplex
    // Inputs 0-4 are clips, 5 is the pipe, 6 and 7 are the mask images.
    expect(graph).toContain('[6:v:0]format=rgba,alphaextract,crop=w=400:h=225:x=800:y=40:exact=1[cm3k]')
    expect(graph).toContain('[cm3a][cm3k]blend=all_mode=multiply:shortest=1[cm3m]')
    expect(graph).toContain('[cm30][cm3m]alphamerge[cx3]')
    expect(graph).toContain('[7:v:0]format=rgba,alphaextract,crop=w=300:h=200:x=10:y=20:exact=1[bl0mk]')
    expect(graph).toMatch(/\[bl0blur\]overlay=x=10:y=20/)
    const args = exportArgumentsV3(masked, '/out/x.mp4.tmp', [true, true, true, false, true], undefined, undefined, ['/tmp/m0.png', '/tmp/m1.png'])
    expect(args.slice(args.indexOf('pipe:0') + 1, args.indexOf('pipe:0') + 17)).toEqual([
      '-loop', '1', '-framerate', '25/1', '-t', '2.000000', '-i', '/tmp/m0.png',
      '-loop', '1', '-framerate', '25/1', '-t', '10.000000', '-i', '/tmp/m1.png',
    ])
    expect(() => exportArgumentsV3(masked, '/out/x.mp4.tmp', [true, true, true, false, true])).toThrow('rasterized mask')
  })

  it('never takes the concat route for a masked clip', () => {
    expect(v3Route(exportManifestV3Schema.parse({ ...backToBack, clips: backToBack.clips.map((entry) => ({ ...entry, mask })) }))).toBe('stacked')
  })
})


describe('background (color) clips', () => {
  const color = (id: string, extra: Partial<ManifestClip> = {}): ManifestClip => ({
    id, kind: 'color', trackIndex: 0, timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 4 * US, opacity: 1, fit: 'contain', gain: 0,
    fill: { type: 'solid', color: '#ff8000' }, ...extra,
  })
  const graphOf = (clips: ManifestClip[], inputs: ExportManifestV3['inputs'] = []) => exportFilterGraphV3(manifest(clips, inputs, 4 * US), inputs.map(() => false)).filterComplex

  it('always takes the stacked route, and opens no input for a background', () => {
    const only = manifest([color('bg')], [], 4 * US)
    expect(v3Route(only)).toBe('stacked')
    const args = exportArgumentsV3(only, '/out/x.mp4.tmp', [])
    expect(args.filter((arg) => arg === '-i')).toEqual(['-i'])
    expect(args[args.indexOf('-i') + 1]).toBe('pipe:0')
  })

  it('synthesises a solid with FFmpeg’s color source at exactly the frame size', () => {
    expect(graphOf([color('bg')])).toContain('color=c=0xff8000:s=1280x720:r=25/1:d=4.000000,format=rgba[k0]')
  })

  it('draws a gradient once with geq along the CSS gradient line, then loops the frame', () => {
    const graph = graphOf([color('bg', { fill: { type: 'gradient', from: '#ff0000', to: '#0000ff', angle: 90 } })])
    expect(graph).toContain('trim=end_frame=1,format=gbrp,geq=r=')
    expect(graph).toContain('loop=loop=-1:size=1:start=0,setpts=N/(25/1)/TB,trim=duration=4.000000[k0]')
    // 90° across a 1280-wide frame: t advances 1/1280 per pixel.
    expect(graph).toContain('(0.0007812500)*(X+0.5)')
    expect(graph).not.toContain('gradients=')
  })

  it('places a picture-in-picture background at its rect and sizes the source to it', () => {
    const graph = graphOf([color('bg', { rect: { x: 100, y: 50, width: 640, height: 360 } })])
    expect(graph).toContain('s=640x360')
    expect(graph).toContain('overlay=100:50:')
  })

  it('shift and pulse blend two stills by the shared eased phase', () => {
    const shift = graphOf([color('bg', { motion: { type: 'shift', to: { type: 'solid', color: '#0000ff' }, periodUs: 4 * US }, sourceStartUs: 1 * US, sourceEndUs: 5 * US })])
    expect(shift).toContain('[k0a][k0b]blend=all_expr=')
    expect(shift).toContain('cos(2*PI*(T+1.000000)/4.000000)')
    expect(shift).toContain('color=c=0x0000ff')
    const pulse = graphOf([color('bg', { motion: { type: 'pulse', toward: 'white', depth: 0.5, periodUs: 4 * US } })])
    expect(pulse).toContain('color=c=0xffffff')
    expect(pulse).toContain('0.500000*(0.5-0.5*cos(')
  })

  it('drift pans an oversized gradient with crop, and does nothing to a solid', () => {
    const drift = graphOf([color('bg', { fill: { type: 'gradient', from: '#000000', to: '#ffffff', angle: 0 }, motion: { type: 'drift', direction: 90, periodUs: 4 * US } })])
    expect(drift).toContain('s=1920x1080')
    expect(drift).toContain('[k0o]crop=1280:720:x=')
    const solidDrift = graphOf([color('bg', { motion: { type: 'drift', direction: 90, periodUs: 4 * US } })])
    expect(solidDrift).not.toContain('crop=')
  })

  it('stacks under video by track order and keeps the video’s input index', () => {
    const graph = graphOf([color('bg'), clip('v', 0, { trackIndex: 1, sourceEndUs: 4 * US })], [{ path: '/m/a.mp4', kind: 'video' }])
    expect(graph.indexOf('[k0]')).toBeLessThan(graph.indexOf('[0:v:0]trim'))
    expect(graph).toContain('[b0][c1]overlay')
  })
})

describe('manifest v3 raw transport', () => {
  it('feeds premultiplied BGRA after the clip inputs and un-premultiplies it on both routes', () => {
    const png = exportArgumentsV3(stacked, '/out/x.mp4.tmp', [true, true, true, false, true])
    const raw = exportArgumentsV3(stacked, '/out/x.mp4.tmp', [true, true, true, false, true], undefined, undefined, [], undefined, undefined, 'raw')
    expect(raw.slice(raw.indexOf('-thread_queue_size'), raw.indexOf('pipe:0') + 1)).toEqual(['-thread_queue_size', '8', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', '1280x720', '-framerate', '25/1', '-i', 'pipe:0'])
    expect(raw[raw.indexOf('-filter_complex') + 1]).toBe(png[png.indexOf('-filter_complex') + 1].replace('[b3][5:v:0]overlay=', '[5:v:0]format=gbrap,unpremultiply=inplace=1[caption];[b3][caption]overlay='))
    for (const route of [backToBack, stacked]) {
      const raw = exportFilterGraphV3(route, [true, true, true, false, true], undefined, 'raw').filterComplex
      expect(raw).toContain('format=gbrap,unpremultiply=inplace=1[caption];')
      expect(raw).toContain('[caption]overlay=0:0:alpha=straight:')
      expect(exportFilterGraphV3(route, [true, true, true, false, true]).filterComplex).not.toContain('unpremultiply')
    }
  })
})

describe('shape-blend export passes (docs/plans/shape-blend/02-export-passes.md)', () => {
  const blending: Shape = { ...defaultShape('box', 'blend-1', 0, 2 * US), layerOrder: 1, blendMode: 'multiply' }
  const withShape = (route: ExportManifestV3): ExportManifestV3 => ({ ...route, shapes: [blending] })

  it('leaves a shape-free (or blend-free) manifest byte-identical: no split, select or blend chain', () => {
    for (const route of [backToBack, stacked]) {
      const graph = exportFilterGraphV3(route, [true, true, true, false, true]).filterComplex
      expect(graph).not.toMatch(/split|select=|blendChains|blend=c0_mode/)
      const normalShape: ExportManifestV3 = { ...route, shapes: [{ ...blending, blendMode: undefined }] }
      expect(exportFilterGraphV3(normalShape, [true, true, true, false, true]).filterComplex).toBe(graph)
    }
  })

  it('multiplies the pipe framerate by K passes and leaves the output rate alone', () => {
    expect(captionPipeRate(backToBack)).toBe('25/1')
    expect(captionPipeRate(withShape(backToBack))).toBe('75/1')
    const args = exportArgumentsV3(withShape(backToBack), '/out/x.mp4.tmp', [true, false])
    expect(args.slice(args.indexOf('-thread_queue_size'), args.indexOf('pipe:0') + 1)).toEqual(['-thread_queue_size', '8', '-f', 'image2pipe', '-framerate', '75/1', '-c:v', 'png', '-i', 'pipe:0'])
    // The output side (encoded frame rate and count) stays in output frames, unaffected by K.
    expect(args.slice(args.indexOf('-r'), args.indexOf('-r') + 2)).toEqual(['-r', '25/1'])
    expect(args[args.indexOf('-frames:v') + 1]).toBe('125')
  })

  it('splits the caption pipe into K=3 bands: a normal overlay, the blend chain, then the final overlay', () => {
    const chains = exportFilterGraphV3(withShape(backToBack), [true, false]).filterComplex.split(';')
    const layer = '[2:v:0]'
    expect(chains).toContain(`${layer}split=3[gp0][gp1][gp2]`)
    expect(chains).toContain("[gp0]select='eq(mod(n\\,3)\\,0)',setpts=N/(25/1)/TB[gs0]")
    expect(chains).toContain("[gp1]select='eq(mod(n\\,3)\\,1)',setpts=N/(25/1)/TB[gs1]")
    expect(chains).toContain("[gp2]select='eq(mod(n\\,3)\\,2)',setpts=N/(25/1)/TB[gs2]")
    // Band 0 (normal) composites first, straight onto the picture.
    const band0 = chains.find((chain) => chain.startsWith('[v]') && chain.includes('[gs0]'))
    expect(band0).toBe('[v][gs0]overlay=0:0:alpha=straight:format=auto:eof_action=pass:repeatlast=0[gb0]')
    // Band 1 (the blend shape) uses the same `blend` chain a blending picture clip does.
    expect(chains.some((chain) => chain === '[gs1]format=gbrap[ct100001]')).toBe(true)
    expect(chains.some((chain) => chain.includes('blend=c0_mode=multiply:c1_mode=multiply:c2_mode=multiply:c3_mode=normal:shortest=1[bl100001]'))).toBe(true)
    // The final band (2) ends the graph exactly like the untouched single-pass case did.
    const final = chains.find((chain) => chain.includes('[gs2]overlay'))
    expect(final).toContain('overlay=0:0:alpha=straight:format=auto:eof_action=endall:shortest=1,format=yuv420p[outv]')
    expect(chains.some((chain) => chain.startsWith(`${layer}format=gbrap`))).toBe(false) // png transport: no unpremultiply
  })

  it('works identically on the stacked route, after picture compositing', () => {
    const chains = exportFilterGraphV3(withShape(stacked), [true, true, true, false, true]).filterComplex.split(';')
    expect(chains.some((chain) => chain.includes('split=3'))).toBe(true)
    expect(chains.some((chain) => chain.includes('eof_action=endall:shortest=1,format=yuv420p[outv]'))).toBe(true)
  })
})
