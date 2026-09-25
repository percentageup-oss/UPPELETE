import { useMemo, type ReactNode } from 'react'
import { COMPOSITION_WIDTH, type Shape, type TextOverlay } from './core/edit'
import type { TemplateBuilder, TemplateText } from './core/overlayTemplates'
import { arrowheadPath, arrowheadSize, lineEnds, shapeBox, shapePathD, shapeRotation } from './core/shapePath'
import { captionStyleInputs } from './captions/style'

const COMPOSITION = { width: COMPOSITION_WIDTH, height: 608 }
const TILE_ASPECT = 3 / 2
const MAX_TEXT_WIDTH = 880
const SPAN_US = 4_000_000

/** Text size without a DOM: the thumbnail only needs to look right, so wide copy wraps at a fixed width. */
function estimateBlock(text: TemplateText): { width: number; height: number } {
  const size = text.style.appearance.fontSize
  const raw = text.text.length * size * 0.56 + size * 0.6
  return { width: Math.round(Math.min(raw, MAX_TEXT_WIDTH)), height: Math.round(size * 1.3 * Math.max(1, Math.ceil(raw / MAX_TEXT_WIDTH))) }
}

type Box = { x: number; y: number; width: number; height: number }

/** Where a built title's text block is centred: the inverse of the 0..1 position `placeTextCentered` stored. */
function overlayCenter(overlay: TextOverlay, block: { width: number; height: number }) {
  const { safeArea } = captionStyleInputs(overlay.style, COMPOSITION)
  const safe = { x: COMPOSITION.width * safeArea.left, y: COMPOSITION.height * safeArea.top,
    width: COMPOSITION.width * (1 - safeArea.left - safeArea.right), height: COMPOSITION.height * (1 - safeArea.top - safeArea.bottom) }
  const { horizontal, vertical } = overlay.style.appearance
  return { x: safe.x + (safe.width - block.width) * horizontal + block.width / 2, y: safe.y + (safe.height - block.height) * vertical + block.height / 2 }
}

const union = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y))
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y }
}

function shapeNode(shape: Shape): ReactNode {
  const { geometry, stroke, fill } = shape
  const { angle, cx, cy } = shapeRotation(geometry)
  const ends = shape.arrowEnd !== 'none' ? lineEnds(geometry) : null
  const head = ends && stroke && shape.arrowEnd !== 'none' ? arrowheadPath(shape.arrowEnd, ends.end, ends.endDir, arrowheadSize(stroke.width)) : null
  return <g key={shape.id} transform={angle ? `rotate(${angle} ${cx} ${cy})` : undefined}>
    <path d={shapePathD(geometry)} fill={fill ? fill.color : 'none'} fillOpacity={fill?.opacity} stroke={stroke?.color ?? 'none'} strokeWidth={stroke?.width}
      strokeLinecap="round" strokeLinejoin="round" strokeDasharray={stroke?.dash === 'dashed' ? '12 8' : stroke?.dash === 'dotted' ? '1 12' : undefined} />
    {head && stroke && <path d={head.d} fill={head.filled ? stroke.color : 'none'} stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />}
  </g>
}

/**
 * A tile picture drawn from the template's own builder, so it can never drift from what inserting produces:
 * the same shapes and titles, at one point in time, as plain SVG. Text sizes are estimated (no DOM needed).
 */
export function TemplateThumbnail({ template }: { template: TemplateBuilder }) {
  const drawn = useMemo(() => {
    try {
      const ids = Object.fromEntries(template.memberKeys.map((key) => [key, `thumb-${template.id}-${key}`]))
      const measured = Object.fromEntries(template.texts.map((text) => [text.key, estimateBlock(text)]))
      const built = template.build({ startUs: 0, endUs: SPAN_US, at: { x: COMPOSITION.width / 2, y: COMPOSITION.height / 2 }, composition: COMPOSITION, ids, measured })
      const titles = built.texts.map((overlay) => {
        const block = measured[template.memberKeys.find((key) => ids[key] === overlay.id) ?? ''] ?? estimateBlock({ key: '', text: overlay.text, style: overlay.style })
        return { overlay, block, center: overlayCenter(overlay, block) }
      })
      const bounds = union([
        ...built.shapes.map((shape) => {
          const box = shapeBox(shape.geometry)
          const grow = shape.geometry.kind === 'bubble' ? shape.geometry.tail.length : 0
          return { x: box.x - grow - (shape.stroke?.width ?? 0), y: box.y - grow - (shape.stroke?.width ?? 0), width: box.width + grow * 2 + (shape.stroke?.width ?? 0) * 2, height: box.height + grow * 2 + (shape.stroke?.width ?? 0) * 2 }
        }),
        ...titles.map(({ block, center }) => ({ x: center.x - block.width / 2, y: center.y - block.height / 2, width: block.width, height: block.height })),
      ])
      const pad = 36
      let width = bounds.width + pad * 2, height = bounds.height + pad * 2
      if (width / height < TILE_ASPECT) width = height * TILE_ASPECT
      else height = width / TILE_ASPECT
      const viewBox = `${bounds.x + bounds.width / 2 - width / 2} ${bounds.y + bounds.height / 2 - height / 2} ${width} ${height}`
      const layers = [
        ...built.shapes.map((shape, index) => ({ order: shape.layerOrder, index, node: shapeNode(shape) })),
        ...titles.map(({ overlay, center }, index) => ({ order: overlay.layerOrder, index: built.shapes.length + index, node:
          <text key={overlay.id} x={center.x} y={center.y} textAnchor="middle" dominantBaseline="central" fontSize={overlay.style.appearance.fontSize}
            fontWeight={overlay.style.appearance.fontWeight} fill={overlay.style.appearance.primaryColor} fontFamily={`"${overlay.style.appearance.fontFamily}", Arial, sans-serif`}
            transform={overlay.style.appearance.rotation ? `rotate(${overlay.style.appearance.rotation} ${center.x} ${center.y})` : undefined}>{overlay.text}</text> })),
      ].sort((a, b) => a.order - b.order || a.index - b.index)
      return { viewBox, layers }
    } catch {
      return null
    }
  }, [template])
  if (!drawn) return <svg viewBox="0 0 96 64" aria-hidden="true" focusable="false" />
  return <svg className="template-thumb" viewBox={drawn.viewBox} aria-hidden="true" focusable="false">
    <rect x="-100000" y="-100000" width="200000" height="200000" fill="#2b303b" />
    {drawn.layers.map((layer) => layer.node)}
  </svg>
}
