import { useMemo, useState } from 'react'
import type { Cue } from './core/model'
import { graphemeBoundaries } from './core/captionText'

export type CaptionEdit = { cueId: string; text: string }

const BLOCK_SPLIT = /\n[ \t]*\n/

/** Every match of `find` in `text` whose start and end fall on grapheme boundaries, so a Malayalam
 * vowel sign or conjunct is never cut in half by a replacement. */
function matchRanges(text: string, find: string, matchCase: boolean): number[] {
  if (!find) return []
  const haystack = matchCase ? text : text.toLowerCase()
  const needle = matchCase ? find : find.toLowerCase()
  if (haystack.length !== text.length) return []
  const boundaries = graphemeBoundaries(text)
  const starts: number[] = []
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
    if (boundaries.has(at) && boundaries.has(at + needle.length)) starts.push(at)
  }
  return starts
}

function replaceAll(text: string, find: string, replacement: string, matchCase: boolean): string {
  const starts = matchRanges(text, find, matchCase)
  let out = ''
  let cursor = 0
  for (const start of starts) { out += text.slice(cursor, start) + replacement; cursor = start + find.length }
  return out + text.slice(cursor)
}

/** Edit every caption in one shot: a single script view, or find & replace. Applies as one undo step. */
export function GlobalCaptionEditor({ cues, onApply, onClose }: { cues: readonly Cue[]; onApply: (edits: CaptionEdit[]) => boolean; onClose: () => void }) {
  const scriptBlocked = cues.some((cue) => BLOCK_SPLIT.test(cue.text))
  const [tab, setTab] = useState<'script' | 'replace'>(scriptBlocked ? 'replace' : 'script')
  const [script, setScript] = useState(() => cues.map((cue) => cue.text).join('\n\n'))
  const [find, setFind] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [composing, setComposing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const blocks = script.split(BLOCK_SPLIT)
  const scriptEdits = useMemo(() => blocks.length === cues.length
    ? cues.flatMap((cue, index) => blocks[index].trim() && blocks[index].trim() !== cue.text.trim() ? [{ cueId: cue.id, text: blocks[index].trim() }] : [])
    : null, [script, cues])
  const replaceEdits = useMemo(() => find
    ? cues.flatMap((cue) => { const text = replaceAll(cue.text, find, replacement, matchCase); return text !== cue.text && text.trim() ? [{ cueId: cue.id, text }] : [] })
    : [], [find, replacement, matchCase, cues])
  const matchCount = useMemo(() => cues.reduce((total, cue) => total + matchRanges(cue.text, find, matchCase).length, 0), [find, matchCase, cues])

  const apply = () => {
    if (tab === 'script') {
      if (!scriptEdits) { setError(`${blocks.length} blocks for ${cues.length} captions. Keep exactly one block per caption, separated by a blank line.`); return }
      if (blocks.some((block) => !block.trim())) { setError('A caption cannot be empty.'); return }
      if (!scriptEdits.length) { onClose(); return }
      if (onApply(scriptEdits)) onClose()
    } else {
      if (!replaceEdits.length) return
      if (onApply(replaceEdits)) onClose()
    }
  }
  const scriptEditCount = scriptEdits?.length ?? 0

  return <div className="relink-backdrop"><section className="relink-review global-edit" role="dialog" aria-modal="true" aria-labelledby="global-edit-title"
    onKeyDown={(event) => {
      if (composing || event.nativeEvent.isComposing) return
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); apply() }
    }}>
    <small>EDIT ALL CAPTIONS</small><h2 id="global-edit-title">Global edit</h2>
    <div className="global-edit-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'script'} disabled={scriptBlocked} title={scriptBlocked ? 'A caption contains a blank line, so the script view is unavailable.' : undefined}
        onClick={() => { setTab('script'); setError(null) }}>Script</button>
      <button type="button" role="tab" aria-selected={tab === 'replace'} onClick={() => { setTab('replace'); setError(null) }}>Find &amp; replace</button>
    </div>
    {tab === 'script' ? <>
      <p>One block per caption, separated by a blank line. Timings stay as they are; you can’t add or remove captions here.</p>
      <textarea className="global-edit-script" lang="ml" value={script} spellCheck={false} aria-label="All captions"
        onChange={(event) => { setScript(event.target.value); setError(null) }} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
      <p className="style-hint">{blocks.length === cues.length ? `${scriptEditCount} caption${scriptEditCount === 1 ? '' : 's'} changed.` : `${blocks.length} blocks for ${cues.length} captions.`}</p>
    </> : <>
      <label>Find<input type="text" lang="ml" value={find} onChange={(event) => setFind(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} autoFocus /></label>
      <label>Replace with<input type="text" lang="ml" value={replacement} onChange={(event) => setReplacement(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} /></label>
      <label className="global-edit-check"><input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} /> Match case</label>
      <p className="style-hint">{find ? `${matchCount} match${matchCount === 1 ? '' : 'es'} in ${replaceEdits.length} caption${replaceEdits.length === 1 ? '' : 's'}.` : 'Matches never split a Malayalam character.'}</p>
    </>}
    {error && <p role="alert" className="style-error">{error}</p>}
    <div><button type="button" onClick={onClose}>Cancel</button>
      <button type="button" className="accent" onClick={apply} disabled={tab === 'replace' && !replaceEdits.length}>{tab === 'replace' ? 'Replace all' : 'Apply'}</button></div>
  </section></div>
}
