import type { CompiledGhosttyShader } from 'ghostty-web-shaderc'
import {
  FULLSCREEN_VERTEX_GLSL,
  FULLSCREEN_VERTEX_WGSL,
  SHADER_UNIFORM_BYTE_LENGTH,
} from 'ghostty-web-shaderc/runtime'

export interface ShaderPass {
  readonly backend: 'webgpu' | 'webgl2'
  capture(source: HTMLCanvasElement): void
  draw(uniforms: ArrayBuffer, effectEnabled: boolean): void
  setShader(shader: CompiledGhosttyShader): Promise<void>
  dispose(): void
}

const COPY_FRAGMENT_WGSL = `@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;
@fragment fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(image, imageSampler, uv);
}`

const COPY_FRAGMENT_GLSL = `#version 300 es
precision highp float;
in vec2 _vs2fs_location0;
uniform sampler2D sourceImage;
out vec4 color;
void main() { color = texture(sourceImage, _vs2fs_location0); }
`

function requireResource<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`Could not create ${name}`)
  return value
}

function shaderLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', minBindingSize: SHADER_UNIFORM_BYTE_LENGTH },
      },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  })
}

interface GpuTextures {
  raw: GPUTexture
  canonical: GPUTexture
  flip: GPUBindGroup
  copy: GPUBindGroup
  shader: GPUBindGroup
  width: number
  height: number
}

export class WebGpuShaderPass implements ShaderPass {
  readonly backend = 'webgpu'
  readonly #canvas: HTMLCanvasElement
  readonly #context: GPUCanvasContext
  readonly #device: GPUDevice
  readonly #format: GPUTextureFormat
  readonly #vertex: GPUShaderModule
  readonly #layout: GPUBindGroupLayout
  readonly #uniforms: GPUBuffer
  readonly #sampler: GPUSampler
  readonly #copyPipeline: GPURenderPipeline
  readonly #flipPipeline: GPURenderPipeline
  #shaderPipeline: GPURenderPipeline | undefined
  #textures: GpuTextures | undefined
  #disposed = false

  constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
    this.#device = device
    this.#canvas = canvas
    this.#context = requireResource(canvas.getContext('webgpu'), 'WebGPU output context')
    this.#format = navigator.gpu.getPreferredCanvasFormat()
    this.#context.configure({ device, format: this.#format, alphaMode: 'opaque' })
    this.#layout = shaderLayout(device)
    this.#vertex = device.createShaderModule({ code: FULLSCREEN_VERTEX_WGSL })
    this.#uniforms = device.createBuffer({
      size: SHADER_UNIFORM_BYTE_LENGTH,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    })
    this.#sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.#copyPipeline = this.#copyPipelineFor(this.#format)
    this.#flipPipeline = this.#copyPipelineFor('rgba8unorm')
  }

  async setShader(shader: CompiledGhosttyShader): Promise<void> {
    const device = this.#device
    device.pushErrorScope('validation')
    let pipeline: GPURenderPipeline | undefined
    let failure: unknown
    try {
      const module = device.createShaderModule({ code: shader.wgsl })
      const info = await module.getCompilationInfo()
      const messages = info.messages.filter((message) => message.type === 'error')
      if (messages.length > 0) {
        throw new Error(messages.map((message) => message.message).join('\n'))
      }
      pipeline = await device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.#layout] }),
        vertex: { module: this.#vertex, entryPoint: 'main' },
        fragment: { module, entryPoint: shader.entryPoint, targets: [{ format: this.#format }] },
        primitive: { topology: 'triangle-list' },
      })
    } catch (cause) {
      failure = cause
    }
    const validation = await device.popErrorScope()
    if (failure !== undefined) throw failure
    if (validation) throw new Error(validation.message)
    if (!this.#disposed) this.#shaderPipeline = pipeline
  }

  capture(source: HTMLCanvasElement): void {
    if (this.#disposed || source.width === 0 || source.height === 0) return
    const context = requireResource(source.getContext('webgpu'), 'Ghostty WebGPU source context')
    const textures = this.#texturesFor(source.width, source.height)
    const encoder = this.#device.createCommandEncoder()
    encoder.copyTextureToTexture(
      { texture: context.getCurrentTexture() },
      { texture: textures.raw },
      [source.width, source.height],
    )
    // Ghostty is top-origin; shader channels store the logical bottom row first.
    this.#render(encoder, textures.canonical.createView(), this.#flipPipeline, textures.flip)
    this.#device.queue.submit([encoder.finish()])
  }

  draw(uniforms: ArrayBuffer, effectEnabled: boolean): void {
    if (this.#disposed || !this.#textures) return
    const pipeline = effectEnabled ? this.#shaderPipeline : undefined
    this.#device.queue.writeBuffer(this.#uniforms, 0, uniforms)
    const encoder = this.#device.createCommandEncoder()
    this.#render(
      encoder,
      this.#context.getCurrentTexture().createView(),
      pipeline ?? this.#copyPipeline,
      pipeline ? this.#textures.shader : this.#textures.copy,
    )
    this.#device.queue.submit([encoder.finish()])
  }

  dispose(): void {
    this.#disposed = true
    this.#textures?.raw.destroy()
    this.#textures?.canonical.destroy()
    this.#uniforms.destroy()
    this.#context.unconfigure()
  }

  #copyPipelineFor(format: GPUTextureFormat): GPURenderPipeline {
    return this.#device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: this.#vertex, entryPoint: 'main' },
      fragment: {
        module: this.#device.createShaderModule({ code: COPY_FRAGMENT_WGSL }),
        entryPoint: 'main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  #copyBindings(pipeline: GPURenderPipeline, texture: GPUTexture): GPUBindGroup {
    return this.#device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: this.#sampler },
      ],
    })
  }

  #texturesFor(width: number, height: number): GpuTextures {
    if (this.#textures?.width === width && this.#textures.height === height) return this.#textures
    this.#textures?.raw.destroy()
    this.#textures?.canonical.destroy()
    this.#canvas.width = width
    this.#canvas.height = height
    const raw = this.#device.createTexture({
      size: [width, height],
      format: this.#format,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    })
    const canonical = this.#device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    this.#textures = {
      raw,
      canonical,
      width,
      height,
      flip: this.#copyBindings(this.#flipPipeline, raw),
      copy: this.#copyBindings(this.#copyPipeline, canonical),
      shader: this.#device.createBindGroup({
        layout: this.#layout,
        entries: [
          { binding: 0, resource: { buffer: this.#uniforms } },
          { binding: 1, resource: canonical.createView() },
          { binding: 2, resource: this.#sampler },
        ],
      }),
    }
    return this.#textures
  }

  #render(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    pipeline: GPURenderPipeline,
    bindings: GPUBindGroup,
  ): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindings)
    pass.draw(3)
    pass.end()
  }
}

function compileGlShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = requireResource(gl.createShader(type), 'WebGL shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  const message = gl.getShaderInfoLog(shader)
  gl.deleteShader(shader)
  throw new Error(`WebGL shader compilation failed: ${message}`)
}

export class WebGlShaderPass implements ShaderPass {
  readonly backend = 'webgl2'
  readonly #canvas: HTMLCanvasElement
  readonly #gl: WebGL2RenderingContext
  readonly #vertex: WebGLShader
  readonly #texture: WebGLTexture
  readonly #uniforms: WebGLBuffer
  readonly #vao: WebGLVertexArrayObject
  readonly #copy: WebGLProgram
  #shader: { program: WebGLProgram; metadata: CompiledGhosttyShader } | undefined
  #hasSource = false
  #disposed = false

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas
    this.#gl = requireResource(
      canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false }),
      'WebGL2 output context',
    )
    const gl = this.#gl
    this.#vertex = compileGlShader(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX_GLSL)
    this.#texture = requireResource(gl.createTexture(), 'WebGL input texture')
    this.#uniforms = requireResource(gl.createBuffer(), 'WebGL uniform buffer')
    this.#vao = requireResource(gl.createVertexArray(), 'WebGL vertex array')
    this.#copy = this.#program(COPY_FRAGMENT_GLSL)
    gl.bindTexture(gl.TEXTURE_2D, this.#texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.disable(gl.DITHER)
    gl.disable(gl.BLEND)
  }

  async setShader(shader: CompiledGhosttyShader): Promise<void> {
    if (this.#disposed) return
    const program = this.#program(shader.glsl)
    this.#gl.deleteProgram(this.#shader?.program ?? null)
    this.#shader = { program, metadata: shader }
  }

  capture(source: HTMLCanvasElement): void {
    if (this.#disposed || source.width === 0 || source.height === 0) return
    const gl = this.#gl
    if (this.#canvas.width !== source.width) this.#canvas.width = source.width
    if (this.#canvas.height !== source.height) this.#canvas.height = source.height
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.#texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    this.#hasSource = true
  }

  draw(uniforms: ArrayBuffer, effectEnabled: boolean): void {
    if (this.#disposed || !this.#hasSource) return
    const gl = this.#gl
    const shader = effectEnabled ? this.#shader : undefined
    const program = shader?.program ?? this.#copy
    gl.useProgram(program)
    gl.bindVertexArray(this.#vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.#texture)
    gl.uniform1i(
      gl.getUniformLocation(program, shader?.metadata.webgl.channel0 ?? 'sourceImage'),
      0,
    )
    const block = shader?.metadata.webgl.uniformBlock
    if (block) this.#bindUniforms(program, block, uniforms)
    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    const gl = this.#gl
    gl.deleteProgram(this.#copy)
    gl.deleteProgram(this.#shader?.program ?? null)
    gl.deleteShader(this.#vertex)
    gl.deleteTexture(this.#texture)
    gl.deleteBuffer(this.#uniforms)
    gl.deleteVertexArray(this.#vao)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  #bindUniforms(program: WebGLProgram, blockName: string, uniforms: ArrayBuffer): void {
    const gl = this.#gl
    const block = gl.getUniformBlockIndex(program, blockName)
    if (block === gl.INVALID_INDEX)
      throw new Error(`WebGL uniform block ${blockName} was not linked`)
    gl.uniformBlockBinding(program, block, 0)
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.#uniforms)
    gl.bufferData(gl.UNIFORM_BUFFER, uniforms, gl.DYNAMIC_DRAW)
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.#uniforms)
  }

  #program(source: string): WebGLProgram {
    const gl = this.#gl
    const fragment = compileGlShader(gl, gl.FRAGMENT_SHADER, source)
    const program = requireResource(gl.createProgram(), 'WebGL program')
    gl.attachShader(program, this.#vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(fragment)
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program
    const message = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`WebGL program linking failed: ${message}`)
  }
}
