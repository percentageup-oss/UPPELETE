import { describe, expect, it } from 'vitest'
import { cubeIndex, parseCube, writeCube, type Cube3D } from './cube'

function identityCube(size: number): Cube3D {
  const data = new Float32Array(size ** 3 * 3)
  const step = 1 / (size - 1)
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const i = cubeIndex(size, r, g, b)
    data[i] = r * step; data[i + 1] = g * step; data[i + 2] = b * step
  }
  return { size, title: 'Identity', domainMin: [0, 0, 0], domainMax: [1, 1, 1], data }
}

describe('.cube round trip', () => {
  it('writes and re-parses an identity LUT unchanged', () => {
    const cube = identityCube(4)
    const parsed = parseCube(writeCube(cube))
    expect(parsed.size).toBe(4)
    expect(parsed.title).toBe('Identity')
    expect(parsed.domainMin).toEqual([0, 0, 0])
    expect(parsed.domainMax).toEqual([1, 1, 1])
    for (let i = 0; i < cube.data.length; i++) expect(parsed.data[i]).toBeCloseTo(cube.data[i], 5)
  })

  it('parses comments, blank lines and an unrecognised keyword without failing', () => {
    const text = ['# a comment', 'TITLE "My LUT"', '', 'LUT_3D_SIZE 2', 'SOME_VENDOR_KEY 1', ...Array(8).fill('0.0 0.0 0.0')].join('\n')
    const cube = parseCube(text)
    expect(cube.size).toBe(2)
    expect(cube.title).toBe('My LUT')
  })

  it('rejects a 1D LUT', () => {
    expect(() => parseCube('LUT_1D_SIZE 4\n0 0 0\n1 1 1\n')).toThrow(/1D/)
  })

  it('rejects a size outside [2, 65]', () => {
    expect(() => parseCube('LUT_3D_SIZE 1\n0 0 0\n')).toThrow(/LUT_3D_SIZE/)
    expect(() => parseCube('LUT_3D_SIZE 66\n')).toThrow(/LUT_3D_SIZE/)
  })

  it('rejects a row count that does not match size^3', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n1 1 1\n')).toThrow(/data rows/)
  })

  it('rejects a file with no LUT_3D_SIZE at all', () => {
    expect(() => parseCube('0 0 0\n1 1 1\n')).toThrow(/LUT_3D_SIZE/)
  })
})

describe('cubeIndex', () => {
  it('is red-fastest: consecutive r values are 3 floats apart', () => {
    expect(cubeIndex(4, 1, 0, 0) - cubeIndex(4, 0, 0, 0)).toBe(3)
    expect(cubeIndex(4, 0, 1, 0) - cubeIndex(4, 0, 0, 0)).toBe(4 * 3)
    expect(cubeIndex(4, 0, 0, 1) - cubeIndex(4, 0, 0, 0)).toBe(4 * 4 * 3)
  })
})
