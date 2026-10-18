import { describe, expect, test } from 'bun:test'
import { parseGlsl, parseWgsl, validate, writeWgsl } from 'naga-wasm'
import { FULLSCREEN_VERTEX_WGSL } from '../../src/runtime.js'
import {
  packShaderUniforms,
  SHADER_UNIFORM_BYTE_LENGTH,
  SHADER_UNIFORM_FIELDS,
  SHADER_UNIFORM_GLSL,
  SHADER_UNIFORM_INITIALIZE_GLSL,
} from '../../src/uniforms.js'

function offset(name: string): number {
  const field = SHADER_UNIFORM_FIELDS.find((field) => field.name === name)
  if (!field) throw new Error(`Missing field ${name}`)
  return field.offset
}

describe('shared shader uniform layout', () => {
  test('uses std140 offsets including vec3 tails and padded scalar arrays', () => {
    expect(SHADER_UNIFORM_BYTE_LENGTH).toBe(4496)
    expect(offset('iResolution')).toBe(0)
    expect(offset('iTime')).toBe(12)
    expect(offset('iFrame')).toBe(24)
    expect(offset('iChannelTime')).toBe(32)
    expect(offset('iChannelResolution')).toBe(96)
    expect(offset('iCurrentCursor')).toBe(208)
    expect(offset('iFocus')).toBe(292)
    expect(offset('iPalette')).toBe(304)
    expect(offset('iBackgroundColor')).toBe(4400)
    expect(offset('iForegroundColor')).toBe(4416)
    expect(offset('iSelectionBackgroundColor')).toBe(4480)
  })

  test('packs scalar, vector, palette, and cursor values at their declared offsets', () => {
    const palette = Array.from({ length: 256 }, (_, index): readonly [number, number, number] => [
      index / 255,
      0.25,
      0.75,
    ])
    const view = new DataView(
      packShaderUniforms({
        iResolution: [1920, 1080, 1],
        iTime: 3.5,
        iFrame: 123,
        iChannelTime: [1, 2, 3, 4],
        iChannelResolution: [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
          [10, 11, 12],
        ],
        iCurrentCursor: [10, 20, 8, 16],
        iFocus: 1,
        iPalette: palette,
        iForegroundColor: [0.2, 0.3, 0.4],
        iSelectionBackgroundColor: [0.6, 0.7, 0.8],
      }),
    )
    expect(view.getFloat32(0, true)).toBe(1920)
    expect(view.getFloat32(12, true)).toBe(3.5)
    expect(view.getInt32(24, true)).toBe(123)
    expect(view.getFloat32(32 + 3 * 16, true)).toBe(4)
    expect(view.getFloat32(96 + 3 * 16 + 8, true)).toBe(12)
    expect(view.getFloat32(208 + 12, true)).toBe(16)
    expect(view.getInt32(292, true)).toBe(1)
    expect(view.getFloat32(304 + 255 * 16, true)).toBe(1)
    expect(view.getFloat32(304 + 255 * 16 + 8, true)).toBe(0.75)
    expect(view.getFloat32(4416 + 4, true)).toBeCloseTo(0.3)
    expect(view.getFloat32(4480 + 8, true)).toBeCloseTo(0.8)
    expect(view.getUint32(304 + 255 * 16 + 12, true)).toBe(0)
  })

  test('resets reused buffers and keeps predictable defaults', () => {
    const buffer = packShaderUniforms({ iTime: 42, iCursorVisible: 1 })
    expect(packShaderUniforms({}, buffer)).toBe(buffer)
    const actual = Array.from(new Float32Array(buffer))
    expect(actual[2]).toBe(1)
    expect(actual.filter((value) => value !== 0)).toEqual([1])
  })

  test('rejects invalid values and incorrectly sized output buffers', () => {
    expect(() => packShaderUniforms({ iTime: Number.NaN })).toThrow('finite number')
    expect(() => packShaderUniforms({ iTime: 1e100 })).toThrow('32-bit float')
    expect(() => packShaderUniforms({ iFrame: 1.25 })).toThrow('32-bit integer')
    expect(() => packShaderUniforms({ iFrame: 2147483648 })).toThrow('32-bit integer')
    expect(() => packShaderUniforms({ iPalette: [] })).toThrow('256 entries')
    expect(() => packShaderUniforms({}, new ArrayBuffer(16))).toThrow('4496-byte')
    expect(() => Reflect.apply(packShaderUniforms, undefined, [{ unknown: 1 }])).toThrow('Unknown')
    expect(() => Reflect.apply(packShaderUniforms, undefined, [{ iResolution: [1, 2] }])).toThrow(
      '3 numbers',
    )
    expect(() => Reflect.apply(packShaderUniforms, undefined, [null])).toThrow('must be an object')
  })

  test('generates uniform GLSL that translates into valid WGSL', () => {
    const glsl = `#version 450
${SHADER_UNIFORM_GLSL}
layout(location = 0) out vec4 color;
void main() {
  ${SHADER_UNIFORM_INITIALIZE_GLSL}
  int index = clamp(iFrame, 0, 3);
  color = vec4(iPalette[clamp(iFocus, 0, 255)], 1.0)
    + vec4(iResolution, iTime)
    + vec4(iChannelResolution[index], iChannelTime[index]);
}
`
    using module = parseGlsl(glsl, { stage: 'fragment' })
    using info = validate(module)
    const wgsl = writeWgsl(module, info)
    using roundtrip = parseWgsl(wgsl)
    using roundtripInfo = validate(roundtrip)
    expect(wgsl).toContain('@group(0) @binding(0)')
    expect(roundtripInfo).toBeDefined()
  })

  test('fullscreen WGSL vertex helper passes Naga validation', () => {
    using module = parseWgsl(FULLSCREEN_VERTEX_WGSL)
    using info = validate(module)
    expect(info).toBeDefined()
  })
})
