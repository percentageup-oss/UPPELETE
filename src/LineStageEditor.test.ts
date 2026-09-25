import { describe, expect, it } from 'vitest'
import { dragLine } from './LineStageEditor'

const line = { kind: 'line' as const, from: { x: 100, y: 100 }, to: { x: 300, y: 100 } }

describe('dragLine', () => {
  it('moves one end and leaves the other', () => {
    expect(dragLine(line, 'to', 20.4, 30.6, false)).toEqual({ ...line, to: { x: 320, y: 131 } })
    expect(dragLine(line, 'from', -10, 0, false).to).toEqual(line.to)
  })

  it('moves the whole line, control point included', () => {
    const curved = { ...line, control: { x: 200, y: 20 } }
    expect(dragLine(curved, 'move', 10, 5, false)).toEqual({ kind: 'line', from: { x: 110, y: 105 }, to: { x: 310, y: 105 }, control: { x: 210, y: 25 } })
  })

  it('adds a control point at mid-line when a straight line is bent', () => {
    expect(dragLine(line, 'control', 0, -40, false).control).toEqual({ x: 200, y: 60 })
  })

  it('snaps an end to 15 degree steps around the other end when asked', () => {
    const snapped = dragLine(line, 'to', 0, 30, true)
    const angle = Math.atan2(snapped.to.y - snapped.from.y, snapped.to.x - snapped.from.x) * 180 / Math.PI
    expect(Math.round(angle) % 15).toBe(0)
    expect(dragLine(line, 'to', 0, 30, false).to).toEqual({ x: 300, y: 130 })
  })
})
