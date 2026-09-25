import type { BubbleTail, Shape, TextOverlay } from './edit'
import type { FitPadding } from './fitToText'
import {
  POP_TEXT, bubbleGeometry, boxOf, draw, ellipseGeometry, getTemplate, listTemplates, placeAndFit, rectAround, rectGeometry,
  registerTemplate, templateShape, templateTextStyle, type Point, type TemplateBuilder, type TemplateCategory, type TemplateText,
} from './overlayTemplates'
import './overlayTemplateCards'

/**
 * The built-in overlay templates: Chat & messaging, Callouts & speech, Social / UI cards (`overlayTemplateCards.ts`) and Labels & lower thirds. Each builder is pure and places
 * every member from measured text sizes, so Malayalam and English text both fit as the shared layout paints them.
 * Sample copy is English; editing a title refits its box (`fitTo`). Importing this file registers the templates.
 */
export { getTemplate, listTemplates }

export const TEMPLATE_CATEGORIES: readonly { id: TemplateCategory; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'callouts', label: 'Callouts' },
  { id: 'cards', label: 'Cards' },
  { id: 'labels', label: 'Labels' },
]

const IOS_BLUE = '#0A84FF', IOS_GREY = '#E9E9EB', INK = '#111111', WHITE = '#FFFFFF'

const tail = (side: BubbleTail['side'], offset: number, width = 34, length = 24, curve = 0.5): BubbleTail => ({ side, offset, width, length, curve })

type BubbleSpec = {
  id: string; name: string; description: string; category: TemplateCategory
  text: string; textColor: string; fill: string; stroke?: { color: string; width: number }
  tail: BubbleTail; fontSize?: number; weight?: number; radius?: number; padding?: FitPadding
}

/** One bubble around one title: the common shape of the iMessage and speech-bubble templates. */
function bubbleTemplate(spec: BubbleSpec): TemplateBuilder {
  const text: TemplateText = { key: 'text', text: spec.text, style: templateTextStyle(spec.fontSize ?? 44, spec.textColor, { fontWeight: spec.weight ?? 400 }) }
  return {
    id: spec.id, name: spec.name, description: spec.description, category: spec.category, supportsGlass: true,
    memberKeys: ['bubble', 'text'], texts: [text],
    build(input) {
      const placed = placeAndFit(text, input.ids.text, input, { enter: POP_TEXT })
      const bubble = templateShape(input, { key: 'bubble', name: 'Bubble', geometry: bubbleGeometry(rectAround(placed.center, 1, 1), spec.radius ?? 44, spec.tail),
        fill: { color: spec.fill }, stroke: spec.stroke ?? null, fit: { placed, padding: spec.padding ?? [34, 22] }, glass: true })
      return { shapes: [bubble], texts: [placed.overlay] }
    },
  }
}

// ---- Chat & messaging -------------------------------------------------------------------------------------------

registerTemplate(bubbleTemplate({ id: 'imessage-sent', name: 'iMessage sent', description: 'A blue outgoing message bubble with its tail at the bottom right.', category: 'chat',
  text: 'Hey! Are we still on for tonight?', textColor: WHITE, fill: IOS_BLUE, tail: tail('bottom', 0.94, 34, 22) }))

registerTemplate(bubbleTemplate({ id: 'imessage-received', name: 'iMessage received', description: 'A grey incoming message bubble with its tail at the bottom left.', category: 'chat',
  text: 'Yes! See you at 8', textColor: INK, fill: IOS_GREY, tail: tail('bottom', 0.06, 34, 22) }))

/** Two overlapping check marks, `s` times a 15 x 12 box, from `origin` (its top left). */
const checkPoints = (origin: Point, s: number) => [
  { x: origin.x, y: origin.y + 6.5 * s }, { x: origin.x + 4.5 * s, y: origin.y + 11 * s }, { x: origin.x + 12.5 * s, y: origin.y + 1 * s },
].map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }))

