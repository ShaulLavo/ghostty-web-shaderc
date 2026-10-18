import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { parseWgsl, validate } from 'naga-wasm'
import { compileGhosttyShader } from '../../src/compiler.js'
import { ShaderCompileError } from '../../src/diagnostics.js'

const fixtures = ['crt', 'cursor-glow', 'language', 'texture-operations']

async function compilationFailure(source: string, sourceName: string): Promise<ShaderCompileError> {
  try {
    await compileGhosttyShader(source, { sourceName })
  } catch (error) {
    if (error instanceof ShaderCompileError) return error
    throw error
  }
  throw new Error('Expected shader compilation to fail')
}

describe('authored Ghostty shader corpus', () => {
  for (const name of fixtures) {
    test(`compiles ${name} at runtime into both renderer formats`, async () => {
      const sourceName = `${name}.glsl`
      const source = await readFile(new URL(`../fixtures/${sourceName}`, import.meta.url), 'utf8')
      const result = await compileGhosttyShader(source, { sourceName })
      expect(result.schemaVersion).toBe(1)
      expect(result.uniformLayout).toBe('ghostty-v1')
      expect(result.entryPoint).toBe('main')
      expect(result.glsl).toContain('#version 300 es')
      expect(result.wgsl).toContain('@fragment')
      expect(result.webgl.channel0).toBeTruthy()
      using module = parseWgsl(result.wgsl)
      using info = validate(module)
      expect(info).toBeDefined()
    })
  }

  test('rejects an unavailable channel with a diagnostic', async () => {
    const source = `void mainImage(out vec4 color, in vec2 pixel) {
      color = texture(iChannel1, pixel / iResolution.xy);
    }`
    await expect(compileGhosttyShader(source, { sourceName: 'channel-one.glsl' })).rejects.toThrow(
      /iChannel1/,
    )
  })

  test('reports parser errors rather than emitting unusable shader text', async () => {
    const source = `void mainImage(out vec4 color, in vec2 pixel) {
      color = vec4(1.0)
    }`
    const error = await compilationFailure(source, 'syntax-error.glsl')
    expect(error.kind).toBe('parse')
    expect(error.sourceName).toBe('syntax-error.glsl')
    expect(error.formatted).toContain('syntax-error.glsl:3:5')
    expect(error.diagnostics).toContainEqual({
      message: error.message,
      line: 3,
      column: 5,
    })
  })

  test('rejects invalid types and unsupported external includes', async () => {
    const invalidType = `void mainImage(out vec4 color, in vec2 pixel) {
      float invalidValue = vec3(1.0);
      color = vec4(invalidValue);
    }`
    const typeError = await compilationFailure(invalidType, 'type-error.glsl')
    expect(typeError.kind).toBe('validation')
    expect(typeError.sourceName).toBe('type-error.glsl')
    expect(typeError.formatted).toContain("Initializer doesn't match the variable type")
    const include = `#include "external.glsl"
    void mainImage(out vec4 color, in vec2 pixel) { color = external(pixel); }`
    const includeError = await compilationFailure(include, 'include.glsl')
    expect(includeError.kind).toBe('parse')
    expect(includeError.formatted).toContain('include.glsl:1:2')
  })
})
