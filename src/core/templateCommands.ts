import { COMPOSITION_WIDTH } from './edit'
import type { CaptionProject } from './model'
import { MAX_BLENDING_SHAPES, MAX_PASS_SHAPES, blendingShapes, passShapes } from './graphicsPasses'
import type { MeasuredBlock } from './overlayTemplates'
import { getTemplate } from './overlayTemplateCatalog'
import { sequenceDurationUs } from './timelineModel'
import { failItem, type ItemFailure, type ItemStep } from './itemStep'

/**
 * Inserts a whole template (a group plus its shapes and titles) as one command, so it is one undo step.
 * The command is pure and replayable: the UI measures the template's texts first and passes the sizes in
 * `measured`, and every new id arrives in `ids`.
 */
export type TemplateCommand = {
  type: 'template-insert'
  templateId: string
  startUs: number
  endUs: number
  /** `group` is the new group's id; `items` maps each of the template's member keys to a new item id. */
  ids: { group: string; items: Record<string, string> }
  /** Where the template's centre goes, in composition units. */
  at: { x: number; y: number }
  /** Measured text block size for each text key the template lists in `texts`. */
  measured: Record<string, MeasuredBlock>
  /** Gives the template's glass-capable shapes the Liquid Glass look. Ignored by templates that have none. */
  glass?: boolean
}

const orderKey = (a: { startUs: number; layerOrder: number; id: string }, b: { startUs: number; layerOrder: number; id: string }) =>
  a.startUs - b.startUs || a.layerOrder - b.layerOrder || a.id.localeCompare(b.id)

export function applyTemplateCommand(project: CaptionProject, command: TemplateCommand, compositionHeight?: number | null): ItemStep | ItemFailure {
  const builder = getTemplate(command.templateId)
  if (!builder) return failItem('asset-missing', [command.templateId], `There is no template called “${command.templateId}”.`)
  const durationUs = sequenceDurationUs(project.clips) || Math.max(0, ...project.cues.map((cue) => cue.endUs))
  if (durationUs <= 0) return failItem('invalid-duration', [command.ids.group], 'Add video to the timeline before adding a template.')
  if (!(command.endUs > command.startUs)) return failItem('invalid-duration', [command.ids.group], 'A template needs an end after its start.')
  const missingIds = builder.memberKeys.filter((key) => !command.ids.items[key])
  if (missingIds.length) return failItem('asset-missing', missingIds, `ids.items needs a new ID for: ${missingIds.join(', ')}.`)
  const unmeasured = builder.texts.filter((text) => !command.measured[text.key]).map((text) => text.key)
  if (unmeasured.length) return failItem('value-range', unmeasured, `measured needs a text size for: ${unmeasured.join(', ')}.`)
  const newIds = [command.ids.group, ...builder.memberKeys.map((key) => command.ids.items[key])]
  const inUse = new Set([...project.shapes, ...project.textOverlays].map((item) => item.id))
  if (new Set(newIds).size !== newIds.length || newIds.some((id) => inUse.has(id)) || (project.groups ?? []).some((group) => group.id === command.ids.group)) {
    return failItem('asset-missing', newIds, 'Every new item and the group need a distinct, unused ID.')
  }
  if ((project.groups ?? []).length >= 200) return failItem('value-range', [command.ids.group], 'A project can hold at most 200 groups.')

  const height = compositionHeight && compositionHeight > 0 ? compositionHeight
    : project.format ? COMPOSITION_WIDTH * project.format.height / project.format.width : 608
  const length = Math.max(1, Math.min(command.endUs - command.startUs, durationUs))
  const startUs = Math.max(0, Math.min(command.startUs, durationUs - length))
  let built
  try {
    built = builder.build({ startUs, endUs: startUs + length, at: command.at, composition: { width: COMPOSITION_WIDTH, height },
      ids: command.ids.items, measured: command.measured, glass: command.glass })
  } catch (error) {
    return failItem('value-range', [command.templateId], error instanceof Error ? error.message : 'The template could not be built.')
  }
  const groupId = command.ids.group
  const shapes = [...project.shapes, ...built.shapes.map((shape) => ({ ...shape, groupId }))]
  if (blendingShapes(shapes).length > MAX_BLENDING_SHAPES) return failItem('value-range', [groupId], `A project can blend at most ${MAX_BLENDING_SHAPES} shapes.`)
  if (passShapes(shapes).length > MAX_PASS_SHAPES) return failItem('value-range', [groupId], `A project can hold at most ${MAX_PASS_SHAPES} blending and glass shapes together.`)
  return {
    project: {
      ...project,
      groups: [...(project.groups ?? []), { id: groupId, name: builder.name }],
      shapes: shapes.sort(orderKey),
      textOverlays: [...project.textOverlays, ...built.texts.map((text) => ({ ...text, groupId }))].sort(orderKey),
    },
    selection: { kind: 'group', id: groupId },
  }
}
