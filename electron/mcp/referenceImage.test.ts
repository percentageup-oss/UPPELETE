import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { assertReferencePath, assertReferenceSize, MAX_REFERENCE_BYTES, referenceMimeForPath } from './referenceImage'

describe('reference image rules', () => {
  it('maps image extensions to mime types case-insensitively', () => {
    expect(referenceMimeForPath('/a/Look.JPG')).toBe('image/jpeg')
    expect(referenceMimeForPath('/a/look.webp')).toBe('image/webp')
    expect(referenceMimeForPath('/a/notes.txt')).toBeNull()
  })

  it('rejects relative paths and non-image files', () => {
    expect(() => assertReferencePath('look.png')).toThrow(/absolute/)
    expect(() => assertReferencePath(path.resolve('secrets.json'))).toThrow(/image/)
    expect(assertReferencePath(path.resolve('look.png'))).toBe('image/png')
  })

  it('rejects empty and oversized files', () => {
    expect(() => assertReferenceSize(0)).toThrow(/empty/)
    expect(() => assertReferenceSize(MAX_REFERENCE_BYTES + 1)).toThrow(/larger/)
    expect(() => assertReferenceSize(1024)).not.toThrow()
  })
})
