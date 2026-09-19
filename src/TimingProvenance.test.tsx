import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TimingProvenance } from './TimingProvenance'
import type { Cue } from './core/model'

it('renders distinct accessible labels for each provenance, review, and missing alignment', () => {
  const cue: Cue = { id: 'c', startUs: 0, endUs: 10_000, text: 'model aligned manual estimated corrected', textSource: 'user', timingSource: 'model', needsReview: true,
    words: (['model', 'aligned', 'manual', 'estimated'] as const).map((source, index) => ({ id: source, text: source, startUs: index * 1000, endUs: index * 1000 + 900, timingSource: source, needsReview: source === 'estimated' })) }
  const html = renderToStaticMarkup(<TimingProvenance cue={cue} />)
  for (const label of ['Model timing', 'Aligned timing', 'Manual timing', 'Estimated timing — not audio-aligned', 'Needs review', '1 word without timing', 'protected on retranscription', 'µs']) expect(html).toContain(label)
  expect(html).toContain('aria-label="Word timing provenance"')
})
