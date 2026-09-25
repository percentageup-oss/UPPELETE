import { isClosedShapeGeometry, type Arrowhead, type BubbleTail, type Shape, type ShapeAnimation, type ShapeGeometry, type TextOverlay } from './edit'
import type { Size } from './composition'
import { fitGeometryToBlock, placeTextCentered, type FitPadding } from './fitToText'
import { LIQUID_GLASS_PRESET } from './glassMap'
import { shapeBox } from './shapePath'
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from '../captions/style'

/** A text member a template contains, named by `key`. The UI measures each one and passes the block size to `template-insert`. */
export type TemplateText = { key: string; text: string; style: CaptionStyle }
export type MeasuredBlock = { width: number; height: number }
export type Point = { x: number; y: number }

export type TemplateBuildInput = {
  startUs: number; endUs: number
  /** Where the template's centre goes, in composition units. */
  at: Point
  composition: Size
  /** One new id per member key. */
  ids: Readonly<Record<string, string>>
  /** Measured text block size per text key (`textBlockBounds`); templates fit their shapes to these. */
  measured: Readonly<Record<string, MeasuredBlock>>
  /** True when the caller asked for the Liquid Glass look: templates give it to the shapes marked `glass`. */
  glass?: boolean
}
export type TemplateBuild = { shapes: Shape[]; texts: TextOverlay[] }

/** The catalogue tabs in the Overlays panel. Later slices add their own. */
export type TemplateCategory = 'chat' | 'callouts' | 'cards' | 'labels'

/** One insertable template. `build` is pure: everything it needs arrives in its input, so replaying a command gives the same items. */
export type TemplateBuilder = {
  id: string
  name: string
  description: string
  category: TemplateCategory
  /** True when at least one shape honours the `glass` input. */
  supportsGlass: boolean
  /** Every member key, shapes and texts alike; `template-insert` needs an id for each. */
  memberKeys: readonly string[]
  /** The text members, so a caller can measure them before inserting. */
  texts: readonly TemplateText[]
  build: (input: TemplateBuildInput) => TemplateBuild
}

const registry = new Map<string, TemplateBuilder>()

/** Adds a template. Catalogue files call this; a duplicate id is a programming error. */
export function registerTemplate(builder: TemplateBuilder): void {
  if (registry.has(builder.id)) throw new Error(`Template “${builder.id}” is already registered.`)
  registry.set(builder.id, builder)
}
export const getTemplate = (id: string): TemplateBuilder | undefined => registry.get(id)
export const listTemplates = (): TemplateBuilder[] => [...registry.values()]

/** Title font for template text: Helvetica Neue/Arial first, then the caption stack that carries the Malayalam fallbacks. */
export const TEMPLATE_FONT = 'Helvetica Neue'

/** A title with every effect off, for template text that sits on its own shape. */
export function plainTemplateStyle(changes: Partial<CaptionStyle['appearance']> = {}): CaptionStyle {
  return { ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, shadowEnabled: false, strokeEnabled: false, glowEnabled: false, backgroundEnabled: false, depthEnabled: false, ...changes } }
}

/** Template text: plain, one font, left to the shared layout for wrapping and Malayalam shaping. */
export const templateTextStyle = (fontSize: number, color: string, changes: Partial<CaptionStyle['appearance']> = {}): CaptionStyle =>
  plainTemplateStyle({ fontFamily: TEMPLATE_FONT, fontSize, primaryColor: color, fontWeight: 500, maxLines: 3, ...changes })

/** Delay in microseconds, capped at half the template's length so a short insert still shows every member. */
export const delayUs = (input: Pick<TemplateBuildInput, 'startUs' | 'endUs'>, delayMs = 0): number =>
  Math.max(0, Math.min(Math.round(delayMs * 1000), Math.floor((input.endUs - input.startUs) / 2)))

export const POP: ShapeAnimation = { kind: 'pop', durationUs: 300_000 }
export const FADE: ShapeAnimation = { kind: 'fade', durationUs: 250_000 }
export const draw = (durationUs = 500_000): ShapeAnimation => ({ kind: 'draw', durationUs })

export type PlacedText = { overlay: TextOverlay; center: Point; block: MeasuredBlock }
export type PlaceOptions = { center?: Point; delayMs?: number; enter?: TextOverlay['enter'] }

/**
 * Centres a title on `options.center` (default: the template's centre, as far as the safe area allows) and
 * returns it with the rect a shape needs to hold it. Shared by templates so each one places and fits the same way.
 */
