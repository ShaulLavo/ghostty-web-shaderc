import { existsSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileGhosttyShader } from 'ghostty-web-shaderc'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Locator, Page } from 'playwright'

const repository = dirname(dirname(fileURLToPath(import.meta.url)))
const artifacts = join(repository, '.artifacts')
const exampleIds = ['phosphor-crt', 'cursor-warp', 'scanline', 'pixels', 'passthrough']
const checks: string[] = []

interface PixelSummary {
  readonly width: number
  readonly height: number
  readonly brightPixels: number
  readonly distinctColors: number
  readonly nonemptyRegions: number
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function browserEnvironment(scratch: string): Record<string, string> {
  const driver = join(dirname(chromium.executablePath()), 'vk_swiftshader_icd.json')
  assert(existsSync(driver), 'Cached Chromium SwiftShader driver missing')
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[name] = value
  }
  return {
    ...environment,
    TMPDIR: scratch,
    TMP: scratch,
    TEMP: scratch,
    VK_ICD_FILENAMES: driver,
    VK_DRIVER_FILES: driver,
  }
}

function serveBundle(): ReturnType<typeof Bun.serve> {
  const root = resolve(artifacts, 'showcase')
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname)
      const filename = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!filename.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })
      const file = Bun.file(filename)
      if (!(await file.exists())) return new Response('Not found', { status: 404 })
      return new Response(file, { headers: { 'Cache-Control': 'no-store' } })
    },
  })
}

async function ready(page: Page, id: string, backend: 'webgpu' | 'webgl2'): Promise<void> {
  try {
    await page.waitForFunction(
      ({ id, backend }) => {
        const app = document.querySelector<HTMLElement>('#app')
        if (app?.dataset.status === 'error')
          throw new Error(
            document.querySelector('[role="alert"]')?.textContent ??
              'Showcase initialization failed',
          )
        if (app?.dataset.status === 'ready' && app.dataset.backend !== backend)
          throw new Error(`Expected ${backend}, got ${app.dataset.backend}`)
        return (
          app?.dataset.example === id &&
          app.dataset.status === 'ready' &&
          app.dataset.backend === backend
        )
      },
      { id, backend },
      { timeout: 90_000 },
    )
  } catch (cause) {
    const status = await page.locator('#app').evaluate((app) => ({
      attributes: app
        .getAttributeNames()
        .filter((name) => name.startsWith('data-'))
        .map((name) => `${name}=${app.getAttribute(name)}`),
      messages: Array.from(
        document.querySelectorAll('[role="alert"], #compile-status, #preview-message'),
        (element) => element.textContent?.trim(),
      ),
    }))
    throw new Error(`Showcase ${id} did not become ready: ${JSON.stringify(status)}`, { cause })
  }
  await page
    .locator(`canvas[data-terminal-preview][data-ready="true"][data-backend="${backend}"]`)
    .waitFor()
}

async function verifyCursorEffect(page: Page): Promise<void> {
  await selectExample(page, 'cursor-warp', 'webgpu')
  await page.waitForFunction(() => {
    const button = document.querySelector<HTMLButtonElement>('#pause-button')
    return button?.getAttribute('aria-pressed') === 'false'
  })
  const previous = await page
    .locator('canvas[data-terminal-preview]')
    .getAttribute('data-cursor-change')
  assert(previous !== null, 'Cursor movement observation hook missing')
  await page.waitForFunction(
    (previous) => {
      const canvas = document.querySelector<HTMLElement>('canvas[data-terminal-preview]')
      if (canvas?.dataset.cursorChange === previous) return false
      document.querySelector<HTMLButtonElement>('#pause-button')?.click()
      return true
    },
    previous,
    { timeout: 10_000, polling: 'raf' },
  )
  assert(
    (await page.locator('#pause-button').getAttribute('aria-pressed')) === 'true',
    'Cursor movement was not paused',
  )
  const canvas = page.locator('canvas[data-terminal-preview]')
  const effect = await canvas.screenshot()
  await page.locator('#effect-button').click()
  const bypass = await canvas.screenshot()
  assert(!effect.equals(bypass), 'Cursor warp has no visible effect during real cursor movement')
  await page.locator('#effect-button').click()
  await page.locator('#pause-button').click()
  checks.push('Cursor warp visibly changes pixels after real terminal cursor movement')
}

