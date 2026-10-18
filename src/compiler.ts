import type { GlslOutput } from 'naga-wasm'
import { ShaderCompileError } from './diagnostics.js'
import type { ShaderDiagnostic } from './diagnostics.js'
import { getShaderCompiler } from './loader.js'
import type { ShaderCompiler } from './loader.js'
import { createShaderSource } from './source.js'
import type { ShaderSource } from './source.js'
import type { CompileOptions, CompiledGhosttyShader } from './types.js'

function contractError(source: ShaderSource, message: string): ShaderCompileError {
  return new ShaderCompileError({ kind: 'contract', sourceName: source.sourceName, message })
}

function checkedMainImage(wgsl: string, source: ShaderSource): void {
  const signature = /\bfn mainImage(?:_\d+)?\(\w+: ptr<function, vec4<f32>>, \w+: vec2<f32>\) \{/u
  if (signature.test(wgsl)) return
  throw contractError(
    source,
    'Shader must define void mainImage(out vec4 color, in vec2 fragCoord)',
  )
}

function checkedResources(wgsl: string, source: ShaderSource): void {
  const declarations = wgsl.matchAll(
    /@group\((\d+)\) @binding\((\d+)\)\s+var(?:<([^>]+)>)? (\w+): ([^;]+);/gu,
  )
  const seen = new Set<string>()
  const expected = new Map([
    ['0:0', 'uniform:GhosttyUniforms'],
    ['0:1', ':texture_2d<f32>'],
    ['0:2', ':sampler'],
  ])
  for (const match of declarations) {
    const binding = `${match[1]}:${match[2]}`
    const type = `${match[3] ?? ''}:${match[5]}`
    if (expected.get(binding) !== type || seen.has(binding)) {
      throw contractError(
        source,
        'Only the Ghostty uniform block and iChannel0 are supported resources',
      )
    }
    seen.add(binding)
  }
  const locations = Array.from(wgsl.matchAll(/@location\((\d+)\)/gu), (match) => match[1])
  if (locations.length !== 2 || locations.some((location) => location !== '0')) {
    throw contractError(source, 'Custom shader inputs and outputs are not supported; use mainImage')
  }
  if (/@builtin\((?:frag_depth|sample_mask)\)/u.test(wgsl)) {
    throw contractError(source, 'Custom shader depth and sample-mask outputs are not supported')
  }
}

function webglBindings(output: GlslOutput, source: ShaderSource): CompiledGhosttyShader['webgl'] {
  let uniformBlock: string | null = null
  for (const [name, binding] of Object.entries(output.reflection.uniforms)) {
    if (binding?.group !== 0 || binding.binding !== 0 || uniformBlock !== null) {
      throw contractError(source, 'Unsupported WebGL uniform binding')
    }
    uniformBlock = name
  }
  let channel0: string | null = null
  for (const [name, binding] of Object.entries(output.reflection.textures)) {
    const texture = binding.texture
    const sampler = binding.sampler
    const supportedSampler = sampler === undefined || (sampler.group === 0 && sampler.binding === 2)
    if (texture?.group !== 0 || texture.binding !== 1 || !supportedSampler) {
      throw contractError(source, 'Unsupported WebGL texture binding')
    }
    if (channel0 !== null) throw contractError(source, 'Only iChannel0 is supported')
    channel0 = name
  }
  return { uniformBlock, channel0 }
}

function validateWgsl(compiler: ShaderCompiler, wgsl: string, source: ShaderSource): void {
  try {
    using module = compiler.parseWgsl(wgsl)
    using info = compiler.validate(module)
    void info
  } catch (cause) {
    const report = cause instanceof compiler.NagaError ? cause.formatted : String(cause)
    throw new ShaderCompileError({
      kind: 'write',
      sourceName: source.sourceName,
      message: 'The compiler could not produce valid WGSL for this shader',
      formatted: `${source.sourceName}: Generated WGSL failed validation\n${report}`,
      cause,
    })
  }
}

function compileWgsl(compiler: ShaderCompiler, source: ShaderSource): string {
  try {
    using module = compiler.parseGlsl(source.text, { stage: 'fragment' })
    using info = compiler.validate(module)
    const wgsl = compiler.writeWgsl(module, info)
    checkedMainImage(wgsl, source)
    checkedResources(wgsl, source)
    validateWgsl(compiler, wgsl, source)
    return wgsl
  } catch (error) {
    throw compileError(error, compiler, source)
  }
}

function compileGlsl(compiler: ShaderCompiler, source: ShaderSource): GlslOutput {
  try {
    using module = compiler.parseGlsl(source.text, { stage: 'fragment' })
    using info = compiler.validate(module)
    const inspection = compiler.writeWgsl(module, info)
    checkedMainImage(inspection, source)
    checkedResources(inspection, source)
    return compiler.writeGlsl(module, info, {
      version: '300 es',
      stage: 'fragment',
      entryPoint: 'main',
      reflect: true,
    })
  } catch (error) {
    throw compileError(error, compiler, source)
  }
}

function userLine(line: number, source: ShaderSource): number | null {
  const mapped = line - source.prefixLines
  return mapped >= 1 && mapped <= source.userLines ? mapped : null
}

function sourceDiagnostic(
  match: RegExpExecArray,
  message: string,
  source: ShaderSource,
): ShaderDiagnostic {
  const line = userLine(Number(match[1]), source)
  return { message, line, column: line === null ? null : Number(match[2]) }
}

function secondaryDiagnostics(
  formatted: string,
  source: ShaderSource,
  message: string,
): ShaderDiagnostic[] {
  const lines = formatted.split('\n')
  const diagnostics: ShaderDiagnostic[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const code = /^\s*(\d+) │ /u.exec(lines[index] ?? '')
    if (code === null) continue
    const line = userLine(Number(code[1]), source)
    const marker = /^\s*│ (.*)$/u.exec(lines[index + 1] ?? '')
    const column = marker?.[1]?.indexOf('^')
    if (line === null || column === undefined || column === -1) continue
    diagnostics.push({ message, line, column: column + 1 })
  }
  return diagnostics
}

function reportDiagnostics(
  formatted: string,
  source: ShaderSource,
  message: string,
): ShaderDiagnostic[] {
  const primary = Array.from(formatted.matchAll(/glsl:(\d+):(\d+)/gu), (match) =>
    sourceDiagnostic(match, message, source),
  )
  const secondary = secondaryDiagnostics(formatted, source, message)
  const diagnostics = primary.concat(secondary)
  const located = diagnostics.filter((diagnostic) => diagnostic.line !== null)
  if (located.length === 0) return primary
  const seen = new Set<string>()
  return located.filter((diagnostic) => {
    const location = `${diagnostic.line}:${diagnostic.column}`
    if (seen.has(location)) return false
    seen.add(location)
    return true
  })
}

function mappedReport(formatted: string, source: ShaderSource): string {
  return formatted
    .replace(/glsl:(\d+):(\d+)/gu, (_match, line: string, column: string) => {
      const mapped = userLine(Number(line), source)
      return mapped === null
        ? `${source.sourceName}:generated:${column}`
        : `${source.sourceName}:${mapped}:${column}`
    })
    .replace(/^(\s*)(\d+)( │)/gmu, (match, whitespace: string, line: string, separator: string) => {
      const mapped = userLine(Number(line), source)
      return mapped === null ? match : `${whitespace}${mapped}${separator}`
    })
}

function compileError(error: unknown, compiler: ShaderCompiler, source: ShaderSource): Error {
  if (error instanceof ShaderCompileError) return error
  if (!(error instanceof compiler.NagaError)) {
    return new ShaderCompileError({
      kind: 'write',
      sourceName: source.sourceName,
      message: 'Shader compilation failed',
      cause: error,
    })
  }
  if (error.message === "Unknown function 'mainImage'") {
    return contractError(
      source,
      'Shader must define void mainImage(out vec4 color, in vec2 fragCoord)',
    )
  }
  const location = /glsl:(\d+):\d+/u.exec(error.formatted)
  const inWrapper = location !== null && Number(location[1]) > source.prefixLines + source.userLines
  if (inWrapper && error.kind === 'parse') {
    return contractError(
      source,
      'Shader must define void mainImage(out vec4 color, in vec2 fragCoord) without defining main',
    )
  }
  const diagnostics = reportDiagnostics(error.formatted, source, error.message)
  return new ShaderCompileError({
    kind: error.kind,
    sourceName: source.sourceName,
    message: error.message,
    formatted: mappedReport(error.formatted, source),
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    cause: error,
  })
}

/** Compiles a Ghostty/ShaderToy mainImage source into WebGPU and WebGL2 fragment programs. */
export async function compileGhosttyShader(
  source: string,
  options: CompileOptions = {},
): Promise<CompiledGhosttyShader> {
  const webgpuSource = createShaderSource(source, options, 'webgpu')
  const webglSource = createShaderSource(source, options, 'webgl')
  const compiler = await getShaderCompiler()
  const wgsl = compileWgsl(compiler, webgpuSource)
  const glsl = compileGlsl(compiler, webglSource)
  return {
    schemaVersion: 1,
    uniformLayout: 'ghostty-v1',
    glsl: glsl.code,
    wgsl,
    entryPoint: 'main',
    webgl: webglBindings(glsl, webglSource),
  }
}
