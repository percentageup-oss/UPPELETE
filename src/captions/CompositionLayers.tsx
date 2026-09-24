import { useLayoutEffect, useRef, type CSSProperties, type ReactElement } from 'react'
import type { CompositionRect, Fill, LayerMask } from '../core/edit'
import { fillCss, paintAt, type FillPaint } from '../core/fill'
import { GridPicture } from './GridPicture'
import { GradedVideo } from './GradedVideo'
import { maskStyle } from './maskStyle'
import { pooledVideoStyle } from './pooledVideoStyle'
import { compositionScale } from '../core/composition'
import type { FrameEffects, PictureEffects } from '../core/frameEffects'
import type { Cube3D } from '../color/cube'
import type { Size } from './renderer'

type Fit = 'contain' | 'cover' | 'stretch'

/** An image, already resolved to a concrete URL (or `null` for a missing asset, shown as a
 * placeholder in the editor preview — the export harness never sees `null`, since export refuses
 * before the job starts when an image is not registered). */
export type CompositionLayerImage = { kind?: 'image'; id: string; url: string | null; label: string; rect: CompositionRect | null; opacity: number; fit: Fit; mask?: LayerMask
  /** Schema 16: the baked LUT grading this picture (`gradeStackFor`/`bakedGradeStack`, docs/EDITING.md
   * "Color: adjustment layers"), if any enabled adjustment layer is stacked above it right now. */
  grade?: Cube3D | null }
/** A pooled `<video>` owned by the playback transport, mounted — never created — by `VideoSlot`
 * (or, once `grade` is set, by `GradedVideo`, which takes over mounting it into a WebGL2 canvas). */
export type CompositionLayerVideo = { kind: 'video'; id: string; element: HTMLVideoElement | null; label: string; rect: CompositionRect | null; opacity: number; fit: Fit; mask?: LayerMask; grade?: Cube3D | null }
/** A generated background (schema 13). `paint` is already resolved from the clip and the current
 * sequence time by `paintAt`, so this holds no clock of its own — same as the frame-paint effects. */
export type CompositionLayerColor = { kind: 'color'; id: string; paint: ReturnType<typeof paintAt>; rect: CompositionRect | null; opacity: number; mask?: LayerMask }
/** An effect over everything painted below it (`backdrop-filter` blurs what is under the div). */
export type CompositionLayerBlur = { kind: 'blur'; id: string; rect: CompositionRect; radius: number; mask?: LayerMask }
/**
 * Frame-paint effects (docs/EDITING.md "Frame-paint effects"): pinned to the output frame, painted
 * by this same component in preview and export — no FFmpeg filter on either side, so parity is
 * exact rather than measured. Vignette and letterbox are meant for the `layers` slot (under
 * captions, like a host-painted overlay); fade is meant for `CaptionPreview`'s `overCaption` slot,
 * since a fade must cover the captions too.
 */
export type CompositionLayerVignette = { kind: 'vignette'; id: string; amount: number; softness: number; mask?: LayerMask }
export type CompositionLayerLetterbox = { kind: 'letterbox'; id: string; orientation: 'horizontal' | 'vertical'; barPx: number; color: string; mask?: LayerMask }
export type CompositionLayerFade = { kind: 'fade'; id: string; color: string; opacity: number; mask?: LayerMask }
/** Texture overlays (film grain, VHS): the animated parameters were already resolved from absolute
 * sequence time by `frameEffectsAt`, so this component holds no clock of its own. */
export type CompositionLayerGrain = { kind: 'grain'; id: string; amount: number; size: number; seed: number; mask?: LayerMask }
export type CompositionLayerVhs = { kind: 'vhs'; id: string; amount: number; scanlines: number; tracking: number; bandY: number; jitter: number; flicker: number; seed: number; mask?: LayerMask }
export type CompositionLayerParticles = { kind: 'particles'; id: string; amount: number; size: number; speed: number; color: string; tick: number; opacity: number; seed: number; mask?: LayerMask }
export type CompositionLayer = CompositionLayerImage | CompositionLayerVideo | CompositionLayerColor | CompositionLayerBlur
  | CompositionLayerVignette | CompositionLayerLetterbox | CompositionLayerFade | CompositionLayerGrain | CompositionLayerVhs | CompositionLayerParticles

