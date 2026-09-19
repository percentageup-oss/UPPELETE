import type { Cue } from './core/model'
import { untimedTokenCount } from './core/wordTiming'

export const TIMING_LABELS = {
  imported: 'Imported cue timing', model: 'Model timing', aligned: 'Aligned timing',
  manual: 'Manual timing', estimated: 'Estimated timing — not audio-aligned',
} as const

export function TimingProvenance({ cue }: { cue: Cue }) {
  const untimed = untimedTokenCount(cue)
  return <section className="timing-details" aria-label="Timing provenance">
    <div className="provenance" id="cue-provenance">
      <span>{TIMING_LABELS[cue.timingSource]}</span>
      <span>{cue.textSource === 'user' ? 'User-corrected text — protected on retranscription' : `${cue.textSource} text`}</span>
      {cue.needsReview && <span className="review">Needs review</span>}
    </div>
    <p>Model: reported by recognition. Aligned: returned by an audio aligner. Manual: moved by you. Estimated: distributed within the cue; may cross pauses.</p>
    {untimed > 0 && <p className="review" role="status">{untimed} word{untimed === 1 ? '' : 's'} without timing. Changed or ambiguous words need review; unchanged safe timings are retained.</p>}
    {!cue.words.length && <p>No word timing available.</p>}
    {cue.words.length > 0 && <details open><summary>Word timing ({cue.words.length})</summary>
      <ul className="word-provenance" aria-label="Word timing provenance">{cue.words.map((word) => <li key={word.id}>
        <strong lang="ml">{word.text}</strong>
        <span>{TIMING_LABELS[word.timingSource]}</span>
        <small>{word.startUs.toLocaleString('en-US')}–{word.endUs.toLocaleString('en-US')} µs</small>
        {(word.needsReview || word.timingSource === 'estimated') && <span className="review">Needs review</span>}
      </li>)}</ul>
    </details>}
  </section>
}
