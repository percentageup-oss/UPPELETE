import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { formatClock, formatTimestamp } from './core/time'
import { untimedTokenCount } from './core/wordTiming'
import { DEFAULT_GROUPING, groupCaption, type GroupingOptions } from './core/captionGrouping'
import type { Segment } from './core/edit'
import type { CaptionWord, Cue } from './core/model'
import type { ProjectMedia } from './core/media'
import { wordMotionAvailability } from './captions/renderer'
import { spansInSequence } from './core/sequence'
import { MOTIONS, resolveCaptionMotion, type CaptionMotion, type CaptionStyle } from './captions/style'
import type { CaptionDisplay } from './captions/wordDisplay'
import { interactiveTranscriptSpans } from './transcript'
import { positionWordActionMenu } from './wordActionMenu'
import { TranscriptionPanel, type ApplyTranscript } from './TranscriptionPanel'

export type WordActionType = 'emphasis' | 'line-break' | 'split' | 'next' | 'previous' | 'delete'

export function CaptionsPanel({
  cueCount, visibleCues, selectedCueId, selectedWordId, warningCueIds, segments, sourceDurationUs,
  historyPastLength, historyFutureLength, onUndo, onRedo,
  effectiveStyle, selected, captionDisplay, onCaptionDisplay, onProjectStyle, onOverride, onResetOverrides, onEstimate, onGroup,
  onSelect, onUpdateText, onSelectWord, onWordAction, cueButtonRefs,
  media, mediaReady, onApplyTranscript, geminiKeyConfigured, onNeedGeminiKey, onImportSrt,
}: {
  cueCount: number
  visibleCues: readonly Cue[]
  selectedCueId: string | null
  selectedWordId: string | null
  warningCueIds: Set<string>
  segments: Segment[] | undefined
  sourceDurationUs: number
  historyPastLength: number
  historyFutureLength: number
  onUndo: () => void
  onRedo: () => void
  effectiveStyle: CaptionStyle
  selected: Cue | null
  captionDisplay: CaptionDisplay
  onCaptionDisplay: (display: CaptionDisplay) => void
  onProjectStyle: (style: CaptionStyle) => void
  onOverride: (override?: { motion?: CaptionMotion; motionSpeed?: number }) => void
  onResetOverrides: () => void
  onEstimate: () => void
  onGroup: (options: GroupingOptions, all: boolean) => void
  onSelect: (cue: Cue) => void
  onUpdateText: (cueId: string, text: string) => boolean
  onSelectWord: (cue: Cue, word: CaptionWord) => void
  onWordAction: (cueId: string, type: WordActionType, word: CaptionWord) => void
  cueButtonRefs: React.MutableRefObject<Map<string, HTMLElement>>
  media: ProjectMedia | null
  mediaReady: boolean
  onApplyTranscript: ApplyTranscript
  geminiKeyConfigured: boolean
  onNeedGeminiKey: () => void
  onImportSrt: () => void
}) {
  const selectedWord = selected?.words.find((word) => word.id === selectedWordId) ?? null
  return <>
    <div className="panel-heading"><div><h2 id="transcript-heading">Captions</h2><small>{cueCount} cues</small></div><div className="caption-heading-actions">
      <div className="history"><button onClick={onUndo} disabled={!historyPastLength} aria-label="Undo" title="Undo (⌘/Ctrl+Z)">↶</button><button onClick={onRedo} disabled={!historyFutureLength} aria-label="Redo" title="Redo (⌘/Ctrl+Shift+Z or Ctrl+Y)">↷</button></div>
      <CaptionTools style={effectiveStyle} selected={selected} captionDisplay={captionDisplay}
        onCaptionDisplay={onCaptionDisplay} onProjectStyle={onProjectStyle}
        onOverride={onOverride} onResetOverrides={onResetOverrides} onEstimate={onEstimate} onGroup={onGroup} />
    </div></div>
    <div className="cue-list" aria-label="Caption cues">
      {!cueCount && <div className="cue-list-empty">
        <TranscriptionPanel media={media} mediaReady={mediaReady} cues={[]} onApply={onApplyTranscript} primary
          geminiKeyConfigured={geminiKeyConfigured} onNeedGeminiKey={onNeedGeminiKey} />
        <button type="button" onClick={onImportSrt}>Import SRT</button>
      </div>}
      {visibleCues.map((cue, index) => <TranscriptCue key={cue.id} cue={cue} index={index} selected={cue.id === selectedCueId} warning={warningCueIds.has(cue.id)}
        removedByCut={Boolean(segments) && spansInSequence(cue, segments, sourceDurationUs).length === 0} selectedWordId={selectedWord?.id ?? null}
        onSelect={() => onSelect(cue)} onUpdateText={(text) => onUpdateText(cue.id, text)} onSelectWord={(word) => onSelectWord(cue, word)}
        onAction={(type, word) => onWordAction(cue.id, type, word)}
        reference={(element) => { if (element) cueButtonRefs.current.set(cue.id, element); else cueButtonRefs.current.delete(cue.id) }} />)}
    </div>
  </>
}