{
  const body: TemplateText = { key: 'body', text: 'Reached home safely', style: templateTextStyle(42, INK, { fontWeight: 400 }) }
  const time: TemplateText = { key: 'time', text: '12:41', style: templateTextStyle(24, '#667781', { fontWeight: 400, maxLines: 1 }) }
  registerTemplate({
    id: 'whatsapp-bubble', name: 'WhatsApp bubble', description: 'A green outgoing bubble with a timestamp and double tick.', category: 'chat', supportsGlass: true,
    memberKeys: ['bubble', 'body', 'time', 'tick1', 'tick2'], texts: [body, time],
    build(input) {
      const placed = placeAndFit(body, input.ids.body, input, { enter: POP_TEXT })
      const bubble = templateShape(input, { key: 'bubble', name: 'Bubble', geometry: bubbleGeometry(rectAround(placed.center, 1, 1), 28, tail('top', 0.97, 26, 18, 0.4)),
        fill: { color: '#D9FDD3' }, fit: { placed, padding: [32, 38] }, glass: true })
      const r = boxOf(bubble)
      const tickX = r.x + r.width - 30 - 21, rowY = r.y + r.height - 22
      const stamp = placeAndFit(time, input.ids.time, input, { center: { x: tickX - 8 - input.measured.time.width / 2, y: rowY }, delayMs: 250, enter: POP_TEXT })
      const tick = (key: string, dx: number) => templateShape(input, { key, name: 'Tick', delayMs: 400, layerOrder: 2,
        geometry: { kind: 'path', points: checkPoints({ x: tickX + dx, y: rowY - 7 }, 1.2), closed: false }, stroke: { color: '#53BDEB', width: 3 } })
      return { shapes: [bubble, tick('tick1', 0), tick('tick2', 6)], texts: [placed.overlay, stamp.overlay] }
    },
  })
}

registerTemplate({
  id: 'typing-indicator', name: 'Typing indicator', description: 'A grey pill with three dots that pop in one after another.', category: 'chat', supportsGlass: true,
  memberKeys: ['pill', 'dot1', 'dot2', 'dot3'], texts: [],
  build(input) {
    const pill = templateShape(input, { key: 'pill', name: 'Pill', geometry: bubbleGeometry(rectAround(input.at, 176, 84), 42, tail('bottom', 0.08, 30, 18)),
      fill: { color: IOS_GREY }, glass: true })
    const dot = (key: string, dx: number, delayMs: number) => templateShape(input, { key, name: 'Dot', delayMs, layerOrder: 2,
      geometry: ellipseGeometry(rectAround({ x: input.at.x + dx, y: input.at.y }, 22, 22)), fill: { color: '#8E8E93' } })
    return { shapes: [pill, dot('dot1', -38, 300), dot('dot2', 0, 450), dot('dot3', 38, 600)], texts: [] }
  },
})

{
  const lines = [
    { side: 'left', text: 'Are you free tonight?', fill: IOS_GREY, color: INK },
    { side: 'right', text: 'Yes! What time?', fill: IOS_BLUE, color: WHITE },
    { side: 'left', text: 'Around 8 at the usual place', fill: IOS_GREY, color: INK },
  ] as const
  const texts: TemplateText[] = lines.map((line, i) => ({ key: `t${i + 1}`, text: line.text, style: templateTextStyle(42, line.color, { fontWeight: 400 }) }))
  const PAD_X = 34, PAD_Y = 22, GAP = 34, MARGIN = 70, STAGGER_MS = 600
  registerTemplate({
    id: 'chat-thread', name: 'Chat thread', description: 'Three alternating bubbles that arrive 0.6 s apart.', category: 'chat', supportsGlass: true,
    memberKeys: lines.flatMap((_, i) => [`b${i + 1}`, `t${i + 1}`]), texts,
    build(input) {
      const sizes = texts.map((text) => { const block = input.measured[text.key]; return { w: block.width + PAD_X * 2, h: block.height + PAD_Y * 2 } })
      const total = sizes.reduce((sum, size) => sum + size.h, 0) + GAP * (sizes.length - 1)
      let top = input.at.y - total / 2
      const shapes: Shape[] = [], overlays: TextOverlay[] = []
      for (const [i, line] of lines.entries()) {
        const { w, h } = sizes[i]
        const center = { x: line.side === 'left' ? MARGIN + w / 2 : input.composition.width - MARGIN - w / 2, y: top + h / 2 }
        top += h + GAP
        const delayMs = i * STAGGER_MS
        const placed = placeAndFit(texts[i], input.ids[`t${i + 1}`], input, { center, delayMs, enter: POP_TEXT })
        shapes.push(templateShape(input, { key: `b${i + 1}`, name: `Bubble ${i + 1}`, delayMs,
          geometry: bubbleGeometry(rectAround(placed.center, 1, 1), 40, tail('bottom', line.side === 'left' ? 0.08 : 0.92, 30, 20)),
          fill: { color: line.fill }, fit: { placed, padding: [PAD_X, PAD_Y] }, glass: true }))
        overlays.push(placed.overlay)
      }
      return { shapes, texts: overlays }
    },
  })
}

