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
  | { kind: 'ready'; shader: CompiledGhosttyShader }
  | { kind: 'failed'; message: string }

function element(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (!(found instanceof HTMLElement)) throw new Error(`Missing page element: ${id}`)
  return found
}

function exampleSelect(): HTMLSelectElement {
  const found = element('example-select')
  if (!(found instanceof HTMLSelectElement)) throw new Error('Missing example selector')
  return found
}

const app = element('app')
const select = exampleSelect()
const fileButtons = new Map<FileId, HTMLButtonElement>()
const codeElements = {
  code: element('source-code'),
  gutter: element('code-gutter'),
  scroll: element('code-scroll'),
}
let selected: Example = examples[0]
let selectedFile: FileId = 'entry'
let compilation: Compilation = { kind: 'compiling' }
let preview: TerminalPreview | null = null
let request = 0
let disposed = false
let shaderApply: Promise<void> = Promise.resolve()

const previewReady = initializePreview()

function errorMessage(error: unknown): string {
  const messages: string[] = []
  const seen = new Set<Error>()
  let current = error
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    if (!messages.includes(current.message)) messages.push(current.message)
    current = current.cause
  }
  return messages.length > 0 ? messages.join(': ') : String(error)
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
    element('preview-message').hidden = true
    app.dataset.preview = 'ready'
    app.dataset.backend = created.backend
    return created
  } catch (error) {
    previewError(new Error(errorMessage(error)))
    return null
  }
}

function createFile(id: FileId, label: string): void {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'file-button'
  item.setAttribute('role', 'tab')
  item.setAttribute('aria-controls', 'source-code')
  item.dataset.file = id
  item.id = `file-${id}`
  item.textContent = label
  item.addEventListener('click', () => {
    selectedFile = id
    renderFile()
  })
  element('file-tabs').append(item)
  fileButtons.set(id, item)
}

function initializeFiles(): void {
  createFile('entry', 'index.ts')
  createFile('source', 'shader.glsl')
  createFile('wgsl', 'output.wgsl')
  createFile('glsl', 'output.glsl')
  element('file-tabs').addEventListener('keydown', navigateFiles)
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

function getFile(): { label: string; source: string; language: CodeLanguage } {
  if (selectedFile === 'entry')
    return {
      label: 'index.ts',
      source: selected.typescript,
      language: 'typescript',
    }
  if (selectedFile === 'source')
    return {
      label: selected.sourceFilename,
      source: selected.source,
      language: 'glsl',
    }
  if (compilation.kind !== 'ready')
    return {
      label: 'Compiling…',
      source: '',
      language: 'wgsl',
    }
  if (selectedFile === 'wgsl')
    return {
      label: 'output.wgsl',
      source: compilation.shader.wgsl,
      language: 'wgsl',
    }
  return {
    label: 'output.glsl',
    source: compilation.shader.glsl,
    language: 'glsl',
  }
}

function updateFileButton(item: HTMLButtonElement, id: FileId): void {
  const active = selectedFile === id
  item.setAttribute('aria-selected', String(active))
  item.tabIndex = active ? 0 : -1
  item.disabled = (id === 'wgsl' || id === 'glsl') && compilation.kind !== 'ready'
}

function renderFile(): void {
  const file = getFile()
  for (const [id, item] of fileButtons) updateFileButton(item, id)
  codeElements.code.setAttribute('aria-label', file.label)
  codeElements.code.setAttribute('aria-labelledby', `file-${selectedFile}`)
  showCode(codeElements, file.source, file.language)
}

function renderSelection(): void {
  select.value = selected.id
  app.dataset.example = selected.id
  app.dataset.state = 'compiling'
  app.dataset.status = 'compiling'
  renderFile()
}

function compileSucceeded(shader: CompiledGhosttyShader): void {
  compilation = { kind: 'ready', shader }
  app.dataset.state = 'ready'
  renderFile()
}

function compileFailed(error: unknown): void {
  compilation = { kind: 'failed', message: errorMessage(error) }
  app.dataset.state = 'error'
  app.dataset.status = 'error'
  previewError(new Error(compilation.message))
  renderFile()
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
  try {
    const shader = await example.compile()
    if (token !== request || disposed) return
    compileSucceeded(shader)
    await applyShader(shader, token)
  } catch (error) {
    if (token === request && !disposed) compileFailed(error)
  }
}

function teardown(): void {
  disposed = true
  preview?.dispose()
}

for (const example of examples) {
  const option = document.createElement('option')
  option.value = example.id
  option.textContent = example.title
  select.append(option)
}

initializeFiles()
select.addEventListener('change', () => {
  const example = examples.find((candidate) => candidate.id === select.value)
  if (example) void selectExample(example)
})
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) teardown()
})
if (import.meta.hot) import.meta.hot.dispose(teardown)
void selectExample(selected)
