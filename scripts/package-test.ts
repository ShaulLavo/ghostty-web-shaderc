import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const repository = dirname(dirname(fileURLToPath(import.meta.url)))
const shaderSource =
  'void mainImage(out vec4 color, in vec2 coord) { color = vec4(0.25, 0.5, 0.75, 1.0); }'

async function streamText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Subprocess returned a non-buffer chunk')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal)
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error
  }
}

async function command(
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
  allowFailure = false,
): Promise<{ stdout: string; stderr: string }> {
  signal.throwIfAborted()
  const executable = args[0]
  if (!executable) throw new Error('Missing subprocess executable')
  const child = spawn(executable, args.slice(1), {
    cwd,
    env: process.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
  let escalation: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    killGroup(child.pid, 'SIGTERM')
    escalation = setTimeout(() => killGroup(child.pid, 'SIGKILL'), 2_000)
    escalation.unref()
  }
  bounded.addEventListener('abort', stop, { once: true })
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  let output: [string, string, number | null]
  try {
    output = await Promise.all([streamText(child.stdout), streamText(child.stderr), exited])
  } finally {
    bounded.removeEventListener('abort', stop)
    clearTimeout(escalation)
    killGroup(child.pid, 'SIGKILL')
    await exited.catch(() => null)
  }
  bounded.throwIfAborted()
  const [stdout, stderr, code] = output
  if (code !== 0 && !allowFailure)
    throw new Error(`${args.join(' ')} exited ${code}\n${stdout}\n${stderr}`)
  if (allowFailure && code === 0) throw new Error(`Expected ${args.join(' ')} to fail`)
  return { stdout, stderr }
}

function checkArtifact(json: string): void {
  const artifact: unknown = JSON.parse(json)
  if (typeof artifact !== 'object' || artifact === null) throw new Error('CLI returned no artifact')
  if (!('schemaVersion' in artifact) || artifact.schemaVersion !== 1)
    throw new Error('CLI returned wrong schema')
  if (
    !('wgsl' in artifact) ||
    typeof artifact.wgsl !== 'string' ||
    !artifact.wgsl.includes('@fragment')
  )
    throw new Error('CLI omitted WGSL')
  if (
    !('glsl' in artifact) ||
    typeof artifact.glsl !== 'string' ||
    !artifact.glsl.includes('void main')
  )
    throw new Error('CLI omitted GLSL')
}

async function verifyRuntimeOnly(consumer: string, signal: AbortSignal): Promise<void> {
  const naga = join(consumer, 'node_modules/naga-wasm')
  const disabled = join(consumer, 'node_modules/.naga-wasm-disabled')
  await writeFile(
    join(consumer, 'runtime-only.mjs'),
    `import { compileGhosttyShader, initializeShaderCompiler } from 'ghostty-web-shaderc';
import { packShaderUniforms, FULLSCREEN_VERTEX_WGSL } from 'ghostty-web-shaderc/runtime';
if (typeof compileGhosttyShader !== 'function' || typeof initializeShaderCompiler !== 'function') throw new Error('Invalid lazy compiler exports');
if (!(packShaderUniforms() instanceof ArrayBuffer) || !FULLSCREEN_VERTEX_WGSL.includes('@vertex')) throw new Error('Invalid runtime exports');
`,
  )
  await rename(naga, disabled)
  try {
    await command(['node', 'runtime-only.mjs'], consumer, signal)
    await command([process.execPath, 'runtime-only.mjs'], consumer, signal)
  } finally {
    await rename(disabled, naga)
  }
}

async function verifyRuntimeCompilation(consumer: string, signal: AbortSignal): Promise<void> {
  await writeFile(
    join(consumer, 'smoke.mjs'),
    `import { compileGhosttyShader } from 'ghostty-web-shaderc';
import { packShaderUniforms } from 'ghostty-web-shaderc/runtime';
const source = ${JSON.stringify(shaderSource)};
const shaders = await Promise.all(Array.from({length: 4}, () => compileGhosttyShader(source)));
for (const shader of shaders) {
  if (shader.schemaVersion !== 1 || shader.uniformLayout !== 'ghostty-v1' || !shader.wgsl.includes('@fragment') || !shader.glsl.includes('void main')) throw new Error('Invalid compiler artifact');
}
if (!(packShaderUniforms({ iTime: 1 }) instanceof ArrayBuffer)) throw new Error('Invalid uniform buffer');
`,
  )
  await command(['node', 'smoke.mjs'], consumer, signal)
  await command([process.execPath, 'smoke.mjs'], consumer, signal)
}

async function verifyCli(consumer: string, signal: AbortSignal): Promise<void> {
  const cli = join(consumer, 'node_modules/ghostty-web-shaderc/dist/cli.js')
  await writeFile(join(consumer, 'shader.glsl'), shaderSource)
  checkArtifact((await command(['node', cli, 'shader.glsl'], consumer, signal)).stdout)
  await command(['node', cli, 'shader.glsl', '--out', 'shader.json'], consumer, signal)
  checkArtifact(await readFile(join(consumer, 'shader.json'), 'utf8'))
  await writeFile(
    join(consumer, 'invalid.glsl'),
    'void mainImage(out vec4 color, in vec2 coord) { color = invalidSymbol; }',
  )
  const invalid = await command(['node', cli, 'invalid.glsl'], consumer, signal, true)
  if (!invalid.stderr.includes('invalid.glsl:1') || !invalid.stderr.includes('invalidSymbol')) {
    throw new Error(`CLI lost original shader diagnostic: ${invalid.stderr}`)
  }
}

async function prepareConsumer(scratch: string, signal: AbortSignal): Promise<string> {
  await command([process.execPath, 'pm', 'pack', '--destination', scratch], repository, signal)
  const tarball = (await readdir(scratch)).find((name) => name.endsWith('.tgz'))
  if (!tarball) throw new Error('bun pm pack did not create a tarball')
  const consumer = join(scratch, 'consumer')
  await mkdir(consumer)
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: 'shaderc-packed-consumer',
      private: true,
      type: 'module',
      dependencies: { 'ghostty-web-shaderc': `file:../${tarball}` },
    }),
  )
  await command(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer, signal)
  await verifyRuntimeOnly(consumer, signal)
  await verifyRuntimeCompilation(consumer, signal)
  await verifyCli(consumer, signal)
  await cp(join(repository, 'test/browser'), consumer, { recursive: true })
  await mkdir(join(consumer, 'public'))
  await cp(join(repository, 'test/fixtures'), join(consumer, 'public/fixtures'), {
    recursive: true,
  })
  signal.throwIfAborted()
  await build({
    root: consumer,
    logLevel: 'warn',
    configFile: false,
    build: { outDir: join(consumer, 'dist'), emptyOutDir: true, target: 'es2022' },
    worker: { format: 'es' },
  })
  return consumer
}

export async function withPackedConsumer<T>(
  run: (consumer: string, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const temporary = process.env.SHADERC_TEST_TMPDIR ?? tmpdir()
  const interrupted = new AbortController()
  const stop = () => interrupted.abort(new Error('Verification interrupted'))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  let scratch: string | undefined
  try {
    await mkdir(temporary, { recursive: true })
    interrupted.signal.throwIfAborted()
    scratch = await mkdtemp(join(temporary, 'shaderc-'))
    const consumer = await prepareConsumer(scratch, interrupted.signal)
    interrupted.signal.throwIfAborted()
    return await run(consumer, interrupted.signal)
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  await withPackedConsumer(async () => {
    console.log(
      'Packed consumer passed: Node + Bun runtime compilation, compiler-free runtime exports, CLI, Vite main/worker WASM bundles',
    )
  })
}
