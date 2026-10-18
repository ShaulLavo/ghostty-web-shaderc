import type { CompiledGhosttyShader } from 'ghostty-web-shaderc'
import { FULLSCREEN_VERTEX_WGSL, SHADER_UNIFORM_BYTE_LENGTH } from 'ghostty-web-shaderc/runtime'
import { height, inputPixels, width } from './cases.js'

export class WebGpuRenderer {
  readonly #device: GPUDevice
  readonly #layout: GPUBindGroupLayout
  readonly #vertex: GPUShaderModule
  readonly #input: GPUTexture
  readonly #target: GPUTexture
  readonly #uniforms: GPUBuffer
  readonly #readback: GPUBuffer
  readonly #bindings: GPUBindGroup

  private constructor(device: GPUDevice) {
    this.#device = device
    this.#layout = device.createBindGroupLayout({
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
    this.#vertex = device.createShaderModule({ code: FULLSCREEN_VERTEX_WGSL })
    this.#input = device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.#target = device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    this.#uniforms = device.createBuffer({
      size: SHADER_UNIFORM_BYTE_LENGTH,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.#readback = device.createBuffer({
      size: 256 * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    this.#bindings = device.createBindGroup({
      layout: this.#layout,
      entries: [
        { binding: 0, resource: { buffer: this.#uniforms } },
        { binding: 1, resource: this.#input.createView() },
        {
          binding: 2,
          resource: device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' }),
        },
      ],
    })
    device.queue.writeTexture({ texture: this.#input }, inputPixels, { bytesPerRow: width * 4 }, [
      width,
      height,
    ])
  }

  static async create(): Promise<WebGpuRenderer> {
    if (!navigator.gpu) throw new Error('Chromium did not expose WebGPU')
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) throw new Error('Chromium did not provide a WebGPU adapter')
    return new WebGpuRenderer(await adapter.requestDevice())
  }

  async draw(shader: CompiledGhosttyShader, uniforms: ArrayBuffer): Promise<Uint8Array> {
    const device = this.#device
    device.pushErrorScope('validation')
    const module = device.createShaderModule({ code: shader.wgsl })
    const info = await module.getCompilationInfo()
    const errors = info.messages.filter((message) => message.type === 'error')
    if (errors.length > 0)
      throw new Error(
        errors
          .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)
          .join('\n'),
      )
    const pipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.#layout] }),
      vertex: { module: this.#vertex, entryPoint: 'main' },
      fragment: { module, entryPoint: shader.entryPoint, targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    })
    device.queue.writeBuffer(this.#uniforms, 0, uniforms)
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#target.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 0],
        },
      ],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.#bindings)
    pass.draw(3)
    pass.end()
    encoder.copyTextureToBuffer(
      { texture: this.#target },
      { buffer: this.#readback, bytesPerRow: 256 },
      [width, height],
    )
    device.queue.submit([encoder.finish()])
    await this.#readback.mapAsync(GPUMapMode.READ)
    const mapped = new Uint8Array(this.#readback.getMappedRange())
    const pixels = new Uint8Array(width * height * 4)
    for (let row = 0; row < height; row++)
      pixels.set(mapped.subarray(row * 256, row * 256 + width * 4), (height - row - 1) * width * 4)
    this.#readback.unmap()
    const validation = await device.popErrorScope()
    if (validation) throw new Error(validation.message)
    return pixels
  }

  dispose(): void {
    this.#input.destroy()
    this.#target.destroy()
    this.#uniforms.destroy()
    this.#readback.destroy()
    this.#device.destroy()
  }
}