{
  const name: TemplateText = { key: 'name', text: 'Maya', style: templateTextStyle(34, INK, { fontWeight: 700, maxLines: 1, alignment: 'left' }) }
  const message: TemplateText = { key: 'message', text: 'Just watched your video. Loved it!', style: templateTextStyle(30, '#3C3C43', { fontWeight: 400, maxLines: 2, alignment: 'left' }) }
  const HEIGHT = 140, AVATAR = 88, INSET = 26
  registerTemplate({
    id: 'dm-notification', name: 'DM notification', description: 'A rounded banner with an avatar, a name and a message.', category: 'chat', supportsGlass: true,
    memberKeys: ['banner', 'avatar', 'name', 'message'], texts: [name, message],
    build(input) {
      const nameBlock = input.measured.name, messageBlock = input.measured.message
      const textWidth = Math.max(nameBlock.width, messageBlock.width)
      const width = INSET + AVATAR + 22 + textWidth + INSET + 6
      const banner = templateShape(input, { key: 'banner', name: 'Banner', geometry: rectGeometry(rectAround(input.at, width, HEIGHT), 42),
        fill: { color: WHITE, opacity: 0.96 }, glass: true })
      const r = boxOf(banner)
      const avatar = templateShape(input, { key: 'avatar', name: 'Avatar', delayMs: 120, layerOrder: 2,
        geometry: ellipseGeometry(rectAround({ x: r.x + INSET + AVATAR / 2, y: r.y + r.height / 2 }, AVATAR, AVATAR)), fill: { color: '#7C6CF0' } })
      const left = r.x + INSET + AVATAR + 22
      const nameText = placeAndFit(name, input.ids.name, input, { center: { x: left + nameBlock.width / 2, y: r.y + r.height / 2 - nameBlock.height / 2 + 2 }, delayMs: 160 })
      const messageText = placeAndFit(message, input.ids.message, input, { center: { x: left + messageBlock.width / 2, y: r.y + r.height / 2 + messageBlock.height / 2 - 2 }, delayMs: 220 })
      return { shapes: [banner, avatar], texts: [nameText.overlay, messageText.overlay] }
    },
  })
}

// ---- Callouts & speech ------------------------------------------------------------------------------------------

registerTemplate(bubbleTemplate({ id: 'speech-bubble', name: 'Speech bubble', description: 'A white bubble with dark text and a tail pointing down to the speaker.', category: 'callouts',
  text: 'Wait, really?', textColor: INK, fill: WHITE, tail: tail('bottom', 0.2, 44, 36), fontSize: 46, weight: 600, radius: 40, padding: [36, 24] }))

{
  const text: TemplateText = { key: 'text', text: 'Hmm, what if…', style: templateTextStyle(46, INK, { fontWeight: 600, maxLines: 2 }) }
  registerTemplate({
    id: 'thought-bubble', name: 'Thought bubble', description: 'An oval cloud with two shrinking circles leading to the thinker.', category: 'callouts', supportsGlass: true,
    memberKeys: ['cloud', 'text', 'dot1', 'dot2'], texts: [text],
    build(input) {
      const placed = placeAndFit(text, input.ids.text, input, { enter: POP_TEXT })
      const cloud = templateShape(input, { key: 'cloud', name: 'Cloud', geometry: ellipseGeometry(rectAround(placed.center, 1, 1)), fill: { color: WHITE },
        fit: { placed, padding: [36, 20] }, glass: true })
      const r = boxOf(cloud)
      const dot = (key: string, x: number, y: number, size: number, delayMs: number) => templateShape(input, { key, name: 'Thought dot', delayMs,
        geometry: ellipseGeometry(rectAround({ x, y }, size, size)), fill: { color: WHITE } })
      const bottom = r.y + r.height
      return { shapes: [cloud, dot('dot1', r.x + r.width * 0.2, bottom + 16, 36, 200), dot('dot2', r.x + r.width * 0.12, bottom + 56, 20, 350)], texts: [placed.overlay] }
    },
  })
}

{
  const text: TemplateText = { key: 'text', text: 'Look at this part', style: templateTextStyle(42, INK, { fontWeight: 600, maxLines: 2 }) }
  registerTemplate({
    id: 'callout-box', name: 'Callout box', description: 'A boxed note with a pointer line that draws on and ends in a dot.', category: 'callouts', supportsGlass: true,
    memberKeys: ['box', 'text', 'pointer'], texts: [text],
    build(input) {
      const placed = placeAndFit(text, input.ids.text, input, { enter: POP_TEXT })
      const box = templateShape(input, { key: 'box', name: 'Box', geometry: rectGeometry(rectAround(placed.center, 1, 1), 18), fill: { color: WHITE },
        stroke: { color: INK, width: 4 }, fit: { placed, padding: [32, 20] }, glass: true })
      const r = boxOf(box)
      const from = { x: r.x + r.width * 0.25, y: r.y + r.height }
      const pointer = templateShape(input, { key: 'pointer', name: 'Pointer', delayMs: 300, enter: draw(450), layerOrder: 2, arrowEnd: 'dot',
        geometry: { kind: 'line', from, to: { x: from.x + 120, y: from.y + 130 } }, stroke: { color: INK, width: 5 } })
      return { shapes: [box, pointer], texts: [placed.overlay] }
    },
  })
}

