import { expect, test } from 'bun:test'
import type { BunPlugin } from 'bun'
import { runInNewContext } from 'node:vm'

const nagaLoader: BunPlugin = {
  name: 'real-naga-test-loader',
  setup(build) {
    build.onResolve({ filter: /^\.\/loader\.js$/ }, () => ({
      path: 'loader',
      namespace: 'test',
    }))
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
      contents: 'export async function getShaderCompiler() { return globalThis.testNaga }',
      loader: 'js',
    }))
  },
}

async function bundledCompiler(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [new URL('../../src/compiler.ts', import.meta.url).pathname],
    format: 'cjs',
    target: 'browser',
    plugins: [nagaLoader],
  })
  const output = result.outputs[0]
  if (!result.success || output === undefined) {
    throw new Error(result.logs.map((log) => log.message).join('\n'))
  }
  return output.text()
}

test('compiles and releases real WASM handles without Symbol.dispose', async () => {
  const naga = await import('naga-wasm')
  const wasm = await naga.init()
  const symbols: object = Object.create(Symbol)
  Object.defineProperty(symbols, 'dispose', { value: undefined })
  const module: { exports: Record<string, unknown> } = { exports: {} }
  // Only this isolated realm lacks the symbol; no production or test-runner globals change.
  const sandbox = { module, testNaga: naga, Symbol: symbols }
  runInNewContext(await bundledCompiler(), sandbox, { timeout: 5000 })
  expect(runInNewContext('typeof Symbol.dispose', sandbox)).toBe('undefined')
  const compile = module.exports.compileGhosttyShader
  if (typeof compile !== 'function') throw new Error('Compiler export is missing')
  const source = 'void mainImage(out vec4 c,vec2 p){c=texture(iChannel0,p/iResolution.xy);}'
  const program: unknown = await compile(source)
  if (program === null || typeof program !== 'object' || !('wgsl' in program)) {
    throw new Error('Compiler returned no shader artifact')
  }
  expect(program.wgsl).toEqual(expect.stringContaining('@fragment'))

  const failures = [
    {
      source: 'void mainImage(out vec4 c,vec2 p){c=vec4(NOPE);}',
      kind: 'parse',
    },
    {
      source: 'void mainImage(out vec4 c,vec2 p){float x=vec3(1.);c=vec4(1.);}',
      kind: 'validation',
    },
    {
      source: 'void mainImage(out vec4 c,vec2 p){dvec2 x=dvec2(1.);c=vec4(vec2(x),0.,1.);}',
      kind: 'write',
    },
  ]
  for (const failure of failures) {
    await expect(compile(failure.source)).rejects.toMatchObject({ kind: failure.kind })
  }
  const before = wasm.memory.buffer.byteLength
  for (let index = 0; index < 100; index += 1) {
    await compile(source)
    for (const failure of failures) {
      await expect(compile(failure.source)).rejects.toMatchObject({ kind: failure.kind })
    }
  }
  expect(wasm.memory.buffer.byteLength).toBe(before)
})
