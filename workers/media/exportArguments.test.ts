import { describe, expect, it } from 'vitest'
import { exportArguments, exportFilterGraph, isIdentityEdit } from './exportArguments'
import { exportFrameCount, normalizeManifest, type ExportManifest, type ExportPlan } from '../../src/export/plan'
import { DEFAULT_CAPTION_STYLE } from '../../src/captions/style'

const plan: ExportPlan = { width: 1080, height: 1920, frameRate: { numerator: 30000, denominator: 1001 },
  range: { startUs: 500_000, endUs: 5_500_000 } }

describe('exportArguments', () => {
  it('builds the exact argument array for media with audio', () => {
    const args = exportArguments('/in/source.mp4', '/out/dest.mp4.tmp', plan, true)
    expect(args).toEqual([
      '-v', 'error', '-nostdin', '-n', '-stats_period', '0.25', '-ss', '0.500000',
      '-autorotate', '-i', '/in/source.mp4', '-thread_queue_size', '1', '-f', 'image2pipe', '-framerate', '30000/1001', '-c:v', 'png', '-i', 'pipe:0',
      '-filter_complex', '[0:v:0]fps=fps=30000/1001:start_time=0,scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v];[v][1:v:0]overlay=0:0:alpha=straight:format=auto:eof_action=endall:shortest=1,format=yuv420p[outv];[0:a:0]aresample=48000:async=1:first_pts=0,apad,atrim=duration=5.000000[outa]',
      '-map', '[outv]', '-map', '[outa]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      '-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-profile:v', 'high', '-b:v', '8M', '-pix_fmt', 'yuv420p',
      '-r', '30000/1001', '-fps_mode', 'cfr', '-frames:v', String(exportFrameCount(plan)), '-t', '5.000000',
      '-map_metadata', '-1', '-metadata:s:v:0', 'rotate=0', '-movflags', '+faststart', '-f', 'mp4', '-progress', 'pipe:1', '/out/dest.mp4.tmp',
    ])
  })
  it('omits the audio branch/map and uses -an when the source has no audio stream', () => {
    const args = exportArguments('/in/source.mp4', '/out/dest.mp4.tmp', plan, false)
    expect(args).toContain('-an')
    expect(args).not.toContain('[outa]')
    expect(args.filter((a) => a === '-map')).toHaveLength(1)
    expect(args.join(' ')).not.toContain('aresample=48000:async=1:first_pts=0,apad')
  })
  it('never overwrites an existing output (-n) and reads from stdin/pipe rather than an interpolated shell command', () => {
    const args = exportArguments('/in/source.mp4', '/out/dest.mp4.tmp', plan, true)
    expect(args).toContain('-n')
    expect(args.at(-1)).toBe('/out/dest.mp4.tmp')
    for (const arg of args) expect(arg).not.toMatch(/[&|`$]/) // ';' inside -filter_complex is FFmpeg's own filter-chain syntax, not a shell metacharacter here
  })
  it('scales the bitrate class with output pixel count', () => {
    const small: ExportPlan = { ...plan, width: 640, height: 360 }
    const large: ExportPlan = { ...plan, width: 3840, height: 2160 }
    expect(exportArguments('/in/s.mp4', '/out/o.mp4', small, false)).toContain('5M')
    expect(exportArguments('/in/s.mp4', '/out/o.mp4', large, false)).toContain('16M')
  })
  it('requests exactly the ceil-computed frame count and matching -t duration for the range', () => {
    const args = exportArguments('/in/source.mp4', '/out/dest.mp4.tmp', plan, true)
    const framesIndex = args.indexOf('-frames:v')
    expect(args[framesIndex + 1]).toBe(String(exportFrameCount(plan)))
    const durationIndex = args.indexOf('-t')
    expect(args[durationIndex + 1]).toBe('5.000000')
  })
})

describe('manifest-driven builder', () => {
  const style = DEFAULT_CAPTION_STYLE
  const identityV2: ExportManifest = { version: 2, cues: [], style, overlays: [], blurRegions: [], audioClips: [] }
  const explicitIdentity: ExportManifest = { ...identityV2, segments: [{ startUs: plan.range.startUs, endUs: plan.range.endUs }] }
  const v1: ExportManifest = { version: 1, cues: [], style }

  it('matches the argument array snapshot for an identity edit', () => {
    expect(exportArguments('/in/source.mp4', '/out/dest.mp4.tmp', plan, true, identityV2)).toMatchSnapshot()
  })

  it('matches the filtergraph snapshot with and without audio', () => {
    expect(exportFilterGraph(plan, true, identityV2)).toMatchSnapshot('with-audio')
    expect(exportFilterGraph(plan, false, identityV2)).toMatchSnapshot('without-audio')
  })

  it('produces exactly the X2 v1 encode for an identity v2 manifest', () => {
    const baseline = exportArguments('/in/source.mp4', '/out/dest.mp4.tmp', plan, true)
    expect(exportArguments('/in/source.mp4', '/out/dest.mp4.tmp', plan, true, v1)).toEqual(baseline)
    expect(exportArguments('/in/source.mp4', '/out/dest.mp4.tmp', plan, true, identityV2)).toEqual(baseline)
    // A single segment covering the whole planned range is still the identity edit.
    expect(exportArguments('/in/source.mp4', '/out/dest.mp4.tmp', plan, true, explicitIdentity)).toEqual(baseline)
    expect(isIdentityEdit(normalizeManifest(explicitIdentity), plan)).toBe(true)
  })

  it('refuses a manifest FFmpeg cannot honestly encode yet (blur, V4); mixes a sound effect (V3)', () => {
    const blurred: ExportManifest = { ...identityV2, blurRegions: [{ id: 'b1', sequence: { startUs: 0, endUs: 1_000_000 }, rect: { x: 10, y: 10, width: 100, height: 100 }, sigmaPx: 12 }] }
    expect(() => exportArguments('/in/s.mp4', '/out/o.mp4', plan, true, blurred)).toThrow(/V4/)
    const sfx: ExportManifest = { ...identityV2, audioClips: [{ id: 'a1', path: '/a.wav', delayUs: 1_500_000, inPointUs: 250_000, durationUs: 2_000_000, gain: .8 }] }
    const graph = exportFilterGraph(plan, true, sfx)
    expect(graph.filterComplex).toContain('[2:a:0]atrim=start=0.250000:end=2.250000,asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=delays=72000S:all=1,volume=0.800000[s0]')
    expect(graph.filterComplex).toContain('amix=inputs=2:normalize=0:duration=first[outa]')
    const args = exportArguments('/in/s.mp4', '/out/o.mp4', plan, true, sfx)
    expect(args).toContain('/a.wav')
  })

  it('accepts overlays without changing the filtergraph, since the export host paints them, not FFmpeg', () => {
    const withOverlay: ExportManifest = { ...identityV2, overlays: [{
      id: 'ov-1', startUs: 0, endUs: 1_000_000, assetUrl: 'media://local/logo.png',
      rect: { x: 0, y: 0, width: 200, height: 100 }, opacity: 1, fit: 'contain',
    }] }
    const baseline = exportArguments('/in/source.mp4', '/out/dest.mp4.tmp', plan, true, identityV2)
    expect(exportArguments('/in/source.mp4', '/out/dest.mp4.tmp', plan, true, withOverlay)).toEqual(baseline)
  })
})

describe('cuts (segments) reach FFmpeg', () => {
  const style = DEFAULT_CAPTION_STYLE
  // Keeps 500ms-2s and 3s-5.5s of the 5s planned range — 1s removed, 4s of output.
  const cut: ExportManifest = {
    version: 2, cues: [], style, overlays: [], blurRegions: [], audioClips: [],
    segments: [{ startUs: 500_000, endUs: 2_000_000 }, { startUs: 3_000_000, endUs: 5_500_000 }],
  }

  it('wires one trim per kept segment into a concat for video, and again for audio', () => {
    const graph = exportFilterGraph(plan, true, cut)
    expect(graph.filterComplex).toBe(
      '[0:v:0]trim=start=0.500000:end=2.000000,setpts=PTS-STARTPTS[v0];'
      + '[0:v:0]trim=start=3.000000:end=5.500000,setpts=PTS-STARTPTS[v1];'
      + '[v0][v1]concat=n=2:v=1:a=0[vcat];'
      + '[0:a:0]atrim=start=0.500000:end=2.000000,asetpts=PTS-STARTPTS[a0];'
      + '[0:a:0]atrim=start=3.000000:end=5.500000,asetpts=PTS-STARTPTS[a1];'
      + '[a0][a1]concat=n=2:v=0:a=1[acat];'
      + '[vcat]fps=fps=30000/1001:start_time=0,scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v];'
      + '[v][1:v:0]overlay=0:0:alpha=straight:format=auto:eof_action=endall:shortest=1,format=yuv420p[outv];'
      + '[acat]aresample=48000:async=1:first_pts=0,apad,atrim=duration=4.000000[outa]',
    )
    expect(graph.maps).toEqual(['-map', '[outv]', '-map', '[outa]'])
  })

  it('omits the audio trim/concat chain, [acat] and the audio map when the source has no audio', () => {
    const graph = exportFilterGraph(plan, false, cut)
    expect(graph.filterComplex).not.toContain('atrim')
    expect(graph.filterComplex).not.toContain('[acat]')
    expect(graph.filterComplex).toContain('[vcat]fps=')
    expect(graph.maps).toEqual(['-map', '[outv]'])
  })

  it('requests the sequence (kept) duration, not the planned range, for -t and -frames:v', () => {
    const args = exportArguments('/in/source.mp4', '/out/dest.mp4.tmp', plan, true, cut)
    expect(args[args.indexOf('-t') + 1]).toBe('4.000000')
    // 4s at 30000/1001fps ceils to 120 frames.
    expect(args[args.indexOf('-frames:v') + 1]).toBe('120')
  })

  it('passes -filter_complex_script instead of inlining the graph when a script path is given', () => {
    const args = exportArguments('/in/source.mp4', '/out/dest.mp4.tmp', plan, true, cut, '/tmp/job/filtergraph.txt')
    expect(args).toContain('-filter_complex_script')
    expect(args[args.indexOf('-filter_complex_script') + 1]).toBe('/tmp/job/filtergraph.txt')
    expect(args).not.toContain('-filter_complex')
  })
})
