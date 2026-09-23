import { useEffect, useMemo, useState } from 'react'
import { summarizeWordMotion, wordMotionAvailability, type MotionCue } from './captions/renderer'
import { CaptionPreview } from './captions/CaptionPreview'
import { CAPTION_TEMPLATES, TEMPLATE_DEMO, type CaptionTemplate } from './captions/templates'
import { captionStyleInputs, MOTIONS, type CaptionMotion, type CaptionStyle, type SavedCaptionPreset } from './captions/style'

const WORD_MOTION_UNAVAILABLE = 'No cue in this project currently has usable word timing (transcribe, estimate, or align word timing first). Word-dependent presets are disabled; captions use static clean.'

export function TemplatesPanel({ style, cues, activeCue, presets, onCommitMotion, onApplyTemplate, onSavePreset, onApplyPreset, onDeletePreset, onEstimate, onAddText, target = 'captions' }: {
  style: CaptionStyle
  cues: readonly MotionCue[]
  activeCue: MotionCue | null
  presets: readonly SavedCaptionPreset[]
  onApplyTemplate: (style: CaptionStyle) => void
  onCommitMotion: (motion: CaptionMotion) => void
  onSavePreset: (name: string) => void
  onApplyPreset: (id: string) => void
  onDeletePreset: (id: string) => void
  /** Estimates word timing for the active cue; omitted when there is none to estimate for. */
  onEstimate?: () => void
  onAddText?: () => void
  target?: 'captions' | 'text'
}) {
  const [query, setQuery] = useState('')
  const [library, setLibrary] = useState<'built-in' | 'saved'>('built-in')
  const [presetName, setPresetName] = useState('')
  const summary = summarizeWordMotion(cues)
  const wordMotionUsable = summary.complete + summary.estimated > 0
  const activeAvailability = activeCue ? wordMotionAvailability(activeCue) : null
  const motionNeedsWords = MOTIONS.find((motion) => motion.id === style.motion)?.words ?? false
  const showEstimateCta = target !== 'text' && motionNeedsWords && activeCue && activeAvailability && !activeAvailability.enabled
  const motionDescription = target === 'text'
    ? 'Word animation is decorative and does not use or alter speech caption timing.'
    : `${wordMotionUsable
      ? `* Word-dependent: ${summary.complete} cue${summary.complete === 1 ? '' : 's'} with aligned/model/manual word timing, ${summary.estimated} with estimated timing (labelled, not aligned to audio), ${summary.unavailable} without usable word timing (fall back to static clean).`
      : WORD_MOTION_UNAVAILABLE}${activeCue && activeAvailability ? ` Selected cue: ${activeAvailability.explanation}` : ''}`

  return <section className="templates-panel" aria-labelledby="templates-heading">
    <h3 id="templates-heading">{target === 'text' ? 'Title styles' : 'Templates'}</h3>
    {onAddText && <><button type="button" className="add-text-button" onClick={onAddText}>Add text at playhead</button>
      <p className="style-hint">Tip: double-click anywhere in the video preview to add text at that spot.</p></>}

    {showEstimateCta && <div className="template-estimate-cta" role="status">
      <p>This style needs word timing to build word by word, and the selected caption doesn’t have it yet — it’s showing as a static line instead.</p>
      {onEstimate && <button type="button" onClick={onEstimate}>Estimate word timing for this caption</button>}
    </div>}

    <div className="template-library-tabs" role="group" aria-label="Template library">
      <button type="button" aria-pressed={library === 'built-in'} onClick={() => setLibrary('built-in')}>Built-in Templates</button>
      <button type="button" aria-pressed={library === 'saved'} onClick={() => setLibrary('saved')}>My Presets</button>
    </div>
    <label className="template-search">Find a template
      <input type="search" value={query} placeholder="Search templates…" onChange={(event) => setQuery(event.target.value)} />
    </label>
    {library === 'built-in' && <div className="template-gallery" aria-label="Built-in caption templates">
      {CAPTION_TEMPLATES.filter((template) => `${template.name} ${template.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())).map((template) =>
        <TemplateCard key={template.id} template={template} selected={target === 'text'
          ? JSON.stringify(style.appearance) === JSON.stringify(template.style.appearance)
          : JSON.stringify(style) === JSON.stringify(template.style)}
          previewMotion={target === 'text' ? 'static-clean' : template.style.motion}
          onApply={() => onApplyTemplate(template.style)} />)}
      {!CAPTION_TEMPLATES.some((template) => `${template.name} ${template.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())) && <p className="style-hint">No matching templates.</p>}
      <p className="style-hint">{target === 'text'
        ? 'These styles change appearance only. Position, word animation, and layer transitions stay as set.'
        : 'Hover or focus to preview sample motion. Applying a word-motion template fills only missing word timing with review-required estimates; existing model, aligned, or manual timing is preserved.'}</p>
    </div>}
    <fieldset className="style-motion" aria-describedby="motion-status">
        <legend>{target === 'text' ? 'Word animation' : 'Motion preset'}</legend>
      {MOTIONS.map((motion) => {
        const disabled = target !== 'text' && motion.words && !wordMotionUsable
        return <label key={motion.id} className={`motion-card ${disabled ? 'disabled' : ''}`}>
          <input type="radio" name="caption-motion" value={motion.id} checked={style.motion === motion.id} disabled={disabled}
            aria-describedby={motion.words ? 'motion-status' : undefined} onChange={() => onCommitMotion(motion.id)} />
          {motion.label}{motion.words && !disabled ? ' *' : ''}
        </label>
      })}
      <p id="motion-status" className="style-hint">{motionDescription}</p>
    </fieldset>

    <fieldset className="style-presets">
      <legend>Saved presets</legend>
      <div className="style-preset-save">
        <label htmlFor="style-preset-name">Preset name
          <input id="style-preset-name" value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="e.g. Reels bold pop" />
        </label>
        <button type="button" disabled={!presetName.trim()} onClick={() => { onSavePreset(presetName); setPresetName('') }}>Save current style</button>
      </div>
      {!presets.length && <p className="style-hint">No saved presets yet.</p>}
      {!!presets.length && <ul className="style-preset-list" aria-label="Saved caption presets">
        {presets.filter((preset) => library !== 'saved' || preset.name.toLowerCase().includes(query.toLowerCase())).map((preset) => <li key={preset.id}>
          <span>{preset.name}</span>
          <span className="style-preset-actions">
            <button type="button" onClick={() => onApplyPreset(preset.id)}>Apply</button>
            <button type="button" className="danger" onClick={() => onDeletePreset(preset.id)}>Delete</button>
          </span>
        </li>)}
      </ul>}
    </fieldset>
  </section>
}

