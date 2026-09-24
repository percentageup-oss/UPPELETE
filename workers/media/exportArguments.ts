import {
  exportBitrate, exportFrameCountFor, exportOutputDurationUs, normalizeManifest, usDecimal,
  type ExportManifestV1, type ExportManifestV2, type ExportManifestV3, type ExportPlan, type ManifestBlurRegion, type ManifestClip,
} from '../../src/export/plan'
import { DEFAULT_VIDEO_ENCODER, videoEncoderArguments, videoEncoderPixelFormat, type VideoEncoderId } from '../../src/core/exportEncoder'
import { zoomScaleCropExpressions } from '../../src/core/zoomRegion'
import { activeMask } from '../../src/core/layerMask'
import type { Fill, LayerMask } from '../../src/core/edit'
import { angleVector, DRIFT_OVERSIZE, DRIFT_TRAVEL, easedPhaseExpression, gradientLine, motionApplies } from '../../src/core/fill'
import { COMPOSITION_WIDTH } from '../../src/core/composition'
import { constantRate, isConstantSpeed, speedPieces, timelineLengthUs } from '../../src/core/clipTime'
import {
  ALIAS_FADE_FROM_PX, ALIAS_FADE_TO_PX, flatGridMetrics, perspectiveGeometry, PERSPECTIVE_HORIZON_FADE,
  type GridFill, type PerspectiveGeometry,
} from '../../src/core/gridFill'

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
function blurPictureChain(input: string, blurRegions: readonly ManifestBlurRegion[], chains: string[], maskInputs?: ReadonlyMap<string, number>): string {
  if (!blurRegions.length) return input
  const sorted = [...blurRegions].sort((a, b) => a.sequence.startUs - b.sequence.startUs || a.id.localeCompare(b.id))
  let previous = input
  sorted.forEach((region, index) => {
    const { x, y, width, height } = region.rect
    const start = usDecimal(region.sequence.startUs)
    const end = usDecimal(region.sequence.endUs)
    chains.push(`${previous}split=2[bl${index}src][bl${index}copy]`)
    const maskInput = maskInputs?.get(region.id)
    // A masked blur keeps only the masked part of the blurred copy: its alpha is multiplied by the
    // mask's alpha (the mask image is cropped to the same rect), so the overlay below shows blur only there.
    chains.push(`[bl${index}copy]crop=w=${width}:h=${height}:x=${x}:y=${y}:exact=1,gblur=sigma=${region.sigmaPx.toFixed(6)}:steps=2[bl${index}${maskInput === undefined ? 'blur' : 'plain'}]`)
    if (maskInput !== undefined) chains.push(...maskAlphaChain(`[bl${index}plain]`, `[${maskInput}:v:0]`, { x, y, width, height }, `bl${index}m`, `bl${index}blur`))
    chains.push(`[bl${index}src][bl${index}blur]overlay=x=${x}:y=${y}:format=auto:enable='between(t,${start},${end})'[blout${index}]`)
    previous = `[blout${index}]`
  })
  return previous
}

/**
 * Multiplies `picture`'s alpha by a layer mask's alpha (docs/EDITING.md "Layer masks"): the mask
 * arrives as a full-frame RGBA image the export host rasterized from the same SVG the preview uses,
 * so `alphaextract` reads its matte, `crop` aligns it with the layer's box, `blend=multiply` keeps any
 * transparency the layer already has (contain letterboxing) and `alphamerge` writes the result back.
 * `picture` must be RGBA. Verified against FFmpeg 9.0.1.
 */
function maskAlphaChain(picture: string, maskInput: string, box: { x: number; y: number; width: number; height: number }, prefix: string, output: string): string[] {
  return [
    `${picture}split=2[${prefix}0][${prefix}1]`,
    `[${prefix}1]alphaextract[${prefix}a]`,
    `${maskInput}format=rgba,alphaextract,crop=w=${box.width}:h=${box.height}:x=${box.x}:y=${box.y}:exact=1[${prefix}k]`,
    `[${prefix}a][${prefix}k]blend=all_mode=multiply:shortest=1[${prefix}m]`,
    `[${prefix}0][${prefix}m]alphamerge[${output}]`,
  ]
}

/** Applies a v3 sequence-timed zoom after the picture is fully composed and before the transparent
 * caption/host-overlay pipe. `scale` is the one FFmpeg 9.0.1 filter that can reconfigure per frame;
 * crop remains output-sized, so downstream overlay and encoder dimensions never change. */
