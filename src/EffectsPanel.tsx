import { useState, type DragEvent } from 'react'
import { AccordionSection } from './AccordionSection'
import { clearDragPayload, PRESET_DRAG_TYPE, setDragPayload, type PresetDragPayload } from './core/dragPayload'
import { BackgroundsSection } from './BackgroundsSection'
import type { BackgroundMotion, Fill } from './core/edit'
import { BlurAreaIcon, BlurFrameIcon, FadeIcon, FlashIcon, GlowIcon, GrainIcon, KenBurnsIcon, LetterboxIcon, PanIcon, ParticlesIcon, VhsIcon, VignetteIcon, ZoomInIcon, ZoomOutIcon } from './TimelineIcons'

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
    { preset: 'film-grain', label: 'Film grain', detail: 'Animated 24 fps film noise over the picture', icon: GrainIcon },
    { preset: 'dreamy-glow', label: 'Dreamy glow', detail: 'Soft bloom around the bright areas', icon: GlowIcon },
    { preset: 'light-particles', label: 'Light particles', detail: 'Warm glowing specks drift through the frame', icon: ParticlesIcon },
    { preset: 'vhs', label: 'VHS', detail: 'Scanlines, tracking noise and color bleed', icon: VhsIcon },
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
export function EffectsPanel({ onAddAtPlayhead, onAddBackground }: {
  onAddAtPlayhead: (preset: PresetDragPayload['preset']) => void
  /** Adds a background clip at the playhead (a drag to the timeline is handled by the timeline itself). */
  onAddBackground: (look: { fill: Fill; motion?: BackgroundMotion }) => void
}) {
  const [openId, setOpenId] = useState<string | null>(SECTIONS[0].heading)
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id))
  return <div className="overlays-panel zoom-panel">
    <div className="effects-sections">
      {SECTIONS.map(({ heading, tileClass, tiles }) => <AccordionSection key={heading} id={heading} title={heading} count={tiles.length} open={openId === heading} onToggle={toggle}>
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
      </AccordionSection>)}
      <AccordionSection id="Backgrounds" title="Backgrounds" open={openId === 'Backgrounds'} onToggle={toggle}>
        <BackgroundsSection onAdd={onAddBackground} />
      </AccordionSection>
    </div>
    <div className="bin-footer"><p>Drag a preset to the timeline, or click to add it at the playhead. Select an effect on the timeline to adjust it.</p></div>
  </div>
}
