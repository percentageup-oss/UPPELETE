import { useId, type CSSProperties } from 'react'
import { COMPOSITION_WIDTH, type Shape } from '../core/edit'
import { chromiumDisplacementScale, glassBounds } from '../core/glassMap'
import { glassCoverageMap, glassImages } from './glassMapImage'
import type { Size } from './renderer'
import { shapeFrameAt } from './shapeMotion'
import { arrowheadPath, arrowheadSize, lineEnds, shapeBox, shapePathD, shapeRotation } from '../core/shapePath'
import { maskStyle } from './maskStyle'
import { blendStyle } from './CompositionLayers'

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/** Dash arrays in stroke-width units. Dotted is a zero-length dash under a round cap, which is why
 * it forces a round cap regardless of the shape's own setting. */
function dashArray(dash: 'solid' | 'dashed' | 'dotted', width: number): string | undefined {
  const w = Math.max(1, width)
  if (dash === 'dashed') return `${w * 2.4} ${w * 1.6}`
  if (dash === 'dotted') return `0.01 ${w * 2}`
  return undefined
}

/**
 * One authored shape as SVG in composition units, scaled to the output by `composition.width / 1080`
 * exactly as `CompositionLayers` scales its rects. Preview and the export host both mount this, so a
 * shape's pixels are the same in both; every animated value comes from `shapeFrameAt`, a pure
 * function of the sequence time passed in.
 */
