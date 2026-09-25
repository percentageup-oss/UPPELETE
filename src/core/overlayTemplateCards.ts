import type { Shape, ShapeAnimation, TextOverlay } from './edit'
import {
  POP_TEXT, bubbleGeometry, boxOf, ellipseGeometry, placeAndFit, rectAround, rectGeometry, registerTemplate, templateShape, templateTextStyle,
  type Point, type TemplateBuildInput, type TemplateText,
} from './overlayTemplates'
import { bellClapperGlyph, bellGlyph, heartGlyph, magnifierGlyph } from './templateGlyphs'

/**
 * Social / UI cards and Labels & lower thirds. Same rules as the chat and callout templates
 * (`overlayTemplateCatalog.ts`): pure builders, every member placed from measured text. Members that hold text but
 * are positioned from insert-time measurements (icon rows, pills with a glyph) do not refit on later text edits.
 * Importing this file registers the templates.
 */
const INK = '#111111', WHITE = '#FFFFFF', GREY = '#8E8E93', RED = '#FF0033', BLUE = '#0A84FF', GREEN = '#34C759'

const text = (key: string, value: string, size: number, color: string, changes: Parameters<typeof templateTextStyle>[2] = {}): TemplateText =>
  ({ key, text: value, style: templateTextStyle(size, color, { maxLines: 1, ...changes }) })

/** A grow reveal that finishes before the exit fade, whatever the insert length. */
const growOver = (input: Pick<TemplateBuildInput, 'startUs' | 'endUs'>, delayUs: number): ShapeAnimation =>
  ({ kind: 'grow', durationUs: Math.min(5_000_000, Math.max(300_000, input.endUs - input.startUs - delayUs - 400_000)) })

const SLIDE_LEFT: ShapeAnimation = { kind: 'slide', direction: 'left', durationUs: 400_000 }
const SLIDE_LEFT_TEXT: TextOverlay['enter'] = { kind: 'slide', direction: 'left', durationUs: 400_000 }

/** Rect geometry whose top corners are square and bottom corners round, for a fill that rises inside a pill. */
const bottomRounded = (rect: { x: number; y: number; width: number; height: number }, radius: number) =>
  ({ kind: 'rect' as const, rect, cornerRadius: radius / 2, cornerRadii: { tl: 0, tr: 0, br: radius, bl: radius }, rotation: 0 })

// ---- Social / UI cards --------------------------------------------------------------------------------------------

{
  const name = text('name', 'Maya Thomas', 34, WHITE, { fontWeight: 700, alignment: 'left' })
  const handle = text('handle', '@maya · 2h', 26, GREY, { fontWeight: 400, alignment: 'left' })
  const body = text('body', 'Just shipped the new caption tools. Try them and tell me what you think!', 38, WHITE, { fontWeight: 400, maxLines: 3, alignment: 'left' })
  const INSET = 36, AVATAR = 84
  registerTemplate({
    id: 'post-card', name: 'Post card', description: 'A social post: avatar, name and handle, body text, and like and reply icons.', category: 'cards', supportsGlass: true,
    memberKeys: ['card', 'avatar', 'name', 'handle', 'body', 'reply', 'like'], texts: [name, handle, body],
    build(input) {
      const b = input.measured
      const width = Math.max(720, b.body.width + INSET * 2)
      const height = INSET + AVATAR + 26 + b.body.height + 30 + 36 + INSET
      const card = templateShape(input, { key: 'card', name: 'Card', geometry: rectGeometry(rectAround(input.at, width, height), 36), fill: { color: '#15181E', opacity: 0.96 }, glass: true })
      const r = boxOf(card)
      const avatar = templateShape(input, { key: 'avatar', name: 'Avatar', delayMs: 100, layerOrder: 2,
        geometry: ellipseGeometry(rectAround({ x: r.x + INSET + AVATAR / 2, y: r.y + INSET + AVATAR / 2 }, AVATAR, AVATAR)), fill: { color: '#7C6CF0' } })
      const left = r.x + INSET + AVATAR + 20
      const nameText = placeAndFit(name, input.ids.name, input, { center: { x: left + b.name.width / 2, y: r.y + INSET + 24 }, delayMs: 140 })
      const handleText = placeAndFit(handle, input.ids.handle, input, { center: { x: left + b.handle.width / 2, y: r.y + INSET + 62 }, delayMs: 180 })
      const bodyTop = r.y + INSET + AVATAR + 26
      const bodyText = placeAndFit(body, input.ids.body, input, { center: { x: r.x + INSET + b.body.width / 2, y: bodyTop + b.body.height / 2 }, delayMs: 240 })
      const iconY = bodyTop + b.body.height + 30 + 18
      const reply = templateShape(input, { key: 'reply', name: 'Reply icon', delayMs: 320, layerOrder: 2,
        geometry: bubbleGeometry(rectAround({ x: r.x + INSET + 18, y: iconY - 2 }, 36, 28), 10, { side: 'bottom', offset: 0.2, width: 12, length: 9, curve: 0.5 }), stroke: { color: GREY, width: 3 } })
      const like = templateShape(input, { key: 'like', name: 'Like icon', delayMs: 380, layerOrder: 2,
        geometry: heartGlyph({ x: r.x + INSET + 118, y: iconY }, 38), stroke: { color: GREY, width: 3 } })
      return { shapes: [card, avatar, reply, like], texts: [nameText.overlay, handleText.overlay, bodyText.overlay] }
    },
  })
}

