import { useEffect, useState } from 'react'
import { isClosedShapeGeometry, type Arrowhead, type BubbleTail, type CornerRadii, type Glass, type Shape, type ShapeAnimation } from './core/edit'
import { LIQUID_GLASS_PRESET } from './core/glassMap'
import type { ShapeChanges } from './core/shapeCommands'
import { resolveCornerRadii } from './core/shapePath'
import { formatTimestamp, parseEditedTimestamp } from './core/time'
import { CAP_ICONS, DASH_ICONS } from './ShapeIcons'
import { ActionBar, HexColorField, NumberField, Row, Section, Segmented, Select, SliderWithNumber, TimeFields } from './style/controls'

/** A slider that drafts locally while dragging and commits one undoable update on release. */
function Slide({ id, value, min, max, step, unit, resetKey, onCommit }: {
  id: string; value: number; min: number; max: number; step: number; unit?: string; resetKey: string; onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value, resetKey])
  return <SliderWithNumber id={id} min={min} max={max} step={step} unit={unit} value={draft} onDraft={setDraft}
    onCommit={(next) => { const clamped = Math.max(min, Math.min(max, next)); if (clamped !== value) onCommit(clamped) }} />
}

const CORNERS: { key: keyof CornerRadii; label: string; glyph: string }[] = [
  { key: 'tl', label: 'Top left', glyph: '┌' }, { key: 'tr', label: 'Top right', glyph: '┐' },
  { key: 'bl', label: 'Bottom left', glyph: '└' }, { key: 'br', label: 'Bottom right', glyph: '┘' },
]

