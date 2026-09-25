import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AgentRequest, AgentResponse, ProjectSummary } from '../../src/core/agentProtocol'
import { listStyleOptions } from '../../src/core/agentProtocol'
import { editCommandSchema } from '../../src/core/editCommandSchema'
import { captionAppearanceSchema, motionSchema, motionSpeedSchema, type CaptionStyle } from '../../src/captions/style'
import { CAPTION_TEMPLATES, titleTemplateChanges } from '../../src/captions/templates'
import { listCreativeOptions } from '../../src/core/creativeOptions'
import { compositionRectSchema } from '../../src/core/edit'
import { defaultTextOverlay } from '../../src/core/textCommands'
import { defaultShape, SHAPE_PRESETS } from '../../src/core/shapeCommands'
import { resolveWordAnchor, type WordAnchor } from '../../src/core/wordAnchor'
import type { InspectedFile } from '../../src/core/assetImport'
import type { ReferenceMime } from './referenceImage'

export type McpToolDeps = {
  /** The one round trip to the renderer's project state (`electron/mcp/rendererBridge.ts`). */
  askRenderer: (request: AgentRequest) => Promise<AgentResponse>
  /** Captures a viewport rect (CSS px) of the project window as a downscaled JPEG (`electron/mcp/ipc.ts`). Absent in tests that do not exercise `render_frame`. */
  /** Reads the reference picture for `match_color_to_reference` from an image path or the clipboard (`electron/mcp/ipc.ts`); throws a user-readable message. */
  readReference?: (source: { imagePath?: string; fromClipboard?: boolean }) => Promise<{ imageBase64: string; mimeType: ReferenceMime }>
  /** Lands whatever the agent handed over (path, clipboard, base64, https url) on disk and probes it the way a dragged-in file is (`electron/mcp/ipc.ts`); throws a user-readable message. */
  importSource?: (source: { path?: string; fromClipboard?: boolean; imageBase64?: string; url?: string }) => Promise<Extract<InspectedFile, { ok: true; kind: 'image' | 'audio' | 'video' }>>
  captureRect?: (rect: { x: number; y: number; width: number; height: number }) => Promise<{ data: string; mimeType: 'image/jpeg'; width: number; height: number }>
}

const text = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })
const errorText = (message: string): CallToolResult => ({ content: [{ type: 'text', text: message }], isError: true })

/** Every tool's shared shape: forward the renderer's `ok: false` as a tool error rather than
 * throwing, so the agent sees the actual validation/command message instead of a generic failure. */
async function relay(deps: McpToolDeps, request: AgentRequest, onOk: (response: Extract<AgentResponse, { ok: true }>) => unknown): Promise<CallToolResult> {
  const response = await deps.askRenderer(request)
  if (!response.ok) return errorText(response.message)
  return text(onOk(response))
}

/** Narrows one of the several `ok: true` response shapes down to the ones that carry `state`
 * (get-state, run-commands, seek, select, undo, redo) — every tool below that expects a project
 * summary back goes through this rather than asserting the shape blindly. */
function stateOf(response: Extract<AgentResponse, { ok: true }>): ProjectSummary {
  if ('state' in response) return response.state
  throw new Error('Expected a response carrying the project state.')
}

/** Same narrowing for the get-captions response — used instead of forwarding it whole, which would
 * also leak the internal request id into the tool result. */
function captionsOf(response: Extract<AgentResponse, { ok: true }>) {
  if ('captions' in response) return { captions: response.captions, total: response.total }
  throw new Error('Expected a response carrying captions.')
}

function outcomesOf(response: Extract<AgentResponse, { ok: true }>) {
  if ('outcomes' in response) return { outcomes: response.outcomes, failedIndex: response.failedIndex, state: response.state }
  throw new Error('Expected a response carrying command outcomes.')
}

/** Guidance for an agent asked to enhance a video from its transcript. Served both as the MCP server's
 * `instructions` (every client sees it at initialize) and as the `auto_edit` prompt. */