{
  const app = text('app', 'CALENDAR', 24, '#6C6C70', { fontWeight: 600, alignment: 'left' })
  const now = text('now', 'now', 24, '#6C6C70', { fontWeight: 400 })
  const title = text('title', 'Design review', 30, INK, { fontWeight: 700, alignment: 'left' })
  const body = text('body', 'Starts in 10 minutes in Studio B', 28, '#3C3C43', { fontWeight: 400, alignment: 'left' })
  const INSET = 24, ICON = 76
  registerTemplate({
    id: 'ios-notification', name: 'iOS notification', description: 'A notification banner with an app icon, title, message and time. Glass variant: blur 14, low tint.', category: 'cards', supportsGlass: true,
    memberKeys: ['banner', 'icon', 'app', 'now', 'title', 'body'], texts: [app, now, title, body],
    build(input) {
      const b = input.measured
      const textWidth = Math.max(b.title.width, b.body.width, b.app.width + 24 + b.now.width)
      const width = INSET + ICON + 20 + textWidth + INSET
      const height = 150
      const banner = templateShape(input, { key: 'banner', name: 'Banner', geometry: rectGeometry(rectAround(input.at, width, height), 44),
        fill: { color: WHITE, opacity: 0.9 }, glass: true, glassTuning: { blur: 14, tintOpacity: 0.15 } })
      const r = boxOf(banner)
      const icon = templateShape(input, { key: 'icon', name: 'App icon', delayMs: 120, layerOrder: 2,
        geometry: rectGeometry(rectAround({ x: r.x + INSET + ICON / 2, y: r.y + height / 2 }, ICON, ICON), 20), fill: { color: '#FF453A' } })
      const left = r.x + INSET + ICON + 20, right = r.x + width - INSET
      const top = r.y + 30
      const appText = placeAndFit(app, input.ids.app, input, { center: { x: left + b.app.width / 2, y: top }, delayMs: 160 })
      const nowText = placeAndFit(now, input.ids.now, input, { center: { x: right - b.now.width / 2, y: top }, delayMs: 160 })
      const titleText = placeAndFit(title, input.ids.title, input, { center: { x: left + b.title.width / 2, y: top + 42 }, delayMs: 200 })
      const bodyText = placeAndFit(body, input.ids.body, input, { center: { x: left + b.body.width / 2, y: top + 82 }, delayMs: 240 })
      return { shapes: [banner, icon], texts: [appText.overlay, nowText.overlay, titleText.overlay, bodyText.overlay] }
    },
  })
}

