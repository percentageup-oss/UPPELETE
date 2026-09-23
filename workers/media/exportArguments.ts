import {
  exportBitrate, exportFrameCountFor, exportOutputDurationUs, normalizeManifest, usDecimal,
  type ExportManifestV1, type ExportManifestV2, type ExportManifestV3, type ExportPlan, type ManifestBlurRegion, type ManifestClip,
} from '../../src/export/plan'
import { zoomScaleCropExpressions } from '../../src/core/zoomRegion'

/**
 * Builds the encoder invocation deterministically from the export plan and the versioned manifest.
 * Nothing here reads renderer state or accepts arbitrary flags — main sends a manifest, this turns
 * it into an argument array (docs/EDITING.md, docs/MEDIA_WORKER.md).
 *
 * **Parity rule for V1:** an identity edit with no effects must produce byte-for-byte the argument
 * array X2 ships today, so an unedited project re-encodes exactly as before. Cuts (`segments`) are
 * V6's trim/concat branch below; sound effects are V3's `amix` branch below; blur is V4's
 * `blurPictureChain`, below — both graphs only touch the normalize step's output format/label when
 * a manifest actually carries an enabled blur region, so a blur-free export's filtergraph string is
 * unchanged.
 */

/** Regions and clips are sorted by `(startUs, id)` before labels are assigned, so the encoder
 * invocation is independent of project/array order (docs/EDITING.md). Audio clips carry `delayUs`
 * (sequence time) rather than `startUs`, so that is the sort key here. */
function sortedAudioClips(manifest: ExportManifestV2): ExportManifestV2['audioClips'] {
  return [...manifest.audioClips].sort((a, b) => a.delayUs - b.delayUs || a.id.localeCompare(b.id))
}
export type ExportFilterGraph = {
  filterComplex: string
  /** `-map` arguments in order, so the caller never has to guess which labels exist. */
  maps: string[]
  hasAudioOut: boolean
}

/** True when the manifest's segments cover the whole planned range in one piece — i.e. no cuts. */
export function isIdentityEdit(manifest: ExportManifestV2, plan: ExportPlan): boolean {
  const segments = manifest.segments
  if (!segments?.length) return true
  return segments.length === 1 && segments[0].startUs <= plan.range.startUs && segments[0].endUs >= plan.range.endUs
}

/**
 * Chains FFmpeg's `split/crop/gblur/overlay` per enabled blur region (docs/EDITING.md "Edit
 * manifest v2 and filtergraph"), each `enable`d over its own sequence-time window so a region only
 * blurs its own span of the output. Regions are sorted by `(sequence.startUs, id)` so the graph
 * string is independent of project/array order, matching every other builder in this file. `input`
 * must already be `format=rgba`: blur rects are arbitrary pixel positions that a
 * chroma-subsampled format would round to even boundaries, and rgba's unsubsampled chroma keeps
 * `crop=…:exact=1` pixel-accurate instead. Returns `input` unchanged when there are no regions, so
 * a blur-free export never gains this chain at all.
 */
function blurPictureChain(input: string, blurRegions: readonly ManifestBlurRegion[], chains: string[]): string {
  if (!blurRegions.length) return input
  const sorted = [...blurRegions].sort((a, b) => a.sequence.startUs - b.sequence.startUs || a.id.localeCompare(b.id))
  let previous = input
  sorted.forEach((region, index) => {
    const { x, y, width, height } = region.rect
    const start = usDecimal(region.sequence.startUs)
    const end = usDecimal(region.sequence.endUs)
    chains.push(`${previous}split=2[bl${index}src][bl${index}copy]`)
    chains.push(`[bl${index}copy]crop=w=${width}:h=${height}:x=${x}:y=${y}:exact=1,gblur=sigma=${region.sigmaPx.toFixed(6)}:steps=2[bl${index}blur]`)
    chains.push(`[bl${index}src][bl${index}blur]overlay=x=${x}:y=${y}:format=auto:enable='between(t,${start},${end})'[blout${index}]`)
    previous = `[blout${index}]`
  })
  return previous
}

/** Applies a v3 sequence-timed zoom after the picture is fully composed and before the transparent
 * caption/host-overlay pipe. `scale` is the one FFmpeg 9.0.1 filter that can reconfigure per frame;
 * crop remains output-sized, so downstream overlay and encoder dimensions never change. */
