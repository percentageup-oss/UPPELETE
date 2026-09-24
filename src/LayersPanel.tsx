import type { CompositionRect, LayerMask, MaskShape } from './core/edit'
import type { Size } from './core/composition'
import type { LayerRow } from './core/layerStack'
import { convertMaskShape, maskSvg } from './core/layerMask'
import { Row, Segmented, SliderWithNumber, Toggle } from './style/controls'

const KIND_GLYPH: Record<LayerRow['kind'], string> = { fade: 'F', text: 'T', captions: 'C', effect: 'E', blur: 'B', image: 'I', video: 'V' }
const SHAPE_OPTIONS = [{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Ellipse' }, { value: 'path', label: 'Pen' }] as const

/** A small preview of the mask's footprint: the same SVG the renderer masks with, drawn on a dark chip. */
function MaskThumb({ mask, units }: { mask: LayerMask; units: Size }) {
  const src = `data:image/svg+xml,${encodeURIComponent(maskSvg({ ...mask, enabled: true }, units, { width: 40, height: Math.max(8, Math.round(40 * units.height / units.width)) }))}`
  return <img className={`mask-thumb ${mask.enabled ? '' : 'off'}`} src={src} alt="" draggable={false} />
}

/**
 * The left-rail Layers tab (docs/EDITING.md "Layer masks"): everything painted at the playhead,
 * front to back, like Photoshop's layer stack for this frame. Clicking a row selects that item on
 * the timeline; the focused row shows its mask — add one (rectangle, ellipse or pen), then adjust
 * shape, invert, feather and density, edit it on the stage, or remove it. Slider changes draft live
 * and commit once, so each gesture is one undo step.
 */
export function LayersPanel({ rows, timeLabel, units, focusKey, editing, drawing, offscreenSelection,
  onFocus, onAddMask, onEditOnStage, onStopEditing, onDraft, onCommit, onRemove, onReset, onJumpToSelection }: {
  rows: readonly LayerRow[]
  timeLabel: string
  /** The 1080-unit composition, so thumbnails share the renderer's coordinate space. */
  units: Size
  focusKey: string | null
  editing: boolean
  drawing: boolean
  /** The selected timeline item exists but is not visible at the playhead. */
  offscreenSelection: boolean
  onFocus: (row: LayerRow) => void
  onAddMask: (row: LayerRow, shape: MaskShape['kind']) => void
  onEditOnStage: (row: LayerRow) => void
  onStopEditing: () => void
  onDraft: (row: LayerRow, mask: LayerMask) => void
  onCommit: (row: LayerRow, mask: LayerMask) => void
  onRemove: (row: LayerRow) => void
  onReset: (row: LayerRow) => void
  onJumpToSelection: () => void
}) {
  const focused = rows.find((row) => row.key === focusKey) ?? null
  const mask = focused?.mask ?? null
  const change = (patch: Partial<LayerMask>, commit: boolean) => { if (focused && mask) (commit ? onCommit : onDraft)(focused, { ...mask, ...patch }) }
  const shape = mask?.shape
  return <div className="overlays-panel layers-panel">
    <div className="layers-head"><h2>Layers</h2><span className="layers-time" aria-live="polite">at {timeLabel}</span></div>
    {offscreenSelection && <p className="layers-note" role="status">The selected item isn’t visible at the playhead. <button type="button" className="link-button" onClick={onJumpToSelection}>Jump to it</button></p>}
    {rows.length === 0
      ? <p className="layers-empty">Nothing is showing at the playhead. Move it over a clip, title or effect to see its layers.</p>
      : <ol className="layer-list" aria-label="Layers at the playhead, front to back">
        {rows.map((row) => <li key={row.key}>
          <button type="button" className={`layer-row ${row.key === focusKey ? 'focused' : ''} ${row.active ? '' : 'idle'}`} aria-pressed={row.key === focusKey}
            aria-label={`${row.label}, ${row.detail}${row.mask ? row.mask.enabled ? ', masked' : ', mask off' : ''}`} onClick={() => onFocus(row)}>
            <span className={`layer-glyph kind-${row.kind}`} aria-hidden="true">{KIND_GLYPH[row.kind]}</span>
            <span className="layer-text"><span className="layer-label">{row.label}</span><span className="layer-detail">{row.active ? row.detail : `${row.detail} · none showing`}</span></span>
            {row.mask && <MaskThumb mask={row.mask} units={units} />}
          </button>
        </li>)}
      </ol>}
    {focused && <section className="layer-mask" aria-label={`Mask for ${focused.label}`}>
      <h3>Mask <span className="layer-mask-target">{focused.label}</span></h3>
      {!mask && <>
        <p className="style-hint">{focused.kind === 'captions' ? 'Masks the whole caption plane — every caption on this track.' : 'Only what is inside the mask shows.'}</p>
        <div className="edit-actions layer-add-mask" role="group" aria-label="Add mask">
          {SHAPE_OPTIONS.map((option) => <button key={option.value} type="button" disabled={drawing} onClick={() => onAddMask(focused, option.value)}>+ {option.label}</button>)}
        </div>
        {drawing && <p className="style-hint" role="status">Click on the preview to place points. Drag to curve. Click the first point or press Enter to close; Esc cancels.</p>}
      </>}
      {mask && shape && <>
        <Row label="Enabled" htmlFor="mask-enabled"><Toggle id="mask-enabled" checked={mask.enabled} label="Mask enabled" hideLabel onChange={(enabled) => change({ enabled }, true)} /></Row>
        <Row label="Shape"><Segmented id="mask-shape" value={shape.kind} options={SHAPE_OPTIONS} onChange={(kind) => onCommit(focused, convertMaskShape(mask, kind))} /></Row>
        <Row label="Invert" htmlFor="mask-invert"><Toggle id="mask-invert" checked={mask.invert} label="Invert mask" hideLabel onChange={(invert) => change({ invert }, true)} /></Row>
        <Row label="Feather"><SliderWithNumber id="mask-feather" min={0} max={200} step={1} value={mask.feather} unit="px" onDraft={(feather) => change({ feather }, false)} onCommit={(feather) => change({ feather }, true)} /></Row>
        <Row label="Density"><SliderWithNumber id="mask-density" min={0} max={100} step={1} value={Math.round(mask.density * 100)} unit="%"
          onDraft={(value) => change({ density: value / 100 }, false)} onCommit={(value) => change({ density: value / 100 }, true)} /></Row>
        {shape.kind === 'rect' && <Row label="Corner radius"><SliderWithNumber id="mask-radius" min={0} max={Math.max(1, Math.floor(Math.min(shape.rect.width, shape.rect.height) / 2))} step={1} value={shape.cornerRadius} unit="px"
          onDraft={(cornerRadius) => focused && onDraft(focused, { ...mask, shape: { ...shape, cornerRadius } })} onCommit={(cornerRadius) => focused && onCommit(focused, { ...mask, shape: { ...shape, cornerRadius } })} /></Row>}
        <div className="edit-actions layer-mask-actions">
          <button type="button" className={editing ? 'active' : undefined} aria-pressed={editing} onClick={() => editing ? onStopEditing() : onEditOnStage(focused)}>{editing ? 'Done editing' : 'Edit on preview'}</button>
          <button type="button" onClick={() => onReset(focused)}>Reset to layer</button>
          <button type="button" className="danger" onClick={() => onRemove(focused)}>Delete mask</button>
        </div>
        {editing && shape.kind === 'path' && <p className="style-hint">Drag points and handles. Alt-click a point to switch corner/smooth. Double-click the outline to add a point; Delete removes the selected point.</p>}
      </>}
    </section>}
  </div>
}

export type { CompositionRect }