function zoomPictureChain(input: string, manifest: ExportManifestV3, output: string, chains: string[]): string {
  const expressions = zoomScaleCropExpressions(manifest.zoomRegions.map((region) => ({
    startUs: region.sequence.startUs, endUs: region.sequence.endUs, rect: region.rect, fromRect: region.fromRect,
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
 * Dreamy glow, after zoom and before the transparent caption layer (docs/EDITING.md "Picture
 * effects: Dreamy glow"): highlight pass (`lutrgb`) → `gblur` → screen `blend` at `amount`, the same
 * three steps the preview's SVG filter runs. Regions are sorted `(startUs, id)`. Returns the input
 * untouched when no region exists, so effect-free graphs stay byte-identical.
 */
function pictureEffectChain(input: string, manifest: ExportManifestV3, chains: string[]): string {
  if (!manifest.pictureEffects.length) return input
  const sorted = [...manifest.pictureEffects].sort((a, b) => a.sequence.startUs - b.sequence.startUs || a.id.localeCompare(b.id))
  let previous = input
  sorted.forEach((effect, index) => {
    const start = usDecimal(effect.sequence.startUs)
    const end = usDecimal(effect.sequence.endUs)
    const level = Math.round(effect.threshold * 255)
    const lut = `clip((val-${level})*255/${255 - level},0,255)`
    chains.push(`${previous}format=rgba,split=2[gl${index}src][gl${index}copy]`)
    chains.push(`[gl${index}copy]lutrgb=r='${lut}':g='${lut}':b='${lut}',gblur=sigma=${effect.sigmaPx.toFixed(6)}:steps=2[gl${index}bloom]`)
    chains.push(`[gl${index}src][gl${index}bloom]blend=all_mode=screen:all_opacity=${effect.amount.toFixed(6)}:enable='between(t,${start},${end})'[glout${index}]`)
    previous = `[glout${index}]`
  })
  return previous
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

export type ExportEncoding = { videoBitrateKbps: number }
/** Without `encoding` this is exactly the historical `-b:v` class, keeping the parity snapshot byte-identical. */
/** Target bitrate in FFmpeg's spelling: the user's setting, else the resolution ladder. The encoder block adds the rest. */
function videoBitrate(width: number, height: number, encoding?: ExportEncoding): string {
  return encoding ? `${encoding.videoBitrateKbps}k` : exportBitrate(width, height)
}

/**
 * `filterComplexScriptPath` is set by the caller when the assembled graph is too large for argv
 * (the Windows limit `docs/EDITING.md` calls out) — it writes `exportFilterGraph`'s string to that
 * file and this passes `-/filter_complex <file>` instead of inlining it with `-filter_complex`. The `-/`
 * prefix (FFmpeg 7+, the export minimum) reads an option's value from a file; FFmpeg 8 removed the
 * older `-filter_complex_script` spelling, which fails there as an unrecognized option.
 */
export function exportArguments(inputPath: string, outputPath: string, plan: ExportPlan, hasAudio: boolean, manifest?: ExportManifestV1 | ExportManifestV2, filterComplexScriptPath?: string, encoding?: ExportEncoding, videoEncoder: VideoEncoderId = DEFAULT_VIDEO_ENCODER): string[] {
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
    ...(filterComplexScriptPath ? ['-/filter_complex', filterComplexScriptPath] : ['-filter_complex', graph.filterComplex]), ...graph.maps,
    ...(graph.hasAudioOut ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : ['-an']),
    ...videoEncoderArguments(videoEncoder, videoBitrate(plan.width, plan.height, encoding)), '-pix_fmt', videoEncoderPixelFormat(videoEncoder),
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
  if (!visual.length || visual.some((clip) => clip.kind !== 'video' || clip.trackIndex !== visual[0].trackIndex || clip.rect || clip.opacity !== 1 || activeMask(clip.mask))) return 'stacked'
  let cursor = 0
  for (const clip of visual) {
    if (clip.timelineStartUs !== cursor) return 'stacked'
    cursor += clipLength(clip)
  }
  return cursor === manifest.sequenceDurationUs ? 'flat' : 'stacked'
}

/** How long the clip occupies the timeline (its source span, retimed by any speed curve). */
const clipLength = (clip: ManifestClip) => timelineLengthUs(clip)
/** How much of its file the clip reads: what `-t` and `trim=duration` measure. */
const clipSourceLength = (clip: ManifestClip) => clip.sourceEndUs - clip.sourceStartUs

/**
 * `setpts` that retimes one clip's picture. It runs after `setpts=PTS-STARTPTS`, so `PTS*TB` is the
 * source offset in seconds. A steady rate is a plain division; a curve is the same piecewise closed
 * form `clipTime.ts` uses for preview and edits — constant pieces `t0 + (x-p)/v`, linear pieces
 * `t0 + L/(vb-va)·ln((va + (vb-va)·(x-p)/L)/va)` — as nested `if`s, quoted so its commas survive.
 * Returns '' for a clip with no speed.
 */
export function retimeFilter(clip: ManifestClip): string {
  if (!clip.speed) return ''
  if (isConstantSpeed(clip)) return `,setpts=PTS/${constantRate(clip).toFixed(9)}`
  const pieces = speedPieces(clip)
  const x = '(PTS*TB)'
  const expression = pieces.map((piece) => {
    const p = (piece.a - clip.sourceStartUs) / 1_000_000
    const length = (piece.b - piece.a) / 1_000_000
    const t0 = piece.t0 / 1_000_000
    const constant = Math.abs(piece.vb - piece.va) < 1e-9 * Math.max(piece.va, piece.vb)
    const body = constant
      ? `${t0.toFixed(9)}+(${x}-${p.toFixed(9)})/${piece.va.toFixed(9)}`
      : `${t0.toFixed(9)}+${(length / (piece.vb - piece.va)).toFixed(9)}*log((${piece.va.toFixed(9)}+${((piece.vb - piece.va) / length).toFixed(9)}*(${x}-${p.toFixed(9)}))/${piece.va.toFixed(9)})`
    return { end: p + length, body }
  })
  const nested = expression.reduceRight((rest, piece, index) => index === expression.length - 1 ? piece.body : `if(lt(${x},${piece.end.toFixed(9)}),${piece.body},${rest})`, '')
  return `,setpts='(${nested})/TB'`
}

/** `atempo` accepts 0.5–100 per instance, so a slow-down below 0.5× is split into equal factors. */
export function atempoChain(rate: number): string {
  const stages = rate < 0.5 ? Math.ceil(Math.log(rate) / Math.log(0.5) - 1e-9) : 1
  const each = Math.pow(rate, 1 / stages)
  return Array.from({ length: stages }, () => `atempo=${each.toFixed(9)}`).join(',')
}

/**
 * Every FFmpeg-composited layer that carries a mask, in the deterministic order its mask image is
 * added as an extra input *after* the caption-layer pipe (so a mask-free export's arguments are
 * unchanged): visual clips back to front, then blur regions. The worker rasterizes `mask` once per
 * distinct value through the export host and hands the files back in this same order.
 */
export type MaskTarget = { kind: 'clip' | 'blur'; id: string; mask: LayerMask; lengthUs: number }
export function maskTargets(manifest: ExportManifestV3): MaskTarget[] {
  const clips = manifest.clips.filter((clip) => clip.kind !== 'audio' && activeMask(clip.mask))
    .sort((a, b) => a.trackIndex - b.trackIndex || a.timelineStartUs - b.timelineStartUs)
    .map((clip): MaskTarget => ({ kind: 'clip', id: clip.id, mask: clip.mask!, lengthUs: clipLength(clip) }))
  const blurs = [...manifest.blurRegions].filter((region) => activeMask(region.mask))
    .sort((a, b) => a.sequence.startUs - b.sequence.startUs || a.id.localeCompare(b.id))
    .map((region): MaskTarget => ({ kind: 'blur', id: region.id, mask: region.mask!, lengthUs: manifest.sequenceDurationUs }))
  return [...clips, ...blurs]
}
/** Input index of each target's mask image: the pipe is at `inputs.length`, masks follow it. */
function maskInputIndexes(manifest: ExportManifestV3): { clip: Map<string, number>; blur: Map<string, number> } {
  const indexes = { clip: new Map<string, number>(), blur: new Map<string, number>() }
  maskTargets(manifest).forEach((target, index) => indexes[target.kind].set(target.id, manifest.inputs.length + 1 + index))
  return indexes
}

/** Quotes a file path for a literal FFmpeg filter option value (e.g. `lut3d=file=…`), never a shell —
 * this graph is always written to `filtergraph.txt` and passed via `-/filter_complex`. Single
 * quotes protect the path's own `:` (a Windows drive letter, and the filter graph's own key=value
 * separator) without per-character escaping; only a literal backslash or single quote inside the path
 * needs its own escape. */
function ffmpegFilterPath(filePath: string): string {
  return `'${filePath.replace(/\\/g, '\\\\').replace(/'/g, "'\\''")}'`
}

/**
 * The grading insertion for a video/image clip whose segment fell under an adjustment layer
 * (`src/export/plan.ts`'s `lutId`) — nothing for an ungraded clip, so a grade-free export's chain is
 * unchanged. `in_color_matrix=bt709:in_range=tv` matches how Chromium decodes the same file for
 * preview (docs/EDITING.md), so FFmpeg's YUV→RGB conversion agrees with what the WebGL2 preview reads
 * before either side samples the identical baked LUT with the same trilinear interpolation.
 */
function lutChain(clip: ManifestClip, lutPaths: ReadonlyMap<string, string>): string {
  if (!clip.lutId) return ''
  const file = lutPaths.get(clip.lutId)
  if (!file) throw new Error(`Missing baked LUT file for ${clip.lutId}`)
  // Video is normally limited-range YUV. Still images are already full-range RGB; forcing TV
  // range on an image would shift its colors before the shared LUT is sampled.
  const input = clip.kind === 'image' ? 'format=gbrp16le' : 'scale=in_color_matrix=bt709:in_range=tv,format=gbrp16le'
  return `,${input},lut3d=file=${ffmpegFilterPath(file)}:interp=trilinear`
}

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

/** Frames at least this small on their short side blend at full size. */
const BLEND_SHRINK_FROM_PX = 480
const BLEND_SHRINK = 8
const hexByte = (color: string, offset: number): number => Number.parseInt(color.slice(1 + offset * 2, 3 + offset * 2), 16)
const num = (value: number): string => `(${value.toFixed(10)})`

/**
 * One generated picture (a background fill) as a `width`×`height` rgba stream `length` seconds long.
 * A solid is FFmpeg's own `color` source. A gradient evaluates the exact CSS gradient line
 * (`gradientLine`, sRGB, linear in t) once with `geq`, then loops that single frame — `geq` runs on
 * one frame instead of every frame. The `gradients` source filter is deliberately not used: its ramp
 * length depends on the pixel format and size, so it cannot match the preview.
 */
function fillSourceChain(fill: Fill, width: number, height: number, rate: string, length: string, label: string, scale: number): string {
  if (fill.type === 'solid') return `color=c=0x${fill.color.slice(1)}:s=${width}x${height}:r=${rate}:d=${length},format=rgba[${label}]`
  if (fill.type === 'grid') return gridSourceChains(fill, width, height, rate, length, label, scale, '0')
  const { ax, ay, c } = gradientLine(fill.angle, width, height)
  const t = `clip(${num(ax)}*(X+0.5)+${num(ay)}*(Y+0.5)+${num(c)},0,1)`
  const plane = (offset: number) => `${hexByte(fill.from, offset)}+0.5+(${hexByte(fill.to, offset) - hexByte(fill.from, offset)})*${t}`
  return stillFrom(`geq=r='${plane(0)}':g='${plane(1)}':b='${plane(2)}'`, width, height, rate, length, label)
}

/** One frame run through `geq` (per-pixel, so once, not per frame), looped for `length`. */
function stillFrom(geq: string, width: number, height: number, rate: string, length: string, label: string, planar = 'gbrp'): string {
  return `color=c=black:s=${width}x${height}:r=${rate},trim=end_frame=1,format=${planar},${geq},format=rgba,`
    + `loop=loop=-1:size=1:start=0,setpts=N/(${rate})/TB,trim=duration=${length}[${label}]`
}

/** Keeps `mod()` arguments positive whatever the scroll direction, since FFmpeg's `mod` truncates. */
const MOD_LIFT_CELLS = 10_000_000
const lerpPlane = (from: string, to: string, offset: number, coverage: string) =>
  `${hexByte(from, offset)}+0.5+(${hexByte(to, offset) - hexByte(from, offset)})*(${coverage})`

/** A flat grid tile of `width`×`height` whose pattern origin is the top-left corner, as a `geq` chain. */
function flatGridStill(grid: GridFill, width: number, height: number, rate: string, length: string, label: string, scale: number): string {
  const { cell, thickness, dotRadius } = flatGridMetrics(grid, scale)
  const coverage = grid.pattern === 'dots'
    ? `clip(${num(dotRadius)}-hypot(mod(X+0.5,${cell})-${cell / 2},mod(Y+0.5,${cell})-${cell / 2})+0.5,0,1)`
    : `max(lt(mod(X,${cell}),${thickness}),lt(mod(Y,${cell}),${thickness}))`
  const plane = (offset: number) => lerpPlane(grid.background, grid.line, offset, coverage)
  return stillFrom(`geq=r='${plane(0)}':g='${plane(1)}':b='${plane(2)}'`, width, height, rate, length, label)
}

/** Alpha expression for the perspective floor. `across` is set for the converging lines (a function of
 * X and Y, static); otherwise the row lines, a function of Y and `phase` (cells moved, an expression in T). */
function perspectiveAlphaExpression(g: PerspectiveGeometry, layer: { kind: 'converging' } | { kind: 'rows'; phase: string }): string {
  const fade = `clip(${num(g.cell)}*ld(3)-${ALIAS_FADE_FROM_PX},0,${ALIAS_FADE_TO_PX - ALIAS_FADE_FROM_PX})/${num(ALIAS_FADE_TO_PX - ALIAS_FADE_FROM_PX)}`
  const horizon = `clip(ld(0)/${num(PERSPECTIVE_HORIZON_FADE * g.bottomSpan)},0,1)`
  const lift = `${MOD_LIFT_CELLS}*${num(g.cell)}`
  const distance = layer.kind === 'converging'
    ? `abs(mod((X+0.5-${num(g.centerX)})*ld(1)/${num(g.focal)}+${num(g.cell / 2)}+${lift},${num(g.cell)})-${num(g.cell / 2)})`
    : `abs(mod(ld(1)+${num(g.cell)}*(${layer.phase})+${num(g.cell / 2)}+${lift},${num(g.cell)})-${num(g.cell / 2)})`
  const perUnit = layer.kind === 'converging' ? `${num(g.focal)}/ld(1)` : `ld(0)*ld(0)/${num(g.bottomSpan)}`
  return `st(0,Y+0.5-${num(g.horizonY)});st(1,${num(g.bottomSpan)}/max(ld(0),0.000001));st(2,${distance});st(3,${perUnit});`
    + `255*gt(ld(0),0)*clip((${num(g.thickness / 2)}-ld(2))*ld(3)+0.5,0,1)*(${fade})*${horizon}`
}

/** The perspective floor: a base of the background color with the converging lines (one still) and the
 * horizontal lines (a one-pixel-wide column regenerated every frame, then stretched across) over it. */
function perspectiveChains(grid: GridFill, width: number, height: number, rate: string, length: string, label: string, scale: number, phase: string): string {
  const g = perspectiveGeometry(grid, width, height, scale)
  const [red, green, blue] = [0, 1, 2].map((offset) => hexByte(grid.line, offset))
  const layerPlanes = (alpha: string) => `geq=r=${red}:g=${green}:b=${blue}:a='${alpha}'`
  return [
    `color=c=0x${grid.background.slice(1)}:s=${width}x${height}:r=${rate}:d=${length},format=rgba[${label}_b]`,
    stillFrom(layerPlanes(perspectiveAlphaExpression(g, { kind: 'converging' })), width, height, rate, length, `${label}_v`, 'gbrap'),
    `color=c=black:s=1x${height}:r=${rate}:d=${length},format=gbrap,${layerPlanes(perspectiveAlphaExpression(g, { kind: 'rows', phase }))},format=rgba,scale=${width}:${height}:flags=neighbor[${label}_h]`,
    `[${label}_b][${label}_v]overlay=0:0:format=auto:shortest=1[${label}_bv]`,
    `[${label}_bv][${label}_h]overlay=0:0:format=auto:shortest=1,format=rgba[${label}]`,
  ].join(';')
}

/** A grid as a `width`×`height` stream. `phase` is the forward scroll in cells as an expression in T
 * (only the perspective floor uses it); flat grids are scrolled by the caller with `crop`. */
function gridSourceChains(grid: GridFill, width: number, height: number, rate: string, length: string, label: string, scale: number, phase: string): string {
  return grid.pattern === 'perspective'
    ? perspectiveChains(grid, width, height, rate, length, label, scale, phase)
    : flatGridStill(grid, width, height, rate, length, label, scale)
}

/**
 * A background clip's picture, motion included, as chains ending in `[label]`. Shift and pulse blend
 * two stills by the shared eased phase (`easedPhaseExpression`, the same function the preview's
 * `paintAt` evaluates); drift pans an oversized still with `crop`.
 */
function colorClipChains(clip: ManifestClip, width: number, height: number, rate: string, label: string, chains: string[], scale: number): void {
  const fill = clip.fill!
  const length = usDecimal(clipLength(clip))
  const motion = clip.motion
  if (!motion || !motionApplies(fill, motion)) {
    chains.push(fillSourceChain(fill, width, height, rate, length, label, scale))
    return
  }
  const phase = (periodUs: number) => easedPhaseExpression(periodUs, clip.sourceStartUs)
  if (motion.type === 'scroll' && fill.type === 'grid') {
    scrollingGridChains(clip, fill, motion, width, height, rate, length, label, chains, scale)
    return
  }
  if (motion.type === 'drift') {
    const oversizedWidth = Math.round(width * DRIFT_OVERSIZE)
    const oversizedHeight = Math.round(height * DRIFT_OVERSIZE)
    chains.push(fillSourceChain(fill, oversizedWidth, oversizedHeight, rate, length, `${label}o`, scale))
    const direction = angleVector(motion.direction)
    const p = `(-cos(2*PI*(t+${(clip.sourceStartUs / 1e6).toFixed(6)})/${(motion.periodUs / 1e6).toFixed(6)}))`
    chains.push(`[${label}o]crop=${width}:${height}:x='(iw-ow)/2-ow*${DRIFT_TRAVEL}*${num(direction.x)}*${p}':y='(ih-oh)/2-oh*${DRIFT_TRAVEL}*${num(direction.y)}*${p}'[${label}]`)
    return
  }
  // `blend` evaluates its expression per pixel — ~8 fps at 1080×1920. Both pictures are smooth (a
  // solid or one linear ramp), so the blend runs at 1/BLEND_SHRINK size and is scaled back up
  // bilinearly: the same picture to within a level or two, at a fraction of the cost. Small frames
  // are cheap already and stay exact. A grid is not smooth — shrinking would smear its lines — so a
  // blend involving one is an alpha crossfade instead: the phase is generated as a single pixel per
  // frame, stretched, merged into the second picture's alpha, and overlaid (all of which are
  // vectorised), which is the same `A·(1−k) + B·k` without evaluating anything per pixel.
  const hasGrid = fill.type === 'grid' || (motion.type === 'shift' && motion.to.type === 'grid')
  const crossfadeAmount = (): string => motion.type === 'shift' ? phase(motion.periodUs) : motion.type === 'pulse' ? `${motion.depth.toFixed(6)}*${phase(motion.periodUs)}` : '0'
  const secondFill: Fill | null = motion.type === 'shift' ? motion.to : motion.type === 'pulse' ? { type: 'solid', color: motion.toward === 'black' ? '#000000' : '#ffffff' } : null
  if (!secondFill) return
  if (hasGrid) {
    chains.push(fillSourceChain(fill, width, height, rate, length, `${label}a`, scale))
    chains.push(fillSourceChain(secondFill, width, height, rate, length, `${label}b`, scale))
    chains.push(`color=c=black:s=1x1:r=${rate}:d=${length},format=gray,geq=lum='clip(255*${crossfadeAmount()}+0.5,0,255)',scale=${width}:${height}:flags=neighbor,format=gray[${label}m]`)
    chains.push(`[${label}b][${label}m]alphamerge[${label}bm]`)
    chains.push(`[${label}a][${label}bm]overlay=0:0:format=auto:shortest=1,format=rgba[${label}]`)
    return
  }
  const shrink = Math.min(width, height) >= BLEND_SHRINK_FROM_PX ? BLEND_SHRINK : 1
  const blendWidth = shrink === 1 ? width : Math.max(2, Math.ceil(width / shrink))
  const blendHeight = shrink === 1 ? height : Math.max(2, Math.ceil(height / shrink))
  const blended = shrink === 1 ? label : `${label}s`
  chains.push(fillSourceChain(fill, blendWidth, blendHeight, rate, length, `${label}a`, scale))
  chains.push(fillSourceChain(secondFill, blendWidth, blendHeight, rate, length, `${label}b`, scale))
  const k = crossfadeAmount()
  chains.push(`[${label}a][${label}b]blend=all_expr='A*(1-${k})+B*${k}':shortest=1[${blended}]`)
  if (shrink > 1) chains.push(`[${blended}]scale=${width}:${height}:flags=bilinear[${label}]`)
}

/**
 * A scrolling grid. A flat grid is drawn once one cell larger each way, and `crop` slides a
 * frame-sized window over it by whole pixels (`flatScrollPx`), so every frame is a copy, not a render.
 * The perspective floor keeps its converging lines still and only re-evaluates the one-pixel-wide
 * column of horizontal lines: it scrolls toward the viewer by the vertical part of `direction`.
 */
function scrollingGridChains(
  clip: ManifestClip, grid: GridFill, motion: Extract<NonNullable<ManifestClip['motion']>, { type: 'scroll' }>,
  width: number, height: number, rate: string, length: string, label: string, chains: string[], scale: number,
): void {
  const direction = angleVector(motion.direction)
  const cells = `((t+${(clip.sourceStartUs / 1e6).toFixed(6)})/${(motion.periodUs / 1e6).toFixed(6)})`
  if (grid.pattern === 'perspective') {
    chains.push(perspectiveChains(grid, width, height, rate, length, label, scale, `${num(direction.y)}*((T+${(clip.sourceStartUs / 1e6).toFixed(6)})/${(motion.periodUs / 1e6).toFixed(6)})`))
    return
  }
  const { cell } = flatGridMetrics(grid, scale)
  chains.push(flatGridStill(grid, width + cell, height + cell, rate, length, `${label}o`, scale))
  const offset = (axis: number) => `floor(mod(${num(axis)}*${cells}*${cell}+${MOD_LIFT_CELLS}*${cell},${cell}))`
  chains.push(`[${label}o]crop=${width}:${height}:x='${cell}-${offset(direction.x)}':y='${cell}-${offset(direction.y)}'[${label}]`)
}

/**
 * The v3 filtergraph. Every clip FFmpeg reads is its **own input**, opened with `-ss`/`-t` at its
 * source range (`exportArgumentsV3`), so no decoder is shared between clips: a reordered or repeated
 * clip, or a picture-in-picture of the same file, can never make one consumer buffer another's
 * decoded frames. `hasAudioByInput[i]` is whether input `i` has an audio stream (probed by the worker).
 */
export function exportFilterGraphV3(manifest: ExportManifestV3, hasAudioByInput: readonly boolean[], lutPaths: ReadonlyMap<string, string> = new Map()): ExportFilterGraph {
  const { width, height, frameRate } = manifest.format
  const rate = `${frameRate.numerator}/${frameRate.denominator}`
  const duration = usDecimal(manifest.sequenceDurationUs)
  const layer = `[${manifest.inputs.length}:v:0]`
  const chains: string[] = []
  const visual = manifest.clips.filter((clip) => clip.kind !== 'audio')
  const maskInputs = maskInputIndexes(manifest)
  const hasBlur = manifest.blurRegions.length > 0
  if (v3Route(manifest) === 'flat') {
    // Each clip is normalised to the output size before `concat` (inputs may differ in size); the
    // CFR conversion runs once after it, exactly as manifest v2's cuts do, so rounding never accumulates.
    const ordered = [...visual].sort((a, b) => a.timelineStartUs - b.timelineStartUs)
    ordered.forEach((clip, index) => chains.push(`[${clip.inputIndex}:v:0]trim=duration=${usDecimal(clipSourceLength(clip))},setpts=PTS-STARTPTS${retimeFilter(clip)}${lutChain(clip, lutPaths)},`
      + `${fitChain(clip.fit, width, height, false)},setsar=1,format=yuv420p[v${index}]`))
    // Blur needs rgba (see `blurPictureChain`); the concat/fps step only gains the extra
    // `,format=rgba` and relabel when a blur region is actually present, so a blur-free export's
    // string here is unchanged.
    const vLabel = hasBlur ? 'vraw' : 'v'
    chains.push(`${ordered.map((_, index) => `[v${index}]`).join('')}concat=n=${ordered.length}:v=1:a=0,fps=fps=${rate}:start_time=0${hasBlur ? ',format=rgba' : ''}[${vLabel}]`)
    const blurred = blurPictureChain(`[${vLabel}]`, manifest.blurRegions, chains, maskInputs.blur)
    const picture = pictureEffectChain(zoomPictureChain(blurred, manifest, 'vz', chains), manifest, chains)
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
      const maskInput = maskInputs.clip.get(clip.id)
      // The mask goes on the fitted picture, before opacity and the start padding, so it multiplies
      // whatever transparency `contain` letterboxing already produced.
      const tail = `setsar=1${maskInput === undefined ? `${alpha}${pad}[c${index}]` : `[cf${index}]`}`
      if (clip.kind === 'color') {
        // Generated at exactly the box size: nothing to fit, and no input file behind it.
        colorClipChains(clip, box.width, box.height, rate, `k${index}`, chains, manifest.format.width / COMPOSITION_WIDTH)
        chains.push(`[k${index}]${tail}`)
      } else chains.push(`[${clip.inputIndex}:v:0]trim=duration=${usDecimal(clipSourceLength(clip))},setpts=PTS-STARTPTS${retimeFilter(clip)}${lutChain(clip, lutPaths)},fps=fps=${rate}:start_time=0,format=rgba,`
        + `${fitChain(clip.fit, box.width, box.height, true)},${tail}`)
      if (maskInput !== undefined) {
        chains.push(...maskAlphaChain(`[cf${index}]`, `[${maskInput}:v:0]`, box, `cm${index}`, `cx${index}`))
        chains.push(`[cx${index}]null${alpha ? alpha : ''}${pad}[c${index}]`)
      }
      const next = `[b${index}]`
      chains.push(`${previous}[c${index}]overlay=${box.x}:${box.y}:format=auto:eof_action=pass:repeatlast=0${next}`)
      previous = next
    })
    // The stacked canvas is already rgba (`format=rgba[base]` above, and every overlaid clip is
    // rgba too), so blur needs no extra format conversion here.
    const blurred = blurPictureChain(previous, manifest.blurRegions, chains, maskInputs.blur)
    const picture = pictureEffectChain(zoomPictureChain(blurred, manifest, 'vz', chains), manifest, chains)
    chains.push(`${picture}${layer}overlay=0:0:alpha=straight:format=auto:eof_action=endall:shortest=1,format=yuv420p[outv]`)
  }
  const maps = ['-map', '[outv]']
  // Sound: every video clip's own audio (on an unmuted track, with an audio stream) and every audio
  // clip, each delayed to its sequence position with its own gain, mixed onto silence pinned to the
  // sequence length — the same structure manifest v2 uses for sound effects.
  const sounds = manifest.clips.filter((clip) => clip.kind !== 'image' && clip.kind !== 'color' && clip.gain > 0 && hasAudioByInput[clip.inputIndex!]
    // A speed curve has no steady rate for `atempo`, so its clip is silent (preview matches).
    && isConstantSpeed(clip))
  const hasAudioOut = sounds.length > 0
  if (hasAudioOut) {
    chains.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration},aformat=sample_fmts=fltp:channel_layouts=stereo[abase]`)
    sounds.forEach((clip, index) => {
      const delaySamples = Math.round(clip.timelineStartUs * 48000 / 1_000_000)
      chains.push(`[${clip.inputIndex}:a:0]atrim=duration=${usDecimal(clipSourceLength(clip))},asetpts=PTS-STARTPTS,${clip.speed ? `${atempoChain(constantRate(clip))},` : ''}`
        + `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=delays=${delaySamples}S:all=1,volume=${clip.gain.toFixed(6)}[s${index}]`)
    })
    chains.push(`[abase]${sounds.map((_, index) => `[s${index}]`).join('')}amix=inputs=${sounds.length + 1}:normalize=0:duration=first[outa]`)
    maps.push('-map', '[outa]')
  }
  return { filterComplex: chains.join(';'), maps, hasAudioOut }
}

/** Input options per clip: video/audio seek to their source range; images loop for their length. */
function inputArguments(manifest: ExportManifestV3, rate: string): string[] {
  const clipByInput = new Map(manifest.clips.flatMap((clip) => clip.inputIndex === undefined ? [] : [[clip.inputIndex, clip] as const]))
  return manifest.inputs.flatMap((input, index) => {
    const clip = clipByInput.get(index)
    if (!clip) throw new Error(`Export input ${index} is not used by any clip.`)
    const length = usDecimal(clipSourceLength(clip))
    if (input.kind === 'image') return ['-loop', '1', '-framerate', rate, '-t', length, '-i', input.path]
    return ['-ss', usDecimal(clip.sourceStartUs), '-t', length, ...(input.kind === 'video' ? ['-autorotate'] : []), '-i', input.path]
  })
}

export function exportArgumentsV3(manifest: ExportManifestV3, outputPath: string, hasAudioByInput: readonly boolean[], filterComplexScriptPath?: string, encoding?: ExportEncoding, maskFiles: readonly string[] = [], preparedGraph?: ExportFilterGraph, videoEncoder: VideoEncoderId = DEFAULT_VIDEO_ENCODER): string[] {
  const { width, height, frameRate } = manifest.format
  const rate = `${frameRate.numerator}/${frameRate.denominator}`
  const graph = preparedGraph ?? exportFilterGraphV3(manifest, hasAudioByInput)
  const targets = maskTargets(manifest)
  if (maskFiles.length !== targets.length) throw new Error(`Export needs ${targets.length} rasterized mask images, got ${maskFiles.length}.`)
  // One looping still per masked layer, as long as that layer, so no decoder or frame is shared.
  const maskInputArguments = targets.flatMap((target, index) => ['-loop', '1', '-framerate', rate, '-t', usDecimal(target.lengthUs), '-i', maskFiles[index]])
  const plan: ExportPlan = { width, height, frameRate, range: { startUs: 0, endUs: manifest.sequenceDurationUs } }
  return ['-v', 'error', '-nostdin', '-n', '-stats_period', '0.25', ...inputArguments(manifest, rate),
    '-thread_queue_size', '1', '-f', 'image2pipe', '-framerate', rate, '-c:v', 'png', '-i', 'pipe:0', ...maskInputArguments,
    ...(filterComplexScriptPath ? ['-/filter_complex', filterComplexScriptPath] : ['-filter_complex', graph.filterComplex]), ...graph.maps,
    ...(graph.hasAudioOut ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : ['-an']),
    ...videoEncoderArguments(videoEncoder, videoBitrate(width, height, encoding)), '-pix_fmt', videoEncoderPixelFormat(videoEncoder),
    '-r', rate, '-fps_mode', 'cfr', '-frames:v', String(exportFrameCountFor(exportOutputDurationUs(plan, manifest), frameRate)), '-t', usDecimal(manifest.sequenceDurationUs),
    '-map_metadata', '-1', '-metadata:s:v:0', 'rotate=0', '-movflags', '+faststart', '-f', 'mp4', '-progress', 'pipe:1', outputPath]
}