{
  const label = text('label', 'SUBSCRIBE', 36, WHITE, { fontWeight: 800 })
  const BELL = 44, PAD = 36
  registerTemplate({
    id: 'subscribe-pill', name: 'Subscribe pill', description: 'A red pill with a bell icon and white SUBSCRIBE text.', category: 'cards', supportsGlass: false,
    memberKeys: ['pill', 'bell', 'clapper', 'label'], texts: [label],
    build(input) {
      const b = input.measured.label
      const width = PAD + BELL + 16 + b.width + PAD, height = 92
      const pill = templateShape(input, { key: 'pill', name: 'Pill', geometry: rectGeometry(rectAround(input.at, width, height), 999), fill: { color: RED } })
      const r = boxOf(pill)
      const bellCenter = { x: r.x + PAD + BELL / 2, y: r.y + height / 2 }
      const bell = templateShape(input, { key: 'bell', name: 'Bell', delayMs: 150, layerOrder: 2, geometry: bellGlyph(bellCenter, BELL), fill: { color: WHITE } })
      const clapper = templateShape(input, { key: 'clapper', name: 'Bell clapper', delayMs: 150, layerOrder: 2, geometry: bellClapperGlyph(bellCenter, BELL), fill: { color: WHITE } })
      const labelText = placeAndFit(label, input.ids.label, input, { center: { x: r.x + width - PAD - b.width / 2, y: r.y + height / 2 }, delayMs: 100, enter: POP_TEXT })
      return { shapes: [pill, bell, clapper], texts: [labelText.overlay] }
    },
  })
}

{
  const label = text('label', 'Like', 36, INK, { fontWeight: 700 })
  const HEART = 42, PAD = 34
  registerTemplate({
    id: 'like-button', name: 'Like button', description: 'A white pill with a red heart and the word Like.', category: 'cards', supportsGlass: true,
    memberKeys: ['pill', 'heart', 'label'], texts: [label],
    build(input) {
      const b = input.measured.label
      const width = PAD + HEART + 16 + b.width + PAD, height = 92
      const pill = templateShape(input, { key: 'pill', name: 'Pill', geometry: rectGeometry(rectAround(input.at, width, height), 999), fill: { color: WHITE, opacity: 0.94 }, glass: true })
      const r = boxOf(pill)
      const heart = templateShape(input, { key: 'heart', name: 'Heart', delayMs: 150, layerOrder: 2,
        geometry: heartGlyph({ x: r.x + PAD + HEART / 2, y: r.y + height / 2 }, HEART), fill: { color: RED } })
      const labelText = placeAndFit(label, input.ids.label, input, { center: { x: r.x + width - PAD - b.width / 2, y: r.y + height / 2 }, delayMs: 100, enter: POP_TEXT })
      return { shapes: [pill, heart], texts: [labelText.overlay] }
    },
  })
}

{
  const placeholder = text('placeholder', 'Search', 34, '#6C6C70', { fontWeight: 400, alignment: 'left' })
  const WIDTH = 720, HEIGHT = 96, GLYPH = 38
  registerTemplate({
    id: 'search-bar', name: 'Search bar', description: 'A pill-shaped search field with a magnifier and placeholder text.', category: 'cards', supportsGlass: true,
    memberKeys: ['bar', 'lens', 'handle', 'placeholder'], texts: [placeholder],
    build(input) {
      const bar = templateShape(input, { key: 'bar', name: 'Bar', geometry: rectGeometry(rectAround(input.at, WIDTH, HEIGHT), 999), fill: { color: WHITE, opacity: 0.85 }, glass: true })
      const r = boxOf(bar)
      const glyph = magnifierGlyph({ x: r.x + 52, y: r.y + HEIGHT / 2 }, GLYPH)
      const stroke = { color: '#6C6C70', width: 4 }
      const lens = templateShape(input, { key: 'lens', name: 'Magnifier lens', delayMs: 120, layerOrder: 2, geometry: glyph.lens, stroke })
      const handle = templateShape(input, { key: 'handle', name: 'Magnifier handle', delayMs: 120, layerOrder: 2, geometry: glyph.handle, stroke })
      const b = input.measured.placeholder
      const placeholderText = placeAndFit(placeholder, input.ids.placeholder, input, { center: { x: r.x + 96 + b.width / 2, y: r.y + HEIGHT / 2 }, delayMs: 160 })
      return { shapes: [bar, lens, handle], texts: [placeholderText.overlay] }
    },
  })
}

