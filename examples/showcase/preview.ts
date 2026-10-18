import type { CompiledGhosttyShader } from 'ghostty-web-shaderc'
import {
  packShaderUniforms,
  SHADER_UNIFORM_BYTE_LENGTH,
  type ShaderVector4,
  type ShaderUniformValues,
} from 'ghostty-web-shaderc/runtime'
import {
  fitTerminalFont,
  Terminal,
  WebGpuTerminalRenderer,
  type GhosttyWebGpuRendererFactory,
  type RendererFrameSnapshot,
} from 'ghostty-webgpu'
import wasmUrl from 'ghostty-webgpu/ghostty-vt.wasm?url'
import bridgeUrl from 'ghostty-webgpu/bridge.wasm?url'
import {
  WebGlShaderPass,
  WebGpuShaderPass,
  type ShaderOutputSize,
  type ShaderPass,
} from './gpu-pass.js'
import { createTerminalScene, type TerminalScene } from './terminal-scene.js'

export interface TerminalPreviewOptions {
  readonly backend?: 'webgpu' | 'webgl2'
  readonly onError?: (error: Error) => void
}

export interface TerminalPreview {
  readonly backend: 'webgpu' | 'webgl2'
  setShader(shader: CompiledGhosttyShader): Promise<void>
  setPaused(paused: boolean): void
  setEffectEnabled(enabled: boolean): void
  dispose(): void
}

const TERMINAL_PADDING = 12
const TERMINAL_FONT = {
  boldWeight: 700,
  family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  letterSpacing: 0,
  lineHeight: 1.25,
  size: 14,
  weight: 400,
} as const
const MAX_FONT_SIZE = TERMINAL_FONT.size
const MIN_FONT_SIZE = 8
const LOGO_COLUMNS = 56
const MONOSPACE_CELL_WIDTH_RATIO = 0.6
const MAX_PIXEL_RATIO = 2

function pixelRatio(host: HTMLElement): number {
  const view = host.ownerDocument.defaultView
  return Math.min(view?.devicePixelRatio ?? 1, MAX_PIXEL_RATIO)
}

function previewFontSize(width: number): number {
  const availableWidth = Math.max(0, width - TERMINAL_PADDING * 2)
  const size = (availableWidth / (LOGO_COLUMNS * MONOSPACE_CELL_WIDTH_RATIO)) * 0.98
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Number(size.toFixed(2))))
}

function outputSize(host: HTMLElement): ShaderOutputSize | undefined {
  const bounds = host.getBoundingClientRect()
  const width = Math.round(bounds.width * pixelRatio(host))
  const height = Math.round(bounds.height * pixelRatio(host))
  if (width < 1 || height < 1) return undefined
  return { height, width }
}

function initialTerminalAppearance(host: HTMLElement): {
  readonly font: Omit<typeof TERMINAL_FONT, 'size'> & { readonly size: number }
  readonly grid: {
    readonly cellHeight: number
    readonly cellWidth: number
    readonly columns: number
    readonly pixelRatio: number
    readonly rows: number
  }
} {
  const bounds = host.getBoundingClientRect()
  const font = { ...TERMINAL_FONT, size: previewFontSize(bounds.width) }
  const fitted = fitTerminalFont(host.ownerDocument, font, pixelRatio(host))
  const availableWidth = Math.max(1, bounds.width - TERMINAL_PADDING * 2)
  const availableHeight = Math.max(1, bounds.height - TERMINAL_PADDING * 2)
  return {
    font,
    grid: {
      cellHeight: fitted.cssCellHeight,
      cellWidth: fitted.cssCellWidth,
      columns: Math.max(2, Math.floor(availableWidth / fitted.cssCellWidth)),
      pixelRatio: fitted.pixelRatio,
      rows: Math.max(1, Math.floor(availableHeight / fitted.cssCellHeight)),
    },
  }
}

async function requestDevice(
  backend: TerminalPreviewOptions['backend'],
): Promise<GPUDevice | undefined> {
  if (backend === 'webgl2' || !navigator.gpu) return undefined
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  return adapter?.requestDevice()
}

