import { captionTokens } from '../core/captionText'
import { applyCaptionTemplateToText, DEFAULT_CAPTION_STYLE, type CaptionStyle } from './style'
import type { MotionCue } from './renderer'
import type { TextAnimation, TextOverlay, TitleMotion } from '../core/edit'

export type CaptionTemplate = {
  id: string; name: string; description: string; tags: string[]; style: CaptionStyle
  /** An optional localized sample for the template gallery only; never copied into project cues. */
  demo?: MotionCue
  /** Built-in title treatment; older templates remain appearance-only for authored text. */
  title?: { style: CaptionStyle; enter: TextAnimation; exit: TextAnimation; titleMotion: TitleMotion }
}
const make = (motion: CaptionStyle['motion'], appearance: Partial<CaptionStyle['appearance']>): CaptionStyle => ({
  motion, motionSpeed: 1, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, fontFamily: 'Arial', fontSize: 92,
    fontWeight: 900, emphasisWeight: 900, secondaryColor: '#edff39', lineHeight: 1.15, outlineWidth: 0,
    shadowBlur: 9, shadowOffset: 4, vertical: .75, ...appearance },
})
const titleTreatment = (kind: TitleMotion['kind'], appearance: Partial<CaptionStyle['appearance']>, durationUs = 650_000): Pick<CaptionTemplate, 'style' | 'title'> => {
  const base = make('static-clean', { fontFamily: 'Helvetica Neue', fontWeight: 700, emphasisWeight: 700, fontSize: 80,
    primaryColor: '#F5F5F7', secondaryColor: '#8B65F6', lineHeight: 1.12, letterSpacing: -2,
    maxLines: 3, outlineWidth: 0, strokeEnabled: false, shadowEnabled: true,
    shadowColor: '#000000', shadowBlur: 12, shadowOffset: 2, backgroundEnabled: false,
    glowEnabled: false, depthEnabled: false, vertical: .5, ...appearance })
  const style: CaptionStyle = { ...base, titleMotion: { kind, durationUs } }
  return { style, title: { style, titleMotion: { kind, durationUs },
    enter: { kind: 'none', durationUs: 0 }, exit: { kind: 'fade', durationUs: 280_000 } } }
}

