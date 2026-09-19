import { captionTokens } from './core/captionText'
import type { Cue } from './core/model'
import { wordMotionAvailability } from './captions/renderer'

export function WordEmphasisPanel({ cue, onToggle, onEstimate }: {
  cue: Cue | null; onToggle: (textStart: number) => void; onEstimate: () => void
}) {
  const timing = wordMotionAvailability(cue)
  return <section className="word-emphasis-panel" aria-labelledby="word-emphasis-heading">
    <h3 id="word-emphasis-heading">Emphasize words</h3>
    <p className="style-hint">Click a word to give it the emphasis font and color; click again to clear it.</p>
    {cue ? <>
      <div className="emphasis-word-list" aria-label="Caption words">
        {captionTokens(cue.text).map((token) => <button key={token.textStart} type="button"
          aria-pressed={cue.emphasized?.some((span) => span.textStart === token.textStart) ?? false}
          onClick={() => onToggle(token.textStart)}>{token.text}</button>)}
      </div>
      <p className="style-hint">{timing.enabled ? timing.explanation : 'Font and color work now. Word animation needs word timing.'}</p>
      {!timing.enabled && <><p className="style-hint">Estimate timings within this cue for word animation. Estimates are not aligned to audio; caption text and cue boundaries stay unchanged.</p>
        <button type="button" disabled={!captionTokens(cue.text).length} onClick={onEstimate}>Estimate word timing</button></>}
    </> : <p className="style-hint">Select a caption in the transcript first.</p>}
  </section>
}
