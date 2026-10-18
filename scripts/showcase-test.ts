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
const exampleIds = [
  'regular',
  'bettercrt',
  'inside-the-matrix',
  'fireworks',
  'water',
  'cursor-lightning',
]
const checks: string[] = []
type ExampleFile = 'entry' | 'source' | 'wgsl' | 'glsl'
const exampleFiles: readonly ExampleFile[] = ['entry', 'source', 'wgsl', 'glsl']

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
            document.querySelector('[role="alert"]')?.textContent ?? 'Showcase failed',
          )
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
      message: document.querySelector('[role="alert"]')?.textContent,
    }))
    throw new Error(`Showcase ${id} did not become ready: ${JSON.stringify(status)}`, { cause })
  }
  await page
    .locator(`canvas[data-terminal-preview][data-ready="true"][data-backend="${backend}"]`)
    .waitFor()
}

async function selectedCode(page: Page, file: ExampleFile): Promise<string> {
  await page.locator(`[data-file="${file}"]`).click()
  return (await page.locator('#source-code').innerText()).trim()
}

async function verifyCode(page: Page, id: string): Promise<void> {
  const source = await readFile(join(repository, 'examples/showcase/shaders', `${id}.glsl`), 'utf8')
  const entry = await readFile(join(repository, 'examples/showcase/entries', `${id}.ts`), 'utf8')
  const compiled = await compileGhosttyShader(source)
  assert((await selectedCode(page, 'source')) === source.trim(), `${id}: source viewer is stale`)
  assert((await selectedCode(page, 'entry')) === entry.trim(), `${id}: TypeScript viewer is stale`)
  assert((await selectedCode(page, 'wgsl')) === compiled.wgsl.trim(), `${id}: WGSL viewer is stale`)
  assert((await selectedCode(page, 'glsl')) === compiled.glsl.trim(), `${id}: GLSL viewer is stale`)
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
    summary.nonemptyRegions >= 2,
    `${label}: terminal content occupies too little of the canvas`,
  )
  checks.push(`${label}: visible terminal pixels across ${summary.nonemptyRegions}/6 regions`)
  return summary
}

async function selectExample(page: Page, id: string, backend: 'webgpu' | 'webgl2'): Promise<void> {
  await page.locator('#example-select').selectOption(id)
  await ready(page, id, backend)
}

function terminalFillsPane(): boolean {
  const pane = document.querySelector<HTMLElement>('.preview-pane')
  const source = document.querySelector<HTMLElement>('.terminal-source')
  const output = document.querySelector<HTMLCanvasElement>('canvas[data-terminal-preview]')
  if (!pane || !source || !output || output.width === 0 || output.height === 0) return false
  const bounds = pane.getBoundingClientRect()
  const canvas = output.getBoundingClientRect()
  const imageHeight = (canvas.width * output.height) / output.width
  return (
    Math.abs(source.clientWidth - bounds.width) <= 1 &&
    Math.abs(source.clientHeight - bounds.height) <= 1 &&
    Math.abs(canvas.left - bounds.left) <= 1 &&
    Math.abs(canvas.right - bounds.right) <= 1 &&
    Math.abs(canvas.top - bounds.top) <= 1 &&
    Math.abs(canvas.bottom - bounds.bottom) <= 1 &&
    Math.abs(imageHeight - canvas.height) <= 2
  )
}

async function verifyTerminalFill(page: Page): Promise<void> {
  await page.waitForFunction(terminalFillsPane, undefined, { timeout: 15_000 })
}

async function verifyMinimalChrome(page: Page): Promise<void> {
  const structure = await page.evaluate(() => {
    const preview = document.querySelector<HTMLElement>('.preview-pane')?.getBoundingClientRect()
    const canvas = document
      .querySelector<HTMLCanvasElement>('canvas[data-terminal-preview]')
      ?.getBoundingClientRect()
    const select = document.querySelector('#example-select')
    return {
      preview,
      canvas,
      hasBrand: Boolean(document.querySelector('.brand')),
      hasPause: Boolean(document.querySelector('#pause-button')),
      hasEffect: Boolean(document.querySelector('#effect-button')),
      hasCopy: Boolean(document.querySelector('#copy-button')),
      hasBackend: Boolean(document.querySelector('#backend-badge')),
      toolbarControls: document.querySelectorAll('.toolbar > *').length,
      hasSelector: Boolean(select),
    }
  })
  assert(
    !structure.hasBrand && !structure.hasPause && !structure.hasEffect,
    'Showcase still has extra toolbar controls',
  )
  assert(!structure.hasCopy && !structure.hasBackend, 'Showcase still has copy/backend chrome')
  assert(
    structure.toolbarControls === 1 && structure.hasSelector,
    'Toolbar should contain only the shader selector',
  )
  assert(structure.preview && structure.canvas, 'Terminal preview is missing')
  assert(
    Math.abs(structure.preview.left - structure.canvas.left) <= 1,
    'Terminal has an unexpected left inset',
  )
  assert(
    Math.abs(structure.preview.right - structure.canvas.right) <= 1,
    'Terminal has an unexpected right inset',
  )
  await verifyTerminalFill(page)
  checks.push('Minimal chrome keeps only the selector, full-pane terminal, file tabs and code')
}