/** Original styles inspired by the supplied reference; all fonts resolve locally with Malayalam fallbacks. */
export const CAPTION_TEMPLATES: CaptionTemplate[] = [
  { id: 'bold-reveal', name: 'Bold reveal', description: 'Words build one by one. Selected words pop in yellow.', tags: ['Bold', 'Shadow', 'Word reveal'],
    style: make('progressive-word-reveal', {}) },
  { id: 'neon-punch', name: 'Neon punch', description: 'Uppercase captions with a contrasting emphasis font.', tags: ['Uppercase', 'Word pop'],
    style: make('word-pop', { textTransform: 'uppercase', fontSize: 78, emphasisFontFamily: 'Impact', emphasisWeight: 400, shadowBlur: 14 }) },
  { id: 'mint-reveal', name: 'Mint reveal', description: 'Clean sequential words with mint emphasis.', tags: ['Word reveal', 'Mint'],
    style: make('progressive-word-reveal', { secondaryColor: '#85ffd0', fontWeight: 400, emphasisItalic: true, fontSize: 80 }) },
  { id: 'paper-bold', name: 'Paper bold', description: 'White type, pink emphasis, soft phrase fade.', tags: ['Phrase fade', 'Pink'],
    style: make('phrase-fade', { secondaryColor: '#ff89bb', emphasisFontFamily: 'Georgia', emphasisItalic: true }) },
  { id: 'anek-bold', name: 'Anek bold', description: 'Set in Anek Malayalam for proper Malayalam shaping, with the spoken word highlighted and an amber italic emphasis.', tags: ['Malayalam', 'Bold', 'Word highlight'],
    style: make('active-word-highlight', { fontFamily: 'Anek Malayalam', secondaryColor: '#f5b83d', emphasisItalic: true }) },
  { id: 'malayalam-gold', name: 'Malayalam Gold', description: 'Bold Malayalam title lettering with a gold gradient, warm outline and dimensional shadow.', tags: ['Malayalam', 'Gold', 'Outlined', 'Title'],
    style: make('phrase-fade', {
      fontFamily: 'Anek Malayalam', fontSize: 92, fontWeight: 900, lineHeight: 1.05, letterSpacing: -2, maxLines: 2,
      primaryColor: '#FFF12A', secondaryColor: '#FFF12A', gradientEnabled: true, gradientFrom: '#FFF12A', gradientTo: '#FFD228', gradientAngle: 180,
      emphasisGradientEnabled: true, emphasisGradientFrom: '#FFF12A', emphasisGradientTo: '#FFD228', emphasisMotion: 'none',
      strokeEnabled: true, outlineColor: '#E93C13', outlineWidth: 8,
      depthEnabled: true, depthColor: '#C52408', depthAmount: 8,
      shadowEnabled: true, shadowColor: '#380900', shadowBlur: 0, shadowOffset: 9,
      backgroundEnabled: false, padding: 18,
    }),
    demo: { text: 'മലയാളം ടൈറ്റിൽ\nടെംപ്ലേറ്റ്', startUs: 0, endUs: 3_000_000 },
  },
  { id: 'white-card', name: 'White Card', description: 'A clean dark title on a padded white card, suited to product callouts.', tags: ['Card', 'White', 'Callout', 'Title'],
    style: { ...make('phrase-fade', { fontFamily: 'Arial', fontSize: 72, fontWeight: 700, primaryColor: '#171717', secondaryColor: '#171717',
      backgroundEnabled: true, backgroundColor: '#ffffff', backgroundOpacity: 1, padding: 20, outlineWidth: 0, strokeEnabled: false,
      shadowEnabled: false, vertical: .5, alignment: 'center', maxLines: 3 }), motionSpeed: 1 } },
  { id: 'title-focus-reveal', name: 'Focus Reveal', description: 'Soft blur resolves into precise white type.', tags: ['Focus', 'Blur', 'Minimal'],
    ...titleTreatment('focus', { fontWeight: 700, fontSize: 82 }, 620_000), demo: { text: 'Make it clear.', startUs: 0, endUs: 3_000_000 } },
  { id: 'title-soft-lift', name: 'Soft Lift', description: 'The title lifts a short distance and settles.', tags: ['Lift', 'Soft', 'Minimal'],
    ...titleTreatment('lift', { fontWeight: 600, fontSize: 78 }, 600_000), demo: { text: 'A better way.', startUs: 0, endUs: 3_000_000 } },
  { id: 'title-word-cascade', name: 'Word Cascade', description: 'Whole shaped words arrive in a measured sequence.', tags: ['Words', 'Stagger', 'Malayalam'],
    ...titleTreatment('cascade', { fontWeight: 700, fontSize: 76 }, 850_000), demo: { text: 'Ideas in motion.', startUs: 0, endUs: 3_000_000 } },
  { id: 'title-line-wipe', name: 'Line Wipe', description: 'A clean horizontal reveal across complete text lines.', tags: ['Wipe', 'Reveal', 'Minimal'],
    ...titleTreatment('wipe', { fontWeight: 700, fontSize: 78 }, 650_000), demo: { text: 'Simply powerful.', startUs: 0, endUs: 3_000_000 } },
  { id: 'title-violet-accent', name: 'Violet Accent', description: 'A quiet entrance followed by a violet final-word accent.', tags: ['Violet', 'Accent', 'Word'],
    ...titleTreatment('accent', { fontWeight: 700, fontSize: 80, secondaryColor: '#916DFF' }, 750_000), demo: { text: 'Create freely.', startUs: 0, endUs: 3_000_000 } },
  { id: 'title-quiet-scale', name: 'Quiet Scale', description: 'A subtle size change brings the title into focus.', tags: ['Scale', 'Minimal', 'Soft'],
    ...titleTreatment('scale', { fontWeight: 600, fontSize: 84 }, 540_000), demo: { text: 'Think bigger.', startUs: 0, endUs: 3_000_000 } },
]

/** One text-update command can commit the complete built-in title treatment. */
export function titleTemplateChanges(template: CaptionTemplate, current: TextOverlay): Pick<TextOverlay, 'style'> & Partial<Pick<TextOverlay, 'enter' | 'exit' | 'titleMotion'>> {
  const title = template.title
  return title
    ? { style: { ...applyCaptionTemplateToText(title.style, current.style), motion: title.style.motion, motionSpeed: title.style.motionSpeed },
      enter: title.enter, exit: title.exit, titleMotion: title.titleMotion }
    : { style: applyCaptionTemplateToText(template.style, current.style) }
}

const text = 'the quick brown fox jumps'
const tokens = captionTokens(text)
/** Explicitly synthetic demonstration timing; never copied into a user's captions. */
export const TEMPLATE_DEMO: MotionCue = {
  text, startUs: 0, endUs: 3_000_000, emphasized: [tokens[2]],
  words: tokens.map((token, index) => ({ ...token, id: `template-demo-${index}`, startUs: 200_000 + index * 400_000,
    endUs: 600_000 + index * 400_000, timingSource: 'manual', needsReview: false })),
}
