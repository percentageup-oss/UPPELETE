import type { Fill } from './edit'

/**
 * Grid backgrounds: the geometry both the preview and the FFmpeg export derive their pixels from
 * (`fill.ts` decides *when*, this decides *where*). Everything is in output pixels of the picture's
 * own box; `scale` is composition units → pixels (`compositionScale`), so a grid keeps its look at
 * any export size.
 *
 * Flat grids (`lines`, `dots`) are integer-pixel by construction — the cell and line thickness are
 * rounded once here and scrolling moves by whole pixels — so the preview's CSS and FFmpeg's `geq`
 * paint the same pixels. The `perspective` floor is analytic per pixel, split into two layers that
 * are cheap to animate: the converging lines depend only on (x, y) and never change; the horizontal
 * lines depend only on y and time, so they are one row of values stretched across the frame.
 */
export type GridFill = Extract<Fill, { type: 'grid' }>

export const DEFAULT_GRID_HORIZON = 0.4
/** Focal length of the perspective floor, as a fraction of the picture's width. */
export const PERSPECTIVE_FOCAL = 0.8
/** The floor fades into the background over this fraction of the distance from the horizon down to
 * the bottom edge, so lines that would be thinner than a pixel never shimmer. */
export const PERSPECTIVE_HORIZON_FADE = 0.35
/** Screen spacing (px) between neighbouring lines below which they are faded out, and above which
 * they are fully drawn. */
export const ALIAS_FADE_FROM_PX = 1.5
export const ALIAS_FADE_TO_PX = 4.5

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const positiveMod = (value: number, modulus: number) => ((value % modulus) + modulus) % modulus

export const gridHorizon = (grid: GridFill): number => grid.horizon ?? DEFAULT_GRID_HORIZON

/** Cell and line thickness of a flat grid in whole pixels; a dot's radius is left continuous. */
export function flatGridMetrics(grid: GridFill, scale: number): { cell: number; thickness: number; dotRadius: number } {
  const cell = Math.max(4, Math.round(grid.cell * scale))
  return { cell, thickness: clamp(Math.round(grid.thickness * scale), 1, cell - 1), dotRadius: Math.max(0.5, grid.thickness * scale / 2) }
}

/** How far a flat grid has scrolled, in whole pixels within one cell: `phase` counts cells (signed). */
export function flatScrollPx(phase: { x: number; y: number } | null, cell: number): { x: number; y: number } {
  if (!phase) return { x: 0, y: 0 }
  return { x: Math.floor(positiveMod(phase.x * cell, cell)), y: Math.floor(positiveMod(phase.y * cell, cell)) }
}

/** Coverage (0–1) of a flat grid's line color at the tile coordinate `(u, v)`, both in [0, cell): lines
 * occupy the first `thickness` pixels of each tile; a dot is a soft-edged disc at the tile's center. */
export function flatGridCoverage(pattern: 'lines' | 'dots', metrics: ReturnType<typeof flatGridMetrics>, u: number, v: number): number {
  if (pattern === 'lines') return u < metrics.thickness || v < metrics.thickness ? 1 : 0
  return clamp(metrics.dotRadius - Math.hypot(u + 0.5 - metrics.cell / 2, v + 0.5 - metrics.cell / 2) + 0.5, 0, 1)
}

export type PerspectiveGeometry = {
  width: number
  height: number
  /** Screen y of the vanishing horizon, and the pixel distance from it down to the bottom edge. */
  horizonY: number
  bottomSpan: number
  centerX: number
  focal: number
  /** World cell and line thickness: 1 world unit of depth is the bottom edge, so at the bottom center
   * a cell is `grid.cell · scale` pixels wide. */
  cell: number
  thickness: number
}

export function perspectiveGeometry(grid: GridFill, width: number, height: number, scale: number): PerspectiveGeometry {
  const horizonY = gridHorizon(grid) * height
  const focal = PERSPECTIVE_FOCAL * width
  return { width, height, horizonY, bottomSpan: height - horizonY, centerX: width / 2, focal, cell: grid.cell * scale / focal, thickness: grid.thickness * scale / focal }
}

const aliasFade = (spacingPx: number) => clamp((spacingPx - ALIAS_FADE_FROM_PX) / (ALIAS_FADE_TO_PX - ALIAS_FADE_FROM_PX), 0, 1)

/** Below the horizon, `d` is the pixel distance from it (pixel center), so depth is `bottomSpan / d`. */
const depthOf = (geometry: PerspectiveGeometry, y: number) => y + 0.5 - geometry.horizonY

const horizonFade = (geometry: PerspectiveGeometry, d: number) => clamp(d / (PERSPECTIVE_HORIZON_FADE * geometry.bottomSpan), 0, 1)

/**
 * Alpha of the receding lines at pixel (x, y): straight lines through the vanishing point, evenly
 * spaced across the floor. They do not move, so this is drawn once.
 */
export function perspectiveConvergingAlpha(geometry: PerspectiveGeometry, x: number, y: number): number {
  const d = depthOf(geometry, y)
  if (d <= 0) return 0
  const depth = geometry.bottomSpan / d
  const across = (x + 0.5 - geometry.centerX) * depth / geometry.focal
  const distance = Math.abs(positiveMod(across + geometry.cell / 2, geometry.cell) - geometry.cell / 2)
  const perUnit = geometry.focal / depth
  const coverage = clamp((geometry.thickness / 2 - distance) * perUnit + 0.5, 0, 1)
  return coverage * aliasFade(geometry.cell * perUnit) * horizonFade(geometry, d)
}

/**
 * Alpha of the horizontal lines on row y. `phase` counts cells the floor has moved toward the viewer
 * (signed), so lines stream down the screen and bunch up toward the horizon like real depth.
 */
export function perspectiveRowAlpha(geometry: PerspectiveGeometry, y: number, phase: number): number {
  const d = depthOf(geometry, y)
  if (d <= 0) return 0
  const depth = geometry.bottomSpan / d
  const distance = Math.abs(positiveMod(depth + geometry.cell * phase + geometry.cell / 2, geometry.cell) - geometry.cell / 2)
  const perUnit = d * d / geometry.bottomSpan
  const coverage = clamp((geometry.thickness / 2 - distance) * perUnit + 0.5, 0, 1)
  return coverage * aliasFade(geometry.cell * perUnit) * horizonFade(geometry, d)
}

/** A static CSS approximation for tiles and swatches (no animation, no perspective foreshortening). */
export function gridSwatchCss(grid: GridFill): string {
  const line = grid.line
  if (grid.pattern === 'dots') return `radial-gradient(circle, ${line} 0 22%, transparent 26%) 0 0 / 10px 10px, ${grid.background}`
  return `linear-gradient(90deg, ${line} 0 1.5px, transparent 1.5px) 0 0 / 10px 10px, linear-gradient(0deg, ${line} 0 1.5px, transparent 1.5px) 0 0 / 10px 10px, ${grid.background}`
}
