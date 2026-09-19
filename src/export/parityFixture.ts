import { captionTokens } from '../core/captionText'
import { DEFAULT_CAPTION_STYLE } from '../captions/style'
import type { FrameRequest } from './frameRequest'

// Authored text and manual timing, not a transcript or claimed audio alignment.
const text = 'മലയാളം: ക്ഷ ക്ര കി കൊ ന്\u200d — React API cafe\u0301 👩🏽‍💻'
const startUs = 3_600_000_007
export const parityFixture: FrameRequest = {
  version: 1, composition: { width: 1080, height: 1920 }, timestampUs: startUs + 625_000,
  cue: { text, startUs, endUs: startUs + 3_000_000,
    words: captionTokens(text).map((token, index) => ({ id: `x1-${index}`, text: token.text,
      textStart: token.textStart, textEnd: token.textEnd, startUs: startUs + index * 250_000,
      endUs: startUs + index * 250_000 + 200_000, timingSource: 'manual', needsReview: false })) },
  style: { ...DEFAULT_CAPTION_STYLE, motion: 'word-pop', appearance: {
    ...DEFAULT_CAPTION_STYLE.appearance, backgroundEnabled: true, backgroundOpacity: .4, padding: 18, vertical: .5,
  } },
}
