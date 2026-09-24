import { describe, expect, it } from 'vitest'
import type { Fill } from './edit'
import {
  flatGridCoverage, flatGridMetrics, flatScrollPx, gridHorizon, perspectiveConvergingAlpha, perspectiveGeometry, perspectiveRowAlpha, DEFAULT_GRID_HORIZON,
} from './gridFill'

type Grid = Extract<Fill, { type: 'grid' }>
const grid = (extra: Partial<Grid> = {}): Grid => ({ type: 'grid', pattern: 'lines', background: '#000000', line: '#ffffff', cell: 80, thickness: 2, ...extra })

describe('flat grid geometry', () => {
  it('rounds the cell and line to whole pixels so preview and export share pixels', () => {
    expect(flatGridMetrics(grid(), 1)).toMatchObject({ cell: 80, thickness: 2 })
    expect(flatGridMetrics(grid(), 0.6)).toMatchObject({ cell: 48, thickness: 1 })
    expect(flatGridMetrics(grid({ cell: 8, thickness: 7 }), 0.1).cell).toBe(4)
    // A line can never fill its cell.
    const thick = flatGridMetrics(grid({ cell: 10, thickness: 9 }), 1)
    expect(thick.thickness).toBeLessThan(thick.cell)
  })

  it('draws lines at the start of each tile and a soft disc at its center', () => {
    const metrics = flatGridMetrics(grid({ thickness: 3 }), 1)
    expect(flatGridCoverage('lines', metrics, 0, 40)).toBe(1)
    expect(flatGridCoverage('lines', metrics, 2, 40)).toBe(1)
    expect(flatGridCoverage('lines', metrics, 3, 40)).toBe(0)
    expect(flatGridCoverage('lines', metrics, 40, 1)).toBe(1)
    const dots = flatGridMetrics(grid({ pattern: 'dots', thickness: 10 }), 1)
    expect(flatGridCoverage('dots', dots, 39, 39)).toBe(1)
    expect(flatGridCoverage('dots', dots, 0, 0)).toBe(0)
    const rim = flatGridCoverage('dots', dots, 39 + 5, 39)
    expect(rim).toBeGreaterThan(0)
    expect(rim).toBeLessThan(1)
  })

  it('scrolls by whole pixels, wrapping inside one cell in either direction', () => {
    expect(flatScrollPx(null, 80)).toEqual({ x: 0, y: 0 })
    expect(flatScrollPx({ x: 0.5, y: 0 }, 80)).toEqual({ x: 40, y: 0 })
    expect(flatScrollPx({ x: 2.5, y: 1 }, 80)).toEqual({ x: 40, y: 0 })
    expect(flatScrollPx({ x: -0.25, y: 0 }, 80)).toEqual({ x: 60, y: 0 })
    expect(flatScrollPx({ x: 0.999, y: 0 }, 80).x).toBe(79)
  })
})

describe('perspective floor', () => {
  const geometry = perspectiveGeometry(grid({ pattern: 'perspective', cell: 90, thickness: 3 }), 540, 960, 0.5)

  it('puts the horizon where asked and defaults it', () => {
    expect(geometry.horizonY).toBeCloseTo(0.4 * 960)
    expect(gridHorizon(grid())).toBe(DEFAULT_GRID_HORIZON)
    expect(perspectiveGeometry(grid({ horizon: 0.25 }), 100, 200, 1).horizonY).toBe(50)
  })

  it('paints nothing at or above the horizon', () => {
    for (const y of [0, 100, Math.floor(geometry.horizonY) - 1]) {
      expect(perspectiveRowAlpha(geometry, y, 0)).toBe(0)
      expect(perspectiveConvergingAlpha(geometry, 270, y)).toBe(0)
    }
  })

  it('keeps the receding lines still and lines up with the vanishing point', () => {
    // The center line runs straight down the middle of the floor.
    const bottom = 959
    expect(perspectiveConvergingAlpha(geometry, 270, bottom)).toBeGreaterThan(0.5)
    expect(perspectiveConvergingAlpha(geometry, 270, 700)).toBeGreaterThan(0.2)
    // A pixel between two receding lines at the bottom edge is empty.
    const spacing = 90 * 0.5
    expect(perspectiveConvergingAlpha(geometry, 270 + spacing / 2, bottom)).toBe(0)
  })

  it('streams horizontal lines down the screen as the phase grows and repeats every cell', () => {
    const rows = (phase: number) => Array.from({ length: 300 }, (_, i) => 660 + i).filter((y) => perspectiveRowAlpha(geometry, y, phase) > 0.5)
    const first = rows(0), later = rows(0.25)
    expect(first.length).toBeGreaterThan(0)
    expect(later).not.toEqual(first)
    expect(rows(1)).toEqual(first)
    expect(rows(3)).toEqual(first)
    // Moving toward the viewer (phase up) moves a near line down the screen.
    const nearest = (list: number[]) => list.find((y) => y > 900) ?? -1
    expect(nearest(rows(0.1))).toBeGreaterThanOrEqual(nearest(first) === -1 ? 0 : nearest(first))
  })

  it('bunches lines toward the horizon and fades them out before they alias', () => {
    const rowYs = Array.from({ length: 560 }, (_, i) => 400 + i).filter((y) => perspectiveRowAlpha(geometry, y, 0) > 0.4)
    const gaps = rowYs.slice(1).map((y, i) => y - rowYs[i]).filter((gap) => gap > 1)
    expect(gaps[0]).toBeLessThan(gaps[gaps.length - 1])
    // Just under the horizon everything is faded to the background.
    for (let y = Math.ceil(geometry.horizonY); y < geometry.horizonY + 12; y++) expect(perspectiveRowAlpha(geometry, y, 0.3)).toBeLessThan(0.3)
  })
})