function sharedRenderer(device: GPUDevice): GhosttyWebGpuRendererFactory {
  let created = false
  return async (options) => {
    if (created) throw new Error('WebGPU device was lost. Reload the preview to reconnect.')
    created = true
    return WebGpuTerminalRenderer.create({
      ...options,
      deviceFactory: () => Promise.resolve(device),
    })
  }
}

function createSurfaces(host: HTMLElement): { source: HTMLDivElement; output: HTMLCanvasElement } {
  const source = document.createElement('div')
  source.className = 'terminal-source'
  source.style.cssText =
    'position:absolute;inset:0;overflow:hidden;clip-path:inset(50%);pointer-events:none;'
  const output = document.createElement('canvas')
  output.dataset['terminalPreview'] = ''
  output.setAttribute('aria-label', 'Live shader applied to a scripted Ghostty terminal session')
  output.style.cssText = 'display:block;width:100%;height:100%;object-fit:fill;background:#0c1412;'
  host.append(source, output)
  return { source, output }
}

function cursorPosition(
  terminal: Terminal,
  snapshot: RendererFrameSnapshot,
  size: ShaderOutputSize,
): ShaderVector4 {
  const cursor = snapshot.paintedCursor ?? snapshot.cursor.viewport
  const canvas = terminal.canvas
  if (!cursor || !canvas) return [0, 0, 0, 0]
  const grid = terminal.appearance.grid
  if (canvas.width === 0 || canvas.height === 0) return [0, 0, 0, 0]
  const width = size.width / grid.columns
  const height = size.height / grid.rows
  return [cursor.x * width, size.height - cursor.y * height, width, height]
}

function colors(
  terminal: Terminal,
): Pick<
  ShaderUniformValues,
  'iBackgroundColor' | 'iForegroundColor' | 'iCursorColor' | 'iPalette'
> {
  const theme = terminal.appearance.theme
  const normalized = (color: {
    r: number
    g: number
    b: number
  }): readonly [number, number, number] => [color.r / 255, color.g / 255, color.b / 255]
  return {
    iBackgroundColor: normalized(theme.background),
    iForegroundColor: normalized(theme.foreground),
    iCursorColor: normalized(theme.cursor),
    iPalette: theme.palette.map(normalized),
  }
}

class PreviewController implements TerminalPreview {
  readonly backend: 'webgpu' | 'webgl2'
  readonly #terminal: Terminal
  readonly #pass: ShaderPass
  readonly #host: HTMLElement
  readonly #source: HTMLDivElement
  readonly #output: HTMLCanvasElement
  readonly #view: Window
  readonly #resizeObserver: ResizeObserver
  readonly #onError: TerminalPreviewOptions['onError']
  readonly #uniforms = new ArrayBuffer(SHADER_UNIFORM_BYTE_LENGTH)
  readonly #themeUniforms: ReturnType<typeof colors>
  readonly #subscriptions: { dispose(): void }[] = []
  #scene: TerminalScene | undefined
  #disposed = false
  #failed = false
  #paused = matchMedia('(prefers-reduced-motion: reduce)').matches
  #effectEnabled = true
  #raf = 0
  #time = 0
  #lastTick = performance.now()
  #frame = 0
  #fontSize: number
  #outputSize: ShaderOutputSize | undefined
  #sourceSize: ShaderOutputSize | undefined
  #currentCursor: ShaderVector4 = [0, 0, 0, 0]
  #previousCursor: ShaderVector4 = [0, 0, 0, 0]
  #cursorChangeTime = 0
  #cursorVisible = 1