async function verifySteadyEffects(page: Page): Promise<void> {
  await page.locator('#pause-button').click()
  for (const id of ['scanline', 'pixels', 'passthrough']) {
    await selectExample(page, id, 'webgpu')
    const canvas = page.locator('canvas[data-terminal-preview]')
    const effect = await canvas.screenshot()
    await page.locator('#effect-button').click()
    const unchanged = effect.equals(await canvas.screenshot())
    assert(
      unchanged === (id === 'passthrough'),
      `${id}: unexpected effect-versus-bypass pixel comparison`,
    )
    await page.locator('#effect-button').click()
    checks.push(
      `${id}: ${id === 'passthrough' ? 'preserves original pixels' : 'visibly changes terminal pixels'}`,
    )
  }
  await page.locator('#pause-button').click()
}

async function selectedCode(
  page: Page,
  file: 'entry' | 'source' | 'wgsl' | 'glsl',
): Promise<string> {
  await page.locator(`[data-file="${file}"]`).click()
  return (await page.locator('#source-code').innerText()).trim()
}

async function verifyCode(page: Page, id: string): Promise<void> {
  const source = await readFile(join(repository, 'examples/showcase/shaders', `${id}.glsl`), 'utf8')
  const entry = await readFile(join(repository, 'examples/showcase/entries', `${id}.ts`), 'utf8')
  const compiled = await compileGhosttyShader(source)
  assert((await selectedCode(page, 'source')) === source.trim(), `${id}: source viewer is stale`)
  assert(
    (await selectedCode(page, 'entry')) === entry.trim(),
    `${id}: TypeScript viewer differs from executed entry`,
  )
  assert(
    (await selectedCode(page, 'wgsl')) === compiled.wgsl.trim(),
    `${id}: generated WGSL differs from selected source`,
  )
  assert(
    (await selectedCode(page, 'glsl')) === compiled.glsl.trim(),
    `${id}: generated GLSL differs from selected source`,
  )
}

async function screenshotPixels(bytes: number[]): Promise<PixelSummary> {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }))
  const sample = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = sample.getContext('2d')
  if (!context) throw new Error('Screenshot sampling context unavailable')
  context.drawImage(bitmap, 0, 0)
  const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data
  const colors = new Set<number>()
  const regions = new Set<number>()
  let brightPixels = 0
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] ?? 0
    const green = data[index + 1] ?? 0
    const blue = data[index + 2] ?? 0
    colors.add((red << 16) | (green << 8) | blue)
    if (Math.max(red, green, blue) < 70) continue
    brightPixels++
    const pixel = index / 4
    const column = Math.floor((pixel % bitmap.width) / (bitmap.width / 3))
    const row = Math.floor(Math.floor(pixel / bitmap.width) / (bitmap.height / 2))
    regions.add(row * 3 + column)
  }
  bitmap.close()
  return {
    width: sample.width,
    height: sample.height,
    brightPixels,
    distinctColors: colors.size,
    nonemptyRegions: regions.size,
  }
}

async function pixels(
  page: Page,
  canvas: Locator,
): Promise<{ image: Buffer; summary: PixelSummary }> {
  const image = await canvas.screenshot({ animations: 'allow' })
  const summary = await page.evaluate(screenshotPixels, Array.from(image))
  return { image, summary }
}

async function assertLiveImage(page: Page, label: string): Promise<PixelSummary> {
  const { summary } = await pixels(page, page.locator('canvas[data-terminal-preview]'))
  assert(summary.width > 200 && summary.height > 100, `${label}: terminal canvas is too small`)
  assert(
    summary.brightPixels > summary.width * summary.height * 0.003,
    `${label}: terminal has no visible text`,
  )
  assert(summary.distinctColors > 16, `${label}: terminal image has too little color variation`)
  assert(
    summary.nonemptyRegions >= 4,
    `${label}: terminal content occupies too little of the canvas`,
  )
  checks.push(`${label}: visible terminal pixels across ${summary.nonemptyRegions}/6 regions`)
  return summary
}

async function selectExample(page: Page, id: string, backend: 'webgpu' | 'webgl2'): Promise<void> {
  await page.locator('#example-select').selectOption(id)
  await ready(page, id, backend)
}

