import { compileGhosttyShader } from 'ghostty-web-shaderc'
import { assertPixels, inputPixels, pixelCases, uniformBuffer } from './cases.js'
import { WebGlRenderer } from './webgl.js'
import { WebGpuRenderer } from './webgpu.js'

async function fixtureSource(name: string): Promise<string> {
  const response = await fetch(`/fixtures/${name}.glsl`)
  if (!response.ok) throw new Error(`Could not load ${name} fixture: ${response.status}`)
  return response.text()
}

async function verifyFixtures(webgpu: WebGpuRenderer, webgl: WebGlRenderer): Promise<string[]> {
  const names = ['texture-operations', 'crt', 'cursor-glow', 'language']
  const passed: string[] = []
  for (const name of names) {
    const shader = await compileGhosttyShader(await fixtureSource(name))
    const uniforms = uniformBuffer({ iTime: 0.5, iFrame: 3, iFocus: 1, iCursorVisible: 1 })
    const gpuPixels = await webgpu.draw(shader, uniforms)
    const glPixels = webgl.draw(shader, uniforms)
    assertPixels(`${name} backend parity`, gpuPixels, Array.from(glPixels), 4)
    if (name === 'texture-operations') assertPixels(name, gpuPixels, Array.from(inputPixels))
    passed.push(`WebGPU + WebGL2: ${name} fixture`)
  }
  return passed
}

function workerMessage(
  event: MessageEvent<{ ok?: boolean; error?: string }>,
  resolve: () => void,
  reject: (error: Error) => void,
): void {
  if (!event.data.ok) {
    reject(new Error(`Worker compilation: ${event.data.error ?? 'invalid result'}`))
    return
  }
  resolve()
}

function workerCompilation(worker: Worker): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    worker.onmessage = (event) => workerMessage(event, resolve, reject)
    worker.onerror = (event) => reject(new Error(`Worker: ${event.message}`))
    worker.postMessage('void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0); }')
  })
}

async function verifyWorker(): Promise<void> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  try {
    await workerCompilation(worker)
  } finally {
    worker.terminate()
  }
}

async function verifyCases(
  shaders: readonly Awaited<ReturnType<typeof compileGhosttyShader>>[],
  webgpu: WebGpuRenderer,
  webgl: WebGlRenderer,
): Promise<string[]> {
  const passed: string[] = []
  for (const [index, test] of pixelCases.entries()) {
    const shader = shaders[index]
    if (!shader) throw new Error(`Missing compiled shader ${index}`)
    const uniforms = uniformBuffer(test.uniforms)
    assertPixels(
      `WebGPU ${test.name}`,
      await webgpu.draw(shader, uniforms),
      test.expected,
      test.tolerance,
    )
    assertPixels(`WebGL2 ${test.name}`, webgl.draw(shader, uniforms), test.expected, test.tolerance)
    passed.push(`WebGPU + WebGL2: ${test.name}`)
  }
  return passed
}

async function run(): Promise<string[]> {
  const shaders = await Promise.all(pixelCases.map((test) => compileGhosttyShader(test.source)))
  const webgpu = await WebGpuRenderer.create()
  let webgl: WebGlRenderer | undefined
  try {
    webgl = new WebGlRenderer()
    const passed = await verifyCases(shaders, webgpu, webgl)
    const fixtures = await verifyFixtures(webgpu, webgl)
    await verifyWorker()
    return passed.concat(fixtures, ['Module worker first-use compilation'])
  } finally {
    webgpu.dispose()
    webgl?.dispose()
  }
}

const result = document.querySelector('#result')
if (!result) throw new Error('Result element missing')
run().then(
  (passed) => {
    result.textContent = JSON.stringify({ ok: true, passed })
    result.setAttribute('data-status', 'passed')
  },
  (error: unknown) => {
    result.textContent = JSON.stringify({
      ok: false,
      error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error),
    })
    result.setAttribute('data-status', 'failed')
  },
)
