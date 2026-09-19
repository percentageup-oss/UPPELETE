import { afterEach, describe, expect, it, vi } from 'vitest'
import { FONT_FAMILY_CHOICES } from '../captions/style'
import { fallbackCatalog, groupLocalFonts, loadLocalFontCatalog, parseFaceStyle, resetLocalFontCatalogCache } from './localFonts'

describe('parseFaceStyle', () => {
  it('maps common weight/italic tokens', () => {
    expect(parseFaceStyle('Regular')).toEqual({ weight: 400, italic: false })
    expect(parseFaceStyle('Bold')).toEqual({ weight: 700, italic: false })
    expect(parseFaceStyle('Bold Italic')).toEqual({ weight: 700, italic: true })
    expect(parseFaceStyle('Light')).toEqual({ weight: 300, italic: false })
    expect(parseFaceStyle('Semibold')).toEqual({ weight: 600, italic: false })
    expect(parseFaceStyle('ExtraBold')).toEqual({ weight: 800, italic: false })
    expect(parseFaceStyle('Black')).toEqual({ weight: 900, italic: false })
    expect(parseFaceStyle('Oblique')).toEqual({ weight: 400, italic: true })
  })

  it('falls back to regular weight, upright, for unknown tokens', () => {
    expect(parseFaceStyle('Condensed Display')).toEqual({ weight: 400, italic: false })
  })
})

describe('groupLocalFonts', () => {
  it('groups by family, dedupes identical faces and pins the fixed choices first', () => {
    const families = groupLocalFonts([
      { family: 'Custom Sans', fullName: 'Custom Sans', postscriptName: 'CustomSans', style: 'Regular' },
      { family: 'Custom Sans', fullName: 'Custom Sans Bold', postscriptName: 'CustomSans-Bold', style: 'Bold' },
      { family: 'Custom Sans', fullName: 'Custom Sans Bold', postscriptName: 'CustomSans-Bold2', style: 'Bold' },
      { family: 'Arial', fullName: 'Arial', postscriptName: 'Arial', style: 'Regular' },
    ])
    expect(families.map((f) => f.family)).toEqual(['Arial', 'Custom Sans'])
    const custom = families.find((f) => f.family === 'Custom Sans')!
    expect(custom.faces).toHaveLength(2)
    expect(custom.faces.map((f) => f.weight)).toEqual([400, 700])
  })
})

describe('fallbackCatalog', () => {
  it('offers the fixed choices with four generic faces each', () => {
    const families = fallbackCatalog()
    expect(families.map((f) => f.family)).toEqual([...FONT_FAMILY_CHOICES])
    expect(families.some((family) => family.family === 'Anek Malayalam')).toBe(true)
    for (const family of families) expect(family.faces).toHaveLength(4)
  })
})

describe('loadLocalFontCatalog', () => {
  afterEach(() => { resetLocalFontCatalogCache(); vi.unstubAllGlobals() })

  it('reports unavailable/unsupported and offers the fallback when the API does not exist', async () => {
    vi.stubGlobal('window', {})
    const state = await loadLocalFontCatalog()
    expect(state).toEqual({ status: 'unavailable', reason: 'unsupported', families: fallbackCatalog() })
  })

  it('reports needs-gesture without a transient user activation', async () => {
    vi.stubGlobal('window', { queryLocalFonts: () => Promise.reject(new DOMException('requires activation', 'SecurityError')) })
    const state = await loadLocalFontCatalog()
    expect(state.status).toBe('unavailable')
    expect(state.status === 'unavailable' && state.reason).toBe('needs-gesture')
  })

  it('reports denied when the user declines the permission', async () => {
    vi.stubGlobal('window', { queryLocalFonts: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) })
    const state = await loadLocalFontCatalog()
    expect(state.status).toBe('unavailable')
    expect(state.status === 'unavailable' && state.reason).toBe('denied')
  })

  it('groups real results into a ready catalog', async () => {
    vi.stubGlobal('window', { queryLocalFonts: () => Promise.resolve([
      { family: 'Noto Sans Malayalam', fullName: 'Noto Sans Malayalam', postscriptName: 'NotoSansMalayalam', style: 'Regular' },
    ]) })
    const state = await loadLocalFontCatalog()
    expect(state.status).toBe('ready')
    expect(state.status === 'ready' && state.families[0].family).toBe('Noto Sans Malayalam')
  })

  it('caches the result across calls', async () => {
    const queryLocalFonts = vi.fn(() => Promise.resolve([]))
    vi.stubGlobal('window', { queryLocalFonts })
    await loadLocalFontCatalog()
    await loadLocalFontCatalog()
    expect(queryLocalFonts).toHaveBeenCalledTimes(1)
  })
})