async function verifyExamples(page: Page): Promise<void> {
  const options = await page
    .locator('#example-select option')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('value')))
  assert(
    options.length === 5 && exampleIds.every((id) => options.includes(id)),
    'Example selector does not contain the five shipped shaders',
  )
  for (const id of exampleIds) {
    await selectExample(page, id, 'webgpu')
    await verifyCode(page, id)
    await assertLiveImage(page, `WebGPU ${id}`)
  }
  checks.push('All five examples show their actual source, executed TypeScript, WGSL and GLSL')
}

async function verifyDesktopBounds(page: Page): Promise<void> {
  const bounds = await page.evaluate(() => {
    const workspace = document.querySelector('.workspace')?.getBoundingClientRect()
    const status = document.querySelector('#compile-status')?.getBoundingClientRect()
    const footer = document.querySelector('.code-footer')?.getBoundingClientRect()
    if (!workspace || !status || !footer) throw new Error('Missing desktop layout elements')
    return { workspace: workspace.bottom, status: status.bottom, footer: footer.bottom }
  })
  assert(bounds.status <= bounds.workspace + 1, 'Compilation status is clipped below workspace')
  assert(bounds.footer <= bounds.workspace + 1, 'Code footer is clipped below workspace')
  checks.push('1280×800 desktop keeps compilation status and code footer inside workspace')
}

async function verifyPauseAndEffect(page: Page): Promise<void> {
  await selectExample(page, 'phosphor-crt', 'webgpu')
  const canvas = page.locator('canvas[data-terminal-preview]')
  await page.locator('#pause-button').click()
  assert(
    (await page.locator('#pause-button').getAttribute('aria-pressed')) === 'true',
    'Pause control did not enter paused state',
  )
  await page.waitForTimeout(150)
  const paused = await canvas.screenshot()
  await page.waitForTimeout(400)
  assert(
    paused.equals(await canvas.screenshot()),
    'Paused terminal, cursor or shader is still animating',
  )
  await page.locator('#effect-button').click()
  assert(
    (await page.locator('#effect-button').getAttribute('aria-pressed')) === 'false',
    'Effect control did not disable effect',
  )
  const original = await canvas.screenshot()
  assert(!paused.equals(original), 'Disabling shader did not change terminal pixels')
  await assertLiveImage(page, 'WebGPU original terminal with effect disabled')
  await page.locator('#effect-button').click()
  assert(
    !original.equals(await canvas.screenshot()),
    'Re-enabling shader did not redraw while paused',
  )
  await selectedCode(page, 'source')
  await page.screenshot({ path: join(artifacts, 'showcase-desktop.png'), fullPage: true })
  await page.locator('#pause-button').click()
  assert(
    (await page.locator('#pause-button').getAttribute('aria-pressed')) === 'false',
    'Resume control did not clear paused state',
  )
  const resumed = await canvas.screenshot()
  await page.waitForTimeout(350)
  assert(!resumed.equals(await canvas.screenshot()), 'Resuming did not restart animation')
  checks.push(
    'Pause freezes all visible activity; effect toggles redraw while paused; resume restarts animation',
  )
}

async function verifyRapidSwitching(page: Page): Promise<void> {
  await page.locator('#example-select').evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) throw new Error('Example selector is not a select')
    for (const id of ['scanline', 'phosphor-crt', 'passthrough', 'cursor-warp', 'pixels']) {
      element.value = id
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
  await ready(page, 'pixels', 'webgpu')
  await page.waitForTimeout(350)
  await ready(page, 'pixels', 'webgpu')
  await verifyCode(page, 'pixels')
  checks.push('Rapid example switching settles on the latest shader and generated files')
}

async function verifyMobile(context: BrowserContext, url: string): Promise<void> {
  const page = await context.newPage()
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(url)
    await ready(page, 'phosphor-crt', 'webgpu')
    await selectedCode(page, 'wgsl')
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      page: document.documentElement.scrollWidth,
    }))
    assert(
      dimensions.page <= dimensions.width + 1,
      `Mobile page overflows horizontally: ${dimensions.page}px > ${dimensions.width}px`,
    )
    await assertLiveImage(page, '390px mobile WebGPU')
    await page.screenshot({ path: join(artifacts, 'showcase-mobile.png'), fullPage: true })
    checks.push('390px mobile layout has no horizontal page overflow with long generated code')
  } finally {
    await page.close()
  }
}

