import { captionTokens } from '../core/captionText'
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from './style'
import type { MotionCue } from './renderer'

export type CaptionTemplate = { id: string; name: string; description: string; tags: string[]; style: CaptionStyle }
const make = (motion: CaptionStyle['motion'], appearance: Partial<CaptionStyle['appearance']>): CaptionStyle => ({
  motion, motionSpeed: 1, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, fontFamily: 'Arial', fontSize: 92,
    fontWeight: 900, emphasisWeight: 900, secondaryColor: '#edff39', lineHeight: 1.15, outlineWidth: 0,
    shadowBlur: 9, shadowOffset: 4, vertical: .75, ...appearance },
})

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
]

const text = 'the quick brown fox jumps'
const tokens = captionTokens(text)
/** Explicitly synthetic demonstration timing; never copied into a user's captions. */
export const TEMPLATE_DEMO: MotionCue = {
  text, startUs: 0, endUs: 3_000_000, emphasized: [tokens[2]],
  words: tokens.map((token, index) => ({ ...token, id: `template-demo-${index}`, startUs: 200_000 + index * 400_000,
    endUs: 600_000 + index * 400_000, timingSource: 'manual', needsReview: false })),
}
