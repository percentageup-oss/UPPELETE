/**
 * When-to-use knowledge for every creative option an agent can pick (`list_creative_options`).
 * The catalogs themselves (`BACKGROUND_PRESETS`, `LOOKS`, `CAPTION_TEMPLATES`, effect kinds) say what
 * exists; this says what each is FOR, so an agent chooses like an editor instead of waiting to be told.
 * Keyed by the catalog's own ids; `editorialGuidance.test.ts` fails when a catalog entry has no guidance,
 * so a new preset/look/title/effect cannot ship without it.
 */
export type Mood = 'energetic' | 'calm' | 'retro' | 'tech' | 'corporate' | 'dramatic' | 'playful' | 'documentary' | 'neutral'

export type Guidance = { mood: Mood[]; useWhen: string; avoidWhen: string }

const g = (mood: Mood[], useWhen: string, avoidWhen: string): Guidance => ({ mood, useWhen, avoidWhen })

export const BACKGROUND_GUIDANCE: Record<string, Guidance> = {
  black: g(['neutral', 'dramatic'], 'Gaps between shots, a hard pause before a reveal, or a backing for picture-in-picture that must not distract.', 'Long stretches - a black hold reads as a mistake.'),
  white: g(['corporate', 'calm'], 'Clean explainer cutaways, product or document stills, light minimal videos.', 'Dark or cinematic videos; it flashes against a dark grade.'),
  slate: g(['corporate', 'neutral'], 'Neutral backing behind a shrunken video or an image cutaway.', 'When you want energy; it is deliberately quiet.'),
  sunset: g(['playful', 'energetic'], 'Upbeat lifestyle, travel or motivation beats; a warm title card.', 'Serious, technical or news-style content.'),
  ocean: g(['calm', 'corporate'], 'Calm explainers, wellness, finance or trust-building beats.', 'High-energy or retro edits.'),
  violet: g(['playful', 'tech'], 'Creative, creator-economy or product-launch beats.', 'Documentary or serious topics.'),
  midnight: g(['dramatic', 'calm'], 'Reflective, storytelling or late-night moods; a title over a dark gradient.', 'Bright, upbeat videos.'),
  shift: g(['energetic', 'playful'], 'A short transition or list beat that needs gentle movement.', 'Anything under text you need to read carefully - the colour drifts.'),
  pulse: g(['energetic', 'dramatic'], 'Building tension or a beat-driven moment; a countdown or a big claim.', 'Long segments - constant pulsing tires the eye.'),
  grid: g(['tech', 'corporate'], 'Tech, data, coding or systems explanations behind a shrunken video or an image.', 'Warm, personal or emotional stories.'),
  'grid-scroll': g(['tech', 'energetic'], 'Moving grid for tech, AI, gaming or startup topics: bridges between sections, intros, and behind picture-in-picture or a callout image.', 'Emotional or personal storytelling; never behind long captions without checking readability.'),
  dots: g(['tech', 'playful'], 'Lighter tech or design topics, list segments, product-style bridges.', 'Dramatic or somber content.'),
  'grid-shift': g(['tech', 'energetic'], 'A hero section, launch announcement or intro where the grid should feel alive.', 'Busy scenes - it competes with detail.'),
  floor: g(['retro', 'energetic'], 'Retro, synthwave, gaming or 80s references; a nostalgic intro or transition.', 'Modern corporate or serious topics.'),
  drift: g(['calm', 'dramatic'], 'Slow atmospheric backing for a quote, reflection or title.', 'Fast-paced content; it feels sluggish.'),
}