export function ShapeActor({ shape, timestampUs, composition, blend = true, glass = true, onPointerDown, onDoubleClick }: {
  shape: Shape; timestampUs: number; composition: Size
  /** False skips the blend style, for export passes that composite this shape's blend themselves. */
  blend?: boolean
  /** False paints a glass shape's surface only (no backdrop layer), for the export pass that builds the glass itself. */
  glass?: boolean
  onPointerDown?: () => void; onDoubleClick?: () => void
}) {
  const uid = useId().replace(/:/g, '')
  const frame = shapeFrameAt(shape, timestampUs)
  if (!frame.visible) return null
  const scale = composition.width / COMPOSITION_WIDTH
  if (shape.glass) return <GlassShapeActor shape={{ ...shape, glass: shape.glass }} glass={glass} scale={scale} frame={frame} uid={uid} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} />
  const { geometry, stroke, fill } = shape
  const d = shapePathD(geometry)
  const box = shapeBox(geometry)
  const rotation = shapeRotation(geometry)
  const strokeWidth = stroke?.width ?? 0
  const headSize = arrowheadSize(strokeWidth)
  const cap = stroke?.dash === 'dotted' ? 'round' : stroke?.cap ?? 'round'
  const drawing = frame.draw < 1, sweeping = frame.sweep < 1
  // Grow scales the unrotated shape horizontally about its left edge; rotation is applied inside it.
  const growTransform = frame.grow < 1 ? `translate(${box.x} 0) scale(${frame.grow} 1) translate(${-box.x} 0)` : undefined
  const drawMask = `shape-draw-${uid}`, sweepClip = `shape-sweep-${uid}`
  const ends = shape.arrowStart !== 'none' || shape.arrowEnd !== 'none' ? lineEnds(geometry) : null
  const pad = strokeWidth + headSize + 8
  const hit = onPointerDown || onDoubleClick
  const pointerHandlers = hit ? {
    onPointerDown: (event: React.PointerEvent) => { event.stopPropagation(); onPointerDown?.() },
    onDoubleClick: (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); onDoubleClick?.() },
  } : {}
  const head = (kind: Shape['arrowEnd'], tip: { x: number; y: number }, direction: { x: number; y: number }, opacity: number) => {
    if (kind === 'none' || !stroke || opacity <= 0) return null
    const { d: headD, filled } = arrowheadPath(kind, tip, direction, headSize)
    return <path d={headD} fill={filled ? stroke.color : 'none'} stroke={stroke.color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />
  }
  // The SVG is only as big as the shape (plus its stroke and arrowheads), not the whole frame: a
  // full-frame masked/translucent layer sits over the export host's bottom-right marker pixel and can
  // perturb it by a level, which the host's exact marker match then reads as an unpainted frame.
  const local = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
  const wrapper: CSSProperties = {
    position: 'absolute', left: local.x * scale, top: local.y * scale, width: local.width * scale, height: local.height * scale,
    pointerEvents: 'none', opacity: frame.opacity * shape.opacity,
    transform: `translate(${frame.x * scale}px, ${frame.y * scale}px) scale(${frame.scale})`,
    transformOrigin: `${(box.x + box.width / 2 - local.x) * scale}px ${(box.y + box.height / 2 - local.y) * scale}px`,
  }
  const svg =
    <svg width={local.width * scale} height={local.height * scale} viewBox={`${local.x} ${local.y} ${local.width} ${local.height}`}
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      <defs>
        {drawing && <mask id={drawMask} maskUnits="userSpaceOnUse" x={box.x - pad} y={box.y - pad} width={box.width + pad * 2} height={box.height + pad * 2}>
          {/* The mask region is the shape's own padded box: a huge region makes Chromium allocate a surface to match. */}
          {/* pathLength normalises the trace so the dash offset is a plain 0..1 fraction. */}
          <path d={d} pathLength={1} fill="none" stroke="#fff" strokeWidth={strokeWidth + 6} strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="1 1" strokeDashoffset={1 - frame.draw} />
        </mask>}
        {sweeping && <clipPath id={sweepClip} clipPathUnits="userSpaceOnUse">
          <rect x={box.x - pad} y={box.y - pad} width={(box.width + pad * 2) * frame.sweep} height={box.height + pad * 2} />
        </clipPath>}
      </defs>
      <g transform={growTransform}>
      <g transform={rotation.angle ? `rotate(${rotation.angle} ${rotation.cx} ${rotation.cy})` : undefined} clipPath={sweeping ? `url(#${sweepClip})` : undefined}>
        {fill && geometry.kind !== 'line' && <path d={d} fill={fill.color} fillOpacity={fill.opacity * frame.draw} stroke="none" />}
        {stroke && stroke.width > 0 && <g mask={drawing ? `url(#${drawMask})` : undefined}>
          <path d={d} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap={cap} strokeLinejoin="round" strokeDasharray={dashArray(stroke.dash, stroke.width)} />
        </g>}
        {ends && head(shape.arrowStart, ends.start, ends.startDir, frame.draw > 0 ? 1 : 0)}
        {ends && head(shape.arrowEnd, ends.end, ends.endDir, clamp01((frame.draw - .9) / .1))}
        {hit && <path d={d} data-shape-hit={shape.id} fill={fill && geometry.kind !== 'line' ? 'transparent' : 'none'} stroke="transparent"
          strokeWidth={Math.max(strokeWidth, 28)} strokeLinecap="round" strokeLinejoin="round"
          style={{ pointerEvents: fill && geometry.kind !== 'line' ? 'all' : 'stroke', cursor: 'pointer' }} {...pointerHandlers} />}
      </g>
      </g>
    </svg>
  const masked = maskStyle(shape.mask, composition, null)
  const blendCss = blendStyle(blend ? shape.blendMode : undefined)
  const content = <div data-shape-id={shape.id} style={Object.keys(masked).length ? wrapper : { ...wrapper, ...blendCss }}>{svg}</div>
  return Object.keys(masked).length
    ? <div data-shape-mask={shape.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...masked, ...blendCss }}>{content}</div>
    : content
}

/**
 * A glass shape (docs/EDITING.md "Shapes"): two sibling layers, never nested, because an ancestor with
 * opacity, mask, filter, blend or clip-path stops `backdrop-filter` seeing the picture (STATUS, liquid glass 02).
 * (1) the glass layer blurs, saturates and refracts what is behind it, masked to the silhouette, with the shape's
 * opacity and motion on the layer itself; (2) the surface: shadow outside the silhouette, tint, inner glow, rim
 * light and specular inside it. `glass={false}` paints the surface only, for the export pass that builds the
 * glass itself.
 */
