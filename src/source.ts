import { ShaderCompileError, sourceError } from './diagnostics.js'
import type { CompileOptions } from './types.js'
import { SHADER_UNIFORM_GLSL, SHADER_UNIFORM_INITIALIZE_GLSL } from './uniforms.js'

export interface ShaderSource {
  readonly sourceName: string
  readonly text: string
  readonly prefixLines: number
  readonly userLines: number
}

const PREFIX = `#version 450
${SHADER_UNIFORM_GLSL}
layout(set = 0, binding = 1) uniform texture2D _ghosttyChannel0Texture;
layout(set = 0, binding = 2) uniform sampler _ghosttyChannel0Sampler;
#define iChannel0 sampler2D(_ghosttyChannel0Texture, _ghosttyChannel0Sampler)
#define texture2D texture
layout(location = 0) in vec2 _ghosttyUv;
layout(location = 0) out vec4 _ghosttyColor;
#define gl_FragCoord vec4(_ghosttyUv * iResolution.xy, 0.0, 1.0)
`

// WGSL's framebuffer Y axis points down; Ghostty's GLSL derivatives use an upward Y axis.
const WEBGPU_PREFIX = `#define dFdy(value) (-dFdy(value))
#define dFdyFine(value) (-dFdyFine(value))
#define dFdyCoarse(value) (-dFdyCoarse(value))
`

const SUFFIX = `
void main() {
  ${SHADER_UNIFORM_INITIALIZE_GLSL}
  mainImage(_ghosttyColor, _ghosttyUv * iResolution.xy);
}
`

function checkedSourceName(options: CompileOptions): string {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ShaderCompileError({
      kind: 'input',
      sourceName: 'shader.glsl',
      message: 'Compile options must be an object',
    })
  }
  const name = options.sourceName
  if (name === undefined) return 'shader.glsl'
  if (typeof name !== 'string' || name.length === 0 || /[\r\n\0]/u.test(name)) {
    throw new ShaderCompileError({
      kind: 'input',
      sourceName: 'shader.glsl',
      message: 'sourceName must be a nonempty single-line string',
    })
  }
  return name
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, (comment) =>
    comment.replace(/[^\n]/gu, ' '),
  )
}

function withoutPrecision(source: string, code: string): string {
  const precision = /\bprecision\s+(?:lowp|mediump|highp)\s+\w+\s*;|\b(?:lowp|mediump|highp)\b/gu
  let result = ''
  let cursor = 0
  for (const match of code.matchAll(precision)) {
    result += source.slice(cursor, match.index) + match[0].replace(/[^\n]/gu, ' ')
    cursor = match.index + match[0].length
  }
  return result + source.slice(cursor)
}

function normalizedBody(source: string, sourceName: string): string {
  const normalized = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
  const code = withoutComments(normalized)
  const reserved = /\b_ghostty\w*\b/gu.exec(code)
  if (reserved) {
    throw sourceError(
      sourceName,
      'Identifiers beginning with _ghostty are reserved for the shader host',
      normalized,
      reserved.index,
    )
  }
  // Both backends use f32/highp. Naga rejects precision qualifiers in function parameters.
  const body = withoutPrecision(normalized, code)
  // Keep source lines and columns unchanged when replacing the user's GLSL version.
  return body.replace(/^[\t ]*#[\t ]*version[^\n]*/gmu, (directive) =>
    directive.replace(/./gu, ' '),
  )
}

export function createShaderSource(
  source: string,
  options: CompileOptions,
  target: 'webgpu' | 'webgl',
): ShaderSource {
  const sourceName = checkedSourceName(options)
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new ShaderCompileError({
      kind: 'input',
      sourceName,
      message: 'Shader source must be a nonempty string',
    })
  }
  const body = normalizedBody(source, sourceName)
  const prefix = target === 'webgpu' ? PREFIX + WEBGPU_PREFIX : PREFIX
  return {
    sourceName,
    text: prefix + body + SUFFIX,
    prefixLines: prefix.split('\n').length - 1,
    userLines: body.split('\n').length,
  }
}