export const EDITING_GUIDE = `You are directing a KathaCut edit. Work like a senior editor who has watched the footage: the user should never have to name a VHS overlay, a moving grid or a zoom - you decide, apply and explain. When asked to edit, enhance or "make it better", do the whole job without asking what to add.
1. Orient: call get_project, then get_transcript (words: true for exact timing). Transcript times are SEQUENCE microseconds, the same clock as clips, zoom regions, effects and titles - never mix in get_captions' source times.
2. Look before you plan: call render_frame at about 4 evenly spaced times to judge framing, setting and the footage's existing colour.
3. Diagnose the genre, tone, pace and platform (aspect ratio). Call list_creative_options once and commit to ONE styleRecipe, stating it in a line. Every look, background, title and effect carries mood/useWhen/avoidWhen - follow them; never invent ids or ranges.
4. Map beats to tools: emphasis, a punchline or a number -> a punch-in zoom landed on the word; a topic change -> a title; a nostalgia or "back then" reference -> a short VHS (plus grain) then back to clean footage; tech, AI or startup bridges -> the moving grid background under a callout or picture-in-picture; pauses and gaps -> a background clip; a named person, place, product or object -> an image (import_media, then place_at_word).
5. Density and restraint: follow the recipe's zoom rhythm, never zoom back to back, do not stack effects, keep the first 1-2 seconds of a hook clean and effects short. Every addition needs a reason you can state.
6. Images: use what the user gave you (files, clipboard) first. Otherwise you may import a public https image url; the user is responsible for image licensing, so name the source. place_at_word reports when a word's timing is only estimated - tell the user then.
7. Apply as much as possible in ONE edit call so it undoes in one step; add_title, set_caption_style, import_media and place_at_word are their own undo steps - say how many. If a command fails nothing commits: fix the reported index and retry.
8. Verify with render_frame at the busiest beats, fix what looks wrong, seek the playhead to the result, then report the style you chose, what you added and why, and that Ctrl/Cmd+Z reverts each step.
The user's explicit instructions always override the recipe. Never rewrite caption text unless asked; captions the user corrected are protected. Malayalam and English text can be mixed - keep text exactly as transcribed.`

const cueTarget = z.strictObject({ startUs: z.number().int().nonnegative(), endUs: z.number().int().positive() }).optional()

/** Registers the tool set (docs/MCP.md): project inspection, the batched edit command,
 * caption styling and playhead/selection/history control. Media, transcription and export tools
 * are added in a later slice once main-side dependencies (probing, jobs, export) join `McpToolDeps`. */