registerTemplate({
  id: 'toggle-switch', name: 'Toggle switch', description: 'A green switch whose white knob slides into the on position.', category: 'cards', supportsGlass: false,
  memberKeys: ['track', 'knob'], texts: [],
  build(input) {
    const W = 176, H = 100, KNOB = 84
    const track = templateShape(input, { key: 'track', name: 'Track', geometry: rectGeometry(rectAround(input.at, W, H), 999), fill: { color: GREEN } })
    const r = boxOf(track)
    const knob = templateShape(input, { key: 'knob', name: 'Knob', delayMs: 250, layerOrder: 2, enter: { kind: 'slide', direction: 'left', durationUs: 450_000 },
      geometry: ellipseGeometry(rectAround({ x: r.x + W - 8 - KNOB / 2, y: r.y + H / 2 }, KNOB, KNOB)), fill: { color: WHITE } })
    return { shapes: [track, knob], texts: [] }
  },
})

registerTemplate({
  id: 'progress-bar', name: 'Progress bar', description: 'A track with a fill that grows from left to right across the insert.', category: 'cards', supportsGlass: false,
  memberKeys: ['track', 'fill'], texts: [],
  build(input) {
    const W = 760, H = 26
    const delay = 300
    const track = templateShape(input, { key: 'track', name: 'Track', geometry: rectGeometry(rectAround(input.at, W, H), 999), fill: { color: WHITE, opacity: 0.25 } })
    const fill = templateShape(input, { key: 'fill', name: 'Fill', delayMs: delay, layerOrder: 2, enter: growOver(input, delay * 1000),
      geometry: rectGeometry(boxOf(track), 999), fill: { color: BLUE } })
    return { shapes: [track, fill], texts: [] }
  },
})

{
  const label = text('label', 'Silent', 26, WHITE, { fontWeight: 600 })
  const SIZE = 250, ICON = 108
  registerTemplate({
    id: 'control-tile', name: 'Control Centre tile', description: 'A rounded square with a round icon button and a label, in the style of a Control Centre tile.', category: 'cards', supportsGlass: true,
    memberKeys: ['tile', 'icon', 'bell', 'clapper', 'label'], texts: [label],
    build(input) {
      const tile = templateShape(input, { key: 'tile', name: 'Tile', geometry: rectGeometry(rectAround(input.at, SIZE, SIZE), 64), fill: { color: '#3A3A44', opacity: 0.75 }, glass: true })
      const r = boxOf(tile)
      const iconCenter = { x: r.x + r.width / 2, y: r.y + 92 }
      const icon = templateShape(input, { key: 'icon', name: 'Icon button', delayMs: 120, layerOrder: 2, geometry: ellipseGeometry(rectAround(iconCenter, ICON, ICON)), fill: { color: '#5E5CE6' } })
      const bell = templateShape(input, { key: 'bell', name: 'Bell', delayMs: 200, layerOrder: 3, geometry: bellGlyph(iconCenter, 52), fill: { color: WHITE } })
      const clapper = templateShape(input, { key: 'clapper', name: 'Bell clapper', delayMs: 200, layerOrder: 3, geometry: bellClapperGlyph(iconCenter, 52), fill: { color: WHITE } })
      const labelText = placeAndFit(label, input.ids.label, input, { center: { x: r.x + r.width / 2, y: r.y + r.height - 44 }, delayMs: 160 })
      return { shapes: [tile, icon, bell, clapper], texts: [labelText.overlay] }
    },
  })
}

registerTemplate({
  id: 'volume-slider', name: 'Volume slider', description: 'A tall glass pill with a white level fill. The fill fades in: there is no vertical reveal animation.', category: 'cards', supportsGlass: true,
  memberKeys: ['track', 'level'], texts: [],
  build(input) {
    const W = 160, H = 420, LEVEL = 0.6
    const track = templateShape(input, { key: 'track', name: 'Track', geometry: rectGeometry(rectAround(input.at, W, H), 80), fill: { color: '#3A3A44', opacity: 0.6 }, glass: true })
    const r = boxOf(track)
    const levelHeight = Math.round(H * LEVEL)
    const level = templateShape(input, { key: 'level', name: 'Level', delayMs: 250, layerOrder: 2, enter: { kind: 'fade', durationUs: 500_000 },
      geometry: bottomRounded({ x: r.x, y: r.y + H - levelHeight, width: W, height: levelHeight }, 80), fill: { color: WHITE, opacity: 0.95 } })
    return { shapes: [track, level], texts: [] }
  },
})

