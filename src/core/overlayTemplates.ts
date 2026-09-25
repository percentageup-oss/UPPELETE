import type { Shape, TextOverlay } from './edit'
import type { Size } from './composition'
import { fitGeometryToBlock, placeTextCentered, type FitPadding } from './fitToText'
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from '../captions/style'

/** A text member a template contains, named by `key`. The UI measures each one and passes the block size to `template-insert`. */
export type TemplateText = { key: string; text: string; style: CaptionStyle }
export type MeasuredBlock = { width: number; height: number }

export type TemplateBuildInput = {
  startUs: number; endUs: number
  /** Where the template's centre goes, in composition units. */
  at: { x: number; y: number }
  composition: Size
  /** One new id per member key. */
  ids: Readonly<Record<string, string>>
  /** Measured text block size per text key (`textBlockBounds`); templates fit their shapes to these. */
  measured: Readonly<Record<string, MeasuredBlock>>
}
export type TemplateBuild = { shapes: Shape[]; texts: TextOverlay[] }

/** One insertable template. `build` is pure: everything it needs arrives in its input, so replaying a command gives the same items. */
export type TemplateBuilder = {
  id: string
  name: string
  /** Every member key, shapes and texts alike; `template-insert` needs an id for each. */
  memberKeys: readonly string[]
  /** The text members, so a caller can measure them before inserting. */
  texts: readonly TemplateText[]
  build: (input: TemplateBuildInput) => TemplateBuild
}

const registry = new Map<string, TemplateBuilder>()

/** Adds a template. Later catalogue slices call this; a duplicate id is a programming error. */
export function registerTemplate(builder: TemplateBuilder): void {
  if (registry.has(builder.id)) throw new Error(`Template “${builder.id}” is already registered.`)
  registry.set(builder.id, builder)
}
export const getTemplate = (id: string): TemplateBuilder | undefined => registry.get(id)
export const listTemplates = (): TemplateBuilder[] => [...registry.values()]

/** A title with every effect off, for template text that sits on its own shape. */
export function plainTemplateStyle(changes: Partial<CaptionStyle['appearance']> = {}): CaptionStyle {
  return { ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, shadowEnabled: false, strokeEnabled: false, glowEnabled: false, backgroundEnabled: false, depthEnabled: false, ...changes } }
}

/**
 * Centres a title on `at` (as far as the safe area allows) and returns it with the rect a shape needs to hold it.
 * Shared by templates so each one places and fits the same way.
 */
export function placeAndFit(text: TemplateText, id: string, input: TemplateBuildInput): { overlay: TextOverlay; center: { x: number; y: number }; block: MeasuredBlock } {
  const block = input.measured[text.key]
  if (!block) throw new Error(`Template text “${text.key}” was not measured.`)
  const placed = placeTextCentered(input.at, block, text.style, input.composition)
  const overlay: TextOverlay = { id, text: text.text, startUs: input.startUs, endUs: input.endUs,
    style: { ...text.style, appearance: { ...text.style.appearance, horizontal: placed.horizontal, vertical: placed.vertical } },
    enter: { kind: 'fade', durationUs: 250_000 }, exit: { kind: 'fade', durationUs: 250_000 }, layerOrder: 2 }
  return { overlay, center: placed.center, block }
}

const SAMPLE_TEXT: TemplateText = { key: 'text', text: 'Hello there', style: plainTemplateStyle({ fontSize: 48, primaryColor: '#FFFFFF', maxLines: 2 }) }
const SAMPLE_PADDING: FitPadding = [32, 20]

/** A small speech bubble: proves the pieces (bubble geometry, fit, group) work together. The catalogue arrives in later slices. */
registerTemplate({
  id: 'sample-bubble', name: 'Speech bubble', memberKeys: ['bubble', 'text'], texts: [SAMPLE_TEXT],
  build(input) {
    const { overlay, center, block } = placeAndFit(SAMPLE_TEXT, input.ids.text, input)
    const fitted = fitGeometryToBlock({ kind: 'bubble', rect: { x: 0, y: 0, width: 1, height: 1 }, cornerRadius: 36, rotation: 0,
      tail: { side: 'bottom', offset: 0.18, width: 44, length: 34, curve: 0.5 } }, center, block, SAMPLE_PADDING)
    if (!fitted) throw new Error('A bubble can always be fitted.')
    const shape: Shape = { id: input.ids.bubble, name: 'Bubble', startUs: input.startUs, endUs: input.endUs, geometry: fitted.geometry,
      stroke: null, fill: { color: '#1F2937', opacity: 1 }, arrowStart: 'none', arrowEnd: 'none', opacity: 1,
      enter: { kind: 'pop', durationUs: 300_000 }, exit: { kind: 'fade', durationUs: 250_000 }, layerOrder: 1,
      fitTo: overlay.id, fitPadding: [SAMPLE_PADDING[0], SAMPLE_PADDING[1]] }
    return { shapes: [shape], texts: [overlay] }
  },
})
