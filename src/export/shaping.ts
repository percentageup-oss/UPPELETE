/**
 * The export harness's check that a caption line was painted as whole shaping runs: every leaf
 * element under `[data-caption-line]` must hold the complete line text, never a word or grapheme
 * split out of it. `leafTexts` are those leaves' `textContent`s.
 *
 * A line that painted nothing at all passes: a title motion's words that have not started yet
 * (the first frame of the motion, or a later line waiting its turn) render no crops, and an empty
 * line has no text that could have been split.
 */
export function isFragmentedLine(leafTexts: readonly string[], lineText: string): boolean {
  if (leafTexts.every((text) => text === '')) return false
  return leafTexts.some((text) => text !== lineText)
}