function CaptionTools({ style, selected, captionDisplay, onCaptionDisplay, onProjectStyle, onOverride, onResetOverrides, onEstimate, onGroup }: {
  style: CaptionStyle; selected: Cue | null; captionDisplay: CaptionDisplay
  onCaptionDisplay: (display: CaptionDisplay) => void; onProjectStyle: (style: CaptionStyle) => void
  onOverride: (override?: { motion?: CaptionMotion; motionSpeed?: number }) => void; onResetOverrides: () => void
  onEstimate: () => void; onGroup: (options: GroupingOptions, all: boolean) => void
}) {
  const [scope, setScope] = useState<'all' | 'selected'>('all')
  const [groupScope, setGroupScope] = useState<'selected' | 'all'>('selected')
  const [maxWords, setMaxWords] = useState(7)
  const [maxChars, setMaxChars] = useState(42)
  const hasOverride = Boolean(selected?.motionOverride)
  const effective = resolveCaptionMotion(style, scope === 'selected' ? selected?.motionOverride : undefined)
  const speedEnabled = effective.motion === 'word-pop' || effective.motion === 'phrase-fade'
  const missingTiming = selected && ['active-word-highlight', 'word-pop', 'progressive-word-reveal'].includes(effective.motion) && !wordMotionAvailability(selected).enabled
  let nextCount: number | null = null
  if (selected?.words.length && !untimedTokenCount(selected)) {
    try { nextCount = groupCaption(selected, () => 'preview', { ...DEFAULT_GROUPING, maxWords, maxGraphemes: maxChars }).length } catch { nextCount = null }
  }
  const setMotion = (motion: CaptionMotion) => {
    if (scope === 'selected') onOverride({ ...selected?.motionOverride, motion })
    else onProjectStyle({ ...style, motion })
  }
  const setSpeed = (motionSpeed: number) => {
    if (scope === 'selected') onOverride({ ...selected?.motionOverride, motionSpeed })
    else onProjectStyle({ ...style, motionSpeed })
  }
  return <details className="caption-tools">
    <summary>⚙ Caption Tools</summary>
    <div className="caption-tools-popover">
    <section aria-label="Caption transition controls">
      <div className="caption-tools-row"><label>Apply to <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}><option value="all">All captions</option><option value="selected" disabled={!selected}>Selected caption</option></select></label>
        {selected && hasOverride && <span className="override-badge">Override</span>}
        {scope === 'selected' && hasOverride && <button type="button" onClick={() => onOverride(undefined)}>Use project settings</button>}
      </div>
      <label>Transition <select aria-label="Caption transition" value={effective.motion} onChange={(e) => setMotion(e.target.value as CaptionMotion)}>
        {MOTIONS.map((motion) => <option key={motion.id} value={motion.id}>{motion.label}</option>)}
      </select></label>
      <label>Speed <input aria-label="Transition speed" type="number" min="0.25" max="4" step="0.25" value={effective.motionSpeed} disabled={!speedEnabled}
        onChange={(e) => setSpeed(Math.max(.25, Math.min(4, Number(e.target.value) || 1)))} />×</label>
      <button type="button" disabled={!speedEnabled || effective.motionSpeed === 1} onClick={() => setSpeed(1)}>Reset speed</button>
      {!speedEnabled && <p className="style-hint">This effect follows word timing and has no separate transition duration.</p>}
      {missingTiming && <p className="template-estimate-cta">This effect needs usable word timing. <button type="button" onClick={onEstimate}>Apply with estimated timing</button></p>}
      <button type="button" onClick={onResetOverrides}>Reset all caption overrides</button>
    </section>
    <section aria-label="Caption display and grouping controls">
      <label>Video display <select value={captionDisplay} onChange={(e) => onCaptionDisplay(e.target.value as CaptionDisplay)}><option value="line">Full caption</option><option value="word">One word at a time</option></select></label>
      <div className="caption-tools-row"><label>Max words <select value={maxWords} onChange={(e) => setMaxWords(Number(e.target.value))}><option value={7}>Default</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} words</option>)}</select></label>
        <label>Max characters <input type="number" min="1" max="200" value={maxChars} onChange={(e) => setMaxChars(Math.max(1, Math.min(200, Number(e.target.value) || 42)))} /></label>
        <label>Lines <select value={style.appearance.maxLines} onChange={(e) => onProjectStyle({ ...style, appearance: { ...style.appearance, maxLines: Number(e.target.value) } })}>{[1,2,3,4,5,6].map((value) => <option key={value} value={value}>{value} line{value === 1 ? '' : 's'}</option>)}</select></label>
      </div>
      <p className="style-hint">Character limits count Malayalam grapheme clusters. Explicit line breaks are preserved.</p>
      <label>Group <select value={groupScope} onChange={(e) => setGroupScope(e.target.value as typeof groupScope)}><option value="selected" disabled={!selected}>Selected caption</option><option value="all">All captions</option></select></label>
      <button type="button" disabled={groupScope === 'selected' && (!selected || !selected.words.length || Boolean(untimedTokenCount(selected)))} onClick={() => onGroup({ ...DEFAULT_GROUPING, maxWords, maxGraphemes: maxChars }, groupScope === 'all')}>Apply grouping{nextCount !== null && groupScope === 'selected' ? ` (${nextCount} captions)` : ''}</button>
    </section>
    </div>
  </details>
}