const DEMO_SIZE = { width: 1080, height: 540 }
/** A requestAnimationFrame timestamp can be fractionally earlier than a performance.now() sampled
 * while the current frame is still running. Keep that first preview frame at the cue start instead
 * of turning the negative delta into an invalid source timestamp. */
export function templatePreviewTimestampUs(frameNowMs: number, startMs: number): number {
  return Math.floor((Math.max(0, frameNowMs - startMs) % 3000) * 1000)
}

/** Chooses only gallery sample content; a template preview never alters project caption text. */
export function templateDemoFor(template: CaptionTemplate): MotionCue {
  return template.demo ?? TEMPLATE_DEMO
}

function TemplateCard({ template, selected, previewMotion, onApply }: { template: CaptionTemplate; selected: boolean; previewMotion: CaptionMotion; onApply: () => void }) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false)
  const [timestampUs, setTimestampUs] = useState(1_100_000)
  const demo = templateDemoFor(template)
  const inputs = useMemo(() => captionStyleInputs({ ...template.style, motion: previewMotion, appearance: { ...template.style.appearance, vertical: .5 } }, DEMO_SIZE), [template, previewMotion])
  useEffect(() => {
    if (!(hovered || focused) || matchMedia('(prefers-reduced-motion: reduce)').matches) { setTimestampUs(1_100_000); return }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => { setTimestampUs(templatePreviewTimestampUs(now, start)); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [hovered, focused, previewMotion])
  return <button type="button" className="template-card" aria-pressed={selected} aria-label={`Apply ${template.name} ${previewMotion === 'static-clean' ? 'style' : 'template'}`} title={template.description}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onClick={onApply}>
    <span className="template-card-heading">{template.name}<span>{selected ? 'Applied' : 'Preview'}</span></span>
    <span className="template-card-preview"><CaptionPreview cue={demo} composition={DEMO_SIZE} timestampUs={timestampUs}
      inputs={inputs} motion={previewMotion} diagnostics={false} /></span>
    <span className="template-tags">{template.tags.map((tag) => <span key={tag}>{tag}</span>)}</span>
  </button>
}
