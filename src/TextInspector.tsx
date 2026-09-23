import { useEffect, useState } from 'react'
import type { TextOverlay } from './core/edit'
import { formatTimestamp, parseEditedTimestamp } from './core/time'
import { TimeFields } from './style/controls'

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
    <p className="style-hint">These transitions move or fade the whole title layer, not individual words.</p>
    <fieldset className="text-animation-controls"><legend>Layer transitions</legend>
    {(['enter', 'exit'] as const).map((edge) => <div key={edge} className="text-transition-edge">
      <strong>{edge === 'enter' ? 'In' : 'Out'}</strong>
      <label>{edge === 'enter' ? 'In transition' : 'Out transition'}<select aria-label={`${edge} animation`} value={item[edge].kind} onChange={(event) => onUpdate({ [edge]: { ...item[edge], kind: event.target.value as TextOverlay[typeof edge]['kind'] } })}>
        {['none', 'fade', 'pop', 'slide'].map((kind) => <option key={kind} value={kind}>{kind}</option>)}
      </select></label>
      {item[edge].kind === 'slide' && <label>Direction<select aria-label={`${edge} slide direction`} value={item[edge].direction ?? 'right'} onChange={(event) => onUpdate({ [edge]: { ...item[edge], direction: event.target.value as 'left' | 'right' | 'up' | 'down' } })}>
        {['left', 'right', 'up', 'down'].map((direction) => <option key={direction}>{direction}</option>)}
      </select></label>}
      <label>Duration (ms)<input type="number" min={0} max={5000} step={50} value={item[edge].durationUs / 1000}
        onChange={(event) => onUpdate({ [edge]: { ...item[edge], durationUs: Math.max(0, Math.min(5_000_000, Number(event.target.value) * 1000)) } })} /></label>
    </div>)}
    </fieldset>
    <div className="text-layer-controls"><span>Layer</span>
      <button type="button" onClick={() => onUpdate({ layerOrder: item.layerOrder + 1 })}>Bring forward</button>
      <button type="button" onClick={() => onUpdate({ layerOrder: item.layerOrder - 1 })}>Send backward</button>
      <button type="button" onClick={() => onUpdate({ layerOrder: Math.max(1, item.layerOrder) })}>Above captions</button>
      <button type="button" onClick={() => onUpdate({ layerOrder: Math.min(-1, item.layerOrder) })}>Below captions</button>
    </div>
    <div className="edit-actions"><button type="button" onClick={onDuplicate}>Duplicate</button><button className="danger" type="button" onClick={onDelete}>Delete text</button></div>
  </section>
}