/** Corner radii for a box: one master slider, or four fields once unlinked. Every edit is one `shape-update`. */
function CornersSection({ item, onUpdate }: { item: Shape; onUpdate: (changes: ShapeChanges) => void }) {
  const geometry = item.geometry
  const hasCorners = geometry.kind === 'rect' || geometry.kind === 'bubble'
  const [linked, setLinked] = useState(!hasCorners || !geometry.cornerRadii)
  useEffect(() => { if (hasCorners) setLinked(!geometry.cornerRadii) }, [item.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (geometry.kind !== 'rect' && geometry.kind !== 'bubble') return null
  const radii = resolveCornerRadii(geometry)
  const setMaster = (cornerRadius: number) => { const { cornerRadii: _drop, ...rest } = geometry; onUpdate({ geometry: { ...rest, cornerRadius } }) }
  const setCorner = (key: keyof CornerRadii, value: number) => onUpdate({ geometry: { ...geometry, cornerRadii: { ...radii, [key]: value } } })
  const relink = () => { setLinked(true); if (geometry.cornerRadii) setMaster(geometry.cornerRadius) }
  return <Section id="shape-corners" title="Corners">
    <Row label="Link corners">
      <Segmented id="shape-corners-link" value={linked ? 'linked' : 'unlinked'} options={[{ value: 'linked', label: 'Linked' }, { value: 'unlinked', label: 'Separate' }]}
        onChange={(value) => { if (value === 'linked') relink(); else setLinked(false) }} />
    </Row>
    {linked
      ? <Row label="Radius" htmlFor="shape-corner-radius"><Slide id="shape-corner-radius" min={0} max={300} step={1} unit="px" value={geometry.cornerRadius} resetKey={item.id} onCommit={setMaster} /></Row>
      : CORNERS.map(({ key, label: text, glyph }) => <Row key={key} label={`${glyph} ${text}`} htmlFor={`shape-corner-${key}`}>
        <NumberField id={`shape-corner-${key}`} ariaLabel={`${text} radius`} min={0} max={20000} unit="px" value={radii[key]} onDraft={() => {}} onCommit={(value) => { if (value !== radii[key]) setCorner(key, value) }} />
      </Row>)}
  </Section>
}

/** The tail of a speech-bubble shape: side, position along the side, size and curve. Every edit is one `shape-update`. */
function TailSection({ item, onUpdate }: { item: Shape; onUpdate: (changes: ShapeChanges) => void }) {
  const geometry = item.geometry
  if (geometry.kind !== 'bubble') return null
  const { tail } = geometry
  const set = (changes: Partial<BubbleTail>) => onUpdate({ geometry: { ...geometry, tail: { ...tail, ...changes } } })
  const slide = (id: string, min: number, max: number, step: number, value: number, onCommit: (value: number) => void, unit?: string) =>
    <Slide id={id} min={min} max={max} step={step} unit={unit} value={value} resetKey={item.id} onCommit={onCommit} />
  return <Section id="shape-tail" title="Tail">
    <Row label="Side" htmlFor="shape-tail-side">
      <Select id="shape-tail-side" ariaLabel="Tail side" value={tail.side}
        options={(['left', 'right', 'top', 'bottom'] as const).map((side) => ({ value: side, label: label(side) }))} onChange={(side) => set({ side })} />
    </Row>
    <Row label="Position" htmlFor="shape-tail-offset">{slide('shape-tail-offset', 0, 100, 1, Math.round(tail.offset * 100), (value) => set({ offset: value / 100 }), '%')}</Row>
    <Row label="Width" htmlFor="shape-tail-width">{slide('shape-tail-width', 0, 400, 1, tail.width, (width) => set({ width }), 'px')}</Row>
    <Row label="Length" htmlFor="shape-tail-length">{slide('shape-tail-length', 0, 400, 1, tail.length, (length) => set({ length }), 'px')}</Row>
    <Row label="Curve" htmlFor="shape-tail-curve">{slide('shape-tail-curve', 0, 100, 1, Math.round(tail.curve * 100), (value) => set({ curve: value / 100 }), '%')}</Row>
  </Section>
}

const REVEAL_KINDS = ['draw', 'sweep', 'grow']

/** Liquid Glass look for closed shapes: the picture behind the shape is blurred, saturated and refracted at the rim. */
function GlassSection({ item, onUpdate }: { item: Shape; onUpdate: (changes: ShapeChanges) => void }) {
  const glass = item.glass
  const blocked = !isClosedShapeGeometry(item.geometry) ? 'Glass needs a closed shape: a box, bubble, ellipse, highlight or closed path.'
    : item.mask !== undefined ? 'Remove the mask to make this shape glass.'
    : item.blendMode !== undefined ? 'Set the blend mode back to Normal to make this shape glass.' : null
  const set = (changes: Partial<Glass>) => { if (glass) onUpdate({ glass: { ...glass, ...changes } }) }
  const setShadow = (changes: Partial<Glass['shadow']>) => { if (glass) onUpdate({ glass: { ...glass, shadow: { ...glass.shadow, ...changes } } }) }
  // Glass cannot draw, sweep or grow in, so switching it on swaps those for a fade instead of failing.
  const enable = () => onUpdate({
    glass: { ...LIQUID_GLASS_PRESET, shadow: { ...LIQUID_GLASS_PRESET.shadow } },
    ...(REVEAL_KINDS.includes(item.enter.kind) ? { enter: { kind: 'fade' as const, durationUs: item.enter.durationUs } } : {}),
    ...(REVEAL_KINDS.includes(item.exit.kind) ? { exit: { kind: 'fade' as const, durationUs: item.exit.durationUs } } : {}),
  })
  const slide = (id: string, min: number, max: number, step: number, value: number, onCommit: (value: number) => void, unit?: string) =>
    <Slide id={id} min={min} max={max} step={step} unit={unit} value={value} resetKey={item.id} onCommit={onCommit} />
  return <Section id="shape-glass" title="Glass">
    <Row label="Liquid Glass" hint={blocked ?? undefined}>
      <Segmented id="shape-glass-on" value={glass ? 'on' : 'off'}
        options={[{ value: 'on', label: 'On', title: blocked ?? undefined }, { value: 'off', label: 'Off' }]}
        onChange={(value) => { if (value === 'off') { if (glass) onUpdate({ glass: null }) } else if (!glass && !blocked) enable() }} />
    </Row>
    {glass && <>
      <Row label="Preset"><button type="button" onClick={enable}>Liquid Glass</button></Row>
      <Row label="Blur" htmlFor="shape-glass-blur">{slide('shape-glass-blur', 0, 60, 1, glass.blur, (blur) => set({ blur }), 'px')}</Row>
      <Row label="Saturation" htmlFor="shape-glass-saturation">{slide('shape-glass-saturation', 50, 300, 5, Math.round(glass.saturation * 100), (value) => set({ saturation: value / 100 }), '%')}</Row>
      <Row label="Refraction" htmlFor="shape-glass-refraction">{slide('shape-glass-refraction', 0, 40, 1, glass.refraction, (refraction) => set({ refraction }), 'px')}</Row>
      <Row label="Rim width" htmlFor="shape-glass-bezel">{slide('shape-glass-bezel', 2, 80, 1, glass.bezel, (bezel) => set({ bezel }), 'px')}</Row>
      <Row label="Tint" htmlFor="shape-glass-tint">{slide('shape-glass-tint', 0, 100, 1, Math.round(glass.tintOpacity * 100), (value) => set({ tintOpacity: value / 100 }), '%')}</Row>
      <Row label="Rim light" htmlFor="shape-glass-rim">{slide('shape-glass-rim', 0, 100, 1, Math.round(glass.rim * 100), (value) => set({ rim: value / 100 }), '%')}</Row>
      <Row label="Specular" htmlFor="shape-glass-specular">{slide('shape-glass-specular', 0, 100, 1, Math.round(glass.specular * 100), (value) => set({ specular: value / 100 }), '%')}</Row>
      <Row label="Shadow blur" htmlFor="shape-glass-shadow-blur">{slide('shape-glass-shadow-blur', 0, 60, 1, glass.shadow.blur, (blur) => setShadow({ blur }), 'px')}</Row>
      <Row label="Shadow offset" htmlFor="shape-glass-shadow-offset">{slide('shape-glass-shadow-offset', -40, 40, 1, glass.shadow.offsetY, (offsetY) => setShadow({ offsetY }), 'px')}</Row>
      <Row label="Shadow opacity" htmlFor="shape-glass-shadow-opacity">{slide('shape-glass-shadow-opacity', 0, 100, 1, Math.round(glass.shadow.opacity * 100), (value) => setShadow({ opacity: value / 100 }), '%')}</Row>
    </>}
  </Section>
}

const ARROWHEADS: Arrowhead[] = ['none', 'triangle', 'open', 'dot']
const label = (value: string) => value[0].toUpperCase() + value.slice(1)

/** Edits one vector shape (schema 17). Every control is one undoable `shape-update`. */
export function ShapeInspector({ item, onUpdate, onMove, onLength, onDuplicate, onDelete, onInvalid }: {
  item: Shape; onUpdate: (changes: ShapeChanges) => void
  onMove: (startUs: number) => void; onLength: (lengthUs: number) => void
  onDuplicate: () => void; onDelete: () => void; onInvalid: (message: string) => void
}) {
  const lengthUs = item.endUs - item.startUs
  const [start, setStart] = useState(formatTimestamp(item.startUs, ':'))
  const [length, setLength] = useState(formatTimestamp(lengthUs, ':'))
  useEffect(() => { setStart(formatTimestamp(item.startUs, ':')); setLength(formatTimestamp(lengthUs, ':')) }, [item.id, item.startUs, lengthUs])
  const updateTime = (value: string, field: 'start' | 'length') => {
    const parsed = parseEditedTimestamp(value, field === 'start' ? item.startUs : lengthUs)
    if (parsed === null || (field === 'length' && parsed <= 0)) { onInvalid('Use a valid positive HH:MM:SS:mmm timestamp.'); return }
    field === 'start' ? onMove(parsed) : onLength(parsed)
  }
  const isLinear = item.geometry.kind === 'line' || item.geometry.kind === 'path'
  const stroke = item.stroke, fill = item.fill
  const setStroke = (changes: Partial<NonNullable<Shape['stroke']>>) => onUpdate({ stroke: { ...(stroke ?? { color: '#E63946', width: 8, dash: 'solid', cap: 'round' }), ...changes } })
  const setFill = (changes: Partial<NonNullable<Shape['fill']>>) => onUpdate({ fill: { ...(fill ?? { color: '#D4F53C', opacity: 1 }), ...changes } })
  // A shape must keep a stroke or a fill, so the one that is left can't be switched off.
  const canDropStroke = fill !== null, canDropFill = stroke !== null

  return <section className="editor-form shape-inspector" aria-label="Shape settings">
    <TimeFields fields={[
      { id: 'shape-start', label: 'Start', value: start, onChange: setStart, onBlur: () => updateTime(start, 'start') },
      { id: 'shape-length', label: 'Length', value: length, onChange: setLength, onBlur: () => updateTime(length, 'length') },
    ]} />
    <Section id="shape-stroke" title="Line">
      <Row label="Show line">
        <Segmented id="shape-stroke-on" value={stroke ? 'on' : 'off'} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          onChange={(value) => { if (value === 'on') setStroke({}); else if (canDropStroke) onUpdate({ stroke: null }) }} />
      </Row>
      {stroke && <>
        <Row label="Color" htmlFor="shape-stroke-color"><HexColorField id="shape-stroke-color" value={stroke.color} onDraft={() => {}} onCommit={(color) => setStroke({ color })} /></Row>
        <Row label="Width" htmlFor="shape-stroke-width"><Slide id="shape-stroke-width" min={1} max={80} step={1} unit="px" value={stroke.width} resetKey={item.id} onCommit={(width) => setStroke({ width })} /></Row>
        <Row label="Style"><Segmented id="shape-stroke-dash" value={stroke.dash} options={[{ value: 'solid', label: 'Solid', icon: DASH_ICONS.solid }, { value: 'dashed', label: 'Dashed', icon: DASH_ICONS.dashed }, { value: 'dotted', label: 'Dotted', icon: DASH_ICONS.dotted }]}
          onChange={(dash) => setStroke({ dash })} /></Row>
        <Row label="Ends"><Segmented id="shape-stroke-cap" value={stroke.cap} options={[{ value: 'round', label: 'Round', icon: CAP_ICONS.round }, { value: 'butt', label: 'Flat', icon: CAP_ICONS.butt }]}
          onChange={(cap) => setStroke({ cap })} /></Row>
      </>}
    </Section>
    <CornersSection item={item} onUpdate={onUpdate} />
    <TailSection item={item} onUpdate={onUpdate} />
    <GlassSection item={item} onUpdate={onUpdate} />
    {!isLinear && <Section id="shape-fill" title="Fill">
      <Row label="Show fill">
        <Segmented id="shape-fill-on" value={fill ? 'on' : 'off'} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          onChange={(value) => { if (value === 'on') setFill({}); else if (canDropFill) onUpdate({ fill: null }) }} />
      </Row>
      {fill && <>
        <Row label="Color" htmlFor="shape-fill-color"><HexColorField id="shape-fill-color" value={fill.color} onDraft={() => {}} onCommit={(color) => setFill({ color })} /></Row>
        <Row label="Opacity" htmlFor="shape-fill-opacity"><Slide id="shape-fill-opacity" min={0} max={100} step={1} unit="%" value={Math.round(fill.opacity * 100)} resetKey={item.id} onCommit={(value) => setFill({ opacity: value / 100 })} /></Row>
      </>}
    </Section>}
    {isLinear && <Section id="shape-arrowheads" title="Arrowheads">
      {(['arrowStart', 'arrowEnd'] as const).map((field) => <Row key={field} label={field === 'arrowStart' ? 'Start' : 'End'} htmlFor={`shape-${field}`}>
        <Select id={`shape-${field}`} ariaLabel={field === 'arrowStart' ? 'Start arrowhead' : 'End arrowhead'} value={item[field]}
          options={ARROWHEADS.map((kind) => ({ value: kind, label: label(kind) }))} onChange={(kind) => onUpdate({ [field]: kind })} />
      </Row>)}
    </Section>}
    <Row label="Opacity" htmlFor="shape-opacity"><Slide id="shape-opacity" min={0} max={100} step={1} unit="%" value={Math.round(item.opacity * 100)} resetKey={item.id} onCommit={(value) => onUpdate({ opacity: value / 100 })} /></Row>
    <Section id="shape-transitions" title="Animation">
      {(['enter', 'exit'] as const).map((edge) => {
        const anim: ShapeAnimation = item[edge]
        const kinds = (edge === 'enter' ? ['none', 'fade', 'pop', 'draw', 'sweep', 'grow', 'slide'] : ['none', 'fade', 'pop', 'grow', 'slide'])
          .filter((kind) => !item.glass || !REVEAL_KINDS.includes(kind))
        return <div key={edge} className="text-transition-edge">
          <p className="style-subgroup">{edge === 'enter' ? 'In' : 'Out'}</p>
          <Row label="Effect" htmlFor={`shape-${edge}-kind`}>
            <Select id={`shape-${edge}-kind`} ariaLabel={`${edge} animation`} value={anim.kind}
              options={kinds.map((kind) => ({ value: kind, label: label(kind) }))}
              onChange={(kind) => onUpdate({ [edge]: kind === 'slide' ? { ...anim, kind, direction: anim.kind === 'slide' ? anim.direction : 'right' } : { kind, durationUs: anim.durationUs } })} />
          </Row>
          {anim.kind === 'slide' && <Row label="Direction" htmlFor={`shape-${edge}-direction`}>
            <Select id={`shape-${edge}-direction`} ariaLabel={`${edge} slide direction`} value={anim.direction ?? 'right'}
              options={(['left', 'right', 'up', 'down'] as const).map((direction) => ({ value: direction, label: label(direction) }))}
              onChange={(direction) => onUpdate({ [edge]: { ...anim, direction } })} />
          </Row>}
          {anim.kind !== 'none' && <Row label="Duration" htmlFor={`shape-${edge}-duration`}>
            <Slide id={`shape-${edge}-duration`} min={50} max={5000} step={50} unit="ms" value={Math.round(anim.durationUs / 1000)} resetKey={item.id}
              onCommit={(ms) => onUpdate({ [edge]: { ...anim, durationUs: ms * 1000 } })} />
          </Row>}
        </div>
      })}
    </Section>
    <Row label="Layer">
      <Segmented id="shape-layer" value={item.layerOrder > 0 ? 'above' : item.layerOrder < 0 ? 'below' : 'none'}
        options={[{ value: 'below', label: 'Below captions' }, { value: 'above', label: 'Above captions' }]}
        onChange={(value) => onUpdate({ layerOrder: value === 'above' ? Math.max(1, item.layerOrder) : Math.min(-1, item.layerOrder) })} />
    </Row>
    <Row label="Order">
      <div className="ins-button-pair">
        <button type="button" onClick={() => onUpdate({ layerOrder: item.layerOrder + 1 })}>Bring forward</button>
        <button type="button" onClick={() => onUpdate({ layerOrder: item.layerOrder - 1 })}>Send backward</button>
      </div>
    </Row>
    <ActionBar><button type="button" onClick={onDuplicate}>Duplicate</button><button className="danger" type="button" onClick={onDelete}>Delete shape</button></ActionBar>
  </section>
}