function zoomPictureChain(input: string, manifest: ExportManifestV3, output: string, chains: string[]): string {
  const expressions = zoomScaleCropExpressions(manifest.zoomRegions.map((region) => ({
    startUs: region.sequence.startUs, endUs: region.sequence.endUs, rect: region.rect,
    easeInUs: region.easeInUs, easeOutUs: region.easeOutUs,
  })), manifest.format)
  if (!expressions) return input
  const { width, height } = manifest.format
  const evenWidth = `trunc(${width}*(${expressions.scale})/2)*2`
  const evenHeight = `trunc(${height}*(${expressions.scale})/2)*2`
  chains.push(`${input}scale=w='${evenWidth}':h='${evenHeight}':eval=frame:flags=lanczos,`
    + `crop=${width}:${height}:x='${expressions.x}':y='${expressions.y}',setsar=1[${output}]`)
  return `[${output}]`
}

/**
 * The filtergraph, assembled as an ordered list of chains joined by `;`. Overlays will never appear
 * here even once V2 lands: the export host paints them into the same transparent caption layer that
 * arrives on `[1:v:0]`, so FFmpeg does no compositing for them at all (ADR 0003).
 *
 * Cuts trim+concat the decoded source before the CFR/scale/pad normalisation, exactly the skeleton
 * in docs/EDITING.md: one `trim`/`atrim` chain per kept segment (in source time — `-ss` always seeks
 * to the start of the planned range, so `[0:v:0]`'s PTS already line up with it), then one `concat`.
 * The identity edit (no segments, or a single segment covering the whole range) skips both entirely,
 * so its filtergraph string is unchanged from before cuts existed.
 */
export function exportFilterGraph(plan: ExportPlan, hasAudio: boolean, manifest?: ExportManifestV1 | ExportManifestV2): ExportFilterGraph {
  // No manifest means the caller has nothing to encode beyond captions — the identity edit.
  const edits = manifest ? normalizeManifest(manifest) : undefined
  const cuts = edits && !isIdentityEdit(edits, plan) ? edits.segments! : null
  const rate = `${plan.frameRate.numerator}/${plan.frameRate.denominator}`
  const duration = usDecimal(exportOutputDurationUs(plan, edits))
  const chains: string[] = []
  let videoInput = '[0:v:0]'
  let audioInput = '[0:a:0]'
  if (cuts) {
    cuts.forEach((segment, index) => chains.push(`[0:v:0]trim=start=${usDecimal(segment.startUs)}:end=${usDecimal(segment.endUs)},setpts=PTS-STARTPTS[v${index}]`))
    chains.push(`${cuts.map((_, index) => `[v${index}]`).join('')}concat=n=${cuts.length}:v=1:a=0[vcat]`)
    videoInput = '[vcat]'
    if (hasAudio) {
      cuts.forEach((segment, index) => chains.push(`[0:a:0]atrim=start=${usDecimal(segment.startUs)}:end=${usDecimal(segment.endUs)},asetpts=PTS-STARTPTS[a${index}]`))
      chains.push(`${cuts.map((_, index) => `[a${index}]`).join('')}concat=n=${cuts.length}:v=0:a=1[acat]`)
      audioInput = '[acat]'
    }
  }
  // Normalise the decoded source to the output's CFR rate and exact frame size, letterboxing
  // rather than cropping, then blur (if any), then flatten the caption/overlay layer over it. Blur
  // only changes this step's own label/format when there is a region to draw — an edit with no
  // blur keeps the exact `[v]`/`scale,pad,setsar` string the parity snapshot pins.
  const blurRegions = edits?.blurRegions ?? []
  const normalizeLabel = blurRegions.length ? 'vbase' : 'v'
  chains.push(`${videoInput}fps=fps=${rate}:start_time=0,scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2,setsar=1${blurRegions.length ? ',format=rgba' : ''}[${normalizeLabel}]`)
  const picture = blurPictureChain(`[${normalizeLabel}]`, blurRegions, chains)
  chains.push(`${picture}[1:v:0]overlay=0:0:alpha=straight:format=auto:eof_action=endall:shortest=1,format=yuv420p[outv]`)
  const maps = ['-map', '[outv]']
  const clips = edits ? sortedAudioClips(edits) : []
  const hasAudioOut = hasAudio || clips.length > 0
  if (hasAudioOut && !clips.length) {
    // No sound effects: byte-for-byte the pre-V3 chain, so an edit with only cuts/overlays/blur
    // re-encodes its audio exactly as X2 always has.
    chains.push(`${audioInput}aresample=48000:async=1:first_pts=0,apad,atrim=duration=${duration}[outa]`)
  } else if (hasAudioOut) {
    // Sound effects mix onto a fixed-duration base: the source audio (or, with none, silence) pads
    // to the output length first, so `amix`'s `duration=first` pins the mixed result to it exactly
    // regardless of how long any individual clip is (docs/EDITING.md's filtergraph skeleton).
    const base = hasAudio
      ? `${audioInput}aresample=48000:async=1:first_pts=0,apad,atrim=duration=${duration},aformat=sample_fmts=fltp:channel_layouts=stereo[abase]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${duration},aformat=sample_fmts=fltp:channel_layouts=stereo[abase]`
    chains.push(base)
    clips.forEach((clip, index) => {
      const inputIndex = 2 + index
      const endPart = clip.durationUs != null ? `:end=${usDecimal(clip.inPointUs + clip.durationUs)}` : ''
      const delaySamples = Math.round(clip.delayUs * 48000 / 1_000_000)
      chains.push(`[${inputIndex}:a:0]atrim=start=${usDecimal(clip.inPointUs)}${endPart},asetpts=PTS-STARTPTS,`
        + `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=delays=${delaySamples}S:all=1,volume=${clip.gain.toFixed(6)}[s${index}]`)
    })
    const mixInputs = ['[abase]', ...clips.map((_, index) => `[s${index}]`)].join('')
    chains.push(`${mixInputs}amix=inputs=${clips.length + 1}:normalize=0:duration=first[outa]`)
  }
  if (hasAudioOut) maps.push('-map', '[outa]')
  return { filterComplex: chains.join(';'), maps, hasAudioOut }
}

