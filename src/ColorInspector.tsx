import type { Grade, GradeInput, ProjectAsset } from './core/edit'
import type { LogProfile } from './color/transfer'
import { LOOKS } from './color/looks'
import { NEUTRAL_GRADE } from './color/bake'
import { Row, Segmented, Select, SliderWithNumber, type SelectOption } from './style/controls'

const LOG_OPTIONS: SelectOption<LogProfile>[] = [
  { value: 'f-log', label: 'F-Log' }, { value: 'f-log2', label: 'F-Log2' }, { value: 's-log3', label: 'S-Log3' },
  { value: 'apple-log', label: 'Apple Log' }, { value: 'v-log', label: 'V-Log' }, { value: 'c-log3', label: 'C-Log3' },
]
const LOOK_OPTIONS: SelectOption<string>[] = [{ value: '', label: 'None' }, ...LOOKS.map((look) => ({ value: look.id, label: look.name }))]

const pct = (v: number) => Math.round(v * 100)
const fromPct = (v: number) => v / 100

/** A percent slider over one primaries field, drafting/committing the whole `Grade` each time —
 * `ColorInspector`'s own draft/commit contract mirrors `ClipInspector`'s (live while dragging, one
 * undo step per finished gesture). */
function PrimariesSlider({ id, label, value, min = -100, max = 100, onDraft, onCommit, onReset, isDefault, hint }: {
  id: string; label: string; value: number; min?: number; max?: number
  onDraft: (v: number) => void; onCommit: (v: number) => void; onReset?: () => void; isDefault?: boolean; hint?: string
}) {
  return <Row label={label} htmlFor={id} onReset={onReset} isDefault={isDefault} hint={hint}>
    <SliderWithNumber id={id} min={min} max={max} step={1} unit="%" value={pct(value)}
      onDraft={(v) => onDraft(fromPct(v))} onCommit={(v) => onCommit(fromPct(Math.max(min, Math.min(max, v))))} />
  </Row>
}

/**
 * The grade-editing fields for a selected adjustment layer, embedded by `ClipInspector` (the same
 * shell that already provides its timing, Enabled/bypass toggle and Delete). `docs/EDITING.md`
 * "Color: adjustment layers" is the pipeline this mirrors: input transform → primaries → look →
 * intensity mix. `lutAssets` lists every `lut`-kind project asset available for the input picker
 * (imported from the Color tab's "My LUTs" section).
 */
