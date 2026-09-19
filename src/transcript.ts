import { locateWordSpans } from './core/captionText'
import type { Cue } from './core/model'

/**
 * Word buttons are useful only when a cue has actual word entries. `locateWordSpans` correctly
 * returns an empty array for an untimed imported cue, but an empty array is truthy in JSX; treating
 * it as interactive content renders no text at all. Return null so callers display the authoritative
 * cue text instead.
 */
export function interactiveTranscriptSpans(cue: Cue) {
  const spans = locateWordSpans(cue.text, cue.words)
  return spans?.length ? spans : null
}
