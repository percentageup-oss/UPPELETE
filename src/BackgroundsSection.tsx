import { useState, type DragEvent } from 'react'
import { FillEditor, MotionEditor } from './BackgroundControls'
import { BACKGROUND_DRAG_TYPE, clearDragPayload, setDragPayload, type BackgroundDragPayload } from './core/dragPayload'
import type { BackgroundMotion, Fill } from './core/edit'
import { swatchCss } from './core/fill'

type Preset = { id: string; label: string; look: Omit<BackgroundDragPayload, 'source'> }

const solid = (color: string): Fill => ({ type: 'solid', color })
const gradient = (from: string, to: string, angle = 135): Fill => ({ type: 'gradient', from, to, angle })
const PERIOD_US = 6_000_000
const grid = (pattern: 'lines' | 'dots' | 'perspective', background: string, line: string, cell = 80, thickness = pattern === 'dots' ? 10 : 2): Fill => ({ type: 'grid', pattern, background, line, cell, thickness })

/** Neutral starting looks; the Custom block below covers everything else. */
const PRESETS: Preset[] = [
  { id: 'black', label: 'Black', look: { fill: solid('#000000') } },
  { id: 'white', label: 'White', look: { fill: solid('#ffffff') } },
  { id: 'slate', label: 'Slate', look: { fill: solid('#1f2937') } },
  { id: 'sunset', label: 'Sunset', look: { fill: gradient('#ff7e5f', '#feb47b') } },
  { id: 'ocean', label: 'Ocean', look: { fill: gradient('#2193b0', '#6dd5ed') } },
  { id: 'violet', label: 'Violet', look: { fill: gradient('#667eea', '#764ba2') } },
  { id: 'midnight', label: 'Midnight', look: { fill: gradient('#0f2027', '#2c5364', 180) } },
  { id: 'shift', label: 'Color shift', look: { fill: solid('#667eea'), motion: { type: 'shift', to: solid('#f093fb'), periodUs: PERIOD_US } } },
  { id: 'pulse', label: 'Pulse', look: { fill: solid('#1e3a8a'), motion: { type: 'pulse', toward: 'black', depth: 0.5, periodUs: PERIOD_US } } },
  { id: 'grid', label: 'Grid', look: { fill: grid('lines', '#0b1020', '#4f8cff') } },
  { id: 'grid-scroll', label: 'Moving grid', look: { fill: grid('lines', '#0b1020', '#4f8cff'), motion: { type: 'scroll', direction: 90, periodUs: 2_000_000 } } },
  { id: 'dots', label: 'Dot grid', look: { fill: grid('dots', '#111827', '#9ca3af', 60, 8), motion: { type: 'scroll', direction: 45, periodUs: 3_000_000 } } },
  { id: 'grid-shift', label: 'Color-shift grid', look: { fill: grid('lines', '#0b1020', '#4f8cff'), motion: { type: 'shift', to: grid('lines', '#1a0b20', '#ff4fa3'), periodUs: PERIOD_US } } },
  { id: 'floor', label: 'Retro floor', look: { fill: grid('perspective', '#160a2e', '#ff3ea5', 90, 3), motion: { type: 'scroll', direction: 180, periodUs: 2_000_000 } } },
  { id: 'drift', label: 'Drift', look: { fill: gradient('#0f2027', '#2c5364', 90), motion: { type: 'drift', direction: 90, periodUs: PERIOD_US } } },
]

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
      {PRESETS.map((preset) => <Tile key={preset.id} id={preset.id} label={preset.label} look={preset.look} onAdd={onAdd} />)}
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
