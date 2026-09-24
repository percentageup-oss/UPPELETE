import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import {
  flatGridMetrics, flatScrollPx, perspectiveConvergingAlpha, perspectiveGeometry, perspectiveRowAlpha, type GridFill,
} from '../core/gridFill'

const hexBytes = (color: string): [number, number, number] => [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16)) as [number, number, number]

/** The CSS of a flat grid over `background`: integer-pixel tiles (`flatGridMetrics`) shifted by the
 * scroll, which is what FFmpeg's `geq` + `crop` reproduce. Lines take the first `thickness` pixels of
 * each tile, a dot is a disc with a one-pixel soft rim at the tile's center. */
export function flatGridStyle(grid: GridFill, scale: number, scroll: { x: number; y: number } | null): CSSProperties {
  const metrics = flatGridMetrics(grid, scale)
  const offset = flatScrollPx(scroll, metrics.cell)
  const [red, green, blue] = hexBytes(grid.line)
  const image = grid.pattern === 'dots'
    ? `radial-gradient(circle at 50% 50%, ${grid.line} ${Math.max(0, metrics.dotRadius - 0.5)}px, rgba(${red}, ${green}, ${blue}, 0) ${metrics.dotRadius + 0.5}px)`
    : `linear-gradient(to right, ${grid.line} ${metrics.thickness}px, transparent ${metrics.thickness}px), linear-gradient(to bottom, ${grid.line} ${metrics.thickness}px, transparent ${metrics.thickness}px)`
  return { backgroundColor: grid.background, backgroundImage: image, backgroundSize: `${metrics.cell}px ${metrics.cell}px`, backgroundPosition: `${offset.x}px ${offset.y}px` }
}

/**
 * The perspective floor, painted on two canvases stacked over the background color: the converging
 * lines (redrawn only when the grid or the size changes) and a one-pixel-wide column of horizontal
 * lines (redrawn every frame the phase moves, then stretched across the frame). Both evaluate the
 * shared math in `core/gridFill.ts`, the same formulas FFmpeg's `geq` runs in export.
 */
function PerspectiveFloor({ grid, width, height, scale, phase }: { grid: GridFill; width: number; height: number; scale: number; phase: number }) {
  const convergingRef = useRef<HTMLCanvasElement>(null)
  const rowsRef = useRef<HTMLCanvasElement>(null)
  const pixelsWide = Math.max(1, Math.round(width))
  const pixelsHigh = Math.max(1, Math.round(height))
  const geometry = useMemo(() => perspectiveGeometry(grid, pixelsWide, pixelsHigh, scale), [grid, pixelsWide, pixelsHigh, scale])

  useLayoutEffect(() => {
    const context = convergingRef.current?.getContext('2d')
    if (!context) return
    const [red, green, blue] = hexBytes(grid.line)
    const image = context.createImageData(pixelsWide, pixelsHigh)
    for (let y = Math.max(0, Math.floor(geometry.horizonY)); y < pixelsHigh; y++) {
      for (let x = 0; x < pixelsWide; x++) {
        const alpha = perspectiveConvergingAlpha(geometry, x, y)
        if (alpha <= 0) continue
        const at = (y * pixelsWide + x) * 4
        image.data[at] = red; image.data[at + 1] = green; image.data[at + 2] = blue; image.data[at + 3] = Math.round(alpha * 255)
      }
    }
    context.putImageData(image, 0, 0)
  }, [geometry, grid.line, pixelsWide, pixelsHigh])

  useLayoutEffect(() => {
    const context = rowsRef.current?.getContext('2d')
    if (!context) return
    const [red, green, blue] = hexBytes(grid.line)
    const image = context.createImageData(1, pixelsHigh)
    for (let y = Math.max(0, Math.floor(geometry.horizonY)); y < pixelsHigh; y++) {
      const alpha = perspectiveRowAlpha(geometry, y, phase)
      image.data[y * 4] = red; image.data[y * 4 + 1] = green; image.data[y * 4 + 2] = blue; image.data[y * 4 + 3] = Math.round(alpha * 255)
    }
    context.putImageData(image, 0, 0)
  }, [geometry, grid.line, pixelsHigh, phase])

  const fill: CSSProperties = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', imageRendering: 'pixelated' }
  return <>
    <canvas ref={convergingRef} width={pixelsWide} height={pixelsHigh} style={fill} />
    <canvas ref={rowsRef} width={1} height={pixelsHigh} style={fill} />
  </>
}

/** A grid filling its (positioned) parent. `width`/`height` are the parent's size in pixels and `scale`
 * is composition units → pixels; `scroll` is the cells traveled (see `paintAt`). */
export function GridPicture({ grid, width, height, scale, scroll }: { grid: GridFill; width: number; height: number; scale: number; scroll: { x: number; y: number } | null }) {
  if (grid.pattern === 'perspective') {
    return <div data-grid-pattern="perspective" style={{ position: 'absolute', inset: 0, backgroundColor: grid.background, overflow: 'hidden' }}>
      <PerspectiveFloor grid={grid} width={width} height={height} scale={scale} phase={scroll?.y ?? 0} />
    </div>
  }
  return <div data-grid-pattern={grid.pattern} style={{ position: 'absolute', inset: 0, ...flatGridStyle(grid, scale, scroll) }} />
}