function TranscriptCue({ cue, index, selected, warning, removedByCut, selectedWordId, onSelect, onUpdateText, onSelectWord, onAction, reference }: {
  cue: Cue; index: number; selected: boolean; warning: boolean; removedByCut: boolean; selectedWordId: string | null
  onSelect: () => void; onUpdateText: (text: string) => boolean; onSelectWord: (word: CaptionWord) => void
  onAction: (type: WordActionType, word: CaptionWord) => void
  reference: (element: HTMLDivElement | null) => void
}) {
  const spans = interactiveTranscriptSpans(cue)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(cue.text)
  const [composing, setComposing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLSpanElement | null>(null)
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null)
  const activeIndex = cue.words.findIndex((word) => word.id === selectedWordId)
  const active = activeIndex >= 0 ? cue.words[activeIndex] : null
  const activateWord = (event: ReactMouseEvent<HTMLButtonElement>, word: CaptionWord) => {
    event.preventDefault(); event.stopPropagation(); menuAnchorRef.current = event.currentTarget; setMenuPosition(null); onSelectWord(word); setMenuOpen(true)
  }
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuOpen])
  useLayoutEffect(() => {
    if (!menuOpen || !active) return
    const place = () => {
      const anchor = menuAnchorRef.current
      const menu = menuRef.current
      if (!anchor || !menu) return
      setMenuPosition(positionWordActionMenu(anchor.getBoundingClientRect(), {
        width: menu.offsetWidth,
        height: menu.offsetHeight,
      }, { width: window.innerWidth, height: window.innerHeight }))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [menuOpen, active?.id])
  const beginEditing = () => { setMenuOpen(false); setDraft(cue.text); setEditing(true) }
  return <div ref={(element) => { rootRef.current = element; reference(element) }} role="button" tabIndex={0} className={`cue-card ${selected ? 'selected' : ''} ${warning ? 'has-warning' : ''}`}
    onClick={() => { setMenuOpen(false); onSelect() }} onDoubleClick={beginEditing} onKeyDown={(event) => { if ((event.target as HTMLElement).closest('textarea,button,input,select')) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() } }}
    aria-pressed={selected} aria-label={`Cue ${index + 1}: ${cue.text || 'empty'}, ${formatClock(cue.startUs)} to ${formatClock(cue.endUs)}`}>
    <span className="cue-number">{index + 1}</span><span className="cue-content"><time>{formatTimestamp(cue.startUs, ':').slice(3, -4)} — {formatTimestamp(cue.endUs, ':').slice(3, -4)}</time>
      {removedByCut && <span className="cue-cut-badge" title="This caption falls entirely inside a removed silence and won’t appear in the cut video.">Removed by cut</span>}
      {editing ? <textarea className="transcript-inline-editor" autoFocus value={draft} onClick={(event) => event.stopPropagation()} onChange={(event) => setDraft(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
        onKeyDown={(event) => { if (composing || event.nativeEvent.isComposing) return; if (event.key === 'Escape') { event.preventDefault(); setEditing(false) } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (onUpdateText(draft)) setEditing(false) } }}
        onBlur={() => { if (!composing && onUpdateText(draft)) setEditing(false) }} aria-label={`Edit caption ${index + 1}`} /> : <span className="cue-text">{spans ? spans.map((span, wordIndex) => <span key={cue.words[wordIndex].id}>{cue.text.slice(wordIndex ? spans[wordIndex - 1].textEnd : 0, span.textStart)}<button type="button" className={`transcript-word ${selectedWordId === cue.words[wordIndex].id ? 'selected' : ''}`}
        onClick={(event) => activateWord(event, cue.words[wordIndex])} onContextMenu={(event) => activateWord(event, cue.words[wordIndex])}>{cue.text.slice(span.textStart, span.textEnd)}</button>{wordIndex === spans.length - 1 ? cue.text.slice(span.textEnd) : ''}</span>) : cue.text}</span>
      }
      {selected && active && menuOpen && createPortal(<span ref={menuRef} className="word-actions" role="menu" aria-label={`Actions for ${active.text}`}
        style={menuPosition ? menuPosition : { visibility: 'hidden' }} onClick={(event) => event.stopPropagation()}>
        <span className="word-actions-heading">{active.text}</span>
        <button type="button" role="menuitem" onClick={() => { onAction('emphasis', active); setMenuOpen(false) }}><strong>Emphasize</strong><small>Make this word stand out</small></button>
        <button type="button" role="menuitem" onClick={beginEditing}><strong>Edit</strong><small>Modify the caption text</small></button>
        <button type="button" role="menuitem" disabled={activeIndex === 0} onClick={() => { onAction('line-break', active); setMenuOpen(false) }}><strong>New line</strong><small>Start a visual line here</small></button>
        <button type="button" role="menuitem" disabled={activeIndex === 0} onClick={() => { onAction('split', active); setMenuOpen(false) }}><strong>Split</strong><small>Split the caption here</small></button>
        <button type="button" role="menuitem" disabled={activeIndex === 0 || index === 0} onClick={() => { onAction('previous', active); setMenuOpen(false) }}><strong>Previous line</strong><small>Move through this word backward</small></button>
        <button type="button" role="menuitem" disabled={activeIndex === cue.words.length - 1} onClick={() => { onAction('next', active); setMenuOpen(false) }}><strong>Next line</strong><small>Move from this word forward</small></button>
        <button type="button" role="menuitem" className="danger" onClick={() => { onAction('delete', active); setMenuOpen(false) }}><strong>Delete</strong><small>Remove this word</small></button>
      </span>, document.body)}
    </span>
    <button type="button" className="cue-edit-trigger" aria-label={`Edit caption ${index + 1}`} title="Edit caption" onClick={(event) => { event.stopPropagation(); onSelect(); beginEditing() }}>✎</button>
  </div>
}
