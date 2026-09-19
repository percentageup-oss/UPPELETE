import { exportBitrate, exportFrameCountFor, exportOutputDurationUs, normalizeManifest, usDecimal, type ExportManifest, type ExportManifestV2, type ExportPlan } from '../../src/export/plan'

/**
 * Builds the encoder invocation deterministically from the export plan and the versioned manifest.
 * Nothing here reads renderer state or accepts arbitrary flags — main sends a manifest, this turns
 * it into an argument array (docs/EDITING.md, docs/MEDIA_WORKER.md).
 *
 * **Parity rule for V1:** an identity edit with no effects must produce byte-for-byte the argument
 * array X2 ships today, so an unedited project re-encodes exactly as before. Cuts (`segments`) are
 * V6's trim/concat branch below; sound effects are V3's `amix` branch below; blur remains V4's
 * work, so a manifest carrying blur regions is still refused rather than silently exporting without
 * the effect.
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
 * Refuses a manifest this ticket cannot honestly encode. Image overlays reach the export host from
 * V2 (`frameRequestAt` emits them per-frame; the host paints them into the same transparent layer as
 * captions — FFmpeg never sees them); sound effects reach FFmpeg's own `amix` graph from V3 below.
 * Nothing in V1's UI can produce blur regions yet — that command has no entry point until V4 — so
 * it remains a guard against a future caller silently getting a video without the effect, not a
 * reachable user-facing error today.
 */
export function assertExportableManifest(manifest: ExportManifestV2): void {
  if (manifest.blurRegions.length) {
    throw new Error('Blur regions are not part of the exported video yet; they reach FFmpeg in ticket V4.')
  }
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
export function exportFilterGraph(plan: ExportPlan, hasAudio: boolean, manifest?: ExportManifest): ExportFilterGraph {
  // No manifest means the caller has nothing to encode beyond captions — the identity edit.
  const edits = manifest ? normalizeManifest(manifest) : undefined
  if (edits) assertExportableManifest(edits)
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
  // rather than cropping, then flatten the caption/overlay layer over it.
  chains.push(`${videoInput}fps=fps=${rate}:start_time=0,scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v]`)
  chains.push(`[v][1:v:0]overlay=0:0:alpha=straight:format=auto:eof_action=endall:shortest=1,format=yuv420p[outv]`)
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
export function exportArguments(inputPath: string, outputPath: string, plan: ExportPlan, hasAudio: boolean, manifest?: ExportManifest, filterComplexScriptPath?: string): string[] {
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
