import type { Fill } from './edit'
import type { BackgroundDragPayload } from './dragPayload'

export type BackgroundPreset = { id: string; label: string; look: Omit<BackgroundDragPayload, 'source'> }

const solid = (color: string): Fill => ({ type: 'solid', color })
export const gradient = (from: string, to: string, angle = 135): Fill => ({ type: 'gradient', from, to, angle })
const PERIOD_US = 6_000_000
const grid = (pattern: 'lines' | 'dots' | 'perspective', background: string, line: string, cell = 80, thickness = pattern === 'dots' ? 10 : 2): Fill => ({ type: 'grid', pattern, background, line, cell, thickness })

/** Neutral starting looks; the Custom block below covers everything else. */
export const BACKGROUND_PRESETS: BackgroundPreset[] = [
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

