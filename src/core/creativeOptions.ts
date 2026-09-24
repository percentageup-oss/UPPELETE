import { z } from 'zod'
import { LOOKS } from '../color/looks'
import { CAPTION_TEMPLATES } from '../captions/templates'
import { titleMotionSchema } from '../captions/style'
import { BACKGROUND_PRESETS } from './backgroundPresets'
import { DEFAULT_BACKGROUND_CLIP_US } from './timelineDrop'
import { BACKGROUND_GUIDANCE, EFFECT_GUIDANCE, LOOK_GUIDANCE, TITLE_GUIDANCE, ZOOM_GUIDANCE } from './editorialGuidance'
import { STYLE_RECIPES } from './styleRecipes'
import { backgroundMotionSchema, effectRegionSchema, fillSchema, gradeSchema, textAnimationSchema, zoomRegionSchema } from './edit'

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
    titleUsage: 'add_title places one of these as an animated text layer; captionTemplates (list_style_options) restyle the captions.',
    schemas: {
      zoomRegion: jsonSchema(zoomRegionSchema),
      effect: jsonSchema(effectRegionSchema),
      titleMotion: jsonSchema(titleMotionSchema),
      textAnimation: jsonSchema(textAnimationSchema),
      backgroundFill: jsonSchema(fillSchema),
      backgroundMotion: jsonSchema(backgroundMotionSchema),
      grade: jsonSchema(gradeSchema),
    },
  }
}
