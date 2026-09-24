import type { Mood } from './editorialGuidance'

/**
 * A coherent editing style an agent can commit to after reading the footage, so choices (look,
 * background, title, effects, zoom rhythm) agree with each other instead of being picked at random.
 * Ids reference the catalogs (`BACKGROUND_PRESETS`, `LOOKS`, `CAPTION_TEMPLATES`, effect kinds); the
 * test in `editorialGuidance.test.ts` fails when a recipe names an id that does not exist.
 */
export type StyleRecipe = {
  id: string
  name: string
  mood: Mood[]
  fitsWhen: string
  looks: string[]
  backgrounds: string[]
  titleTemplates: string[]
  effects: string[]
  /** Effects the recipe should NOT add unless the transcript clearly calls for them. */
  avoidEffects: string[]
  zoomRhythm: string
  notes: string
}

export const STYLE_RECIPES: StyleRecipe[] = [
  {
    id: 'tech-explainer', name: 'Tech explainer', mood: ['tech', 'energetic'],
    fitsWhen: 'Software, AI, gadgets, coding, startups, data, how-it-works videos.',
    looks: ['classic-contrast', 'neon-assassin'], backgrounds: ['grid-scroll', 'grid', 'dots'], titleTemplates: ['title-violet-accent', 'title-word-cascade'],
    effects: ['glow', 'vignette'], avoidEffects: ['vhs', 'letterbox'],
    zoomRhythm: 'Punch-in on key claims and numbers, one every 8-15 s.',
    notes: 'Use the moving grid behind picture-in-picture, image callouts and section bridges - not behind the speaker for the whole video.',
  },
  {
    id: 'retro-nostalgia', name: 'Retro / nostalgia', mood: ['retro', 'playful'],
    fitsWhen: 'Childhood memories, old tech, "back in the day", 80s/90s references, throwback stories.',
    looks: ['mono-selenium', 'golden-drift', 'warm-chrome'], backgrounds: ['floor', 'drift'], titleTemplates: ['title-soft-lift', 'title-quiet-scale'],
    effects: ['vhs', 'grain'], avoidEffects: ['particles'],
    zoomRhythm: 'Slow pushes through the memory; punch-in only on the reveal.',
    notes: 'Apply VHS and grain only over the nostalgic beats, then return to clean footage so the effect reads as a flashback.',
  },
  {
    id: 'corporate-clean', name: 'Corporate clean', mood: ['corporate', 'neutral'],
    fitsWhen: 'Business, finance, education, product walkthroughs, interviews for a professional audience.',
    looks: ['reportage', 'classic-contrast'], backgrounds: ['slate', 'white', 'ocean'], titleTemplates: ['title-focus-reveal', 'title-line-wipe'],
    effects: ['vignette', 'fade'], avoidEffects: ['vhs', 'particles', 'glow'],
    zoomRhythm: 'Sparse punch-ins, one every 15-25 s.',
    notes: 'Restraint is the style: few effects, one title treatment, no busy backgrounds.',
  },
  {
    id: 'energetic-shorts', name: 'Energetic shorts', mood: ['energetic', 'playful'],
    fitsWhen: 'Vertical short-form, comedy, hype, quick tips, creator content.',
    looks: ['slide-vivid', 'wanderlust'], backgrounds: ['shift', 'sunset', 'pulse'], titleTemplates: ['title-word-cascade', 'title-violet-accent'],
    effects: ['particles', 'glow'], avoidEffects: ['letterbox'],
    zoomRhythm: 'A zoom every 5-8 s, alternating punch-ins; a reveal-style zoom on jokes.',
    notes: 'Keep the first 1-2 seconds clean, then front-load motion. Effects stay short (under 2 s).',
  },
  {
    id: 'calm-storytelling', name: 'Calm storytelling', mood: ['calm', 'dramatic', 'documentary'],
    fitsWhen: 'Personal essays, documentaries, reflective or emotional content, long-form monologue.',
    looks: ['cinema-soft', 'moody-matte'], backgrounds: ['midnight', 'drift', 'black'], titleTemplates: ['title-quiet-scale', 'title-soft-lift'],
    effects: ['vignette', 'grain', 'letterbox'], avoidEffects: ['particles', 'vhs'],
    zoomRhythm: 'Slow pushes across whole answers; almost no punch-ins.',
    notes: 'Let pauses breathe. Use one look for the whole video and add texture only for emphasis.',
  },
]