// ---- Labels & lower thirds ----------------------------------------------------------------------------------------

{
  const name = text('name', 'Maya Thomas', 54, WHITE, { fontWeight: 700, alignment: 'left' })
  const role = text('role', 'Film director', 30, '#D0D3DA', { fontWeight: 400, alignment: 'left' })
  const BAR = 12, PAD = 32, MARGIN = 60
  registerTemplate({
    id: 'lower-third', name: 'Lower third', description: 'A name and role over a dark panel with an accent bar, at the lower left. Slides in from the left and fades out.', category: 'labels', supportsGlass: true,
    memberKeys: ['panel', 'bar', 'name', 'role'], texts: [name, role],
    build(input) {
      const b = input.measured
      const textWidth = Math.max(b.name.width, b.role.width)
      const height = b.name.height + b.role.height + 44
      const width = BAR + PAD + textWidth + PAD
      const center: Point = { x: MARGIN + width / 2, y: input.composition.height - MARGIN - height / 2 }
      const panel = templateShape(input, { key: 'panel', name: 'Panel', geometry: rectGeometry(rectAround(center, width, height), 12), fill: { color: '#000000', opacity: 0.6 }, enter: SLIDE_LEFT, glass: true })
      const r = boxOf(panel)
      const bar = templateShape(input, { key: 'bar', name: 'Accent bar', layerOrder: 2, enter: SLIDE_LEFT, geometry: rectGeometry({ x: r.x, y: r.y, width: BAR, height }, 0), fill: { color: '#FFC300' } })
      const left = r.x + BAR + PAD
      const nameText = placeAndFit(name, input.ids.name, input, { center: { x: left + b.name.width / 2, y: r.y + 22 + b.name.height / 2 }, enter: SLIDE_LEFT_TEXT })
      const roleText = placeAndFit(role, input.ids.role, input, { center: { x: left + b.role.width / 2, y: r.y + 22 + b.name.height + b.role.height / 2 }, delayMs: 100, enter: SLIDE_LEFT_TEXT })
      return { shapes: [panel, bar], texts: [nameText.overlay, roleText.overlay] }
    },
  })
}

{
  const label = text('label', 'NEW', 30, WHITE, { fontWeight: 800 })
  registerTemplate({
    id: 'pill-tag', name: 'Pill tag', description: 'A small rounded badge that resizes to its text.', category: 'labels', supportsGlass: false,
    memberKeys: ['pill', 'label'], texts: [label],
    build(input) {
      const placed = placeAndFit(label, input.ids.label, input, { enter: POP_TEXT })
      const pill = templateShape(input, { key: 'pill', name: 'Pill', geometry: rectGeometry(rectAround(placed.center, 1, 1), 999), fill: { color: '#7C5CFF' }, fit: { placed, padding: [30, 14] } })
      return { shapes: [pill], texts: [placed.overlay] }
    },
  })
}