  constructor(
    terminal: Terminal,
    pass: ShaderPass,
    source: HTMLDivElement,
    output: HTMLCanvasElement,
    host: HTMLElement,
    onError: TerminalPreviewOptions['onError'],
  ) {
    const view = host.ownerDocument.defaultView
    if (!view) throw new TypeError('Terminal preview host must belong to a window')
    this.backend = pass.backend
    this.#terminal = terminal
    this.#pass = pass
    this.#host = host
    this.#source = source
    this.#output = output
    this.#view = view
    this.#onError = onError
    this.#fontSize = terminal.appearance.font.size
    this.#themeUniforms = colors(terminal)
    output.dataset['backend'] = pass.backend
    this.#subscriptions.push(terminal.on('frame', () => this.#capture()))
    this.#subscriptions.push(terminal.on('error', ({ cause }) => this.fail(cause)))
    this.#resizeObserver = new ResizeObserver(this.#surfaceResized)
    this.#resizeObserver.observe(host)
    this.#view.addEventListener('resize', this.#windowResized)
    this.#synchronizeLayout()
    document.addEventListener('visibilitychange', this.#visibilityChanged)
    output.addEventListener('webglcontextlost', this.#contextLost)
  }

  start(): void {
    this.#scene = createTerminalScene(this.#terminal)
    this.#synchronizeAnimation()
  }

  async setShader(shader: CompiledGhosttyShader): Promise<void> {
    if (this.#disposed) return
    await this.#pass.setShader(shader)
    this.#draw()
  }

  setPaused(paused: boolean): void {
    this.#paused = paused
    this.#synchronizeAnimation()
    this.#draw()
  }

  setEffectEnabled(enabled: boolean): void {
    this.#effectEnabled = enabled
    this.#draw()
  }

  fail(cause: unknown): void {
    if (this.#disposed || this.#failed) return
    this.#failed = true
    this.#scene?.setPaused(true)
    cancelAnimationFrame(this.#raf)
    this.#raf = 0
    this.#onError?.(cause instanceof Error ? cause : new Error(String(cause)))
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    cancelAnimationFrame(this.#raf)
    this.#scene?.dispose()
    this.#resizeObserver.disconnect()
    this.#view.removeEventListener('resize', this.#windowResized)
    document.removeEventListener('visibilitychange', this.#visibilityChanged)
    this.#output.removeEventListener('webglcontextlost', this.#contextLost)
    for (const subscription of this.#subscriptions) subscription.dispose()
    this.#pass.dispose()
    this.#terminal.dispose()
    this.#source.remove()
    this.#output.remove()
  }

  #capture(): void {
    const canvas = this.#terminal.canvas
    const snapshot = this.#terminal.frameSnapshot()
    if (this.#disposed || this.#failed || !canvas || !this.#outputSize) return
    if (canvas.width === 0 || canvas.height === 0) return
    try {
      if (snapshot) this.#updateCursor(snapshot)
      this.#pass.capture(canvas)
      this.#sourceSize = { width: canvas.width, height: canvas.height }
      this.#draw()
      this.#output.dataset['ready'] = 'true'
    } catch (cause) {
      this.fail(cause)
    }
  }

  #updateCursor(snapshot: RendererFrameSnapshot): void {
    const size = this.#outputSize
    if (!size) return
    const current = cursorPosition(this.#terminal, snapshot, size)
    this.#cursorVisible = snapshot.cursor.visible ? 1 : 0
    if (current.every((value, index) => value === this.#currentCursor[index])) return
    this.#previousCursor = this.#currentCursor
    this.#currentCursor = current
    this.#cursorChangeTime = this.#time
    this.#output.dataset['cursorChange'] = String(this.#cursorChangeTime)
  }

  #draw(): void {
    if (this.#disposed || this.#failed) return
    const size = this.#outputSize
    const sourceSize = this.#sourceSize
    if (!size || !sourceSize) return
    const cursorColor: ShaderVector4 = [0.57, 0.93, 0.62, 1]
    const width = size.width
    const height = size.height
    const uniforms = packShaderUniforms(
      {
        ...this.#themeUniforms,
        iResolution: [width, height, 1],
        iChannelResolution: [
          [sourceSize.width, sourceSize.height, 1],
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        iChannelTime: [this.#time, 0, 0, 0],
        iTime: this.#time,
        iTimeDelta: this.#paused ? 0 : 1 / 60,
        iFrameRate: 60,
        iFrame: this.#frame,
        iCurrentCursor: this.#currentCursor,
        iPreviousCursor: this.#previousCursor,
        iCurrentCursorColor: cursorColor,
        iPreviousCursorColor: cursorColor,
        iCursorColor: [0.57, 0.93, 0.62],
        iCursorVisible: this.#cursorVisible,
        iTimeCursorChange: this.#cursorChangeTime,
        iFocus: 1,
      },
      this.#uniforms,
    )
    this.#pass.draw(uniforms, this.#effectEnabled)
  }

  #synchronizeAnimation(): void {
    cancelAnimationFrame(this.#raf)
    this.#raf = 0
    const stopped = this.#paused || document.hidden || this.#disposed || this.#failed
    this.#scene?.setPaused(stopped)
    this.#lastTick = performance.now()
    if (!stopped) this.#raf = requestAnimationFrame(this.#animate)
  }

  readonly #animate = (timestamp: number): void => {
    this.#time += Math.min((timestamp - this.#lastTick) / 1000, 0.1)
    this.#lastTick = timestamp
    this.#frame = (this.#frame + 1) % 2147483647
    try {
      this.#draw()
    } catch (cause) {
      this.fail(cause)
    }
    if (!this.#failed && !this.#disposed) this.#raf = requestAnimationFrame(this.#animate)
  }

  readonly #visibilityChanged = (): void => this.#synchronizeAnimation()
  readonly #surfaceResized = (): void => this.#synchronizeLayout()
  readonly #windowResized = (): void => this.#synchronizeLayout()
  readonly #contextLost = (event: Event): void => {
    event.preventDefault()
    this.fail(new Error('The WebGL2 preview context was lost. Reload to reconnect.'))
  }

  #synchronizeLayout(): void {
    if (this.#disposed || this.#failed) return
    try {
      const bounds = this.#host.getBoundingClientRect()
      const fontSize = previewFontSize(bounds.width)
      if (fontSize !== this.#fontSize) {
        this.#fontSize = fontSize
        this.#terminal.setFont({ size: fontSize })
      }
      const size = outputSize(this.#host)
      if (!size) return
      this.#outputSize = size
      this.#pass.resize(size)
      const snapshot = this.#terminal.frameSnapshot()
      if (snapshot) this.#updateCursor(snapshot)
      this.#draw()
    } catch (cause) {
      this.fail(cause)
    }
  }
}

export async function createTerminalPreview(
  host: HTMLElement,
  options: TerminalPreviewOptions = {},
): Promise<TerminalPreview> {
  const { source, output } = createSurfaces(host)
  let device: GPUDevice | undefined
  let pass: ShaderPass | undefined
  let terminal: Terminal | undefined
  let controller: PreviewController | undefined
  try {
    const appearance = initialTerminalAppearance(host)
    device = await requestDevice(options.backend)
    pass = device ? new WebGpuShaderPass(device, output) : new WebGlShaderPass(output)
    terminal = await Terminal.create({
      accessibility: { label: 'Ghostty shader demonstration terminal' },
      appearance: {
        cursor: { blink: false, style: 'block' },
        font: appearance.font,
        grid: appearance.grid,
      },
      padding: TERMINAL_PADDING,
      fitEnvironment: { getPixelRatio: () => Math.min(window.devicePixelRatio, 2) },
      keyboard: false,
      rendererFactory: device ? sharedRenderer(device) : undefined,
      runtime: { kind: 'owned', options: { wasm: wasmUrl, bridge: bridgeUrl } },
    })
    await terminal.open(source)
    terminal.setTheme({
      ...terminal.appearance.theme,
      background: { r: 12, g: 20, b: 18 },
      foreground: { r: 214, g: 232, b: 221 },
      cursor: { r: 145, g: 236, b: 159 },
    })
    controller = new PreviewController(terminal, pass, source, output, host, options.onError)
    if (device) monitorDevice(device, controller)
    controller.start()
    return controller
  } catch (cause) {
    controller?.dispose()
    if (!controller) pass?.dispose()
    if (!controller) terminal?.dispose()
    device?.destroy()
    source.remove()
    output.remove()
    throw cause
  }
}

function monitorDevice(device: GPUDevice, controller: PreviewController): void {
  device.addEventListener('uncapturederror', (event) => controller.fail(event.error))
  void device.lost.then((info) => {
    if (info.reason !== 'destroyed')
      controller.fail(new Error(`WebGPU device lost: ${info.message}`))
  })
}