/** The frame-paint layers pinned to the output frame (under captions), back to front. Preview and the
 * export host both build their list here so the two can never disagree about order or content. */
export function pinnedEffectLayers(effects: FrameEffects): CompositionLayer[] {
  return [
    ...(effects.vignette ? [{ kind: 'vignette' as const, id: 'vignette', ...effects.vignette }] : []),
    ...(effects.vhs ? [{ kind: 'vhs' as const, id: 'vhs', ...effects.vhs }] : []),
    ...(effects.grain ? [{ kind: 'grain' as const, id: 'grain', ...effects.grain }] : []),
    ...(effects.particles ? [{ kind: 'particles' as const, ...effects.particles }] : []),
    ...(effects.letterbox ? [{ kind: 'letterbox' as const, id: 'letterbox', ...effects.letterbox }] : []),
  ]
}

/**
 * Signed noise painted with plain alpha, so it composites correctly over a transparent layer in the
 * export host (a blend mode would have nothing to blend with there): one white and one black rect,
 * each keeping only the half of the noise above/below mid-gray as alpha. `feTurbulence` is seeded
 * explicitly, so the same seed always paints the same speckle. `cellPx` sets the noise's feature
 * size by rendering the filter in a scaled-down user space that the viewBox stretches back up.
 */
function NoiseFill({ id, width, height, cellX, cellY, frequency, seed, gain }: {
  id: string; width: number; height: number; cellX: number; cellY: number; frequency: readonly [number, number]; seed: number; gain: number
}) {
  const viewWidth = Math.max(1, width / cellX)
  const viewHeight = Math.max(1, height / cellY)
  const filter = (name: string, sign: 1 | -1, color: 0 | 1) => <filter key={name} id={`${id}-${name}`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency={`${frequency[0]} ${frequency[1]}`} numOctaves={1} seed={seed} stitchTiles="stitch" result="noise" />
    <feColorMatrix in="noise" type="matrix" values={`0 0 0 0 ${color}  0 0 0 0 ${color}  0 0 0 0 ${color}  ${2 * gain * sign} 0 0 0 ${-gain * sign}`} />
  </filter>
  return <svg width={width} height={height} viewBox={`0 0 ${viewWidth} ${viewHeight}`} preserveAspectRatio="none"
    style={{ position: 'absolute', left: 0, top: 0, display: 'block' }}>
    <defs>{filter('white', 1, 1)}{filter('black', -1, 0)}</defs>
    <rect width={viewWidth} height={viewHeight} filter={`url(#${id}-white)`} />
    <rect width={viewWidth} height={viewHeight} filter={`url(#${id}-black)`} />
  </svg>
}

function VhsPaint({ layer, composition, scale }: { layer: CompositionLayerVhs; composition: Size; scale: number }) {
  const { width, height } = composition
  const amount = layer.amount
  const scanlineAlpha = 0.4 * layer.scanlines * amount
  const bandHeight = height * 0.05 * (0.4 + layer.tracking) * Math.min(1, amount * 1.5)
  const bandTop = layer.bandY * (height + bandHeight) - bandHeight
  const headSwitchHeight = height * 0.035
  const noiseGain = Math.min(1, amount * layer.tracking * 2.5)
  const fringe = 0.16 * amount
  return <div data-vhs-id={layer.id} style={{ position: 'absolute', left: 0, top: 0, width, height, overflow: 'hidden' }}>
    <div style={{ position: 'absolute', inset: 0, background: `repeating-linear-gradient(to bottom, rgba(0,0,0,${scanlineAlpha}) 0px, rgba(0,0,0,${scanlineAlpha}) ${1.5 * scale}px, transparent ${1.5 * scale}px, transparent ${3 * scale}px)` }} />
    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(to right, rgba(255,32,96,${fringe}) 0%, transparent 7%, transparent 93%, rgba(0,200,255,${fringe}) 100%)` }} />
    <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: layer.flicker * 0.08 * amount }} />
    {noiseGain > 0 && bandHeight > 0.5 && <div style={{ position: 'absolute', left: layer.jitter * width * 0.012 * layer.tracking, top: bandTop, width, height: bandHeight, overflow: 'hidden' }}>
      <NoiseFill id={`${layer.id}-band`} width={width} height={bandHeight} cellX={2 * scale} cellY={2 * scale} frequency={[0.02, 0.7]} seed={layer.seed} gain={noiseGain} />
    </div>}
    {noiseGain > 0 && <div style={{ position: 'absolute', left: 0, bottom: 0, width, height: headSwitchHeight, overflow: 'hidden' }}>
      <NoiseFill id={`${layer.id}-head`} width={width} height={headSwitchHeight} cellX={2 * scale} cellY={2 * scale} frequency={[0.03, 0.8]} seed={layer.seed + 1} gain={Math.min(1, noiseGain * 1.4)} />
    </div>}
  </div>
}

/**
 * Preview counterpart of the export's `pictureEffectChain` glow (docs/EDITING.md "Picture effects:
 * Dreamy glow"): highlight pass → Gaussian blur → screen at `amount`, all in sRGB. Render it once and
 * apply the returned `filter` style to the picture wrapper; the SVG itself paints nothing.
 */
export function glowFilterStyle(glow: NonNullable<PictureEffects['glow']>, scale: number, id: string): { defs: ReactElement; style: CSSProperties } {
  const { amount, threshold } = glow
  const slope = 1 / (1 - threshold)
  const intercept = -threshold / (1 - threshold)
  const defs = <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" data-glow-filter={id}>
    <defs>
      <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feComponentTransfer in="SourceGraphic" result="bright">
          <feFuncR type="linear" slope={slope} intercept={intercept} />
          <feFuncG type="linear" slope={slope} intercept={intercept} />
          <feFuncB type="linear" slope={slope} intercept={intercept} />
        </feComponentTransfer>
        <feGaussianBlur in="bright" stdDeviation={glow.radius * scale} edgeMode="duplicate" result="bloom" />
        <feComposite in="SourceGraphic" in2="bloom" operator="arithmetic" k1={-amount} k2={1} k3={amount} k4={0} />
      </filter>
    </defs>
  </svg>
  return { defs, style: { filter: `url(#${id})` } }
}

/**
 * Mounts a pooled `<video>` into the composition. Letting React create and destroy `<video>` as the
 * layer list changes would reload the media on every change; appending the transport's element
 * keeps it decoding. Moving it between slots in one commit never pauses it.
 */
function VideoSlot({ element, style, fit }: { element: HTMLVideoElement | null; style: CSSProperties; fit: Fit }) {
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const parent = host.current
    if (!parent || !element) return
    Object.assign(element.style, pooledVideoStyle(fit, true))
    parent.appendChild(element)
    return () => { if (element.parentNode === parent) parent.removeChild(element) }
  }, [element, fit])
  return <div ref={host} data-video-layer style={style} />
}

