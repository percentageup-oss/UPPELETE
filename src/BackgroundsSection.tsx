import { useState, type DragEvent } from 'react'
import { FillEditor, MotionEditor } from './BackgroundControls'
import { BACKGROUND_DRAG_TYPE, clearDragPayload, setDragPayload, type BackgroundDragPayload } from './core/dragPayload'
import type { BackgroundMotion, Fill } from './core/edit'
import { swatchCss } from './core/fill'
import { BACKGROUND_PRESETS, gradient, type BackgroundPreset as Preset } from './core/backgroundPresets'

function Tile({ id, label, look, onAdd }: { id: string; label: string; look: Preset['look']; onAdd: (look: Preset['look']) => void }) {
  const payload: BackgroundDragPayload = { source: 'background', ...look }
  const beginDrag = (event: DragEvent) => {
    setDragPayload(payload)
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(BACKGROUND_DRAG_TYPE, JSON.stringify(payload))
  }
  return <button type="button" className="overlay-tile background-tile" draggable data-background-id={id}
    onDragStart={beginDrag} onDragEnd={() => clearDragPayload()} onClick={() => onAdd(look)}
    title={`Add ${label.toLowerCase()} background at the playhead`}>
    <span className={`background-swatch ${look.motion ? 'animated' : ''}`} style={{ background: swatchCss({ fill: look.fill, motion: look.motion }) }} aria-hidden="true" />
    <span>{label}</span>
  </button>
}

/** The Effects tab's Backgrounds section body: pick a preset or build a custom fill, then drag it to the
 * timeline (or click to add at the playhead). It becomes a video-track clip that runs under the picture. */
export function BackgroundsSection({ onAdd }: { onAdd: (look: { fill: Fill; motion?: BackgroundMotion }) => void }) {
  const [custom, setCustom] = useState<{ fill: Fill; motion: BackgroundMotion | null }>({ fill: gradient('#667eea', '#764ba2'), motion: null })
  const customLook = { fill: custom.fill, ...(custom.motion ? { motion: custom.motion } : {}) }
  return <>
    <div className="overlays-grid">
      {BACKGROUND_PRESETS.map((preset) => <Tile key={preset.id} id={preset.id} label={preset.label} look={preset.look} onAdd={onAdd} />)}
    </div>
    <div className="background-custom">
      <h4 className="background-custom-heading">Custom background</h4>
      <div className="editor-form">
        <FillEditor idPrefix="bg-custom" fill={custom.fill} onDraft={(fill) => setCustom((state) => ({ ...state, fill }))} onCommit={(fill) => setCustom((state) => ({ ...state, fill }))} />
        <MotionEditor idPrefix="bg-custom" fill={custom.fill} motion={custom.motion}
          onDraft={(motion) => setCustom((state) => ({ ...state, motion }))} onCommit={(motion) => setCustom((state) => ({ ...state, motion }))} />
        <button type="button" className="background-custom-add" draggable
          onDragStart={(event) => {
            const payload: BackgroundDragPayload = { source: 'background', ...customLook }
            setDragPayload(payload)
            event.dataTransfer.effectAllowed = 'copy'
            event.dataTransfer.setData(BACKGROUND_DRAG_TYPE, JSON.stringify(payload))
          }}
          onDragEnd={() => clearDragPayload()} onClick={() => onAdd(customLook)}
          title="Add custom background at the playhead">
          <span className={`background-swatch ${customLook.motion ? 'animated' : ''}`} style={{ background: swatchCss({ fill: customLook.fill, motion: customLook.motion }) }} aria-hidden="true" />
          Add custom background
        </button>
      </div>
    </div>
  </>
}
