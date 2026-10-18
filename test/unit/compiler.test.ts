import { describe, expect, test } from 'bun:test'
import {
  compileGhosttyShader,
  initializeShaderCompiler,
  ShaderCompileError,
} from '../../src/index.js'

const PASSTHROUGH = `void mainImage(out vec4 color, in vec2 fragCoord) {
  color = texture(iChannel0, fragCoord / iResolution.xy);
}`

async function compilationError(
  source: string,
  sourceName = 'example.glsl',
): Promise<ShaderCompileError> {
  try {
    await compileGhosttyShader(source, { sourceName })
  } catch (error) {
    if (error instanceof ShaderCompileError) return error
    throw error
  }
  throw new Error('Expected shader compilation to fail')
}

describe('runtime compiler', () => {
  test('compiles concurrently without caller initialization', async () => {
    const programs = await Promise.all(
      Array.from({ length: 8 }, () => compileGhosttyShader(PASSTHROUGH)),
    )
    const first = programs[0]
    if (first === undefined) throw new Error('Expected compiled shaders')
    expect(programs).toHaveLength(8)
    for (const program of programs) {
      expect(program.wgsl).toBe(first.wgsl)
      expect(program.glsl).toStartWith('#version 300 es')
      expect(program.wgsl).toContain('@fragment')
      expect(program.webgl.uniformBlock).toBe('GhosttyUniforms_block_0Fragment')
      expect(program.webgl.channel0).toBe('_group_0_binding_1_fs')
    }
  })

  test('returns a JSON-serializable artifact with a fixed render contract', async () => {
    const program = await compileGhosttyShader(PASSTHROUGH)
    expect(JSON.parse(JSON.stringify(program))).toEqual(program)
    expect(program.schemaVersion).toBe(1)
    expect(program.uniformLayout).toBe('ghostty-v1')
    expect(program.entryPoint).toBe('main')
    expect(program.wgsl).toMatch(/@group\(0\) @binding\(0\)\s+var<uniform>/u)
    expect(program.wgsl).toMatch(/@group\(0\) @binding\(1\)\s+var \w+: texture_2d<f32>/u)
    expect(program.wgsl).toMatch(/@group\(0\) @binding\(2\)\s+var \w+: sampler/u)
    expect(program.wgsl).toContain('@location(0) _ghosttyUv: vec2<f32>')
  })

  test('prewarming is optional and idempotent', async () => {
    await Promise.all([initializeShaderCompiler(), initializeShaderCompiler()])
    expect((await compileGhosttyShader(PASSTHROUGH)).wgsl).toContain('fn mainImage')
  })

  test('accepts GLSL ES versions, precision, comments, macros, CRLF and legacy texture2D', async () => {
    const source = `\uFEFF#version 300 es\r\nprecision mediump float;\r\n// _ghostty identifiers in comments are harmless\r\n#define SAMPLE texture2D\r\nvoid mainImage(out highp vec4 color, in highp vec2 pos) {\r\n color = SAMPLE(iChannel0, pos / iResolution.xy);\r\n}`
    const program = await compileGhosttyShader(source)
    expect(program.wgsl).toContain('textureSample(')
    expect(program.glsl).toContain('uniform highp sampler2D')
  })

  test('unused channel has no WebGL sampler requirement', async () => {
    const program = await compileGhosttyShader('void mainImage(out vec4 c, vec2 p){c=vec4(1.0);}')
    expect(program.webgl.channel0).toBeNull()
  })

  test.each(['vec4(vec2(textureSize(iChannel0,0)),0.,1.)', 'texelFetch(iChannel0,ivec2(0),0)'])(
    'supports samplerless texture operations: %s',
    async (expression) => {
      const program = await compileGhosttyShader(
        `void mainImage(out vec4 c,vec2 p){c=${expression};}`,
      )
      expect(program.webgl.channel0).toBe('_group_0_binding_1_fs')
    },
  )

  test('uses canonical coordinates for gl_FragCoord', async () => {
    const program = await compileGhosttyShader('void mainImage(out vec4 c,vec2 p){c=gl_FragCoord;}')
    expect(program.wgsl).not.toContain('@builtin(position)')
    expect(program.wgsl).toContain('_ghosttyUv_1')
  })

  test('corrects the WGSL Y derivative without changing GLSL derivative semantics', async () => {
    const program = await compileGhosttyShader(
      'void mainImage(out vec4 c,vec2 p){c=vec4(dFdx(p.x),dFdy(p.y),fwidth(p.y),1.);}',
    )
    expect(program.wgsl).toContain('dpdy(')
    expect(program.wgsl).toMatch(/-\(_e\d+\)/u)
    expect(program.glsl).toContain('dFdy(')
    expect(program.glsl).not.toMatch(/-\(_e\d+\)/u)
  })

  test('corrects fine and coarse WGSL Y derivatives', async () => {
    const program = await compileGhosttyShader(
      'void mainImage(out vec4 c,vec2 p){c=vec4(dFdyFine(p.y),dFdyCoarse(p.y),fwidthCoarse(p.y),1.);}',
    )
    expect(program.wgsl).toContain('dpdyFine(')
    expect(program.wgsl).toContain('dpdyCoarse(')
    expect(Array.from(program.wgsl.matchAll(/-\(_e\d+\)/gu))).toHaveLength(2)
    expect(program.glsl).not.toMatch(/-\(_e\d+\)/u)
  })

  test.each([
    'void helper() {}',
    'void mainImage(vec4 c, vec2 p) {}',
    'vec4 mainImage(out vec4 c, vec2 p) { c=vec4(1);return c; }',
    'void mainImage(out vec3 c, vec2 p) { c=vec3(1); }',
    'void mainImage(out vec4 c, out vec2 p) { c=vec4(1);p=vec2(1); }',
  ])('rejects incompatible mainImage entry points: %s', async (source) => {
    const error = await compilationError(source)
    expect(error.message).toContain('mainImage')
  })

  test('accepts inout output and overloaded helpers', async () => {
    const program = await compileGhosttyShader(`
float tint(float x) { return x; }
vec3 tint(vec3 x) { return x; }
void mainImage(inout vec4 c, in vec2 p) { c=vec4(tint(vec3(tint(iTime))),1.); }
`)
    expect(program.wgsl).toContain('fn tint')
  })

  test.each([
    'layout(set=1,binding=0,std140) uniform Extra { vec4 extra; };',
    'layout(set=0,binding=1,std140) uniform Extra { vec4 extra; };',
    'layout(set=1,binding=0) uniform sampler extra;',
    'layout(set=1,binding=0,std430) buffer Extra { vec4 extra; };',
    'layout(location=1) in vec2 extra;',
    'layout(location=1) out vec4 extra;',
  ])('rejects unsupported resource and I/O declarations: %s', async (declaration) => {
    const error = await compilationError(`${declaration}\n${PASSTHROUGH}`)
    expect(error).toBeInstanceOf(ShaderCompileError)
  })

  test('rejects host identifiers with a source location', async () => {
    const error = await compilationError('// comment\nfloat _ghosttyExtra;\n' + PASSTHROUGH)
    expect(error.kind).toBe('contract')
    expect(error.diagnostics[0]).toMatchObject({ line: 2, column: 7 })
  })

  test('maps parser diagnostics to original user lines', async () => {
    const source = `#version 300 es
precision mediump float;
void mainImage(out vec4 c,vec2 p) {
  c = vec4(unknown_value);
}`
    const error = await compilationError(source, 'crt.glsl')
    expect(error.kind).toBe('parse')
    expect(error.sourceName).toBe('crt.glsl')
    expect(error.diagnostics[0]).toMatchObject({ line: 4, column: 12 })
    expect(error.formatted).toContain('crt.glsl:4:12')
    expect(error.formatted).toContain('4 │   c = vec4(unknown_value);')
  })

  test('includes user locations from secondary validation spans', async () => {
    const error = await compilationError(`void mainImage(out vec4 c,vec2 p) {
  float bad = vec3(1.0);
  c=vec4(1.0);
}`)
    expect(error.kind).toBe('validation')
    expect(error.diagnostics.some((diagnostic) => diagnostic.line === 2)).toBe(true)
    expect(error.formatted).toContain("Initializer doesn't match")
  })

  test('preprocessor line directives retain physical user source locations', async () => {
    const error = await compilationError(`#line 200 2
void mainImage(out vec4 c,vec2 p) {
  c=vec4(NOPE);
}`)
    expect(error.diagnostics[0]?.line).toBe(3)
  })

  test('Unicode comments preserve diagnostic columns', async () => {
    const source = '// π and 🦄\nvoid mainImage(out vec4 c,vec2 p){/*σ*/c=vec4(NOPE);}'
    const error = await compilationError(source)
    expect(error.diagnostics[0]).toMatchObject({ line: 2, column: 47 })
  })

  test('compilation succeeds after parse and validation failures', async () => {
    for (let index = 0; index < 20; index += 1) {
      await compilationError('void mainImage(out vec4 c,vec2 p){c=vec4(NOPE);}')
      await compilationError('void mainImage(out vec4 c,vec2 p){float bad=vec3(1.0);c=vec4(1.);}')
    }
    expect((await compileGhosttyShader(PASSTHROUGH)).wgsl).toContain('textureSample')
  })

  test('rejects empty source before loading the compiler', async () => {
    const error = await compilationError(' \n ')
    expect(error.kind).toBe('input')
  })
})
