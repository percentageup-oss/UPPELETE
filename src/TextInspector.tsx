import { useEffect, useState } from 'react'
import type { TextOverlay } from './core/edit'
import { formatTimestamp, parseEditedTimestamp } from './core/time'
import { ActionBar, Row, Section, Segmented, Select, SliderWithNumber, TimeFields } from './style/controls'

/** A ms slider that drafts locally while dragging and commits one undoable update on release. */
function DurationSlider({ id, durationUs, resetKey, onCommit }: { id: string; durationUs: number; resetKey: string; onCommit: (durationUs: number) => void }) {
  const [ms, setMs] = useState(Math.round(durationUs / 1000))
  useEffect(() => setMs(Math.round(durationUs / 1000)), [durationUs, resetKey])
  return <SliderWithNumber id={id} min={0} max={5000} step={50} unit="ms" value={ms} onDraft={setMs}
    onCommit={(value) => { const next = Math.max(0, Math.min(5000, Math.round(value))) * 1000; if (next !== durationUs) onCommit(next) }} />
}

export function TextInspector({ item, onUpdate, onMove, onLength, onDuplicate, onDelete, onInvalid }: {
  item: TextOverlay; onUpdate: (changes: Partial<TextOverlay>) => void
  onMove: (startUs: number) => void; onLength: (lengthUs: number) => void
  onDuplicate: () => void; onDelete: () => void; onInvalid: (message: string) => void
}) {
  const lengthUs = item.endUs - item.startUs
  const [start, setStart] = useState(formatTimestamp(item.startUs, ':'))
  const [length, setLength] = useState(formatTimestamp(lengthUs, ':'))
  const [text, setText] = useState(item.text)
  useEffect(() => { setStart(formatTimestamp(item.startUs, ':')); setLength(formatTimestamp(lengthUs, ':')) }, [item.id, item.startUs, lengthUs])
  useEffect(() => setText(item.text), [item.id, item.text])
  const updateTime = (value: string, field: 'start' | 'length') => {
    const parsed = parseEditedTimestamp(value, field === 'start' ? item.startUs : lengthUs)
    if (parsed === null || (field === 'length' && parsed <= 0)) { onInvalid('Use a valid positive HH:MM:SS:mmm timestamp.'); return }
    field === 'start' ? onMove(parsed) : onLength(parsed)
  }
  return <section className="editor-form text-inspector" aria-label="Text item settings">
    <label>Text<textarea aria-label="Text content" value={text} onChange={(event) => setText(event.target.value)} onBlur={() => {
      const trimmed = text.trim()
      if (!trimmed) { setText(item.text); onInvalid('Text cannot be empty.'); return }
      if (trimmed !== item.text) onUpdate({ text: trimmed })
    }} /></label>
    <TimeFields fields={[
      { id: 'text-start', label: 'Start', value: start, onChange: setStart, onBlur: () => updateTime(start, 'start') },
      { id: 'text-length', label: 'Length', value: length, onChange: setLength, onBlur: () => updateTime(length, 'length') },
    ]} />
    <Section id="title-motion" title="Title motion">
      <Row label="Treatment" htmlFor="title-motion-kind">
        <Select id="title-motion-kind" ariaLabel="Title motion treatment" value={item.titleMotion?.kind ?? 'none'}
          options={[
            { value: 'none', label: 'None' }, { value: 'focus', label: 'Focus Reveal' },
            { value: 'lift', label: 'Soft Lift' }, { value: 'cascade', label: 'Word Cascade' },
            { value: 'wipe', label: 'Line Wipe' }, { value: 'accent', label: 'Violet Accent' },
            { value: 'scale', label: 'Quiet Scale' },
          ]} onChange={(kind) => onUpdate({ titleMotion: kind === 'none' ? undefined : {
            kind: kind as NonNullable<TextOverlay['titleMotion']>['kind'], durationUs: item.titleMotion?.durationUs ?? 650_000,
          } })} />
      </Row>
      {item.titleMotion && <Row label="Duration" htmlFor="title-motion-duration">
        <DurationSlider id="title-motion-duration" durationUs={item.titleMotion.durationUs} resetKey={item.id}
          onCommit={(durationUs) => onUpdate({ titleMotion: { ...item.titleMotion!, durationUs: Math.max(100_000, durationUs) } })} />
      </Row>}
    </Section>
    <p className="style-hint">These transitions move or fade the whole title layer, not individual words.</p>
    <Section id="text-transitions" title="Layer transitions">
      {(['enter', 'exit'] as const).map((edge) => {
        const label = edge === 'enter' ? 'In' : 'Out'
        return <div key={edge} className="text-transition-edge">
          <p className="style-subgroup">{label}</p>
          <Row label={edge === 'enter' ? 'In transition' : 'Out transition'} htmlFor={`text-${edge}-kind`}>
            <Select id={`text-${edge}-kind`} ariaLabel={`${edge} animation`} value={item[edge].kind}
              options={(['none', 'fade', 'pop', 'slide'] as const).map((kind) => ({ value: kind, label: kind[0].toUpperCase() + kind.slice(1) }))}
              onChange={(kind) => onUpdate({ [edge]: { ...item[edge], kind } })} />
          </Row>
          {item[edge].kind === 'slide' && <Row label="Direction" htmlFor={`text-${edge}-direction`}>
            <Select id={`text-${edge}-direction`} ariaLabel={`${edge} slide direction`} value={item[edge].direction ?? 'right'}
              options={(['left', 'right', 'up', 'down'] as const).map((direction) => ({ value: direction, label: direction[0].toUpperCase() + direction.slice(1) }))}
              onChange={(direction) => onUpdate({ [edge]: { ...item[edge], direction } })} />
          </Row>}
          <Row label="Duration" htmlFor={`text-${edge}-duration`}>
            <DurationSlider id={`text-${edge}-duration`} durationUs={item[edge].durationUs} resetKey={item.id}
              onCommit={(durationUs) => onUpdate({ [edge]: { ...item[edge], durationUs } })} />
          </Row>
        </div>
      })}
    </Section>
    <Row label="Layer">
      <Segmented id="text-layer" value={item.layerOrder > 0 ? 'above' : item.layerOrder < 0 ? 'below' : 'none'}
        options={[{ value: 'below', label: 'Below captions' }, { value: 'above', label: 'Above captions' }]}
        onChange={(value) => onUpdate({ layerOrder: value === 'above' ? Math.max(1, item.layerOrder) : Math.min(-1, item.layerOrder) })} />
    </Row>
    <Row label="Order">
      <div className="ins-button-pair">
        <button type="button" onClick={() => onUpdate({ layerOrder: item.layerOrder + 1 })}>Bring forward</button>
        <button type="button" onClick={() => onUpdate({ layerOrder: item.layerOrder - 1 })}>Send backward</button>
      </div>
    </Row>
    <ActionBar><button type="button" onClick={onDuplicate}>Duplicate</button><button className="danger" type="button" onClick={onDelete}>Delete text</button></ActionBar>
  </section>
}