/**
 * `filterComplexScriptPath` is set by the caller when the assembled graph is too large for argv
 * (the Windows limit `docs/EDITING.md` calls out) — it writes `exportFilterGraph`'s string to that
 * file and this passes `-filter_complex_script` instead of inlining it with `-filter_complex`.
 */
export function exportArguments(inputPath: string, outputPath: string, plan: ExportPlan, hasAudio: boolean, manifest?: ExportManifestV1 | ExportManifestV2, filterComplexScriptPath?: string): string[] {
  const rate = `${plan.frameRate.numerator}/${plan.frameRate.denominator}`
  const edits = manifest ? normalizeManifest(manifest) : undefined
  const outputDurationUs = exportOutputDurationUs(plan, edits)
  const duration = usDecimal(outputDurationUs)
  const graph = exportFilterGraph(plan, hasAudio, manifest)
  // Sound-effect inputs start at index 2 (0 is the source, 1 is the caption/overlay layer pipe),
  // in the same sorted order `exportFilterGraph` used to assign their `[N:a:0]` labels.
  const clipInputs = (edits ? sortedAudioClips(edits) : []).flatMap((clip) => ['-i', clip.path])
  return ['-v', 'error', '-nostdin', '-n', '-stats_period', '0.25', '-ss', usDecimal(plan.range.startUs),
    // FFmpeg autorotates on decode, so `[0:v]` is already display-oriented; `-noautorotate` is never emitted.
    '-autorotate', '-i', inputPath, '-thread_queue_size', '1', '-f', 'image2pipe', '-framerate', rate, '-c:v', 'png', '-i', 'pipe:0', ...clipInputs,
    ...(filterComplexScriptPath ? ['-filter_complex_script', filterComplexScriptPath] : ['-filter_complex', graph.filterComplex]), ...graph.maps,
    ...(graph.hasAudioOut ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : ['-an']),
    '-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-profile:v', 'high', '-b:v', exportBitrate(plan.width, plan.height), '-pix_fmt', 'yuv420p',
    '-r', rate, '-fps_mode', 'cfr', '-frames:v', String(exportFrameCountFor(outputDurationUs, plan.frameRate)), '-t', duration,
    '-map_metadata', '-1', '-metadata:s:v:0', 'rotate=0', '-movflags', '+faststart', '-f', 'mp4', '-progress', 'pipe:1', outputPath]
}

// ---------------------------------------------------------------------------------------------
// Manifest v3: the multi-track timeline (docs/EDITING.md "Export — manifest v3").
// ---------------------------------------------------------------------------------------------

/**
 * **Flat** (concat) when the picture is one video track played end to end — gapless from 0 to the
 * sequence end, full frame and opaque — which is "two videos back to back", the most wanted case.
 * Everything else — gaps, picture-in-picture, stacked tracks, FFmpeg-composited images — is
 * **stacked**: a black canvas with every visual clip overlaid at its position.
 */
export type V3Route = 'flat' | 'stacked'
export function v3Route(manifest: ExportManifestV3): V3Route {
  const visual = manifest.clips.filter((clip) => clip.kind !== 'audio').sort((a, b) => a.timelineStartUs - b.timelineStartUs)
  if (!visual.length || visual.some((clip) => clip.kind !== 'video' || clip.trackIndex !== visual[0].trackIndex || clip.rect || clip.opacity !== 1)) return 'stacked'
  let cursor = 0
  for (const clip of visual) {
    if (clip.timelineStartUs !== cursor) return 'stacked'
    cursor += clip.sourceEndUs - clip.sourceStartUs
  }
  return cursor === manifest.sequenceDurationUs ? 'flat' : 'stacked'
}

