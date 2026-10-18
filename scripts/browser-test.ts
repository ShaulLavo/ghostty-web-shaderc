import { existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { withPackedConsumer } from './package-test.js'

function browserEnvironment(): Record<string, string> {
  const driver = join(dirname(chromium.executablePath()), 'vk_swiftshader_icd.json')
  if (!existsSync(driver))
    throw new Error('Cached Chromium SwiftShader driver missing; install Playwright Chromium first')
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env))
    if (value !== undefined) environment[name] = value
  return { ...environment, VK_ICD_FILENAMES: driver, VK_DRIVER_FILES: driver }
}

function serveBundle(directory: string): ReturnType<typeof Bun.serve> {
  const root = resolve(directory)
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname)
      const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!path.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })
      const file = Bun.file(path)
      if (!(await file.exists())) return new Response('Not found', { status: 404 })
      return new Response(file, {
        headers: {
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'",
        },
      })
    },
  })
}

function captureBrowserErrors(page: Page, errors: string[]): void {
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
}

async function verifyBrowser(consumer: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const env = browserEnvironment()
  const server = serveBundle(join(consumer, 'dist'))
  const errors: string[] = []
  let browser: Browser | undefined
  const stop = () => {
    void browser?.close()
  }
  signal.addEventListener('abort', stop, { once: true })
  try {
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
    signal.throwIfAborted()
    const page = await browser.newPage()
    captureBrowserErrors(page, errors)
    await page.goto(server.url.toString())
    await page.locator('#result[data-status]').waitFor({ timeout: 120_000 })
    const status = await page.locator('#result').getAttribute('data-status')
    const result = await page.locator('#result').textContent()
    if (status !== 'passed' || errors.length > 0)
      throw new Error(`Browser verification failed\n${result}\n${errors.join('\n')}`)
    console.log(`Real Chromium software GPU verification passed under strict CSP: ${result}`)
  } finally {
    signal.removeEventListener('abort', stop)
    await browser?.close()
    server.stop(true)
  }
}

await withPackedConsumer(verifyBrowser)
