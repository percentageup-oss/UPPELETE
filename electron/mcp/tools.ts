import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AgentRequest, AgentResponse, ProjectSummary } from '../../src/core/agentProtocol'
import { listStyleOptions } from '../../src/core/agentProtocol'
import { editCommandSchema } from '../../src/core/editCommandSchema'
import { captionAppearanceSchema, motionSchema, motionSpeedSchema, type CaptionStyle } from '../../src/captions/style'
import { CAPTION_TEMPLATES } from '../../src/captions/templates'

export type McpToolDeps = {
  /** The one round trip to the renderer's project state (`electron/mcp/rendererBridge.ts`). */
  askRenderer: (request: AgentRequest) => Promise<AgentResponse>
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

const cueTarget = z.strictObject({ startUs: z.number().int().nonnegative(), endUs: z.number().int().positive() }).optional()

/** Registers the slice-2 tool set (docs/MCP.md): project inspection, the batched edit command,
 * caption styling and playhead/selection/history control. Media, transcription and export tools
 * are added in a later slice once main-side dependencies (probing, jobs, export) join `McpToolDeps`. */
export function registerTools(server: McpServer, deps: McpToolDeps): void {
  server.registerTool('get_project', {
    title: 'Get project',
    description: 'Overview of the open KathaCut project: title, output format, assets, tracks, clips, blur regions, frame-paint effects (vignette/letterbox/fade), caption style, caption count, the playhead position and current selection (sequence microseconds), and any validation warnings. Call this first to orient yourself.',
    inputSchema: {},
  }, async () => relay(deps, { id: randomUUID(), kind: 'get-state' }, stateOf))

  server.registerTool('get_captions', {
    title: 'Get captions',
    description: "Lists captions (cues). Units are microseconds. Each cue's startUs/endUs are in the SOURCE time of the video it names (mediaAssetId) — not sequence time; `range` filters by a cue's own stored time. Pass `words: true` to include per-word timing for placing word-anchored edits or fillers.",
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
    inputSchema: { commands: z.array(editCommandSchema).min(1).max(200) },
  }, async ({ commands }) => relay(deps, { id: randomUUID(), kind: 'run-commands', commands }, outcomesOf))

  server.registerTool('seek', {
    title: 'Seek',
    description: 'Moves the playhead to a sequence-time position (microseconds) so the user sees what you are looking at.',
    inputSchema: { sequenceUs: z.number().int().nonnegative() },
  }, async ({ sequenceUs }) => relay(deps, { id: randomUUID(), kind: 'seek', sequenceUs }, stateOf))

  server.registerTool('select', {
    title: 'Select',
    description: 'Selects a caption, clip, blur region, frame-paint effect or marker (or clears the selection with a null id), highlighting it in the editor.',
    inputSchema: {
      kind: z.enum(['cue', 'clip', 'blur', 'effect', 'text', 'marker']).nullable(),
      id: z.string().min(1).nullable(),
    },
  }, async ({ kind, id }) => relay(deps, { id: randomUUID(), kind: 'select', selection: kind && id ? { kind, id } : null }, stateOf))

  server.registerTool('undo', {
    title: 'Undo',
    description: 'Undoes the most recent project edit (yours or the user\'s) — the same history every ⌘/Ctrl+Z in the app uses.',
    inputSchema: {},
  }, async () => relay(deps, { id: randomUUID(), kind: 'undo' }, stateOf))

  server.registerTool('redo', {
    title: 'Redo',
    inputSchema: {},
  }, async () => relay(deps, { id: randomUUID(), kind: 'redo' }, stateOf))

  server.registerTool('list_style_options', {
    title: 'List style options',
    description: 'Motion presets, installed font choices, built-in caption templates, and every caption-appearance field with its valid range/options — read this before calling set_caption_style to build a valid value instead of guessing.',
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
    inputSchema: { templateId: z.enum(CAPTION_TEMPLATES.map((template) => template.id) as [string, ...string[]]) },
  }, async ({ templateId }) => {
    const template = CAPTION_TEMPLATES.find((candidate) => candidate.id === templateId)
    if (!template) return errorText(`Unknown template id "${templateId}".`)
    return relay(deps, { id: randomUUID(), kind: 'run-commands', commands: [{ type: 'apply-template', style: template.style, idPrefix: randomUUID() }] }, stateOf)
  })
}