const clipLength = (clip: ManifestClip) => clip.sourceEndUs - clip.sourceStartUs

/**
 * Fits a picture into `width`×`height`. `contain` letterboxes — with transparent bars when the
 * picture is stacked over other tracks, so what is below shows through, exactly like the preview's
 * `object-fit: contain` element — `cover` crops and `stretch` distorts.
 */
function fitChain(fit: ManifestClip['fit'], width: number, height: number, transparent: boolean): string {
  if (fit === 'cover') return `scale=${width}:${height}:force_original_aspect_ratio=increase:reset_sar=1,crop=${width}:${height}`
  if (fit === 'stretch') return `scale=${width}:${height}:reset_sar=1`
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2${transparent ? ':color=black@0' : ''}`
}

/**
 * The v3 filtergraph. Every clip FFmpeg reads is its **own input**, opened with `-ss`/`-t` at its
 * source range (`exportArgumentsV3`), so no decoder is shared between clips: a reordered or repeated
 * clip, or a picture-in-picture of the same file, can never make one consumer buffer another's
 * decoded frames. `hasAudioByInput[i]` is whether input `i` has an audio stream (probed by the worker).
 */
export function exportFilterGraphV3(manifest: ExportManifestV3, hasAudioByInput: readonly boolean[]): ExportFilterGraph {
  const { width, height, frameRate } = manifest.format
  const rate = `${frameRate.numerator}/${frameRate.denominator}`
  const duration = usDecimal(manifest.sequenceDurationUs)
  const layer = `[${manifest.inputs.length}:v:0]`
  const chains: string[] = []
  const visual = manifest.clips.filter((clip) => clip.kind !== 'audio')
  const hasBlur = manifest.blurRegions.length > 0
  if (v3Route(manifest) === 'flat') {
    // Each clip is normalised to the output size before `concat` (inputs may differ in size); the
    // CFR conversion runs once after it, exactly as manifest v2's cuts do, so rounding never accumulates.
    const ordered = [...visual].sort((a, b) => a.timelineStartUs - b.timelineStartUs)
    ordered.forEach((clip, index) => chains.push(`[${clip.inputIndex}:v:0]trim=duration=${usDecimal(clipLength(clip))},setpts=PTS-STARTPTS,`
      + `${fitChain(clip.fit, width, height, false)},setsar=1,format=yuv420p[v${index}]`))
    // Blur needs rgba (see `blurPictureChain`); the concat/fps step only gains the extra
    // `,format=rgba` and relabel when a blur region is actually present, so a blur-free export's
    // string here is unchanged.
    const vLabel = hasBlur ? 'vraw' : 'v'
    chains.push(`${ordered.map((_, index) => `[v${index}]`).join('')}concat=n=${ordered.length}:v=1:a=0,fps=fps=${rate}:start_time=0${hasBlur ? ',format=rgba' : ''}[${vLabel}]`)
    const blurred = blurPictureChain(`[${vLabel}]`, manifest.blurRegions, chains)
    const picture = zoomPictureChain(blurred, manifest, 'vz', chains)
    chains.push(`${picture}${layer}overlay=0:0:alpha=straight:format=auto:eof_action=endall:shortest=1,format=yuv420p[outv]`)
  } else {
    // A black RGBA canvas as long as the sequence; each visual clip, back to front, is padded at its
    // start with transparent frames (`tpad`) so the overlay never stalls waiting for it, and ends
    // with `eof_action=pass:repeatlast=0` so its last frame never smears across a following gap.
    // Verified against FFmpeg 9.0.1 with a real encode (docs/STATUS.md).
    chains.push(`color=c=black:s=${width}x${height}:r=${rate}:d=${duration},format=rgba[base]`)
    let previous = '[base]'
    const ordered = [...visual].sort((a, b) => a.trackIndex - b.trackIndex || a.timelineStartUs - b.timelineStartUs)
    ordered.forEach((clip, index) => {
      const box = clip.rect ?? { x: 0, y: 0, width, height }
      const alpha = clip.opacity < 1 ? `,colorchannelmixer=aa=${clip.opacity.toFixed(6)}` : ''
      const pad = clip.timelineStartUs > 0 ? `,tpad=start_duration=${usDecimal(clip.timelineStartUs)}:start_mode=add:color=black@0` : ''
      chains.push(`[${clip.inputIndex}:v:0]trim=duration=${usDecimal(clipLength(clip))},setpts=PTS-STARTPTS,fps=fps=${rate}:start_time=0,format=rgba,`
        + `${fitChain(clip.fit, box.width, box.height, true)},setsar=1${alpha}${pad}[c${index}]`)
      const next = `[b${index}]`
      chains.push(`${previous}[c${index}]overlay=${box.x}:${box.y}:format=auto:eof_action=pass:repeatlast=0${next}`)
      previous = next
    })
    // The stacked canvas is already rgba (`format=rgba[base]` above, and every overlaid clip is
    // rgba too), so blur needs no extra format conversion here.
    const blurred = blurPictureChain(previous, manifest.blurRegions, chains)
    const picture = zoomPictureChain(blurred, manifest, 'vz', chains)
    chains.push(`${picture}${layer}overlay=0:0:alpha=straight:format=auto:eof_action=endall:shortest=1,format=yuv420p[outv]`)
  }
  const maps = ['-map', '[outv]']
  // Sound: every video clip's own audio (on an unmuted track, with an audio stream) and every audio
  // clip, each delayed to its sequence position with its own gain, mixed onto silence pinned to the
  // sequence length — the same structure manifest v2 uses for sound effects.
  const sounds = manifest.clips.filter((clip) => clip.kind !== 'image' && clip.gain > 0 && hasAudioByInput[clip.inputIndex])
  const hasAudioOut = sounds.length > 0
  if (hasAudioOut) {
    chains.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration},aformat=sample_fmts=fltp:channel_layouts=stereo[abase]`)
    sounds.forEach((clip, index) => {
      const delaySamples = Math.round(clip.timelineStartUs * 48000 / 1_000_000)
      chains.push(`[${clip.inputIndex}:a:0]atrim=duration=${usDecimal(clipLength(clip))},asetpts=PTS-STARTPTS,`
        + `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=delays=${delaySamples}S:all=1,volume=${clip.gain.toFixed(6)}[s${index}]`)
    })
    chains.push(`[abase]${sounds.map((_, index) => `[s${index}]`).join('')}amix=inputs=${sounds.length + 1}:normalize=0:duration=first[outa]`)
    maps.push('-map', '[outa]')
  }
  return { filterComplex: chains.join(';'), maps, hasAudioOut }
}

