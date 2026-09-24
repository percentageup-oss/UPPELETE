/**
 * Parse and write the Adobe `.cube` LUT format (the de facto interchange format FFmpeg's `lut3d`
 * filter and every color tool read), restricted to the 3D case this app needs — see `bake.ts`. A 1D
 * `.cube` (`LUT_1D_SIZE`) is rejected with a clear error rather than silently misread as 3D.
 */

export type Cube3D = {
  size: number
  title: string
  /** [min, min, min] and [max, max, max] the lattice's domain maps to; almost always [0,0,0]/[1,1,1]. */
  domainMin: readonly [number, number, number]
  domainMax: readonly [number, number, number]
  /** Flattened RGB triples, red fastest — index of (r, g, b) is `(b * size + g) * size + r`, times 3. */
  data: Float32Array
}

const MIN_SIZE = 2
const MAX_SIZE = 65

export function cubeIndex(size: number, r: number, g: number, b: number): number {
  return ((b * size + g) * size + r) * 3
}

/** Throws on a 1D LUT, a missing/out-of-range size, or a row count that doesn't match `size^3`. */
export function parseCube(text: string): Cube3D {
  let size: number | null = null
  let title = ''
  let domainMin: [number, number, number] = [0, 0, 0]
  let domainMax: [number, number, number] = [1, 1, 1]
  const rows: number[][] = []

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('TITLE')) { title = line.slice(5).trim().replace(/^"|"$/g, ''); continue }
    if (line.startsWith('LUT_1D_SIZE')) throw new Error('1D .cube LUTs are not supported — only 3D LUTs.')
    if (line.startsWith('LUT_3D_SIZE')) { size = Number(line.slice('LUT_3D_SIZE'.length).trim()); continue }
    if (line.startsWith('DOMAIN_MIN')) { domainMin = parseTriple(line.slice('DOMAIN_MIN'.length)); continue }
    if (line.startsWith('DOMAIN_MAX')) { domainMax = parseTriple(line.slice('DOMAIN_MAX'.length)); continue }
    const row = line.split(/\s+/).map(Number)
    if (row.length === 3 && row.every(Number.isFinite)) rows.push(row)
    // Any other keyword (e.g. an unknown vendor extension) is ignored rather than rejected.
  }

  if (size === null || !Number.isInteger(size)) throw new Error('.cube file has no LUT_3D_SIZE.')
  if (size < MIN_SIZE || size > MAX_SIZE) throw new Error(`.cube LUT_3D_SIZE must be between ${MIN_SIZE} and ${MAX_SIZE} (got ${size}).`)
  const expected = size ** 3
  if (rows.length !== expected) throw new Error(`.cube file has ${rows.length} data rows, expected ${expected} (size ${size}).`)

  const data = new Float32Array(expected * 3)
  for (let i = 0; i < expected; i++) { data[i * 3] = rows[i][0]; data[i * 3 + 1] = rows[i][1]; data[i * 3 + 2] = rows[i][2] }
  return { size, title, domainMin, domainMax, data }
}

function parseTriple(text: string): [number, number, number] {
  const parts = text.trim().split(/\s+/).map(Number)
  if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) throw new Error(`Malformed .cube domain line: "${text.trim()}"`)
  return [parts[0], parts[1], parts[2]]
}

export function writeCube(cube: Cube3D): string {
  const lines: string[] = []
  if (cube.title) lines.push(`TITLE "${cube.title}"`)
  lines.push(`LUT_3D_SIZE ${cube.size}`)
  lines.push(`DOMAIN_MIN ${cube.domainMin.join(' ')}`)
  lines.push(`DOMAIN_MAX ${cube.domainMax.join(' ')}`)
  for (let b = 0; b < cube.size; b++) for (let g = 0; g < cube.size; g++) for (let r = 0; r < cube.size; r++) {
    const i = cubeIndex(cube.size, r, g, b)
    lines.push(`${fmt(cube.data[i])} ${fmt(cube.data[i + 1])} ${fmt(cube.data[i + 2])}`)
  }
  return lines.join('\n') + '\n'
}

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(6) : '0.000000'
}

/** Encodes a baked LUT's flattened RGB data as base64 (little-endian float32) — compact transport for
 * the export manifest (`src/export/plan.ts`); the export worker turns it back into an actual `.cube`
 * text file (`writeCube`) since that is the only format FFmpeg's `lut3d` filter reads. Every platform
 * this app ships on (x86-64/ARM64 macOS and Windows) is little-endian, so `Float32Array`'s native byte
 * order needs no explicit `DataView` handling here. */
export function encodeCubeData(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/** The inverse of `encodeCubeData`. `length` is the expected element count (`size ** 3 * 3`). */
export function decodeCubeData(base64: string, length: number): Float32Array {
  const binary = atob(base64)
  if (binary.length !== length * 4) throw new Error('LUT data length does not match its declared size.')
  const bytes = new Uint8Array(length * 4)
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}