{
  const glyph: TemplateText = { key: 'glyph', text: '“', style: templateTextStyle(120, '#F5B83D', { fontWeight: 800, maxLines: 1 }) }
  const body: TemplateText = { key: 'body', text: 'The details are not the details. They make the design.', style: templateTextStyle(44, WHITE, { fontWeight: 500, maxLines: 4, alignment: 'left' }) }
  const attribution: TemplateText = { key: 'attribution', text: '— Charles Eames', style: templateTextStyle(30, '#A0A4AE', { fontWeight: 500, maxLines: 1, alignment: 'left' }) }
  const PAD: FitPadding = [64, 96]
  registerTemplate({
    id: 'quote-card', name: 'Quote card', description: 'A dark card with a large opening quote mark, the quote and an attribution.', category: 'callouts', supportsGlass: true,
    memberKeys: ['card', 'glyph', 'body', 'attribution'], texts: [glyph, body, attribution],
    build(input) {
      const bodyText = placeAndFit(body, input.ids.body, input, { delayMs: 150 })
      const card = templateShape(input, { key: 'card', name: 'Card', geometry: rectGeometry(rectAround(bodyText.center, 1, 1), 32), fill: { color: '#1C1C22' },
        fit: { placed: bodyText, padding: PAD }, glass: true })
      const r = boxOf(card)
      const left = r.x + PAD[0]
      const glyphBlock = input.measured.glyph, attributionBlock = input.measured.attribution
      const glyphText = placeAndFit(glyph, input.ids.glyph, input, { center: { x: left + glyphBlock.width / 2, y: r.y + 78 }, delayMs: 100 })
      const attributionText = placeAndFit(attribution, input.ids.attribution, input, { center: { x: left + attributionBlock.width / 2, y: r.y + r.height - PAD[1] / 2 }, delayMs: 450 })
      return { shapes: [card], texts: [glyphText.overlay, bodyText.overlay, attributionText.overlay] }
    },
  })
}

{
  const NOTE = '#FFE873', FLAP = '#E8C547', TILT = -3, FOLD = 36
  const text: TemplateText = { key: 'text', text: 'Remember to call Mom', style: templateTextStyle(46, '#3B3A2E', { fontWeight: 600, maxLines: 3, rotation: TILT }) }
  registerTemplate({
    id: 'sticky-note', name: 'Sticky note', description: 'A yellow note tilted three degrees, with a folded bottom corner.', category: 'callouts', supportsGlass: false,
    memberKeys: ['note', 'flap', 'text'], texts: [text],
    build(input) {
      const placed = placeAndFit(text, input.ids.text, input, { enter: POP_TEXT })
      const w = Math.max(320, placed.block.width + 88), h = Math.max(260, placed.block.height + 80)
      const c = placed.center, l = c.x - w / 2, t = c.y - h / 2, r = c.x + w / 2, b = c.y + h / 2
      const radians = TILT * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians)
      // The path geometry has no rotation of its own, so the tilt is baked into its points, about the note's centre.
      const turn = (x: number, y: number) => ({ x: Math.round((c.x + (x - c.x) * cos - (y - c.y) * sin) * 100) / 100, y: Math.round((c.y + (x - c.x) * sin + (y - c.y) * cos) * 100) / 100 })
      const note = templateShape(input, { key: 'note', name: 'Note', geometry: { kind: 'path', closed: true, points: [turn(l, t), turn(r, t), turn(r, b - FOLD), turn(r - FOLD, b), turn(l, b)] },
        fill: { color: NOTE } })
      const flap = templateShape(input, { key: 'flap', name: 'Folded corner', delayMs: 120, layerOrder: 1,
        geometry: { kind: 'path', closed: true, points: [turn(r - FOLD, b), turn(r, b - FOLD), turn(r - FOLD, b - FOLD)] }, fill: { color: FLAP } })
      return { shapes: [note, flap], texts: [placed.overlay] }
    },
  })
}
