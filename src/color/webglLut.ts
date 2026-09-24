/**
 * The WebGL2 half of preview/export parity (docs/EDITING.md "Color: adjustment layers"): draws a
 * video or image source through the same baked 3D LUT (`bakeGrade`/`composeLuts`, `src/color/bake.ts`)
 * the FFmpeg `lut3d` filter applies on export, trilinearly sampled on both sides so the two read
 * identical data the same way. One `LutRenderer` owns one `<canvas>`'s GL context — `GradedVideo.tsx`
 * creates and disposes one per graded picture layer.
 */

import type { Cube3D } from './cube'

const VERTEX_SRC = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`

// The LUT lookup remaps a domain value `v` (0..1) to the texel-center-aligned coordinate for a
// `size`^3 lattice — `(v * (size - 1) + 0.5) / size` — so hardware trilinear filtering interpolates
// between the same lattice points `sampleLut` (bake.ts) does, not one texel off from them.
const FRAGMENT_SRC = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform mediump sampler3D uLut;
uniform float uLutSize;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 src = texture(uSource, vec2(vUv.x, 1.0 - vUv.y));
  vec3 coord = (clamp(src.rgb, 0.0, 1.0) * (uLutSize - 1.0) + 0.5) / uLutSize;
  outColor = vec4(texture(uLut, coord).rgb, src.a);
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not create a WebGL shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Color preview shader failed to compile: ${log ?? 'unknown error'}`)
  }
  return shader
}

/**
 * IEEE-754 binary32 → binary16, for uploading a baked LUT (`Float32Array`, always within [0, 1]) as
 * a `HALF_FLOAT` 3D texture. WebGL2 core filters `HALF_FLOAT` textures linearly without an extension;
 * `FLOAT` needs `OES_texture_float_linear`, which is not guaranteed on every GPU this app ships to —
 * `HALF_FLOAT` keeps trilinear LUT sampling portable. (Public-domain bit-twiddling; see Fabian
 * Giesen's `float_to_half_fast3`, the same algorithm three.js's `DataUtils.toHalfFloat` uses.)
 */
export function float32ToHalfFloat(value: number): number {
  floatScratch[0] = value
  const x = int32Scratch[0]
  const sign = (x >> 16) & 0x8000
  let mantissa = (x >> 12) & 0x07ff
  const exponent = (x >> 23) & 0xff
  if (exponent < 103) return sign
  if (exponent > 142) return sign | 0x7c00
  if (exponent < 113) {
    mantissa |= 0x0800
    return sign | ((mantissa >> (114 - exponent)) + ((mantissa >> (113 - exponent)) & 1))
  }
  let bits = sign | ((exponent - 112) << 10) | (mantissa >> 1)
  bits += mantissa & 1
  return bits
}
const floatScratch = new Float32Array(1)
const int32Scratch = new Int32Array(floatScratch.buffer)

/** `Cube3D.data` (RGB float32 triples) as `Uint16Array` RGBA half-floats, alpha forced to 1 — the
 * shape `texImage3D(..., RGBA16F, ...)` wants. */
function lutToHalfFloatRgba(cube: Cube3D): Uint16Array {
  const count = cube.size ** 3
  const out = new Uint16Array(count * 4)
  const one = float32ToHalfFloat(1)
  for (let i = 0; i < count; i++) {
    out[i * 4] = float32ToHalfFloat(cube.data[i * 3])
    out[i * 4 + 1] = float32ToHalfFloat(cube.data[i * 3 + 1])
    out[i * 4 + 2] = float32ToHalfFloat(cube.data[i * 3 + 2])
    out[i * 4 + 3] = one
  }
  return out
}

export type LutSource = TexImageSource

/**
 * Owns one canvas's WebGL2 context, program and textures. `uploadLut` re-uploads only when the
 * cube's identity changes (`GradedVideo` passes the same `Cube3D` reference while a grade stays
 * unchanged), and `draw` re-uploads the source texture every call — the cost of a fresh video frame.
 * `dispose` releases every GL resource; call it once, when the canvas unmounts.
 */
export class LutRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly sourceTexture: WebGLTexture
  private readonly lutTexture: WebGLTexture
  private readonly vao: WebGLVertexArrayObject
  private uploadedLut: Cube3D | null = null
  private lutSize = 0

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC)
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC)
    const program = gl.createProgram()
    if (!program) throw new Error('Could not create a WebGL program')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program)
      gl.deleteProgram(program)
      throw new Error(`Color preview program failed to link: ${log ?? 'unknown error'}`)
    }
    this.program = program

    const vao = gl.createVertexArray()
    const buffer = gl.createBuffer()
    if (!vao || !buffer) throw new Error('Could not create WebGL buffers')
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'aPosition')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.vao = vao

    const sourceTexture = gl.createTexture()
    const lutTexture = gl.createTexture()
    if (!sourceTexture || !lutTexture) throw new Error('Could not create WebGL textures')
    this.sourceTexture = sourceTexture
    this.lutTexture = lutTexture
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_3D, lutTexture)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
  }

  /** Re-uploads the LUT texture only when `cube` is a new object — cheap to call every draw. */
  uploadLut(cube: Cube3D): void {
    if (this.uploadedLut === cube) return
    const { gl } = this
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, cube.size, cube.size, cube.size, 0, gl.RGBA, gl.HALF_FLOAT, lutToHalfFloatRgba(cube))
    this.uploadedLut = cube
    this.lutSize = cube.size
  }

  /** Uploads `source` as the current frame and draws it through the already-uploaded LUT. `width`/
   * `height` size the canvas's drawing buffer (its intrinsic size, for `object-fit` to scale from). */
  draw(source: LutSource, width: number, height: number): void {
    const { gl } = this
    const canvas = gl.canvas as HTMLCanvasElement
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    gl.viewport(0, 0, width, height)
    gl.useProgram(this.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture)
    gl.uniform1i(gl.getUniformLocation(this.program, 'uSource'), 0)
    gl.uniform1i(gl.getUniformLocation(this.program, 'uLut'), 1)
    gl.uniform1f(gl.getUniformLocation(this.program, 'uLutSize'), this.lutSize)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    const { gl } = this
    const canvas = gl.canvas as HTMLCanvasElement
    gl.deleteTexture(this.sourceTexture)
    gl.deleteTexture(this.lutTexture)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
    // Free the context once the canvas is really gone: grade on/off switches remount a canvas each
    // time, and Chromium caps live WebGL contexts (~16), evicting the oldest. Losing it synchronously
    // would break a same-canvas re-create (StrictMode's mount → cleanup → mount hands back the lost
    // context), so wait a tick and skip if the canvas is still attached.
    setTimeout(() => { if (!canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext() }, 0)
  }
}