/** Input options per clip: video/audio seek to their source range; images loop for their length. */
function inputArguments(manifest: ExportManifestV3, rate: string): string[] {
  const clipByInput = new Map(manifest.clips.map((clip) => [clip.inputIndex, clip]))
  return manifest.inputs.flatMap((input, index) => {
    const clip = clipByInput.get(index)
    if (!clip) throw new Error(`Export input ${index} is not used by any clip.`)
    const length = usDecimal(clipLength(clip))
    if (input.kind === 'image') return ['-loop', '1', '-framerate', rate, '-t', length, '-i', input.path]
    return ['-ss', usDecimal(clip.sourceStartUs), '-t', length, ...(input.kind === 'video' ? ['-autorotate'] : []), '-i', input.path]
  })
}

export function exportArgumentsV3(manifest: ExportManifestV3, outputPath: string, hasAudioByInput: readonly boolean[], filterComplexScriptPath?: string): string[] {
  const { width, height, frameRate } = manifest.format
  const rate = `${frameRate.numerator}/${frameRate.denominator}`
  const graph = exportFilterGraphV3(manifest, hasAudioByInput)
  const plan: ExportPlan = { width, height, frameRate, range: { startUs: 0, endUs: manifest.sequenceDurationUs } }
  return ['-v', 'error', '-nostdin', '-n', '-stats_period', '0.25', ...inputArguments(manifest, rate),
    '-thread_queue_size', '1', '-f', 'image2pipe', '-framerate', rate, '-c:v', 'png', '-i', 'pipe:0',
    ...(filterComplexScriptPath ? ['-filter_complex_script', filterComplexScriptPath] : ['-filter_complex', graph.filterComplex]), ...graph.maps,
    ...(graph.hasAudioOut ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : ['-an']),
    '-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-profile:v', 'high', '-b:v', exportBitrate(width, height), '-pix_fmt', 'yuv420p',
    '-r', rate, '-fps_mode', 'cfr', '-frames:v', String(exportFrameCountFor(exportOutputDurationUs(plan, manifest), frameRate)), '-t', usDecimal(manifest.sequenceDurationUs),
    '-map_metadata', '-1', '-metadata:s:v:0', 'rotate=0', '-movflags', '+faststart', '-f', 'mp4', '-progress', 'pipe:1', outputPath]
}
