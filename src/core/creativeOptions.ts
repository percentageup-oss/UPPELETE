import { z } from 'zod'
import { LOOKS } from '../color/looks'
import { CAPTION_TEMPLATES } from '../captions/templates'
import { titleMotionSchema } from '../captions/style'
import { BACKGROUND_PRESETS } from './backgroundPresets'
import { DEFAULT_BACKGROUND_CLIP_US } from './timelineDrop'
import { BACKGROUND_GUIDANCE, EFFECT_GUIDANCE, LOOK_GUIDANCE, TITLE_GUIDANCE, ZOOM_GUIDANCE } from './editorialGuidance'
import { STYLE_RECIPES } from './styleRecipes'
import { backgroundMotionSchema, effectRegionSchema, fillSchema, gradeSchema, shapeSchema, textAnimationSchema, zoomRegionSchema } from './edit'
import { SHAPE_PRESETS, type ShapePreset } from './shapeCommands'
import { listTemplates } from './overlayTemplateCatalog'

const SHAPE_GUIDANCE: Record<ShapePreset, { name: string; mood: string; useWhen: string; avoidWhen: string }> = {
  box: { name: 'Box', mood: 'Explainer, precise', useWhen: 'Pointing at a region of the picture or a chart; it draws on around the subject.', avoidWhen: 'Over faces, or when a zoom already frames the subject.' },
  circle: { name: 'Circle', mood: 'Explainer, friendly', useWhen: 'Circling a person, object or number the narrator names.', avoidWhen: 'Stacked with a box on the same subject.' },
  arrow: { name: 'Arrow', mood: 'Explainer, direct', useWhen: 'Pointing from a caption or title to what it refers to.', avoidWhen: 'Long holds: keep it under about 3 seconds.' },
  'dotted-arrow': { name: 'Dotted arrow', mood: 'Editorial, curved', useWhen: 'Showing a path, a link between two things or a process step; the curve draws on as a dotted trail.', avoidWhen: 'Tight layouts, where the curve crosses text.' },
  underline: { name: 'Underline', mood: 'Emphasis', useWhen: 'Stressing a key word in a title or caption.', avoidWhen: 'Every line: it stops meaning anything.' },
  highlight: { name: 'Highlighter', mood: 'Marker, editorial', useWhen: 'A sweep behind a title or number to make it read as marked up. Paints below the captions by default.', avoidWhen: 'Low-contrast text: check it stays readable.' },
}

/**
 * Everything an agent needs to pick zooms, titles, backgrounds, effects and looks without guessing
 * ids or ranges (`list_creative_options` MCP tool). Catalogs come straight from the same constants the
 * UI uses (`LOOKS`, `BACKGROUND_PRESETS`, `CAPTION_TEMPLATES`) and the shapes are generated from the real
 * zod schemas, so this can never drift from what `edit` will accept.
 */
const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' })

export function listCreativeOptions() {
  return {
    compositionNote: 'Composition space is 1080 units wide by 1080/aspect tall; rects are {x, y, width, height} in those units. All times are integer microseconds in SEQUENCE time.',
    editorialNote: 'Every look, background, title and effect carries mood/useWhen/avoidWhen. Choose from them on your own judgment - the user should not have to name a VHS overlay or a moving grid. Decide from the transcript and footage, commit to one styleRecipe, and keep the choices consistent.',
    styleRecipes: STYLE_RECIPES,
    looks: LOOKS.map(({ id, name, description }) => ({ id, name, description, ...LOOK_GUIDANCE[id] })),
    lookUsage: 'Add an adjustment clip: edit [{type:"clip-add", clip:{kind:"adjustment", ..., grade:{input:{...}, primaries:{...}, look:{id, strength}, intensity}}}]. Read get_project for a current adjustment clip to copy the exact grade shape.',
    backgroundPresets: BACKGROUND_PRESETS.map(({ id, label, look }) => ({ id, label, fill: look.fill, motion: look.motion ?? null, ...BACKGROUND_GUIDANCE[id] })),
    defaultBackgroundClipUs: DEFAULT_BACKGROUND_CLIP_US,
    titleTreatments: CAPTION_TEMPLATES.filter((template) => template.title).map(({ id, name, description, title }) => ({ id, name, description, titleMotion: title!.titleMotion, ...TITLE_GUIDANCE[id] })),
    effectGuidance: EFFECT_GUIDANCE,
    zoomGuidance: ZOOM_GUIDANCE,
    shapePresets: SHAPE_PRESETS.map((id) => ({ id, ...SHAPE_GUIDANCE[id] })),
    shapeUsage: 'add_shape places one preset as a vector graphic; edit it afterwards with the shape-* commands in `edit`. Shapes share one layerOrder with titles: negative paints under the captions, zero or more over them. A box (geometry kind rect) rounds its corners with cornerRadius, or with cornerRadii {tl,tr,br,bl} for four independent radii. A speech bubble is geometry kind bubble: a box (rect, cornerRadius) plus tail {side: left|right|top|bottom, offset 0..1 along the side, width, length, curve 0..1}. A closed shape (box, circle, highlight, closed path) may be Liquid Glass via shape-update changes {glass:{blur,saturation,refraction,bezel,tintOpacity,rim,specular,shadow:{blur,offsetY,opacity}}} (null removes it); glass cannot have a mask, a blend mode or a draw/sweep/grow animation, at most 8 blending plus glass shapes per project, and both preview and export render it.',
    overlayTemplates: listTemplates().map(({ id, name, description, category, supportsGlass, memberKeys, texts }) => ({ id, name, description, category, supportsGlass, memberKeys, textKeys: texts.map((text) => text.key) })),
    overlayTemplateUsage: 'Insert one with `edit` [{type:"template-insert", templateId, startUs, endUs, at:{x,y} (centre, composition units), ids:{group, items:{<every memberKey>: newId}}, measured:{<every textKey>:{width,height}} (measured title block sizes; the app measures them, an agent can estimate width from characters x fontSize x 0.56), glass?: true}]. It adds one group of shapes and titles as a single undo step; every id must be new. Edit the titles afterwards with text-update: shapes with fitTo refit in the app.',
    titleUsage: 'add_title places one of these as an animated text layer; captionTemplates (list_style_options) restyle the captions.',
    schemas: {
      zoomRegion: jsonSchema(zoomRegionSchema),
      effect: jsonSchema(effectRegionSchema),
      titleMotion: jsonSchema(titleMotionSchema),
      shape: jsonSchema(shapeSchema),
      textAnimation: jsonSchema(textAnimationSchema),
      backgroundFill: jsonSchema(fillSchema),
      backgroundMotion: jsonSchema(backgroundMotionSchema),
      grade: jsonSchema(gradeSchema),
    },
  }
}
