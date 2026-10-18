import type { CompiledGhosttyShader } from 'ghostty-web-shaderc'
import { FULLSCREEN_VERTEX_GLSL } from 'ghostty-web-shaderc/runtime'
import { height, inputPixels, width } from './cases.js'

function requireResource<T>(resource: T | null, description: string): T {
  if (resource === null) throw new Error(`WebGL could not create ${description}`)
  return resource
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = requireResource(gl.createShader(type), 'shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  const error = gl.getShaderInfoLog(shader)
  gl.deleteShader(shader)
  throw new Error(`WebGL compile: ${error}\n${source}`)
}

export class WebGlRenderer {
  readonly #gl: WebGL2RenderingContext
  readonly #vertex: WebGLShader
  readonly #input: WebGLTexture
  readonly #uniforms: WebGLBuffer
  readonly #vao: WebGLVertexArrayObject

  constructor() {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    this.#gl = requireResource(
      canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      }),
      'WebGL2 context',
    )
    const gl = this.#gl
    this.#vertex = compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX_GLSL)
    this.#input = requireResource(gl.createTexture(), 'input texture')
    this.#uniforms = requireResource(gl.createBuffer(), 'uniform buffer')
    this.#vao = requireResource(gl.createVertexArray(), 'vertex array')
    gl.bindVertexArray(this.#vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.#input)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      inputPixels,
    )
    gl.disable(gl.DITHER)
    gl.disable(gl.BLEND)
  }

  draw(shader: CompiledGhosttyShader, uniforms: ArrayBuffer): Uint8Array {
    const gl = this.#gl
    const fragment = compile(gl, gl.FRAGMENT_SHADER, shader.glsl)
    const program = requireResource(gl.createProgram(), 'program')
    try {
      gl.attachShader(program, this.#vertex)
      gl.attachShader(program, fragment)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(`WebGL link: ${gl.getProgramInfoLog(program)}`)
      gl.useProgram(program)
      this.#bindUniforms(program, shader, uniforms)
      gl.viewport(0, 0, width, height)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      const pixels = new Uint8Array(width * height * 4)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      const error = gl.getError()
      if (error !== gl.NO_ERROR) throw new Error(`WebGL error 0x${error.toString(16)}`)
      return pixels
    } finally {
      gl.deleteProgram(program)
      gl.deleteShader(fragment)
    }
  }

  #bindUniforms(program: WebGLProgram, shader: CompiledGhosttyShader, uniforms: ArrayBuffer): void {
    const gl = this.#gl
    if (shader.webgl.channel0 !== null)
      gl.uniform1i(gl.getUniformLocation(program, shader.webgl.channel0), 0)
    if (shader.webgl.uniformBlock === null) return
    const block = gl.getUniformBlockIndex(program, shader.webgl.uniformBlock)
    if (block === gl.INVALID_INDEX)
      throw new Error(`Uniform block ${shader.webgl.uniformBlock} was not linked`)
    gl.uniformBlockBinding(program, block, 0)
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.#uniforms)
    gl.bufferData(gl.UNIFORM_BUFFER, uniforms, gl.DYNAMIC_DRAW)
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.#uniforms)
  }

  dispose(): void {
    const gl = this.#gl
    gl.deleteShader(this.#vertex)
    gl.deleteTexture(this.#input)
    gl.deleteBuffer(this.#uniforms)
    gl.deleteVertexArray(this.#vao)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