function GlassShapeActor({ shape, glass: paintGlass, scale, frame, uid, onPointerDown, onDoubleClick }: {
  shape: Shape & { glass: NonNullable<Shape['glass']> }; glass: boolean; scale: number
  frame: ReturnType<typeof shapeFrameAt>; uid: string
  onPointerDown?: () => void; onDoubleClick?: () => void
}) {
  const { geometry, stroke, fill, glass } = shape
  const d = shapePathD(geometry)
  const bounds = glassBounds(geometry)
  const { angle, cx, cy } = shapeRotation(geometry)
  const rotate = angle ? `rotate(${angle} ${cx} ${cy})` : undefined
  const images = paintGlass ? glassImages(geometry, glass, scale) : null
  const opacity = frame.opacity * shape.opacity
  const motion = `translate(${frame.x * scale}px, ${frame.y * scale}px) scale(${frame.scale})`
  const strokeWidth = stroke?.width ?? 0
  const pad = glass.shadow.blur * 2 + Math.abs(glass.shadow.offsetY) + strokeWidth + 8
  const local = { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 }
  const filterId = `glass-refract-${uid}`, insideId = `glass-inside-${uid}`, outsideId = `glass-outside-${uid}`
  const shadowBlurId = `glass-shadow-blur-${uid}`, glowBlurId = `glass-glow-blur-${uid}`, softId = `glass-soft-${uid}`, rimId = `glass-rim-${uid}`
  const hit = onPointerDown || onDoubleClick
  const pointerHandlers = hit ? {
    onPointerDown: (event: React.PointerEvent) => { event.stopPropagation(); onPointerDown?.() },
    onDoubleClick: (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); onDoubleClick?.() },
  } : {}
  const backdrop = `blur(${glass.blur * scale}px) saturate(${glass.saturation})${images && glass.refraction > 0 ? ` url(#${filterId})` : ''}`
  const box = (rect: { x: number; y: number; width: number; height: number }): CSSProperties => ({
    position: 'absolute', left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale, pointerEvents: 'none',
    transform: motion, transformOrigin: `${rect.width * scale / 2}px ${rect.height * scale / 2}px`,
  })
  const region = { x: local.x, y: local.y, width: local.width, height: local.height }
  const tint = fill?.color ?? '#ffffff'
  const tintOpacity = glass.tintOpacity * (fill?.opacity ?? 1)
  const shadowOn = glass.shadow.opacity > 0
  return (
    <>
      {images && <svg width={0} height={0} style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
        <defs>
          <filter id={filterId} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
            <feImage href={images.mapUrl} x={0} y={0} width={bounds.width * scale} height={bounds.height * scale} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={chromiumDisplacementScale(glass.refraction * scale)} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>}
      {paintGlass && <div data-shape-glass={shape.id} style={{
        ...box(bounds), opacity,
        backdropFilter: backdrop, WebkitBackdropFilter: backdrop,
        ...(images ? { maskImage: `url(${images.maskUrl})`, WebkitMaskImage: `url(${images.maskUrl})`, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' } : {}),
        // Without a raster (very large shape) fall back to the box, which is exact for a plain box.
        ...(!images && geometry.kind === 'rect' && !geometry.rotation ? { borderRadius: geometry.cornerRadius * scale } : {}),
      }} />}
      <div data-shape-id={shape.id} style={{ ...box(local), opacity }}>
        <svg width={local.width * scale} height={local.height * scale} viewBox={`${local.x} ${local.y} ${local.width} ${local.height}`}
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
          <defs>
            <clipPath id={insideId} clipPathUnits="userSpaceOnUse"><path d={d} transform={rotate} /></clipPath>
            <mask id={outsideId} maskUnits="userSpaceOnUse" {...region}>
              <rect {...region} fill="#fff" />
              <path d={d} transform={rotate} fill="#000" />
            </mask>
            <filter id={shadowBlurId} filterUnits="userSpaceOnUse" {...region}><feGaussianBlur stdDeviation={glass.shadow.blur / 2} /></filter>
            <filter id={glowBlurId} filterUnits="userSpaceOnUse" {...region}><feGaussianBlur stdDeviation={Math.max(0.5, glass.bezel * 0.35)} /></filter>
            <filter id={softId} filterUnits="userSpaceOnUse" {...region}><feGaussianBlur stdDeviation={1.2} /></filter>
            {/* Light comes from the top left whatever the shape's own rotation. */}
            <linearGradient id={rimId} gradientUnits="userSpaceOnUse" x1={bounds.x} y1={bounds.y} x2={bounds.x + bounds.width} y2={bounds.y + bounds.height}
              gradientTransform={angle ? `rotate(${-angle} ${cx} ${cy})` : undefined}>
              <stop offset="0" stopColor="#fff" stopOpacity="1" />
              <stop offset="0.4" stopColor="#fff" stopOpacity="0.18" />
              <stop offset="0.7" stopColor="#fff" stopOpacity="0.06" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          {shadowOn && <g mask={`url(#${outsideId})`}>
            <g transform={`translate(0 ${glass.shadow.offsetY})`}>
              <path d={d} transform={rotate} fill="#000" fillOpacity={glass.shadow.opacity} filter={`url(#${shadowBlurId})`} />
            </g>
          </g>}
          <g clipPath={`url(#${insideId})`}>
            {tintOpacity > 0 && <path d={d} transform={rotate} fill={tint} fillOpacity={tintOpacity} />}
            {glass.rim > 0 && <path d={d} transform={rotate} fill="none" stroke="#fff" strokeOpacity={0.22 * glass.rim} strokeWidth={glass.bezel * 1.2} filter={`url(#${glowBlurId})`} />}
            {glass.rim > 0 && <path d={d} transform={rotate} fill="none" stroke={`url(#${rimId})`} strokeOpacity={glass.rim} strokeWidth={3} />}
            {glass.specular > 0 && <path d={d} transform={rotate} fill="none" stroke={`url(#${rimId})`} strokeOpacity={glass.specular * 0.6} strokeWidth={Math.max(2, glass.bezel * 0.5)} filter={`url(#${softId})`} />}
          </g>
          {stroke && stroke.width > 0 && <path d={d} transform={rotate} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinejoin="round" strokeDasharray={dashArray(stroke.dash, stroke.width)} />}
          {hit && <path d={d} transform={rotate} data-shape-hit={shape.id} fill="transparent" stroke="transparent" strokeWidth={Math.max(strokeWidth, 28)} strokeLinejoin="round"
            style={{ pointerEvents: 'all', cursor: 'pointer' }} {...pointerHandlers} />}
        </svg>
      </div>
    </>
  )
}

/**
 * The glass export pass's map sub-frame (docs/plans/liquid-glass/04-glass-export-pass.md): a fully OPAQUE frame,
 * background rgb(128,128,0) = no shift and no coverage, with the shape's refraction map (R/G displacement, B
 * silhouette coverage) drawn where the shape is, following its motion, and B scaled by the shape's opacity.
 * FFmpeg reads R/G as the `displace` maps and B as the alpha that cuts the glassed picture to the shape.
 * The surface (tint, rim, shadow) is a normal `ShapeActor glass={false}` in the next band.
 */
export function GlassMapActor({ shape, timestampUs, composition }: { shape: Shape; timestampUs: number; composition: Size }) {
  const frame = shapeFrameAt(shape, timestampUs)
  if (!frame.visible || !shape.glass) return null
  const scale = composition.width / COMPOSITION_WIDTH
  const bounds = glassBounds(shape.geometry)
  const images = glassCoverageMap(shape.geometry, shape.glass, scale)
  const opacity = clamp01(frame.opacity * shape.opacity)
  const place: CSSProperties = {
    position: 'absolute', left: bounds.x * scale, top: bounds.y * scale, width: bounds.width * scale, height: bounds.height * scale,
    transform: `translate(${frame.x * scale}px, ${frame.y * scale}px) scale(${frame.scale})`, transformOrigin: '50% 50%',
  }
  return (
    <div data-glass-map-frame={shape.id} style={{ position: 'absolute', inset: 0, background: 'rgb(128, 128, 0)', isolation: 'isolate', overflow: 'hidden' }}>
      {/* Without a raster (very large shape) the box itself is the coverage, with no refraction. */}
      {images
        ? <img data-glass-map={shape.id} src={images.mapUrl} alt="" style={{ ...place, imageRendering: 'auto' }} />
        : <div style={{ ...place, background: 'rgb(128, 128, 255)' }} />}
      {/* Multiply keeps R and G and scales B by the opacity. */}
      <div style={{ position: 'absolute', inset: 0, mixBlendMode: 'multiply', background: `rgb(255, 255, ${Math.round(opacity * 255)})` }} />
    </div>
  )
}