{
  const price = text('price', '$24.99', 52, INK, { fontWeight: 800 })
  const NOTCH = 44, PAD = 36, HOLE = 16
  registerTemplate({
    id: 'price-tag', name: 'Price tag', description: 'A yellow tag with a pointed left end, an eyelet and the price.', category: 'labels', supportsGlass: false,
    memberKeys: ['tag', 'hole', 'price'], texts: [price],
    build(input) {
      const b = input.measured.price
      const w = NOTCH + PAD + b.width + PAD, h = Math.max(96, b.height + 40)
      const l = input.at.x - w / 2, t = input.at.y - h / 2, r = l + w, bottom = t + h
      const tag = templateShape(input, { key: 'tag', name: 'Tag', geometry: { kind: 'path', closed: true, points: [{ x: l + NOTCH, y: t }, { x: r, y: t }, { x: r, y: bottom }, { x: l + NOTCH, y: bottom }, { x: l, y: input.at.y }] }, fill: { color: '#FFD60A' } })
      const hole = templateShape(input, { key: 'hole', name: 'Eyelet', delayMs: 100, layerOrder: 2, geometry: ellipseGeometry(rectAround({ x: l + NOTCH - 4, y: input.at.y }, HOLE, HOLE)), fill: { color: '#15181E' } })
      const priceText = placeAndFit(price, input.ids.price, input, { center: { x: l + NOTCH + PAD + b.width / 2, y: input.at.y }, delayMs: 150, enter: POP_TEXT })
      return { shapes: [tag, hole], texts: [priceText.overlay] }
    },
  })
}

{
  const digit = text('digit', '1', 68, WHITE, { fontWeight: 800 })
  registerTemplate({
    id: 'step-number', name: 'Step number', description: 'A filled circle with a step number.', category: 'labels', supportsGlass: false,
    memberKeys: ['circle', 'digit'], texts: [digit],
    build(input) {
      const circle = templateShape(input, { key: 'circle', name: 'Circle', geometry: ellipseGeometry(rectAround(input.at, 132, 132)), fill: { color: '#FF6B35' } })
      const digitText = placeAndFit(digit, input.ids.digit, input, { delayMs: 120, enter: POP_TEXT })
      return { shapes: [circle], texts: [digitText.overlay] }
    },
  })
}

{
  const title = text('title', 'Chapter 2 · Getting started', 42, WHITE, { fontWeight: 700, alignment: 'left' })
  const HEIGHT = 112, LINE = 6, MARGIN = 60
  registerTemplate({
    id: 'chapter-bar', name: 'Chapter title bar', description: 'A full-width bar at the bottom with a title and a thin progress line that grows across the insert.', category: 'labels', supportsGlass: true,
    memberKeys: ['bar', 'track', 'line', 'title'], texts: [title],
    build(input) {
      const { width, height } = input.composition
      const top = height - HEIGHT - 40
      const bar = templateShape(input, { key: 'bar', name: 'Bar', geometry: rectGeometry({ x: 0, y: top, width, height: HEIGHT }, 0), fill: { color: '#000000', opacity: 0.7 }, enter: { kind: 'slide', direction: 'left', durationUs: 400_000 }, glass: true })
      const lineRect = { x: 0, y: top + HEIGHT - LINE, width, height: LINE }
      const track = templateShape(input, { key: 'track', name: 'Progress track', delayMs: 100, layerOrder: 2, geometry: rectGeometry(lineRect, 0), fill: { color: WHITE, opacity: 0.2 } })
      const line = templateShape(input, { key: 'line', name: 'Progress line', delayMs: 300, layerOrder: 3, enter: growOver(input, 300_000), geometry: rectGeometry(lineRect, 0), fill: { color: '#FFC300' } })
      const b = input.measured.title
      const titleText = placeAndFit(title, input.ids.title, input, { center: { x: MARGIN + b.width / 2, y: top + (HEIGHT - LINE) / 2 }, delayMs: 150 })
      return { shapes: [bar, track, line] as Shape[], texts: [titleText.overlay] }
    },
  })
}

{
  const label = text('label', '00:45', 40, WHITE, { fontFamily: 'Courier New', fontWeight: 700 })
  registerTemplate({
    id: 'timer-chip', name: 'Timer chip (static)', description: 'A pill with monospaced time text. It is a static label, not a live countdown: retype the text to change it.', category: 'labels', supportsGlass: true,
    memberKeys: ['pill', 'label'], texts: [label],
    build(input) {
      const placed = placeAndFit(label, input.ids.label, input, { enter: POP_TEXT })
      const pill = templateShape(input, { key: 'pill', name: 'Pill', geometry: rectGeometry(rectAround(placed.center, 1, 1), 999), fill: { color: '#000000', opacity: 0.72 }, fit: { placed, padding: [34, 16] }, glass: true })
      return { shapes: [pill], texts: [placed.overlay] }
    },
  })
}