async function verifyFallback(context: BrowserContext, url: string): Promise<void> {
  const page = await context.newPage()
  try {
    await page.goto(`${url}?backend=webgl2`)
    await ready(page, 'phosphor-crt', 'webgl2')
    await assertLiveImage(page, 'Explicit WebGL2 fallback')
    await selectExample(page, 'cursor-warp', 'webgl2')
    await assertLiveImage(page, 'WebGL2 Ghostty cursor shader')
    checks.push(
      'Explicit WebGL2 reports its real backend and renders the terminal with two shaders',
    )
  } finally {
    await page.close()
  }
}

async function verifyVisibleErrors(context: BrowserContext, url: string): Promise<void> {
  const page = await context.newPage()
  try {
    await page.route('**/*.wasm', (route) => route.abort('failed'))
    await page.goto(url)
    const alert = page.locator('[role="alert"]').first()
    await alert.waitFor({ state: 'visible', timeout: 60_000 })
    const message = await alert.innerText()
    assert(message.trim().length > 12, 'WASM load failure produced no useful visible error')
    checks.push('Failed WASM loading produces a visible error message')
  } finally {
    await page.close()
  }
}

async function verifyPage(context: BrowserContext, url: string): Promise<void> {
  const errors: string[] = []
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(url)
    await ready(page, 'phosphor-crt', 'webgpu')
    await verifyDesktopBounds(page)
    await verifyExamples(page)
    await verifyPauseAndEffect(page)
    await verifyCursorEffect(page)
    await verifySteadyEffects(page)
    await verifyRapidSwitching(page)
    assert(errors.length === 0, `Unhandled showcase errors: ${errors.join('\n')}`)
  } catch (error) {
    await page
      .screenshot({ path: join(artifacts, 'showcase-failure.png'), fullPage: true })
      .catch(() => undefined)
    throw error
  } finally {
    await page.close()
  }
}

async function run(): Promise<void> {
  await access(join(artifacts, 'showcase/index.html'))
  const interrupted = new AbortController()
  let scratch: string | undefined
  let server: ReturnType<typeof Bun.serve> | undefined
  let browser: Browser | undefined
  const stop = () => {
    interrupted.abort()
    void browser?.close()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    scratch = await mkdtemp(join(process.env.SHADERC_TEST_TMPDIR ?? tmpdir(), 'shader-showcase-'))
    const env = browserEnvironment(scratch)
    server = serveBundle()
    browser = await chromium.launch({
      headless: true,
      args: [
        '--enable-unsafe-webgpu',
        '--use-angle=vulkan',
        '--enable-features=Vulkan,VulkanFromANGLE',
        '--use-webgpu-adapter=swiftshader',
      ],
      env,
    })
    interrupted.signal.throwIfAborted()
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    })
    const url = server.url.toString()
    await verifyPage(context, url)
    await verifyFallback(context, url)
    await verifyMobile(context, url)
    await verifyVisibleErrors(context, url)
    await writeFile(
      join(artifacts, 'showcase-verification.json'),
      JSON.stringify(
        {
          ok: true,
          browser: 'Chromium SwiftShader',
          checks,
          retainedArtifacts: ['showcase-desktop.png', 'showcase-mobile.png'],
        },
        null,
        2,
      ) + '\n',
    )
    await rm(join(artifacts, 'showcase-failure.png'), { force: true })
    console.log(
      `Showcase verification passed: ${checks.length} checks; real GhosttyWASM + WebGPU/WebGL2, five shaders, code views, pause/effect, rapid switching, mobile and error handling`,
    )
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    await browser?.close()
    server?.stop(true)
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true })
  }
}

try {
  await run()
} catch (error) {
  await mkdir(artifacts, { recursive: true })
  await writeFile(
    join(artifacts, 'showcase-verification.json'),
    JSON.stringify(
      { ok: false, checks, error: error instanceof Error ? error.stack : String(error) },
      null,
      2,
    ) + '\n',
  )
  throw error
}

for (const filename of [
  'showcase-verification.json',
  'showcase-desktop.png',
  'showcase-mobile.png',
]) {
  console.log(`${filename}: ${(await stat(join(artifacts, filename))).size} bytes`)
}
