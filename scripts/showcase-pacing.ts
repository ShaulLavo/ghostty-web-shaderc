import type { CompiledGhosttyShader } from 'ghostty-web-shaderc'

export interface PacingFrame {
  readonly id: number
  readonly shader: string
  readonly width: number
  readonly height: number
  readonly animationFrame: number
}

export interface PacingProbe {
  readonly frames: PacingFrame[]
  readonly completed: PacingFrame[]
  unfinished: number
  maxUnfinished: number
  delayed: number
  animationFrames: number
  heavyAnimationFrames: number
  latestSelection: { readonly heavyFrame: number; readonly unfinished: number } | null
}

declare global {
  interface Window {
    showcasePacing: PacingProbe
  }
}

// Runs before application code. Native completion still decides when GPU work really finished.
export function installPacingProbe(shaders: Record<string, CompiledGhosttyShader>): void {
  const probe: PacingProbe = {
    frames: [],
    completed: [],
    unfinished: 0,
    maxUnfinished: 0,
    delayed: 0,
    animationFrames: 0,
    heavyAnimationFrames: 0,
    latestSelection: null,
  }
  window.showcasePacing = probe
  const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 100))
  const isOutput = (canvas: HTMLCanvasElement | OffscreenCanvas) =>
    canvas instanceof HTMLCanvasElement && canvas.matches('canvas[data-terminal-preview]')
  const shaderName = (source: string) =>
    Object.entries(shaders).find(
      ([, shader]) => shader.wgsl === source || shader.glsl === source,
    )?.[0] ?? 'copy'

  function beginFrame(canvas: HTMLCanvasElement | OffscreenCanvas, shader: string): PacingFrame {
    const frame = {
      id: probe.frames.length,
      shader,
      width: canvas.width,
      height: canvas.height,
      animationFrame: probe.animationFrames,
    }
    probe.frames.push(frame)
    probe.unfinished++
    probe.maxUnfinished = Math.max(probe.maxUnfinished, probe.unfinished)
    queueMicrotask(() => window.dispatchEvent(new Event('showcase-postprocess-frame')))
    return frame
  }

  function completeFrame(frame: PacingFrame): void {
    probe.unfinished--
    probe.completed.push(frame)
  }

  function heartbeat(): void {
    probe.animationFrames++
    if (probe.unfinished > 0 && probe.frames.at(-1)?.shader === 'fireworks')
      probe.heavyAnimationFrames++
    requestAnimationFrame(heartbeat)
  }
  requestAnimationFrame(heartbeat)

  function installWebGpu(): void {
    if (!navigator.gpu) return
    const textures = new WeakMap<GPUTexture, HTMLCanvasElement | OffscreenCanvas>()
    const views = new WeakMap<GPUTextureView, HTMLCanvasElement | OffscreenCanvas>()
    const modules = new WeakMap<GPUShaderModule, string>()
    const pipelines = new WeakMap<GPURenderPipeline, string>()
    const passes = new WeakMap<GPURenderPassEncoder, GPUCommandEncoder>()
    const passShaders = new WeakMap<GPURenderPassEncoder, string>()
    type Output = { canvas: HTMLCanvasElement | OffscreenCanvas; shader: string }
    const encoders = new WeakMap<GPUCommandEncoder, Output>()
    const commands = new WeakMap<GPUCommandBuffer, Output>()
    const pending = new WeakMap<GPUQueue, Promise<void>>()
    const canvases = new WeakMap<GPUCommandEncoder, HTMLCanvasElement | OffscreenCanvas>()
    const getTexture = GPUCanvasContext.prototype.getCurrentTexture
    const createView = GPUTexture.prototype.createView
    const createModule = GPUDevice.prototype.createShaderModule
    const createPipeline = GPUDevice.prototype.createRenderPipelineAsync
    const beginPass = GPUCommandEncoder.prototype.beginRenderPass
    const setPipeline = GPURenderPassEncoder.prototype.setPipeline
    const draw = GPURenderPassEncoder.prototype.draw
    const finish = GPUCommandEncoder.prototype.finish
    const submit = GPUQueue.prototype.submit
    const done = GPUQueue.prototype.onSubmittedWorkDone

    GPUCanvasContext.prototype.getCurrentTexture = function () {
      const texture = getTexture.call(this)
      if (isOutput(this.canvas)) textures.set(texture, this.canvas)
      return texture
    }
    GPUTexture.prototype.createView = function (descriptor) {
      const view = createView.call(this, descriptor)
      const canvas = textures.get(this)
      if (canvas) views.set(view, canvas)
      return view
    }
    GPUDevice.prototype.createShaderModule = function (descriptor) {
      const module = createModule.call(this, descriptor)
      modules.set(module, shaderName(descriptor.code))
      return module
    }
    GPUDevice.prototype.createRenderPipelineAsync = async function (descriptor) {
      const pipeline = await createPipeline.call(this, descriptor)
      const module = descriptor.fragment?.module
      if (module) pipelines.set(pipeline, modules.get(module) ?? 'copy')
      return pipeline
    }
    GPUCommandEncoder.prototype.beginRenderPass = function (descriptor) {
      const pass = beginPass.call(this, descriptor)
      passes.set(pass, this)
      const attachments = Array.from(descriptor.colorAttachments, (entry) => entry?.view)
      const canvas = attachments
        .map((view) => (view instanceof GPUTexture ? textures.get(view) : view && views.get(view)))
        .find(Boolean)
      if (canvas) canvases.set(this, canvas)
      return pass
    }
    GPURenderPassEncoder.prototype.setPipeline = function (pipeline) {
      setPipeline.call(this, pipeline)
      passShaders.set(this, pipelines.get(pipeline) ?? 'copy')
    }
    GPURenderPassEncoder.prototype.draw = function (
      vertices,
      instances,
      firstVertex,
      firstInstance,
    ) {
      draw.call(this, vertices, instances, firstVertex, firstInstance)
      const encoder = passes.get(this)
      const canvas = encoder && canvases.get(encoder)
      if (canvas && encoder)
        encoders.set(encoder, { canvas, shader: passShaders.get(this) ?? 'copy' })
    }
    GPUCommandEncoder.prototype.finish = function (descriptor) {
      const command = finish.call(this, descriptor)
      const frame = encoders.get(this)
      if (frame) commands.set(command, frame)
      return command
    }
    GPUQueue.prototype.submit = function (buffers) {
      const submitted = Array.from(buffers)
      submit.call(this, submitted)
      const frames = submitted
        .map((command) => commands.get(command))
        .filter((output) => output !== undefined)
        .map((output) => beginFrame(output.canvas, output.shader))
      if (frames.length === 0) return
      const completion = done
        .call(this)
        .then(delay)
        .then(() => frames.forEach(completeFrame))
      pending.set(this, completion)
      void completion.catch(() => undefined)
    }
    GPUQueue.prototype.onSubmittedWorkDone = function () {
      const completion = done.call(this)
      const delayed = pending.get(this)
      if (!delayed) return completion
      probe.delayed++
      return Promise.all([completion, delayed]).then(() => undefined)
    }
  }

  function installWebGl(): void {
    const gl = WebGL2RenderingContext.prototype
    const shaderSources = new WeakMap<WebGLShader, string>()
    const programs = new WeakMap<WebGLProgram, string>()
    const selected = new WeakMap<WebGL2RenderingContext, string>()
    const fences = new WeakMap<WebGLSync, PacingFrame>()
    const shaderSource = gl.shaderSource
    const attachShader = gl.attachShader
    const useProgram = gl.useProgram
    const drawArrays = gl.drawArrays
    const fenceSync = gl.fenceSync
    const clientWaitSync = gl.clientWaitSync
    const flush = gl.flush

    gl.shaderSource = function (shader, source) {
      shaderSource.call(this, shader, source)
      shaderSources.set(shader, shaderName(source))
    }
    gl.attachShader = function (program, shader) {
      attachShader.call(this, program, shader)
      const name = shaderSources.get(shader)
      if (name && name !== 'copy') programs.set(program, name)
    }
    gl.useProgram = function (program) {
      useProgram.call(this, program)
      selected.set(this, program ? (programs.get(program) ?? 'copy') : 'copy')
    }

    function waitForFrame(
      context: WebGL2RenderingContext,
      sync: WebGLSync,
      frame: PacingFrame,
    ): void {
      const status = clientWaitSync.call(context, sync, 0, 0)
      if (status === context.TIMEOUT_EXPIRED)
        return void setTimeout(() => waitForFrame(context, sync, frame), 0)
      if (status === context.WAIT_FAILED) throw new Error('Pacing probe GPU fence failed')
      void delay().then(() => completeFrame(frame))
      context.deleteSync(sync)
    }

    gl.drawArrays = function (mode, first, count) {
      drawArrays.call(this, mode, first, count)
      if (!isOutput(this.canvas)) return
      const frame = beginFrame(this.canvas, selected.get(this) ?? 'copy')
      const sync = fenceSync.call(this, this.SYNC_GPU_COMMANDS_COMPLETE, 0)
      if (!sync) throw new Error('Pacing probe could not create GPU fence')
      flush.call(this)
      waitForFrame(this, sync, frame)
    }
    gl.fenceSync = function (condition, flags) {
      const sync = fenceSync.call(this, condition, flags)
      const frame = probe.frames.at(-1)
      if (sync && frame && isOutput(this.canvas)) fences.set(sync, frame)
      return sync
    }
    gl.clientWaitSync = function (sync, flags, timeout) {
      const status = clientWaitSync.call(this, sync, flags, timeout)
      const fence = fences.get(sync)
      if (!fence || status === this.WAIT_FAILED) return status
      if (!probe.completed.includes(fence)) {
        probe.delayed++
        return this.TIMEOUT_EXPIRED
      }
      return status
    }
  }

  installWebGpu()
  installWebGl()
}