export const LOOK_GUIDANCE: Record<string, Guidance> = {
  reportage: g(['documentary', 'neutral'], 'Interviews, news-style or serious talking-head content.', 'Bright, cheerful or product content.'),
  'slide-vivid': g(['energetic', 'playful'], 'Travel, food, lifestyle and colourful subjects that should pop.', 'Skin tones already warm and saturated.'),
  'soft-negative': g(['calm', 'playful'], 'Warm personal vlogs and family or lifestyle footage.', 'Technical or clinical content.'),
  'street-negative': g(['documentary', 'dramatic'], 'Street, urban and gritty scenes with a cool shadow tint.', 'Soft, warm subjects.'),
  'pastel-print': g(['playful', 'calm'], 'Light, fashion or beauty content and soft brand videos.', 'Dark or dramatic scenes.'),
  'cinema-soft': g(['dramatic', 'calm'], 'Story-driven or cinematic footage; a safe default grade for narrative.', 'Screen recordings and graphics.'),
  'bleach-skip': g(['dramatic', 'documentary'], 'Tense, serious or thriller-style beats.', 'Cheerful content.'),
  'classic-contrast': g(['neutral', 'documentary'], 'A general-purpose, punchy grade for most talking-head footage.', 'Already high-contrast footage.'),
  'warm-chrome': g(['calm', 'playful'], 'Warm, friendly and golden-hour footage.', 'Cool, technical or clinical scenes.'),
  'mono-deep': g(['dramatic', 'retro'], 'A flashback, memory or high-drama moment in black and white.', 'The whole video unless the style is deliberately monochrome.'),
  'mono-selenium': g(['retro', 'dramatic'], 'Vintage or archive feel, historical references.', 'Modern product or tech content.'),
  'cartel-dusk': g(['dramatic'], 'Moody dusk scenes and crime or thriller-style storytelling.', 'Bright daytime or corporate footage.'),
  'neon-assassin': g(['tech', 'dramatic'], 'Night, city, gaming and cyber themes with neon accents.', 'Natural, everyday scenes.'),
  wanderlust: g(['energetic', 'playful'], 'Travel and outdoor footage; teal-and-orange pop.', 'Indoor talking heads - it can tint skin.'),
  'moody-matte': g(['dramatic', 'calm'], 'Reflective, cinematic and personal essay content.', 'High-energy or bright content.'),
  'cold-forest': g(['calm', 'dramatic'], 'Nature, isolation or serious documentary content with cool greens.', 'Warm, cheerful subjects.'),
  'golden-drift': g(['calm', 'playful'], 'Golden-hour, nostalgic and warm memory beats.', 'Cold or clinical topics.'),
}

export const TITLE_GUIDANCE: Record<string, Guidance> = {
  'title-focus-reveal': g(['calm', 'corporate'], 'Opening title or a section heading that should feel premium and minimal.', 'Fast comedic beats.'),
  'title-soft-lift': g(['calm', 'neutral'], 'Lower-key labels, names and short statements.', 'High-impact hooks.'),
  'title-word-cascade': g(['energetic', 'playful'], 'A hook or list where each word matters, including Malayalam text (whole shaped words arrive).', 'Long sentences - too slow to read.'),
  'title-line-wipe': g(['corporate', 'neutral'], 'Clean chapter headings and multi-line statements.', 'Short one-word emphasis.'),
  'title-violet-accent': g(['tech', 'playful'], 'A punchline or key phrase whose last word should land with an accent colour.', 'Text with no obvious final word to stress.'),
  'title-quiet-scale': g(['calm', 'documentary'], 'Quiet statements, quotes and reflective moments.', 'Loud, energetic sections.'),
}

/** Frame-paint effect kinds (`effectRegionSchema`). */
export const EFFECT_GUIDANCE: Record<string, Guidance> = {
  vhs: g(['retro', 'playful'], 'A nostalgia, flashback or "back in the day" beat, an archive-footage reference, a retro-tech mention. 1-4 seconds, then cut back to clean.', 'The whole video (unless the style is retro), emotional close-ups, or under text that must stay crisp.'),
  grain: g(['dramatic', 'documentary', 'retro'], 'A filmic texture over a whole graded section, or over a flashback for grit.', 'Screen recordings and clean tech content; stacked with vhs on the same range.'),
  particles: g(['playful', 'energetic'], 'A celebration, big reveal, milestone or hype moment.', 'Serious content; more than about once a minute.'),
  glow: g(['dramatic', 'tech'], 'A soft bloom on a night, neon or dreamy beat, or a hero product moment.', 'Bright scenes where highlights already clip.'),
  vignette: g(['dramatic', 'neutral'], 'Draw focus to the speaker; pair with a slow zoom on a serious statement. Safe across a whole section.', 'Already dark footage.'),
  letterbox: g(['dramatic', 'documentary'], 'Cinematic bars for a story beat, a flashback or a serious quote.', 'Vertical short-form video, where bars waste the frame.'),
  fade: g(['neutral', 'calm'], 'Fade in at the very start and out at the end; a soft dip between two unrelated sections.', 'Mid-sentence, or as a substitute for a real cut.'),
}

export const ZOOM_GUIDANCE = {
  punchIn: { scale: '1.10-1.20x', durationSeconds: '0.6-1.2', useWhen: 'A punchline, a strong claim or a key number - land the zoom on the word, not before it.', avoidWhen: 'Back to back, or on every sentence.' },
  slowPush: { scale: '1.05-1.15x', durationSeconds: '3-8', useWhen: 'Storytelling, emotional or serious statements; use across a whole answer.', avoidWhen: 'Energetic, fast-cut content.' },
  reveal: { scale: 'start 1.0x, end 1.2-1.3x using fromRect', durationSeconds: '0.4-0.8', useWhen: 'A joke turn or a surprising reveal; hold the framing right after.', avoidWhen: 'Calm, corporate content.' },
  density: { energeticShorts: 'a zoom every 5-10 s', standard: 'every 10-20 s', calm: 'every 20-40 s, or slow pushes only' },
} as const