export function placeAndFit(text: TemplateText, id: string, input: TemplateBuildInput, options: PlaceOptions = {}): PlacedText {
  const block = input.measured[text.key]
  if (!block) throw new Error(`Template text “${text.key}” was not measured.`)
  const placed = placeTextCentered(options.center ?? input.at, block, text.style, input.composition)
  const overlay: TextOverlay = { id, text: text.text, startUs: input.startUs + delayUs(input, options.delayMs), endUs: input.endUs,
    style: { ...text.style, appearance: { ...text.style.appearance, horizontal: placed.horizontal, vertical: placed.vertical } },
    enter: options.enter ?? { kind: 'fade', durationUs: 250_000 }, exit: { kind: 'fade', durationUs: 250_000 }, layerOrder: 2 }
  return { overlay, center: placed.center, block }
}

/** A title that pops in, for chat bubbles and cards. */
export const POP_TEXT: TextOverlay['enter'] = { kind: 'pop', durationUs: 300_000 }

export const rectAround = (center: Point, width: number, height: number) => ({ x: center.x - width / 2, y: center.y - height / 2, width, height })
export const rectGeometry = (rect: { x: number; y: number; width: number; height: number }, cornerRadius = 0, rotation = 0): ShapeGeometry =>
  ({ kind: 'rect', rect, cornerRadius, rotation })
export const ellipseGeometry = (rect: { x: number; y: number; width: number; height: number }, rotation = 0): ShapeGeometry =>
  ({ kind: 'ellipse', rect, rotation })
export const bubbleGeometry = (rect: { x: number; y: number; width: number; height: number }, cornerRadius: number, tail: BubbleTail, rotation = 0): ShapeGeometry =>
  ({ kind: 'bubble', rect, cornerRadius, tail, rotation })

export type TemplateShapeSpec = {
  key: string
  name: string
  geometry: ShapeGeometry
  fill?: { color: string; opacity?: number } | null
  stroke?: { color: string; width: number; dash?: 'solid' | 'dashed' | 'dotted' } | null
  delayMs?: number
  enter?: ShapeAnimation
  layerOrder?: number
  arrowEnd?: Arrowhead
  /** Size the box to this title (the shape then stores `fitTo`, so editing the text refits it). */
  fit?: { placed: PlacedText; padding: FitPadding; maxWidth?: number }
  /** Takes the Liquid Glass look when the caller asked for it. */
  glass?: boolean
  /** Overrides on the Liquid Glass preset for this shape (the default tint is 35%). */
  glassTuning?: { blur?: number; tintOpacity?: number }
}

const REVEAL_KINDS: readonly string[] = ['draw', 'sweep', 'grow']

/** Builds one template shape: timing, fit, glass and the stored defaults every shape needs. */
export function templateShape(input: TemplateBuildInput, spec: TemplateShapeSpec): Shape {
  const id = input.ids[spec.key]
  if (!id) throw new Error(`Template shape “${spec.key}” has no id.`)
  let geometry = spec.geometry
  if (spec.fit) {
    const fitted = fitGeometryToBlock(geometry, spec.fit.placed.center, spec.fit.placed.block, spec.fit.padding, spec.fit.maxWidth)
    if (!fitted) throw new Error(`Template shape “${spec.key}” cannot be fitted to text.`)
    geometry = fitted.geometry
  }
  const enter = spec.enter ?? POP
  const glassOk = spec.glass && input.glass && isClosedShapeGeometry(geometry) && !REVEAL_KINDS.includes(enter.kind)
  return {
    id, name: spec.name, startUs: input.startUs + delayUs(input, spec.delayMs), endUs: input.endUs, geometry,
    stroke: spec.stroke ? { color: spec.stroke.color, width: spec.stroke.width, dash: spec.stroke.dash ?? 'solid', cap: 'round' } : null,
    fill: spec.fill ? { color: spec.fill.color, opacity: spec.fill.opacity ?? 1 } : null,
    arrowStart: 'none', arrowEnd: spec.arrowEnd ?? 'none', opacity: 1, enter, exit: FADE, layerOrder: spec.layerOrder ?? 1,
    ...(spec.fit ? { fitTo: spec.fit.placed.overlay.id, fitPadding: [spec.fit.padding[0], spec.fit.padding[1]] as [number, number] } : {}),
    ...(glassOk ? { glass: { ...LIQUID_GLASS_PRESET, tintOpacity: 0.35, ...spec.glassTuning, shadow: { ...LIQUID_GLASS_PRESET.shadow } } } : {}),
  }
}

/** The rect a shape covers before rotation, for placing members relative to a fitted box. */
export const boxOf = (shape: Shape) => shapeBox(shape.geometry)