export function ColorInspector({ grade, lutAssets, onDraft, onCommit }: {
  grade: Grade
  lutAssets: readonly ProjectAsset[]
  onDraft: (grade: Grade) => void
  onCommit: (grade: Grade) => void
}) {
  const { primaries } = grade
  const draftPrimaries = (patch: Partial<Grade['primaries']>) => onDraft({ ...grade, primaries: { ...primaries, ...patch } })
  const commitPrimaries = (patch: Partial<Grade['primaries']>) => onCommit({ ...grade, primaries: { ...primaries, ...patch } })
  const resetPrimaries = (patch: Partial<Grade['primaries']>) => () => onCommit({ ...grade, primaries: { ...primaries, ...patch } })
  const triple = (id: 'lift' | 'gamma' | 'gain', label: string) => {
    const master = primaries[id][0]
    return <PrimariesSlider id={`grade-${id}`} label={label} value={master}
      onDraft={(v) => draftPrimaries({ [id]: [v, v, v] })} onCommit={(v) => commitPrimaries({ [id]: [v, v, v] })}
      onReset={resetPrimaries({ [id]: NEUTRAL_GRADE.primaries[id] })} isDefault={primaries[id].every((v) => v === 0)}
      hint="Sets red, green and blue together." />
  }

  const inputType: GradeInput['type'] = grade.input.type
  const setInputType = (type: GradeInput['type']) => {
    const input: GradeInput = type === 'none' ? { type: 'none' }
      : type === 'log' ? { type: 'log', profile: grade.input.type === 'log' ? grade.input.profile : 'f-log' }
      : { type: 'lut', assetId: grade.input.type === 'lut' ? grade.input.assetId : lutAssets[0]?.id ?? '' }
    onCommit({ ...grade, input })
  }

  return <div className="editor-form color-inspector">
    <p className="clip-inspector-meta">Grades every video/image clip on the tracks below it, for its own time range. Backgrounds (generated fills) are never graded.</p>

    <Row label="Input" htmlFor="grade-input-type">
      <Segmented id="grade-input-type" value={inputType} onChange={setInputType}
        options={[{ value: 'none', label: 'None' }, { value: 'log', label: 'Camera log' },
          ...(lutAssets.length || inputType === 'lut' ? [{ value: 'lut' as const, label: 'LUT' }] : [])]} />
    </Row>
    {!lutAssets.length && grade.input.type !== 'lut' && <p className="clip-inspector-meta">Import a .cube LUT in the Color tab to use a custom input.</p>}
    {grade.input.type === 'log' && <Row label="Profile" htmlFor="grade-log-profile">
      <Select id="grade-log-profile" value={grade.input.profile} options={LOG_OPTIONS}
        onChange={(profile) => onCommit({ ...grade, input: { type: 'log', profile } })} />
    </Row>}
    {grade.input.type === 'lut' && (lutAssets.length
      ? <Row label="LUT" htmlFor="grade-lut-asset">
        <Select id="grade-lut-asset" value={grade.input.assetId} options={lutAssets.map((asset) => ({ value: asset.id, label: asset.name }))}
          onChange={(assetId) => onCommit({ ...grade, input: { type: 'lut', assetId } })} />
      </Row>
      : <p className="clip-inspector-meta">Import a .cube LUT in the Color tab first.</p>)}

    <Row label="Exposure" htmlFor="grade-exposure" onReset={resetPrimaries({ exposureStops: 0 })} isDefault={primaries.exposureStops === 0}>
      <SliderWithNumber id="grade-exposure" min={-5} max={5} step={0.1} unit=" stops" value={Math.round(primaries.exposureStops * 10) / 10}
        onDraft={(v) => draftPrimaries({ exposureStops: v })} onCommit={(v) => commitPrimaries({ exposureStops: Math.max(-5, Math.min(5, v)) })} />
    </Row>
    <PrimariesSlider id="grade-temperature" label="Temperature" value={primaries.temperature}
      onDraft={(v) => draftPrimaries({ temperature: v })} onCommit={(v) => commitPrimaries({ temperature: v })}
      onReset={resetPrimaries({ temperature: 0 })} isDefault={primaries.temperature === 0} />
    <PrimariesSlider id="grade-tint" label="Tint" value={primaries.tint}
      onDraft={(v) => draftPrimaries({ tint: v })} onCommit={(v) => commitPrimaries({ tint: v })}
      onReset={resetPrimaries({ tint: 0 })} isDefault={primaries.tint === 0} />
    <PrimariesSlider id="grade-contrast" label="Contrast" value={primaries.contrast}
      onDraft={(v) => draftPrimaries({ contrast: v })} onCommit={(v) => commitPrimaries({ contrast: v })}
      onReset={resetPrimaries({ contrast: 0 })} isDefault={primaries.contrast === 0} />
    <PrimariesSlider id="grade-highlights" label="Highlights" value={primaries.highlights}
      onDraft={(v) => draftPrimaries({ highlights: v })} onCommit={(v) => commitPrimaries({ highlights: v })}
      onReset={resetPrimaries({ highlights: 0 })} isDefault={primaries.highlights === 0} />
    <PrimariesSlider id="grade-shadows" label="Shadows" value={primaries.shadows}
      onDraft={(v) => draftPrimaries({ shadows: v })} onCommit={(v) => commitPrimaries({ shadows: v })}
      onReset={resetPrimaries({ shadows: 0 })} isDefault={primaries.shadows === 0} />
    <PrimariesSlider id="grade-saturation" label="Saturation" value={primaries.saturation} min={-100} max={200}
      onDraft={(v) => draftPrimaries({ saturation: v })} onCommit={(v) => commitPrimaries({ saturation: Math.max(-1, Math.min(2, v)) })}
      onReset={resetPrimaries({ saturation: 0 })} isDefault={primaries.saturation === 0} />
    {triple('lift', 'Lift')}
    {triple('gamma', 'Gamma')}
    {triple('gain', 'Gain')}

    <Row label="Look" htmlFor="grade-look">
      <Select id="grade-look" value={grade.look?.id ?? ''} options={LOOK_OPTIONS}
        onChange={(id) => onCommit({ ...grade, look: id ? { id, strength: grade.look?.strength ?? 1 } : null })} />
    </Row>
    {grade.look && <PrimariesSlider id="grade-look-strength" label="Look strength" value={grade.look.strength} min={0} max={100}
      onDraft={(v) => onDraft({ ...grade, look: { ...grade.look!, strength: v } })}
      onCommit={(v) => onCommit({ ...grade, look: { ...grade.look!, strength: Math.max(0, Math.min(1, v)) } })}
      onReset={() => onCommit({ ...grade, look: { ...grade.look!, strength: 1 } })} isDefault={grade.look.strength === 1} />}

    <PrimariesSlider id="grade-intensity" label="Intensity" value={grade.intensity} min={0} max={100}
      onDraft={(v) => onDraft({ ...grade, intensity: v })} onCommit={(v) => onCommit({ ...grade, intensity: Math.max(0, Math.min(1, v)) })}
      onReset={() => onCommit({ ...grade, intensity: 1 })} isDefault={grade.intensity === 1}
      hint="0% bakes to no effect at all, regardless of the settings above." />
  </div>
}
