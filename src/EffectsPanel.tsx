import type { DragEvent } from 'react'
import { clearDragPayload, PRESET_DRAG_TYPE, setDragPayload, type PresetDragPayload } from './core/dragPayload'
import { BlurAreaIcon, BlurFrameIcon, FadeIcon, FlashIcon, KenBurnsIcon, LetterboxIcon, PanIcon, VignetteIcon, ZoomInIcon, ZoomOutIcon } from './TimelineIcons'

type PresetTile = { preset: PresetDragPayload['preset']; label: string; detail: string; icon: typeof ZoomInIcon }
type Section = { heading: string; tileClass: string; tiles: PresetTile[] }

const SECTIONS: Section[] = [
  { heading: 'Zoom', tileClass: 'zoom-tile', tiles: [
    { preset: 'zoom-in', label: 'Zoom in', detail: 'Punch in, hold, then release', icon: ZoomInIcon },
    { preset: 'zoom-out', label: 'Zoom out', detail: 'Start tight, then pull out', icon: ZoomOutIcon },
    { preset: 'pan', label: 'Pan', detail: 'Slide across the frame, left to right', icon: PanIcon },
    { preset: 'ken-burns', label: 'Ken Burns', detail: 'Slow push in from the full frame', icon: KenBurnsIcon },
  ] },
  { heading: 'Blur', tileClass: 'blur-tile', tiles: [
    { preset: 'blur-area', label: 'Blur area', detail: 'A masked rectangle you move and resize', icon: BlurAreaIcon },
    { preset: 'blur-frame', label: 'Blur frame', detail: 'Blurs the whole picture', icon: BlurFrameIcon },
  ] },
  { heading: 'Look', tileClass: 'look-tile', tiles: [
    { preset: 'vignette', label: 'Vignette', detail: 'Darkens the edges of the frame', icon: VignetteIcon },
    { preset: 'letterbox-239', label: 'Letterbox 2.39', detail: 'Cinematic bars that slide in', icon: LetterboxIcon },
    { preset: 'letterbox-185', label: 'Letterbox 1.85', detail: 'Cinematic bars that slide in', icon: LetterboxIcon },
  ] },
  { heading: 'Transitions', tileClass: 'transition-tile', tiles: [
    { preset: 'fade-in', label: 'Fade in', detail: 'From a solid color into the picture', icon: FadeIcon },
    { preset: 'fade-out', label: 'Fade out', detail: 'From the picture to a solid color', icon: FadeIcon },
    { preset: 'fade-dip', label: 'Dip to black', detail: 'Briefly covers, then releases', icon: FadeIcon },
    { preset: 'flash', label: 'Flash', detail: 'A brief white dip', icon: FlashIcon },
  ] },
]

/** The left-rail Effects tab: a library of effect types to add to the program, grouped into
 * sections. Zoom and Blur paint the picture; Look and Transitions are frame-paint effects, painted
 * by the shared caption/overlay host layer rather than an FFmpeg filter (docs/EDITING.md
 * "Frame-paint effects"). */
export function EffectsPanel({ onAddAtPlayhead }: { onAddAtPlayhead: (preset: PresetDragPayload['preset']) => void }) {
  return <div className="overlays-panel zoom-panel">
    <div className="effects-sections">
      {SECTIONS.map(({ heading, tileClass, tiles }) => <section key={heading} aria-labelledby={`effects-section-${heading}`}>
        <h3 id={`effects-section-${heading}`} className="effects-section-heading">{heading}</h3>
        <div className="overlays-grid">
          {tiles.map(({ preset, label, detail, icon: Icon }) => {
            const payload: PresetDragPayload = { source: 'preset', preset }
            const beginDrag = (event: DragEvent) => {
              setDragPayload(payload)
              event.dataTransfer.effectAllowed = 'copy'
              event.dataTransfer.setData(PRESET_DRAG_TYPE, JSON.stringify(payload))
            }
            return <button key={preset} type="button" className={`overlay-tile ${tileClass}`} draggable
              onDragStart={beginDrag} onDragEnd={() => clearDragPayload()} onClick={() => onAddAtPlayhead(preset)}
              title={`Add ${label.toLowerCase()} at the playhead`}>
              <Icon /><span>{label}</span><small>{detail}</small>
            </button>
          })}
        </div>
      </section>)}
    </div>
    <div className="bin-footer"><p>Drag a preset to the timeline, or click to add it at the playhead. Select an effect on the timeline to adjust it.</p></div>
  </div>
}