async function verifyExamples(page: Page): Promise<void> {
  const options = await page
    .locator('#example-select option')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('value')))
  assert(
    options.length === exampleIds.length && exampleIds.every((id) => options.includes(id)),
    'Example selector does not contain the regular control and upstream shader set',
  )
  await verifyMinimalChrome(page)
  for (const id of exampleIds) {
    await selectExample(page, id, 'webgpu')
    await verifyCode(page, id)
    await assertLiveImage(page, `WebGPU ${id}`)
  }
  checks.push('All six shaders compile at runtime and show source, WGSL and GLSL')
}

async function verifyRegularSwitching(page: Page): Promise<void> {
  for (const id of ['bettercrt', 'regular', 'water']) {
    await selectExample(page, id, 'webgpu')
    await verifyCode(page, id)
    await assertLiveImage(page, `Shader/control switch to ${id}`)
  }
  checks.push(
    'Switching from a shader to Regular and back preserves the terminal and matching output',
  )
}

async function verifyRapidSwitching(page: Page): Promise<void> {
  await page.locator('#example-select').evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) throw new Error('Example selector is not a select')
    for (const id of [
      'water',
      'bettercrt',
      'regular',
      'bettercrt',
      'fireworks',
      'inside-the-matrix',
      'cursor-lightning',
    ]) {
      element.value = id
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
  await ready(page, 'cursor-lightning', 'webgpu')
  await verifyCode(page, 'cursor-lightning')
  checks.push('Rapid switching settles on the latest upstream shader')
}

interface CodeScrollResult {
  readonly clientHeight: number
  readonly lineCount: number
  readonly maxTop: number
  readonly syntaxColors: number
}

async function codeScrollPresentation() {
  const scroll = document.querySelector<HTMLElement>('#code-scroll')
  const gutter = document.querySelector<HTMLElement>('#code-gutter')
  const code = document.querySelector<HTMLElement>('#source-code')
  if (!scroll || !gutter || !code) throw new Error('Code viewer is missing')
  const content = code.closest('pre')
  if (!(content instanceof HTMLElement)) throw new Error('Code content is missing')
  const pane = scroll.parentElement
  if (!pane) throw new Error('Code pane is missing')
  const style = getComputedStyle(gutter)
  const lineHeight = Number.parseFloat(style.lineHeight)
  const paddingTop = Number.parseFloat(style.paddingTop)
  const lineCount = (gutter.textContent ?? '').split('\n').length
  const maxTop = scroll.scrollHeight - scroll.clientHeight
  const maxLeft = scroll.scrollWidth - scroll.clientWidth
  const positions = Array.from(
    new Set([
      0,
      Math.min(paddingTop + lineHeight * 17, maxTop),
      Math.min(Math.ceil(maxTop / 2), maxTop),
      maxTop,
    ]),
  )

  const sampleAt = async (top: number) => {
    scroll.scrollTo({ top, left: maxLeft })
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const scrollBounds = scroll.getBoundingClientRect()
    const gutterBounds = gutter.getBoundingClientRect()
    const firstLine = Math.max(1, Math.ceil((scroll.scrollTop - paddingTop) / lineHeight) + 1)
    const lastLine = Math.min(
      lineCount,
      Math.floor((scroll.scrollTop + scroll.clientHeight - paddingTop) / lineHeight),
    )
    const lines = Array.from(new Set([firstLine, 18, lastLine])).filter(
      (line) => line >= 1 && line <= lineCount,
    )
    const rows = lines
      .map((line) => {
        const y = gutterBounds.top + paddingTop + (line - 0.5) * lineHeight
        const visible = y > scrollBounds.top && y < scrollBounds.bottom
        const covered = [gutterBounds.left + 2, gutterBounds.right - 2].every(
          (x) => document.elementFromPoint(x, y) === gutter,
        )
        return { line, visible, covered }
      })
      .filter((row) => row.visible)
    return {
      top: scroll.scrollTop,
      left: scroll.scrollLeft,
      pinned: Math.abs(gutterBounds.left - scrollBounds.left) <= 1,
      coversRows: gutter.clientHeight >= content.scrollHeight - 1,
      rows,
    }
  }

  const samples = []
  for (const top of positions) samples.push(await sampleAt(top))
  const baseColor = getComputedStyle(code).color
  const syntaxColors = new Set(
    Array.from(
      code.querySelectorAll('[class*="hljs-"]:not(.hljs-comment)'),
      (token) => getComputedStyle(token).color,
    ).filter((color) => color !== baseColor),
  ).size
  return {
    clientHeight: scroll.clientHeight,
    lineCount,
    maxTop,
    maxLeft,
    samples,
    syntaxColors,
    opaque: style.backgroundColor === getComputedStyle(pane).backgroundColor,
  }
}

