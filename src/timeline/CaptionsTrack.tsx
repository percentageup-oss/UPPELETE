import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { CaptionWord, Cue } from '../core/model'
import type { CueDragMode } from '../core/timeline'
import { timeToPixel } from '../core/timeline'
import { spanSequenceUs } from '../core/timelineModel'
import type { Retime } from '../core/clipTime'
import { formatClock } from '../core/time'
import { TIMING_LABELS } from '../TimingProvenance'
import type { CaptionDisplay } from '../captions/wordDisplay'

/** Where one piece of a caption is seen: its sequence range and the source range it shows. A caption
 * straddling a cut, or spoken twice because its video repeats, has several. */
export type CaptionSpan = { startUs: number; endUs: number; sourceStartUs: number; sourceEndUs: number; clipId: string | null; retime?: Retime }

function WordBlocks({ cue, span, selectedWordId, onSeek, onSelectWord }: {
  cue: Cue; span: CaptionSpan; selectedWordId: string | null
  onSeek: (sourceUs: number, cueId: string) => void
  onSelectWord: (cue: Cue, word: CaptionWord) => void
}) {
  // Positions are laid out in sequence time, so a sped-up or ramped clip spaces its words as they play.
  const spanUs = span.endUs - span.startUs
  // Enter (or a pointer) activates a word; Space is left alone so it reaches the global play/pause
  // shortcut even while a word is focused/selected.
  const activate = (event: ReactPointerEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>, word: CaptionWord) => {
    if ('key' in event && event.key !== 'Enter') return
    if ('button' in event && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onSeek(word.startUs, cue.id)
    onSelectWord(cue, word)
  }
  if (!cue.words.length) {
    return <span data-item-kind="cue" data-item-id={cue.id} role="button" tabIndex={0} lang="ml" className="word-block untimed" style={{ left: 0, width: '100%' }}
      title="No word timing. Use “Estimate all words & group” in the inspector to create reviewable estimates."
      aria-label={`Caption ${cue.text || 'empty'} without word timing, ${formatClock(cue.startUs)}`}
      onPointerDown={() => onSeek(Math.max(cue.startUs, span.sourceStartUs), cue.id)} onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault(); event.stopPropagation(); onSeek(Math.max(cue.startUs, span.sourceStartUs), cue.id)
      }}>{cue.text || '(empty)'}</span>
  }
  // Only the words this piece shows, placed within the piece's own source range.
  return <>{cue.words.filter((word) => word.endUs > span.sourceStartUs && word.startUs < span.sourceEndUs).map((word) => {
    const estimated = word.timingSource === 'estimated' || word.needsReview
    const selected = word.id === selectedWordId
    const startUs = Math.max(word.startUs, span.sourceStartUs)
    const endUs = Math.min(word.endUs, span.sourceEndUs)
    return <span key={word.id} data-item-kind="word" data-item-id={cue.id} data-word-id={word.id} role="button" tabIndex={0} lang="ml" aria-pressed={selected}
      className={`word-block ${estimated ? 'estimated' : ''} ${selected ? 'selected' : ''}`}
      title={`${TIMING_LABELS[word.timingSource]}${estimated ? ' — needs review' : ''}`}
      aria-label={`Word ${word.text}, ${formatClock(word.startUs)}, ${TIMING_LABELS[word.timingSource]}`}
      style={{ left: `${timeToPixel(spanSequenceUs(span, startUs) - span.startUs, spanUs, 100)}%`, width: `${Math.max(.5, timeToPixel(spanSequenceUs(span, endUs) - spanSequenceUs(span, startUs), spanUs, 100))}%` }}
      onPointerDown={(event) => activate(event, word)} onKeyDown={(event) => activate(event, word)}>{word.text}</span>
  })}</>
}

/**
 * The captions row. Captions are stored in their video's source time; each is drawn once per place
 * the sequence shows it (`spansOf`). A caption clipped by a cut still drags as one caption: only its
 * outer pieces carry handles.
 */
export function CaptionsTrack({ cues, spansOf, durationUs, mode, selectedCueId, warningCueIds, draggingId, selectedWordId, locked = false, onBeginDrag, onKeyboardSelect, onSeekSource, onSelectWord, onSeekTrack }: {
  cues: readonly Cue[]
  spansOf: (cue: Cue) => CaptionSpan[]
  durationUs: number
  mode: CaptionDisplay
  selectedCueId: string | null
  warningCueIds: Set<string>
  draggingId: string | null
  selectedWordId: string | null
  /** The caption track this row belongs to (schema 6) is locked: no drag handles, moving refused. */
  locked?: boolean
  onBeginDrag: (event: ReactPointerEvent<HTMLElement>, cue: Cue, mode: CueDragMode, span: CaptionSpan) => void
  onKeyboardSelect: (event: ReactKeyboardEvent<HTMLDivElement>, cue: Cue, span: CaptionSpan) => void
  onSeekSource: (cue: Cue, sourceUs: number, span: CaptionSpan) => void
  onSelectWord: (cue: Cue, word: CaptionWord) => void
  onSeekTrack: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const place = (span: CaptionSpan) => ({ left: `${timeToPixel(span.startUs, durationUs, 100)}%`, width: `${Math.max(.02, timeToPixel(span.endUs - span.startUs, durationUs, 100))}%` })
  return <div className={`track captions ${mode} ${locked ? 'locked' : ''}`} onPointerDown={onSeekTrack} role="group"
    aria-label={mode === 'line' ? 'Caption lines. Tab to a caption, then press Enter or Space to select and seek to it.' : 'Caption words. Tab to a word, then press Enter or Space to seek to it.'}>
    {mode === 'line' ? cues.flatMap((cue) => spansOf(cue).map((span, spanIndex, spans) => <div
      key={`${cue.id}:${spanIndex}`}
      data-item-kind="cue" data-item-id={cue.id}
      role="button"
      tabIndex={0}
      lang="ml"
      aria-label={`Cue ${cue.text}, ${formatClock(cue.startUs)} to ${formatClock(cue.endUs)}${spans.length > 1 ? `, part ${spanIndex + 1} of ${spans.length}` : ''}${locked ? ' (track locked)' : ''}`}
      className={`cue-block ${cue.id === selectedCueId ? 'active' : ''} ${warningCueIds.has(cue.id) ? 'has-warning' : ''} ${draggingId === cue.id ? 'dragging' : ''} ${locked ? 'locked' : ''}`}
      style={place(span)}
      onPointerDown={(event) => onBeginDrag(event, cue, 'move', span)}
      onKeyDown={(event) => onKeyboardSelect(event, cue, span)}
    >
      {!locked && spanIndex === 0 && <span className="cue-handle start" data-handle="start" aria-hidden="true" onPointerDown={(event) => onBeginDrag(event, cue, 'start', span)} />}
      <span className="cue-block-text">{cue.text}</span>
      {!locked && spanIndex === spans.length - 1 && <span className="cue-handle end" data-handle="end" aria-hidden="true" onPointerDown={(event) => onBeginDrag(event, cue, 'end', span)} />}
    </div>)) : cues.flatMap((cue) => spansOf(cue).map((span, spanIndex) => <div key={`${cue.id}:${spanIndex}`}
      className={`cue-span ${cue.id === selectedCueId ? 'active' : ''} ${warningCueIds.has(cue.id) ? 'has-warning' : ''}`} style={place(span)}>
      <WordBlocks cue={cue} span={span} selectedWordId={selectedWordId} onSeek={(sourceUs) => onSeekSource(cue, sourceUs, span)} onSelectWord={onSelectWord} />
    </div>))}
  </div>
}