export function registerTools(server: McpServer, deps: McpToolDeps): void {
  server.registerTool('get_project', {
    title: 'Get project',
    description: 'Overview of the open KathaCut project: title, output format, assets, tracks, clips, blur regions, frame-paint effects (vignette/letterbox/fade), caption style, caption count, the playhead position and current selection (sequence microseconds), and any validation warnings. Call this first to orient yourself.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    inputSchema: {},
  }, async () => relay(deps, { id: randomUUID(), kind: 'get-state' }, stateOf))

  server.registerTool('get_captions', {
    title: 'Get captions',
    description: "Lists captions (cues). Units are microseconds. Each cue's startUs/endUs are in the SOURCE time of the video it names (mediaAssetId) — not sequence time; `range` filters by a cue's own stored time. Pass `words: true` to include per-word timing for placing word-anchored edits or fillers.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    inputSchema: {
      range: cueTarget.describe('Only cues overlapping this source-time range, in the range\'s own video.'),
      cueIds: z.array(z.string().min(1)).max(500).optional().describe('Only these cue ids.'),
      words: z.boolean().optional().describe('Include each cue\'s word-level timing (default false).'),
      limit: z.number().int().positive().max(500).optional(),
      offset: z.number().int().nonnegative().optional(),
    },
  }, async (args) => relay(deps, { id: randomUUID(), kind: 'get-captions', ...args }, captionsOf))

  server.registerTool('edit', {
    title: 'Edit',
    description: 'Applies one or more editing commands as a SINGLE undo step — nothing commits if any command fails, and the failing index is returned so you can fix and retry. This is the same command set the UI itself uses (captions, assets, tracks, clips, blur regions, frame-paint effects, markers): see `get_project`/`get_captions` for current ids, and `list_style_options` for style fields. Composition is 1080 units wide by 1080/aspect tall. `clip-update` `changes.speed` sets a video/audio clip\'s speed as {points:[{sourceUs,rate}]} (rate 0.1–10, points in increasing asset source time; one point = constant speed, several = a ramp that is silent; null clears). A speed change ripples later clips on that track. `clip-add` with `clip.kind: "adjustment"` places a DaVinci-style adjustment layer (a video-track clip with no asset) that grades every video/image clip on the tracks below it, for its own time range — never a `color` (generated background) clip; `changes.grade` (clip-update, adjustment clips only) sets its input (none/a built-in camera log profile/a `lut`-kind asset id), primaries (exposure/white-balance/contrast/highlights-shadows/lift-gamma-gain/saturation), an optional built-in look by id, and intensity (0 bakes to no effect). `get_project`\'s `clips[].grade` reports the current grade of any adjustment clip.',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
    inputSchema: { commands: z.array(editCommandSchema).min(1).max(200) },
  }, async ({ commands }) => relay(deps, { id: randomUUID(), kind: 'run-commands', commands }, outcomesOf))

  server.registerTool('get_transcript', {
    title: 'Get transcript',
    description: 'The spoken transcript in SEQUENCE time (the timeline you see, after cuts and speed changes), so it lines up directly with clips, zoom regions, effects and titles. Cues in removed ranges are left out (see `omitted`). Pass `words: true` for word timing, `range` to filter by sequence time. Prefer this over get_captions when planning edits.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    inputSchema: {
      range: cueTarget.describe('Only cues overlapping this sequence-time range.'),
      words: z.boolean().optional().describe("Include each cue's word-level timing (default false)."),
      limit: z.number().int().positive().max(500).optional(),
      offset: z.number().int().nonnegative().optional(),
    },
  }, async (args) => relay(deps, { id: randomUUID(), kind: 'get-transcript', ...args }, (response) => {
    if ('captions' in response) return { cues: response.captions, total: response.total, omitted: response.omitted ?? 0 }
    throw new Error('Expected a response carrying captions.')
  }))

  server.registerTool('list_creative_options', {
    title: 'List creative options',
    description: 'Looks (color grades), background presets, title treatments, effect and zoom guidance, style recipes, and JSON schemas for zoom regions, effects, titles, backgrounds and grades. Each look, background, title and effect says when to use it (mood/useWhen/avoidWhen) so you can choose without being told; pick one styleRecipe and stay consistent. Read once before planning zooms, titles, backgrounds, effects or color.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    inputSchema: {},
  }, async () => text(listCreativeOptions()))

  const titleTemplates = CAPTION_TEMPLATES.filter((template) => template.title)
  server.registerTool('add_title', {
    title: 'Add title',
    description: `Adds one animated title (text layer) using a built-in treatment, as a single undo step. Times are SEQUENCE microseconds. templateId: ${titleTemplates.map((template) => template.id).join(', ')} (default ${titleTemplates[0]?.id}). \`vertical\` is the title's vertical position, 0 (top) to 1 (bottom); default 0.5. Use \`edit\` text-update for finer changes afterwards.`,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    inputSchema: {
      text: z.string().trim().min(1).max(2000),
      startUs: z.number().int().nonnegative(),
      endUs: z.number().int().positive(),
      templateId: z.enum(titleTemplates.map((template) => template.id) as [string, ...string[]]).optional(),
      vertical: z.number().min(0).max(1).optional(),
    },
  }, async ({ text: titleText, startUs, endUs, templateId, vertical }) => {
    if (endUs <= startUs) return errorText('endUs must be after startUs.')
    const template = titleTemplates.find((candidate) => candidate.id === (templateId ?? titleTemplates[0]?.id))
    if (!template) return errorText(`Unknown title template "${templateId}".`)
    const base = defaultTextOverlay(randomUUID(), startUs, endUs, titleText)
    const overlay = { ...base, ...titleTemplateChanges(template, base) }
    if (vertical !== undefined) overlay.style = { ...overlay.style, appearance: { ...overlay.style.appearance, vertical } }
    return relay(deps, { id: randomUUID(), kind: 'run-commands', commands: [{ type: 'text-add', overlay }] }, outcomesOf)
  })

  server.registerTool('add_shape', {
    title: 'Add shape',
    description: `Adds one vector graphic (box, circle, arrow, dotted arrow, underline or highlighter) as a single undo step. Times are SEQUENCE microseconds. preset: ${SHAPE_PRESETS.join(', ')}. \`color\` is a #RRGGBB hex that recolours the line (or the fill for highlight). The shape appears centred; place and reshape it afterwards with \`edit\` shape-update (geometry) and time it with shape-move / shape-trim. Lists of presets and the shape schema come from list_creative_options.`,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    inputSchema: {
      preset: z.enum(SHAPE_PRESETS),
      startUs: z.number().int().nonnegative(),
      endUs: z.number().int().positive(),
      color: z.string().regex(/^#[\da-fA-F]{6}$/).optional(),
      compositionHeight: z.number().int().min(16).max(3840).optional().describe('Output frame height in composition units (1080 / aspect); default 608 (16:9). Only used to centre the shape.'),
    },
  }, async ({ preset, startUs, endUs, color, compositionHeight }) => {
    if (endUs <= startUs) return errorText('endUs must be after startUs.')
    const shape = defaultShape(preset, randomUUID(), startUs, endUs, compositionHeight)
    if (color) {
      if (shape.stroke) shape.stroke = { ...shape.stroke, color }
      else if (shape.fill) shape.fill = { ...shape.fill, color }
    }
    return relay(deps, { id: randomUUID(), kind: 'run-commands', commands: [{ type: 'shape-add', shape }] }, outcomesOf)
  })

  const placementFields = {
    durationUs: z.number().int().positive().max(3_600_000_000).optional().describe('How long the picture stays (default 3 s).'),
    rect: compositionRectSchema.optional().describe('Position and size in composition units (1080 wide); default: the standard overlay size for that picture, centred.'),
    trackId: z.string().min(1).max(128).optional().describe('Preferred track; a free one is used when it is occupied.'),
  }
  server.registerTool('import_media', {
    title: 'Import media',
    description: 'Brings an image (or audio/video file) into the project so you can use it. Give exactly one source: `path` (absolute path to an image/audio/video file - e.g. one you downloaded or generated), `fromClipboard: true` (the user just copied an image), `imageBase64` (a small image, up to 5 MB), or `url` (a public https image url, up to 25 MB - the user is responsible for the image\'s licence, so say where it came from). Images are identified by their content, not their name. The same picture imported twice reuses one asset. With `placement`, an IMAGE is also put on the timeline at `sequenceUs` in the SAME undo step (audio/video cannot be placed on import). To put an image on a spoken word, import it without placement and call place_at_word. Never overwrites the user\'s files: bytes you pass are saved to the app\'s own agent-media folder.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    inputSchema: {
      path: z.string().min(1).max(1024).optional(),
      fromClipboard: z.boolean().optional(),
      imageBase64: z.string().min(1).max(7_000_000).optional(),
      url: z.string().min(1).max(2048).optional(),
      placement: z.strictObject({ sequenceUs: z.number().int().nonnegative().describe('Sequence-time start in microseconds.'), ...placementFields }).optional(),
    },
  }, async ({ path: filePath, fromClipboard, imageBase64, url, placement }) => {
    const sources = [filePath !== undefined, fromClipboard === true, imageBase64 !== undefined, url !== undefined].filter(Boolean).length
    if (sources !== 1) return errorText('Give exactly one of path, fromClipboard: true, imageBase64, or url.')
    if (!deps.importSource) return errorText('Importing media is not available in this build.')
    let inspected: Awaited<ReturnType<NonNullable<McpToolDeps['importSource']>>>
    try { inspected = await deps.importSource({ path: filePath, fromClipboard, imageBase64, url }) } catch (error) { return errorText(error instanceof Error ? error.message : 'The media could not be imported.') }
    const { sequenceUs, ...rest } = placement ?? { sequenceUs: 0 }
    return relay(deps, {
      id: randomUUID(), kind: 'import-inspected', inspected: { kind: inspected.kind, media: inspected.media, url: inspected.url },
      ...(placement ? { placement: { startUs: sequenceUs, ...rest } } : {}),
    }, (response) => {
      if ('imported' in response) return { ...response.imported, undo: 'Ctrl/Cmd+Z removes it in one step.' }
      throw new Error('Expected an import result.')
    })
  })

  server.registerTool('place_at_word', {
    title: 'Place image at a spoken word',
    description: 'Puts an image that is already in the project (see import_media / get_project asset ids) on the timeline at a spoken word or phrase, as ONE undo step - e.g. show the company logo when the speaker says its name. Anchor it with `text` (the spoken word or phrase; use `occurrence` when it is said more than once) or with `cueId` + `wordIndex` (+ `wordCount`) from get_transcript. Times are SEQUENCE microseconds, matching get_transcript. `offsetUs` shifts the start (negative = earlier); `durationUs` defaults to the phrase length, at least 1.5 s. If the word\'s timing is only ESTIMATED (not aligned to the audio) the result says so - tell the user it may be off. Fails when the word falls in a removed range.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    inputSchema: {
      assetId: z.string().min(1).max(128),
      text: z.string().trim().min(1).max(200).optional(),
      occurrence: z.number().int().positive().optional().describe('Which occurrence of `text` (1 = first).'),
      cueId: z.string().min(1).max(200).optional(),
      wordIndex: z.number().int().nonnegative().optional(),
      wordCount: z.number().int().positive().max(50).optional(),
      offsetUs: z.number().int().min(-60_000_000).max(60_000_000).optional(),
      ...placementFields,
    },
  }, async ({ assetId, text: anchorText, occurrence, cueId, wordIndex, wordCount, offsetUs, durationUs, rect, trackId }) => {
    const byText = anchorText !== undefined
    const byCue = cueId !== undefined && wordIndex !== undefined
    if (byText === byCue) return errorText('Give either `text`, or both `cueId` and `wordIndex` - not both, not neither.')
    const transcript = await deps.askRenderer({ id: randomUUID(), kind: 'get-transcript', words: true })
    if (!transcript.ok) return errorText(transcript.message)
    if (!('captions' in transcript)) return errorText('Expected a transcript.')
    const wordAnchor: WordAnchor = byText ? { text: anchorText, ...(occurrence ? { occurrence } : {}) } : { cueId: cueId!, wordIndex: wordIndex!, ...(wordCount ? { wordCount } : {}) }
    let anchor: ReturnType<typeof resolveWordAnchor>
    try { anchor = resolveWordAnchor(transcript.captions, wordAnchor) } catch (error) { return errorText(error instanceof Error ? error.message : 'The word could not be found.') }
    const startUs = Math.max(0, anchor.startUs + (offsetUs ?? 0))
    const placement = { startUs, durationUs: durationUs ?? Math.max(anchor.endUs - anchor.startUs, 1_500_000), ...(rect ? { rect } : {}), ...(trackId ? { trackId } : {}) }
    return relay(deps, { id: randomUUID(), kind: 'place-image', assetId, placement }, (response) => {
      if (!('placed' in response)) throw new Error('Expected a placement result.')
      return {
        ...response.placed,
        anchor: { matchedText: anchor.matchedText, cueId: anchor.cueId, wordStartUs: anchor.startUs, wordEndUs: anchor.endUs, occurrences: anchor.totalMatches, timing: anchor.estimated ? 'ESTIMATED - not aligned to the audio; tell the user it may be off' : 'aligned' },
        undo: 'Ctrl/Cmd+Z removes it in one step.',
      }
    })
  })

  server.registerPrompt('auto_edit', {
    title: 'Enhance this video from its transcript',
    description: 'Watch the footage and read the transcript, pick a style, then add zooms, titles, backgrounds, effects and images on your own judgment.',
    argsSchema: { goal: z.string().max(500).optional() },
  }, ({ goal }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `${EDITING_GUIDE}

Goal: ${goal?.trim() || 'Edit this video like a senior editor: choose a coherent style yourself and add the zooms, titles, backgrounds, effects and illustrative images it deserves. I will not tell you what to add.'}` } }] }))

  server.registerTool('render_frame', {
    title: 'Render frame',
    description: 'Shows you the preview exactly as the user sees it (video, zooms, titles, effects, look and captions) at one or more SEQUENCE times, as images. Use it to check your own edits - "did the zoom land on the face?", "is the title readable?", "does the grade match the reference?" - then fix and re-check. Seeks the playhead (visible to the user). The KathaCut window must be visible. Up to 6 times per call; images are downscaled JPEG.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    inputSchema: { sequenceUs: z.array(z.number().int().nonnegative()).min(1).max(6).describe('Sequence-time positions in microseconds.') },
  }, async ({ sequenceUs }) => {
    if (!deps.captureRect) return errorText('Frame capture is not available in this build.')
    const content: CallToolResult['content'] = []
    for (const at of sequenceUs) {
      const prepared = await deps.askRenderer({ id: randomUUID(), kind: 'prepare-snapshot', sequenceUs: at })
      if (!prepared.ok) return errorText(prepared.message)
      if (!('rect' in prepared) || !prepared.rect) return errorText('Expected a preview rectangle to capture.')
      const image = await deps.captureRect(prepared.rect)
      content.push({ type: 'text', text: `Frame at ${at} µs (${image.width}×${image.height})` }, { type: 'image', data: image.data, mimeType: image.mimeType })
    }
    return { content }
  })

  server.registerTool('match_color_to_reference', {
    title: 'Match color to a reference image',
    description: 'Color-grades the video to look like a reference picture. Derives a tone and color transfer (a .cube LUT) from the frame at `sequenceUs` (default: under the playhead) toward the reference, and adds it as ONE adjustment layer over the range (default: the whole program) - one undo step. Give exactly one image source: `imagePath` (absolute path to a png/jpg/webp/gif/bmp), `fromClipboard: true` (the user copied the image just now), or `imageBase64` + `mimeType` (small images only). A statistical match: best when subject and lighting are alike; lower `strength` to soften it. Afterwards call render_frame to check the result and adjust with `edit` (the adjustment clip\'s grade) if needed. If you cannot get the image bytes (e.g. it is only attached in chat), look at it yourself and grade by hand with `edit` instead.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    inputSchema: {
      imagePath: z.string().min(1).max(1024).optional(),
      fromClipboard: z.boolean().optional(),
      imageBase64: z.string().min(1).max(14_000_000).optional(),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']).optional(),
      sequenceUs: z.number().int().nonnegative().optional().describe('Sequence time of the frame to match from; must be on a video clip.'),
      startUs: z.number().int().nonnegative().optional().describe('Start of the range the grade applies to (sequence us).'),
      endUs: z.number().int().positive().optional().describe('End of that range.'),
      strength: z.number().min(0).max(1).optional().describe('0-1, default 1.'),
      name: z.string().trim().min(1).max(100).optional().describe('Name for the saved LUT.'),
    },
  }, async ({ imagePath, fromClipboard, imageBase64, mimeType, sequenceUs, startUs, endUs, strength, name }) => {
    const sources = [imagePath !== undefined, fromClipboard === true, imageBase64 !== undefined].filter(Boolean).length
    if (sources !== 1) return errorText('Give exactly one of imagePath, fromClipboard: true, or imageBase64 (with mimeType).')
    if (imageBase64 !== undefined && !mimeType) return errorText('imageBase64 needs its mimeType.')
    let image: { imageBase64: string; mimeType: ReferenceMime }
    try {
      if (imageBase64 !== undefined) image = { imageBase64, mimeType: mimeType! }
      else if (!deps.readReference) return errorText('Reading a reference image is not available in this build.')
      else image = await deps.readReference({ imagePath, fromClipboard })
    } catch (error) { return errorText(error instanceof Error ? error.message : 'The reference image could not be read.') }
    return relay(deps, {
      id: randomUUID(), kind: 'match-reference', ...image, strength: strength ?? 1,
      ...(sequenceUs !== undefined ? { sequenceUs } : {}), ...(startUs !== undefined ? { startUs } : {}), ...(endUs !== undefined ? { endUs } : {}), ...(name ? { name } : {}),
    }, (response) => {
      if ('match' in response) return { ...response.match, undo: 'Ctrl/Cmd+Z removes the grade in one step.' }
      throw new Error('Expected a match result.')
    })
  })

  server.registerTool('seek', {
    title: 'Seek',
    description: 'Moves the playhead to a sequence-time position (microseconds) so the user sees what you are looking at.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    inputSchema: { sequenceUs: z.number().int().nonnegative() },
  }, async ({ sequenceUs }) => relay(deps, { id: randomUUID(), kind: 'seek', sequenceUs }, stateOf))

  server.registerTool('select', {
    title: 'Select',
    description: 'Selects a caption, clip, blur region, frame-paint effect or marker (or clears the selection with a null id), highlighting it in the editor.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    inputSchema: {
      kind: z.enum(['cue', 'clip', 'blur', 'effect', 'text', 'shape', 'marker']).nullable(),
      id: z.string().min(1).nullable(),
    },
  }, async ({ kind, id }) => relay(deps, { id: randomUUID(), kind: 'select', selection: kind && id ? { kind, id } : null }, stateOf))

  server.registerTool('undo', {
    title: 'Undo',
    description: 'Undoes the most recent project edit (yours or the user\'s) — the same history every ⌘/Ctrl+Z in the app uses.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    inputSchema: {},
  }, async () => relay(deps, { id: randomUUID(), kind: 'undo' }, stateOf))

  server.registerTool('redo', {
    title: 'Redo',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    inputSchema: {},
  }, async () => relay(deps, { id: randomUUID(), kind: 'redo' }, stateOf))

  server.registerTool('list_style_options', {
    title: 'List style options',
    description: 'Motion presets, installed font choices, built-in caption templates, and every caption-appearance field with its valid range/options — read this before calling set_caption_style to build a valid value instead of guessing.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    inputSchema: {},
  }, async () => text(listStyleOptions()))

  const stylePatchShape = {
    motion: motionSchema.optional(),
    motionSpeed: motionSpeedSchema.optional(),
    appearance: captionAppearanceSchema.partial().optional(),
  }
  server.registerTool('set_caption_style', {
    title: 'Set caption style',
    description: 'Patches the project\'s caption style (motion preset and/or appearance fields) and applies it to every caption, same as the Style panel. Only the fields you pass are changed; call get_project first to see the current style, and list_style_options for valid field ranges. If the motion needs word timing that some captions lack, missing timing is filled with review-required estimates.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    inputSchema: stylePatchShape,
  }, async (patch) => {
    const current = await deps.askRenderer({ id: randomUUID(), kind: 'get-state' })
    if (!current.ok) return errorText(current.message)
    const currentStyle = stateOf(current).captionStyle
    const style: CaptionStyle = {
      motion: patch.motion ?? currentStyle?.motion ?? 'static-clean',
      motionSpeed: patch.motionSpeed ?? currentStyle?.motionSpeed ?? 1,
      appearance: { ...currentStyle?.appearance, ...patch.appearance } as CaptionStyle['appearance'],
    }
    return relay(deps, { id: randomUUID(), kind: 'run-commands', commands: [{ type: 'apply-template', style, idPrefix: randomUUID() }] }, stateOf)
  })

  server.registerTool('apply_template', {
    title: 'Apply caption template',
    description: `Applies one of the built-in caption templates by id to every caption. Available ids: ${CAPTION_TEMPLATES.map((template) => template.id).join(', ')} (see list_style_options for names/descriptions).`,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    inputSchema: { templateId: z.enum(CAPTION_TEMPLATES.map((template) => template.id) as [string, ...string[]]) },
  }, async ({ templateId }) => {
    const template = CAPTION_TEMPLATES.find((candidate) => candidate.id === templateId)
    if (!template) return errorText(`Unknown template id "${templateId}".`)
    return relay(deps, { id: randomUUID(), kind: 'run-commands', commands: [{ type: 'apply-template', style: template.style, idPrefix: randomUUID() }] }, stateOf)
  })
}