async function verifyCodeScroll(page: Page, label: string): Promise<CodeScrollResult> {
  const result = await page.evaluate(codeScrollPresentation)

  assert(result.syntaxColors >= 2, `${label}: syntax highlighting is missing readable colors`)
  assert(result.opaque, `${label}: gutter background does not hide scrolled code`)
  for (const sample of result.samples) {
    const position = `${label} at scroll ${sample.left},${sample.top}`
    assert(sample.pinned, `${position}: line numbers moved horizontally`)
    assert(sample.coversRows, `${position}: gutter background does not cover all code rows`)
    assert(sample.rows.length > 0, `${position}: no visible line numbers were checked`)
    assert(
      sample.rows.every((row) => row.covered),
      `${position}: code paints over line numbers ${sample.rows
        .filter((row) => !row.covered)
        .map((row) => row.line)
        .join(', ')}`,
    )
  }
  assert(
    result.maxLeft === 0 || result.samples.some((sample) => sample.left > 0),
    `${label}: horizontal code scrolling was not exercised`,
  )
  if (result.maxTop > 0) {
    assert(
      result.samples.some((sample) => sample.top > 0),
      `${label}: code was not scrolled beyond the first row`,
    )
  }
  assert(
    result.lineCount < 18 ||
      result.samples.some((sample) => sample.rows.some((row) => row.line === 18)),
    `${label}: line 18 was not checked`,
  )
  assert(
    result.maxTop <= result.clientHeight ||
      result.samples.some((sample) => sample.top > result.clientHeight),
    `${label}: code was not checked beyond one viewport`,
  )
  assert(
    result.samples.some((sample) => sample.rows.some((row) => row.line === result.lineCount)),
    `${label}: the final line was not checked`,
  )
  return result
}

async function verifyMobile(context: BrowserContext, url: string): Promise<void> {
  const page = await context.newPage()
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(url)
    await ready(page, 'regular', 'webgpu')
    await verifyTerminalFill(page)
    await page.setViewportSize({ width: 844, height: 390 })
    await verifyTerminalFill(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await verifyTerminalFill(page)
    await selectExample(page, 'bettercrt', 'webgpu')
    const dimensions = await page.evaluate(() => {
      const scroll = document.querySelector<HTMLElement>('#code-scroll')
      return {
        width: innerWidth,
        page: document.documentElement.scrollWidth,
        codeScrollWidth: scroll?.scrollWidth ?? 0,
        codeClientWidth: scroll?.clientWidth ?? 0,
      }
    })
    assert(
      dimensions.page <= dimensions.width + 1,
      `Mobile page overflows horizontally: ${dimensions.page}px > ${dimensions.width}px`,
    )
    assert(
      dimensions.codeScrollWidth > dimensions.codeClientWidth,
      'Mobile code viewer lost horizontal scrolling',
    )
    for (const file of exampleFiles) {
      await selectedCode(page, file)
      await verifyCodeScroll(page, `bettercrt/${file}`)
    }
    await selectExample(page, 'inside-the-matrix', 'webgpu')
    await selectedCode(page, 'source')
    const deepScroll = await verifyCodeScroll(page, 'inside-the-matrix/source')
    assert(
      deepScroll.maxTop > deepScroll.clientHeight,
      'Long shader did not exercise a scroll position beyond one viewport',
    )
    await selectExample(page, 'bettercrt', 'webgpu')
    await selectedCode(page, 'source')
    await assertLiveImage(page, '390px mobile WebGPU')
    await page.screenshot({ path: join(artifacts, 'showcase-mobile.png'), fullPage: true })
    checks.push(
      '390px mobile layout keeps colored syntax and an opaque sticky gutter through line 18 and the final line',
    )
  } finally {
    await page.close()
  }
}

async function verifyFallback(context: BrowserContext, url: string): Promise<void> {
  const page = await context.newPage()
  try {
    await page.goto(`${url}?backend=webgl2`)
    await ready(page, 'regular', 'webgl2')
    await selectExample(page, 'bettercrt', 'webgl2')
    await assertLiveImage(page, 'Explicit WebGL2 fallback')
    await selectExample(page, 'inside-the-matrix', 'webgl2')
    await assertLiveImage(page, 'WebGL2 upstream shader')
    checks.push('WebGL2 renders the upstream shader set')
  } finally {
    await page.close()
  }
}

async function verifyVisibleErrors(context: BrowserContext, url: string): Promise<void> {
  const page = await context.newPage()
  try {
    await page.route('**/*.wasm', (route) => route.abort('failed'))
    await page.goto(url)
    const alert = page.locator('[role="alert"]:visible').first()
    await alert.waitFor({ state: 'visible', timeout: 60_000 })
    assert(
      (await alert.innerText()).trim().length > 12,
      'WASM load failure produced no useful visible error',
    )
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
    await ready(page, 'regular', 'webgpu')
    await verifyExamples(page)
    await verifyRegularSwitching(page)
    await verifyRapidSwitching(page)
    await page.screenshot({ path: join(artifacts, 'showcase-desktop.png'), fullPage: true })
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
      `Showcase verification passed: ${checks.length} checks; runtime upstream shaders, WebGPU/WebGL2, code views, mobile and error handling`,
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
