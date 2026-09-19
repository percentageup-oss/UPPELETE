import { FONT_FAMILY_CHOICES } from '../captions/style'

export type FontFace = { style: string; postscriptName: string; weight: number; italic: boolean }
export type FontFamilyEntry = { family: string; faces: FontFace[] }
export type FontCatalogReason = 'unsupported' | 'denied' | 'needs-gesture' | 'failed'
export type LocalFontCatalogState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; families: FontFamilyEntry[] }
  | { status: 'unavailable'; reason: FontCatalogReason; families: FontFamilyEntry[] }

const WEIGHT_TOKENS: [RegExp, number][] = [
  [/\bthin\b/, 100], [/\bhairline\b/, 100],
  [/\bextra ?light\b|\bultra ?light\b/, 200],
  [/\blight\b/, 300],
  [/\bregular\b|\bnormal\b|\bbook\b|\broman\b/, 400],
  [/\bmedium\b/, 500],
  [/\bsemi ?bold\b|\bdemi ?bold\b/, 600],
  [/\bextra ?bold\b|\bultra ?bold\b/, 800],
  [/\bblack\b|\bheavy\b|\bultra ?black\b/, 900],
  [/\bbold\b/, 700],
]

/** Maps a face's free-text style string ("Bold Italic", "Semibold", …) to a numeric weight and
 * italic flag. Unknown tokens fall back to regular weight, upright — never guessed beyond that. */
export function parseFaceStyle(style: string): { weight: number; italic: boolean } {
  const lower = style.toLowerCase()
  const italic = /\bitalic\b|\boblique\b/.test(lower)
  for (const [pattern, weight] of WEIGHT_TOKENS) if (pattern.test(lower)) return { weight, italic }
  return { weight: 400, italic }
}

function dedupeFaces(faces: FontFace[]): FontFace[] {
  const seen = new Set<string>()
  const result: FontFace[] = []
  for (const face of faces) {
    const key = `${face.weight}:${face.italic}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(face)
  }
  return result.sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic))
}

/** Groups raw `queryLocalFonts()` results by family, with the fixed offline choices pinned first. */
export function groupLocalFonts(fonts: readonly LocalFontData[]): FontFamilyEntry[] {
  const byFamily = new Map<string, FontFace[]>()
  for (const font of fonts) {
    const { weight, italic } = parseFaceStyle(font.style)
    const list = byFamily.get(font.family) ?? []
    list.push({ style: font.style, postscriptName: font.postscriptName, weight, italic })
    byFamily.set(font.family, list)
  }
  const pinned = FONT_FAMILY_CHOICES.filter((family) => byFamily.has(family))
  const rest = [...byFamily.keys()].filter((family) => !FONT_FAMILY_CHOICES.includes(family as (typeof FONT_FAMILY_CHOICES)[number])).sort((a, b) => a.localeCompare(b))
  return [...pinned, ...rest].map((family) => ({ family, faces: dedupeFaces(byFamily.get(family)!) }))
}

/** Generic Regular/Bold/Italic/Bold Italic faces for the fixed offline font-family choices, used
 * when Local Font Access is unavailable, denied or not yet granted. No face is invented beyond
 * these four standard styles; `font-synthesis: none` means a face the OS doesn't actually have
 * simply renders without a faked bold/italic. */
export function fallbackCatalog(): FontFamilyEntry[] {
  return FONT_FAMILY_CHOICES.map((family) => ({
    family,
    faces: [
      { style: 'Regular', postscriptName: '', weight: 400, italic: false },
      { style: 'Bold', postscriptName: '', weight: 700, italic: false },
      { style: 'Italic', postscriptName: '', weight: 400, italic: true },
      { style: 'Bold Italic', postscriptName: '', weight: 700, italic: true },
    ],
  }))
}

let cached: Promise<LocalFontCatalogState> | null = null

/** Enumerates installed system fonts via Chromium's Local Font Access API. Must be called from a
 * real user gesture (click) — `queryLocalFonts()` requires transient activation and throws
 * `SecurityError` otherwise. Never downloads, bundles or sends font data anywhere; the result is
 * cached for the life of the page since the installed font set does not change mid-session. */
export function loadLocalFontCatalog(): Promise<LocalFontCatalogState> {
  if (cached) return cached
  cached = (async (): Promise<LocalFontCatalogState> => {
    if (typeof window === 'undefined' || !window.queryLocalFonts) return { status: 'unavailable', reason: 'unsupported', families: fallbackCatalog() }
    try {
      const fonts = await window.queryLocalFonts()
      const families = groupLocalFonts(fonts)
      return families.length ? { status: 'ready', families } : { status: 'unavailable', reason: 'failed', families: fallbackCatalog() }
    } catch (error) {
      const reason: FontCatalogReason = error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied'
        : error instanceof DOMException && error.name === 'SecurityError' ? 'needs-gesture' : 'failed'
      return { status: 'unavailable', reason, families: fallbackCatalog() }
    }
  })()
  return cached
}

/** Test-only: clears the module-level cache so repeated calls re-probe `queryLocalFonts`. */
export function resetLocalFontCatalogCache(): void { cached = null }
