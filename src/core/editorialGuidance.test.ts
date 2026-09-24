import { describe, expect, it } from 'vitest'
import { BACKGROUND_GUIDANCE, EFFECT_GUIDANCE, LOOK_GUIDANCE, TITLE_GUIDANCE } from './editorialGuidance'
import { STYLE_RECIPES } from './styleRecipes'
import { BACKGROUND_PRESETS } from './backgroundPresets'
import { effectRegionSchema } from './edit'
import { LOOKS } from '../color/looks'
import { CAPTION_TEMPLATES } from '../captions/templates'
import { listCreativeOptions } from './creativeOptions'

const effectKinds = effectRegionSchema.options.map((option) => option.shape.kind.value as string)
const titleIds = CAPTION_TEMPLATES.filter((template) => template.title).map((template) => template.id)

describe('editorial guidance covers every catalog entry', () => {
  it('has guidance for each background preset, look, title treatment and effect kind', () => {
    expect(BACKGROUND_PRESETS.filter((preset) => !BACKGROUND_GUIDANCE[preset.id]).map((preset) => preset.id)).toEqual([])
    expect(LOOKS.filter((look) => !LOOK_GUIDANCE[look.id]).map((look) => look.id)).toEqual([])
    expect(titleIds.filter((id) => !TITLE_GUIDANCE[id])).toEqual([])
    expect(effectKinds.filter((kind) => !EFFECT_GUIDANCE[kind])).toEqual([])
  })

  it('has no guidance for ids that no longer exist', () => {
    expect(Object.keys(BACKGROUND_GUIDANCE).filter((id) => !BACKGROUND_PRESETS.some((preset) => preset.id === id))).toEqual([])
    expect(Object.keys(LOOK_GUIDANCE).filter((id) => !LOOKS.some((look) => look.id === id))).toEqual([])
    expect(Object.keys(TITLE_GUIDANCE).filter((id) => !titleIds.includes(id))).toEqual([])
    expect(Object.keys(EFFECT_GUIDANCE).filter((kind) => !effectKinds.includes(kind))).toEqual([])
  })

  it('gives every entry a non-empty use/avoid explanation', () => {
    for (const guidance of [...Object.values(BACKGROUND_GUIDANCE), ...Object.values(LOOK_GUIDANCE), ...Object.values(TITLE_GUIDANCE), ...Object.values(EFFECT_GUIDANCE)]) {
      expect(guidance.useWhen.length).toBeGreaterThan(10)
      expect(guidance.avoidWhen.length).toBeGreaterThan(5)
      expect(guidance.mood.length).toBeGreaterThan(0)
    }
  })
})

describe('style recipes', () => {
  it('only reference real looks, backgrounds, titles and effects', () => {
    for (const recipe of STYLE_RECIPES) {
      expect(recipe.looks.filter((id) => !LOOKS.some((look) => look.id === id)), `${recipe.id} looks`).toEqual([])
      expect(recipe.backgrounds.filter((id) => !BACKGROUND_PRESETS.some((preset) => preset.id === id)), `${recipe.id} backgrounds`).toEqual([])
      expect(recipe.titleTemplates.filter((id) => !titleIds.includes(id)), `${recipe.id} titles`).toEqual([])
      expect([...recipe.effects, ...recipe.avoidEffects].filter((kind) => !effectKinds.includes(kind)), `${recipe.id} effects`).toEqual([])
    }
  })

  it('never both recommends and forbids the same effect, and ids are unique', () => {
    for (const recipe of STYLE_RECIPES) expect(recipe.effects.filter((kind) => recipe.avoidEffects.includes(kind))).toEqual([])
    expect(new Set(STYLE_RECIPES.map((recipe) => recipe.id)).size).toBe(STYLE_RECIPES.length)
  })

  it('routes the moving grid to the tech recipe and VHS to the retro one', () => {
    expect(STYLE_RECIPES.find((recipe) => recipe.id === 'tech-explainer')?.backgrounds).toContain('grid-scroll')
    expect(STYLE_RECIPES.find((recipe) => recipe.id === 'retro-nostalgia')?.effects).toContain('vhs')
  })
})

describe('list_creative_options carries the guidance', () => {
  const options = listCreativeOptions()
  it('attaches useWhen to backgrounds, looks and titles and lists recipes', () => {
    expect(options.backgroundPresets.every((preset) => 'useWhen' in preset)).toBe(true)
    expect(options.looks.every((look) => 'useWhen' in look)).toBe(true)
    expect(options.titleTreatments.every((title) => 'useWhen' in title)).toBe(true)
    expect(options.styleRecipes.length).toBe(STYLE_RECIPES.length)
    expect(options.effectGuidance.vhs.useWhen).toMatch(/nostalgia/i)
  })
})