/**
 * Everything painted under the captions, in the same composition-unit space `CaptionView` draws in,
 * back to front in the order given: visual clips in track order, then blur. A `rect` of `null` fills
 * the frame. The caller does the time-visibility filtering and asset lookup (`App.tsx`'s
 * `CaptionStage` for the live preview, `frameHarness.tsx` from the already-resolved export frame
 * request) so this stays a pure paint of whatever list it is given. `composition` may be the fixed
 * 1080-unit preview space (scale 1) or an export harness's output-pixel composition
 * (`compositionScale`, matching `compositionToPixels`).
 */
export function CompositionLayers({ layers, composition }: { layers: readonly CompositionLayer[]; composition: Size }) {
  const scale = compositionScale(composition)
  if (!layers.length) return null
  const box = (rect: CompositionRect | null): CSSProperties => rect
    ? { position: 'absolute', left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale }
    : { position: 'absolute', left: 0, top: 0, width: composition.width, height: composition.height }
  return <>{layers.map((layer) => {
    if (layer.kind === 'color') {
      const { paint } = layer
      const { base, overlay } = paint
      const pixels = layer.rect ? { width: layer.rect.width * scale, height: layer.rect.height * scale } : composition
      const picture = (fill: Fill, scroll: FillPaint['scroll']) => fill.type === 'grid' ? <GridPicture grid={fill} width={pixels.width} height={pixels.height} scale={scale} scroll={scroll} /> : null
      return <div key={layer.id} data-color-id={layer.id} style={{ ...box(layer.rect), overflow: 'hidden', opacity: layer.opacity, ...maskStyle(layer.mask, composition, layer.rect) }}>
        <div style={{ position: 'absolute', left: `${base.left * 100}%`, top: `${base.top * 100}%`, width: `${base.width * 100}%`, height: `${base.height * 100}%`, background: fillCss(paint.fill) }}>{picture(paint.fill, paint.scroll)}</div>
        {overlay && <div style={{ position: 'absolute', inset: 0, background: fillCss(overlay.fill), opacity: overlay.opacity }}>{picture(overlay.fill, null)}</div>}
      </div>
    }
    if (layer.kind === 'blur') {
      const blur = `blur(${layer.radius * scale}px)`
      return <div key={layer.id} data-blur-id={layer.id} style={{ ...box(layer.rect), backdropFilter: blur, WebkitBackdropFilter: blur, ...maskStyle(layer.mask, composition, layer.rect) }} />
    }
    if (layer.kind === 'vignette') {
      // Softer (higher `softness`) starts darkening closer to the center; harder stays transparent
      // until near the rim. Painted the same way in preview and export — no FFmpeg equivalent needed.
      const innerStopPercent = 85 - layer.softness * 50
      return <div key={layer.id} data-vignette-id={layer.id} style={{ ...box(null), ...maskStyle(layer.mask, composition, null),
        background: `radial-gradient(ellipse at center, transparent ${innerStopPercent}%, rgba(0,0,0,${layer.amount}) 100%)` }} />
    }
    if (layer.kind === 'grain') {
      if (layer.amount <= 0) return null
      const cell = Math.max(0.5, layer.size) * scale
      return <div key={layer.id} data-grain-id={layer.id} style={{ ...box(null), overflow: 'hidden', ...maskStyle(layer.mask, composition, null) }}>
        <NoiseFill id={layer.id} width={composition.width} height={composition.height} cellX={cell} cellY={cell} frequency={[0.85, 0.85]} seed={layer.seed} gain={Math.min(1, layer.amount * 1.2)} />
      </div>
    }
    if (layer.kind === 'vhs') return layer.mask
      ? <div key={layer.id} data-vhs-mask={layer.id} style={{ ...box(null), ...maskStyle(layer.mask, composition, null) }}><VhsPaint layer={layer} composition={composition} scale={scale} /></div>
      : <VhsPaint key={layer.id} layer={layer} composition={composition} scale={scale} />
    if (layer.kind === 'particles') {
      if (layer.amount <= 0 || layer.opacity <= 0) return null
      const count = Math.min(72, Math.round(72 * layer.amount))
      const seconds = layer.tick / 60
      const hash01 = (n: number) => {
        let value = (Math.imul((n ^ layer.seed) | 0, 0x9e3779b1) + 0x7f4a7c15) | 0
        value = Math.imul(value ^ (value >>> 15), 0x85ebca6b)
        value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
        return ((value ^ (value >>> 16)) >>> 0) / 4294967296
      }
      const gradientId = `particles-${layer.id}`
      return <div key={layer.id} data-particles-id={layer.id} style={{ ...box(null), overflow: 'hidden', ...maskStyle(layer.mask, composition, null) }}>
        <svg width={composition.width} height={composition.height} viewBox={`0 0 ${composition.width} ${composition.height}`} preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, display: 'block' }} aria-hidden="true">
          <defs><radialGradient id={gradientId} cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor={layer.color} stopOpacity=".95" />
            <stop offset="35%" stopColor={layer.color} stopOpacity=".55" />
            <stop offset="100%" stopColor={layer.color} stopOpacity="0" />
          </radialGradient></defs>
          {Array.from({ length: count }, (_, index) => {
            const base = index * 7
            const phase = hash01(base + 1) * Math.PI * 2
            const baseX = hash01(base + 2)
            const baseY = hash01(base + 3)
            const x = ((baseX + Math.sin(seconds * 0.65 + phase) * 0.025 + 1) % 1) * composition.width
            const y = ((baseY - seconds * layer.speed * 0.035 + 2) % 1) * composition.height
            const radius = layer.size * scale * (0.3 + hash01(base + 4) * 0.55)
            const alpha = layer.opacity * (0.65 + hash01(base + 5) * 0.35) * (0.85 + 0.15 * Math.sin(seconds * 1.8 + phase))
            const glint = index % 11 === 0
            return <g key={index} opacity={Math.max(0, alpha)}>
              <circle cx={x} cy={y} r={radius * 2.7} fill={`url(#${gradientId})`} />
              {glint && <circle cx={x} cy={y} r={Math.max(0.45, radius * 0.2)} fill="#FFF8E8" opacity=".9" />}
            </g>
          })}
        </svg>
      </div>
    }
    if (layer.kind === 'letterbox') {
      const barPx = layer.barPx * scale
      if (barPx <= 0.5) return null
      const bars = layer.orientation === 'horizontal'
        ? [{ top: 0, left: 0, right: 0, height: barPx }, { bottom: 0, left: 0, right: 0, height: barPx }]
        : [{ top: 0, bottom: 0, left: 0, width: barPx }, { top: 0, bottom: 0, right: 0, width: barPx }]
      return <div key={layer.id} data-letterbox-id={layer.id} style={{ ...box(null), ...maskStyle(layer.mask, composition, null) }}>
        {bars.map((bar, index) => <div key={index} style={{ position: 'absolute', background: layer.color, ...bar }} />)}
      </div>
    }
    if (layer.kind === 'fade') return <div key={layer.id} data-fade-id={layer.id} style={{ ...box(null), background: layer.color, opacity: layer.opacity, ...maskStyle(layer.mask, composition, null) }} />
    if (layer.kind === 'video') {
      const videoStyle = { ...box(layer.rect), opacity: layer.opacity, ...maskStyle(layer.mask, composition, layer.rect) }
      return layer.grade
        ? <GradedVideo key={layer.id} source={{ kind: 'video', element: layer.element }} grade={layer.grade} fit={layer.fit} style={videoStyle} />
        : <VideoSlot key={layer.id} element={layer.element} fit={layer.fit} style={videoStyle} />
    }
    const style: CSSProperties = { ...box(layer.rect), opacity: layer.opacity, objectFit: layer.fit === 'stretch' ? 'fill' : layer.fit, ...maskStyle(layer.mask, composition, layer.rect) }
    if (!layer.url) return <div key={layer.id} data-overlay-missing={layer.id} style={{ ...style, boxSizing: 'border-box',
      border: '1px dashed #ffda8b', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      color: '#ffda8b', fontSize: 11, textAlign: 'center', background: '#10101066' }}>{layer.label}</div>
    if (layer.grade) return <GradedVideo key={layer.id} source={{ kind: 'image', url: layer.url }} grade={layer.grade} fit={layer.fit} style={style} />
    return <img key={layer.id} data-overlay-id={layer.id} src={layer.url} draggable={false} alt="" style={style} />
  })}</>
}
