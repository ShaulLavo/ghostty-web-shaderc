import type { CompiledGhosttyShader } from 'ghostty-web-shaderc'
import { examples } from './catalog.js'
import { showCode } from './code-view.js'
import type { CodeLanguage } from './code-view.js'
import { createTerminalPreview } from './preview.js'
import './styles.css'

type Example = (typeof examples)[number]
type TerminalPreview = Awaited<ReturnType<typeof createTerminalPreview>>
type FileId = 'entry' | 'source' | 'wgsl' | 'glsl'
type Compilation =
  | { kind: 'compiling' }
  | { kind: 'ready'; shader: CompiledGhosttyShader; duration: number }
  | { kind: 'failed'; message: string }

function element(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (!(found instanceof HTMLElement)) throw new Error(`Missing page element: ${id}`)
  return found
}

function button(id: string): HTMLButtonElement {
  const found = element(id)
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Expected button: ${id}`)
  return found
}

function exampleSelect(): HTMLSelectElement {
  const found = element('example-select')
  if (!(found instanceof HTMLSelectElement)) throw new Error('Missing example selector')
  return found
}

const app = element('app')
const select = exampleSelect()
const pauseButton = button('pause-button')
const effectButton = button('effect-button')
const copyButton = button('copy-button')
const fileButtons = new Map<FileId, HTMLButtonElement>()
const codeElements = {
  code: element('source-code'),
  gutter: element('code-gutter'),
  lineCount: element('code-line-count'),
  scroll: element('code-scroll'),
}
let selected: Example = examples[0]
let selectedFile: FileId = 'entry'
let compilation: Compilation = { kind: 'compiling' }
let preview: TerminalPreview | null = null
let request = 0
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches
let effectEnabled = true
let currentCode = ''
let disposed = false
let copyReset: ReturnType<typeof setTimeout> | undefined
let shaderApply: Promise<void> = Promise.resolve()

const previewReady = initializePreview()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function previewError(error: Error): void {
  const message = element('preview-message')
  message.textContent = error.message
  message.dataset.state = 'error'
  message.setAttribute('role', 'alert')
  message.hidden = false
  app.dataset.preview = 'error'
  app.dataset.status = 'error'
}

async function initializePreview(): Promise<TerminalPreview | null> {
  try {
    const backend =
      new URLSearchParams(location.search).get('backend') === 'webgl2' ? 'webgl2' : 'webgpu'
    const created = await createTerminalPreview(element('terminal-preview'), {
      backend,
      onError: previewError,
    })
    if (disposed) {
      created.dispose()
      return null
    }
    preview = created
    element('backend-badge').textContent = created.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'
    element('backend-badge').dataset.ready = 'true'
    element('preview-message').hidden = true
    app.dataset.preview = 'ready'
    app.dataset.backend = created.backend
    pauseButton.disabled = false
    effectButton.disabled = false
    return created
  } catch (error) {
    previewError(new Error(errorMessage(error)))
    element('backend-badge').textContent = 'GPU unavailable'
    return null
  }
}

function createFile(id: FileId, label: string, extension: string, generated: boolean): void {
  const target = generated ? element('generated-files') : element('source-files')
  const item = document.createElement('button')
  const icon = document.createElement('span')
  const name = document.createElement('span')
  item.type = 'button'
  item.className = 'file-button'
  item.setAttribute('role', 'tab')
  item.setAttribute('aria-controls', 'source-code')
  item.dataset.file = id
  item.id = `file-${id}`
  icon.className = `file-icon file-icon-${extension}`
  icon.textContent = extension
  icon.setAttribute('aria-hidden', 'true')
  name.className = 'file-name'
  name.textContent = label
  item.append(icon, name)
  item.addEventListener('click', () => {
    selectedFile = id
    renderFile()
  })
  target.append(item)
  fileButtons.set(id, item)
}

function initializeFiles(): void {
  createFile('entry', 'index.ts', 'ts', false)
  createFile('source', selected.sourceFilename, 'gl', false)
  createFile('wgsl', 'compiled.wgsl', 'wg', true)
  createFile('glsl', 'compiled.glsl', 'gl', true)
  for (const group of [element('source-files'), element('generated-files')]) {
    group.addEventListener('keydown', navigateFiles)
  }
}

function navigateFiles(event: KeyboardEvent): void {
  if (
    event.key !== 'ArrowDown' &&
    event.key !== 'ArrowUp' &&
    event.key !== 'ArrowLeft' &&
    event.key !== 'ArrowRight'
  )
    return
  const available = Array.from(fileButtons.values()).filter((item) => !item.disabled)
  const current = available.findIndex((item) => item === document.activeElement)
  const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
  const target = available[(current + direction + available.length) % available.length]
  event.preventDefault()
  target?.click()
  target?.focus()
}

function getFile(): { label: string; source: string; language: CodeLanguage; origin: string } {
  if (selectedFile === 'entry')
    return {
      label: 'index.ts',
      source: selected.typescript,
      language: 'typescript',
      origin: 'Runtime entry point',
    }
  if (selectedFile === 'source')
    return {
      label: selected.sourceFilename,
      source: selected.source,
      language: 'glsl',
      origin: 'ShaderToy / Ghostty source',
    }
  if (compilation.kind !== 'ready')
    return {
      label: 'Compiling…',
      source: '',
      language: 'wgsl',
      origin: 'Waiting for the runtime compiler',
    }
  if (selectedFile === 'wgsl')
    return {
      label: 'compiled.wgsl',
      source: compilation.shader.wgsl,
      language: 'wgsl',
      origin: 'Generated in this browser · WebGPU',
    }
  return {
    label: 'compiled.glsl',
    source: compilation.shader.glsl,
    language: 'glsl',
    origin: 'Generated in this browser · WebGL2',
  }
}

function updateFileButton(item: HTMLButtonElement, id: FileId): void {
  const active = selectedFile === id
  item.setAttribute('aria-selected', String(active))
  item.tabIndex = active ? 0 : -1
  item.disabled = (id === 'wgsl' || id === 'glsl') && compilation.kind !== 'ready'
  if (id !== 'source') return
  const name = item.querySelector('.file-name')
  if (name) name.textContent = selected.sourceFilename
}

function renderFile(): void {
  const file = getFile()
  currentCode = file.source
  for (const [id, item] of fileButtons) updateFileButton(item, id)
  element('file-label').textContent = file.label
  element('file-kind').textContent =
    file.language === 'typescript' ? 'TypeScript' : file.language.toUpperCase()
  element('file-origin').textContent = file.origin
  codeElements.code.setAttribute('aria-label', file.label)
  codeElements.code.setAttribute('aria-labelledby', `file-${selectedFile}`)
  showCode(codeElements, file.source, file.language)
  copyButton.disabled = !file.source
  resetCopyButton()
}

function renderCredit(): void {
  const host = element('example-credit')
  host.replaceChildren()
  if (!selected.credit) {
    host.textContent = 'Original example · MIT'
    return
  }
  const link = document.createElement('a')
  link.href = selected.credit.url
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.textContent = `${selected.credit.author} ↗`
  const license = document.createElement('span')
  license.textContent = selected.credit.license
  host.append(link, license)
}

function renderSelection(): void {
  select.value = selected.id
  app.dataset.example = selected.id
  app.dataset.state = 'compiling'
  app.dataset.status = 'compiling'
  element('tree-project').textContent = selected.id
  element('example-description').textContent = selected.description
  element('example-position').textContent = `${examples.indexOf(selected) + 1} / ${examples.length}`
  element('compile-indicator').dataset.state = 'compiling'
  element('compile-status').textContent = 'Compiling shader in the browser…'
  element('compile-status').removeAttribute('role')
  renderCredit()
  renderFile()
}

function compileSucceeded(shader: CompiledGhosttyShader, duration: number): void {
  compilation = { kind: 'ready', shader, duration }
  app.dataset.state = 'ready'
  element('compile-indicator').dataset.state = 'ready'
  element('compile-status').textContent = `Compiled both outputs in ${duration.toFixed(1)} ms`
  renderFile()
}

function compileFailed(error: unknown): void {
  compilation = { kind: 'failed', message: errorMessage(error) }
  app.dataset.state = 'error'
  app.dataset.status = 'error'
  element('compile-indicator').dataset.state = 'error'
  element('compile-status').textContent = compilation.message
  element('compile-status').setAttribute('role', 'alert')
}

async function applyShader(shader: CompiledGhosttyShader, token: number): Promise<void> {
  const renderer = await previewReady
  if (!renderer || token !== request || disposed) return
  shaderApply = shaderApply
    .catch(() => undefined)
    .then(async () => {
      if (token !== request || disposed) return
      await renderer.setShader(shader)
    })
  try {
    await shaderApply
  } catch (error) {
    if (token === request) previewError(new Error(errorMessage(error)))
    return
  }
  if (token === request && app.dataset.preview !== 'error') app.dataset.status = 'ready'
}

async function selectExample(example: Example): Promise<void> {
  const token = ++request
  selected = example
  compilation = { kind: 'compiling' }
  if (selectedFile === 'wgsl' || selectedFile === 'glsl') selectedFile = 'entry'
  renderSelection()
  const start = performance.now()
  try {
    const shader = await example.compile()
    if (token !== request || disposed) return
    compileSucceeded(shader, performance.now() - start)
    await applyShader(shader, token)
  } catch (error) {
    if (token === request && !disposed) compileFailed(error)
  }
}

function moveExample(direction: number): void {
  const index = (examples.indexOf(selected) + direction + examples.length) % examples.length
  const example = examples[index]
  if (example) void selectExample(example)
}

function resetCopyButton(): void {
  if (copyReset) clearTimeout(copyReset)
  const label = copyButton.querySelector('span')
  if (label) label.textContent = 'Copy'
}

async function copyCode(): Promise<void> {
  const label = copyButton.querySelector('span')
  if (!label) return
  try {
    await navigator.clipboard.writeText(currentCode)
    label.textContent = 'Copied'
  } catch {
    label.textContent = 'Unavailable'
  }
  copyReset = setTimeout(resetCopyButton, 1600)
}

function renderPauseState(): void {
  pauseButton.setAttribute('aria-pressed', String(paused))
  const label = pauseButton.querySelector('span')
  const icon = pauseButton.querySelector('path')
  if (label) label.textContent = paused ? 'Resume' : 'Pause'
  if (icon) icon.setAttribute('d', paused ? 'M4 2.5 13 8l-9 5.5z' : 'M4 3h3v10H4zm5 0h3v10H9z')
  element('preview-state').lastChild?.remove()
  element('preview-state').append(paused ? 'Paused' : 'Live')
  element('preview-state').dataset.paused = String(paused)
}

function togglePaused(): void {
  paused = !paused
  preview?.setPaused(paused)
  renderPauseState()
}

function toggleEffect(): void {
  effectEnabled = !effectEnabled
  preview?.setEffectEnabled(effectEnabled)
  effectButton.setAttribute('aria-pressed', String(effectEnabled))
  effectButton.lastChild?.remove()
  effectButton.append(effectEnabled ? 'Shader on' : 'Shader off')
}

function teardown(): void {
  disposed = true
  preview?.dispose()
  if (copyReset) clearTimeout(copyReset)
}

for (const example of examples) {
  const option = document.createElement('option')
  option.value = example.id
  option.dataset.exampleId = example.id
  option.textContent = example.title
  select.append(option)
}
initializeFiles()
renderPauseState()
select.addEventListener('change', () => {
  const example = examples.find((candidate) => candidate.id === select.value)
  if (example) void selectExample(example)
})
button('previous-example').addEventListener('click', () => moveExample(-1))
button('next-example').addEventListener('click', () => moveExample(1))
pauseButton.addEventListener('click', togglePaused)
effectButton.addEventListener('click', toggleEffect)
copyButton.addEventListener('click', () => {
  void copyCode()
})
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) teardown()
})
if (import.meta.hot) import.meta.hot.dispose(teardown)
void selectExample(selected)
