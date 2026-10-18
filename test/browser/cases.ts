import { packShaderUniforms } from 'ghostty-web-shaderc/runtime'

export const width = 2
export const height = 2
export const inputPixels = new Uint8Array([
  255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 64, 255, 255, 0, 0,
])

type UniformValues = NonNullable<Parameters<typeof packShaderUniforms>[0]>

export interface PixelCase {
  readonly name: string
  readonly source: string
  readonly uniforms: UniformValues
  readonly expected: readonly number[]
  readonly tolerance?: number
}

function solid(pixel: readonly number[]): number[] {
  return pixel.concat(pixel, pixel, pixel)
}

const palette = Array.from({ length: 256 }, (_, index): readonly [number, number, number] => [
  index / 255,
  (255 - index) / 255,
  index % 2,
])

export const pixelCases: readonly PixelCase[] = [
  {
    name: 'texture orientation and alpha',
    source: `void mainImage(out vec4 color, in vec2 coord) {
  color = texture(iChannel0, coord / iResolution.xy);
}`,
    uniforms: {},
    expected: Array.from(inputPixels),
    tolerance: 0,
  },
  {
    name: 'integer texel fetch without sampler',
    source: `void mainImage(out vec4 color, in vec2 coord) {
  color = texelFetch(iChannel0, ivec2(coord), 0);
}`,
    uniforms: {},
    expected: Array.from(inputPixels),
    tolerance: 0,
  },
  {
    name: 'texture size without sampling',
    source: `void mainImage(out vec4 color, in vec2 coord) {
  color = vec4(vec2(textureSize(iChannel0, 0)) / 2.0, 0.0, 1.0);
}`,
    uniforms: {},
    expected: solid([255, 255, 0, 255]),
    tolerance: 0,
  },
  {
    name: 'bottom-left gl_FragCoord',
    source: `void mainImage(out vec4 color, in vec2 coord) {
  color = vec4(gl_FragCoord.xy / iResolution.xy, 0.0, 1.0);
}`,
    uniforms: {},
    expected: [64, 64, 0, 255, 191, 64, 0, 255, 64, 191, 0, 255, 191, 191, 0, 255],
  },
  {
    name: 'bottom-left screen derivatives',
    source: `void mainImage(out vec4 color, in vec2 coord) {
  color = vec4(dFdx(coord.x), dFdy(coord.y), fwidth(coord.y), 1.0);
}`,
    uniforms: {},
    expected: solid([255, 255, 255, 255]),
    tolerance: 0,
  },
  {
    name: 'bottom-left fragment coordinates',
    source: `void mainImage(out vec4 color, in vec2 coord) {
  color = vec4(coord / iResolution.xy, 0.0, 1.0);
}`,
    uniforms: {},
    expected: [64, 64, 0, 255, 191, 64, 0, 255, 64, 191, 0, 255, 191, 191, 0, 255],
  },
  {
    name: 'time and integer frame uniforms',
    source: `void mainImage(out vec4 color, in vec2 coord) {
  color = vec4(iTime, iTimeDelta, iFrameRate, float(iFrame) / 255.0);
}`,
    uniforms: { iTime: 0.25, iTimeDelta: 0.5, iFrameRate: 0.75, iFrame: 128 },
    expected: solid([64, 128, 191, 128]),
  },
  {
    name: 'dynamic palette indexing',
    source: `void mainImage(out vec4 color, in vec2 coord) {
  int index = int(floor(coord.x)) + int(floor(coord.y)) * 2 + 128;
  color = vec4(iPalette[index], 1.0);
}`,
    uniforms: { iPalette: palette },
    expected: [128, 127, 0, 255, 129, 126, 255, 255, 130, 125, 0, 255, 131, 124, 255, 255],
  },
  {
    name: 'focus and cursor colors',
    source: `void mainImage(out vec4 color, in vec2 coord) {
  color = iFocus == 1 ? iCurrentCursorColor : iPreviousCursorColor;
  color.a = float(iCursorVisible) * iCurrentCursor.w;
}`,
    uniforms: {
      iFocus: 1,
      iCurrentCursor: [0, 0, 1, 0.5],
      iCurrentCursorColor: [0.25, 0.5, 0.75, 1],
      iPreviousCursorColor: [1, 0, 0, 1],
      iCursorVisible: 1,
    },
    expected: solid([64, 128, 191, 128]),
  },
  {
    name: 'unfocused previous cursor',
    source: `void mainImage(out vec4 color, in vec2 coord) {
  color = iFocus == 1 ? iCurrentCursorColor : iPreviousCursorColor;
}`,
    uniforms: { iFocus: 0, iPreviousCursorColor: [0.75, 0.25, 0.5, 0.25] },
    expected: solid([191, 64, 128, 64]),
  },
  {
    name: 'CRT scanline shader',
    source: `#define PI 3.14159265358979323846
float scanline(vec2 coord) {
  return 0.75 + 0.25 * sin(coord.y * PI + iTime);
}
void mainImage(out vec4 color, in vec2 coord) {
  vec4 terminal = texture(iChannel0, coord / iResolution.xy);
  color = vec4(terminal.rgb * scanline(coord), terminal.a);
}`,
    uniforms: { iTime: 0 },
    expected: [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 128, 64, 128, 128, 0, 0],
  },
]

export function uniformBuffer(values: UniformValues): ArrayBuffer {
  return packShaderUniforms({ ...values, iResolution: [width, height, 1] })
}

export function assertPixels(
  name: string,
  actual: Uint8Array,
  expected: readonly number[],
  tolerance = 1,
): void {
  if (actual.length !== expected.length)
    throw new Error(`${name}: pixel byte count ${actual.length} != ${expected.length}`)
  const index = expected.findIndex(
    (value, offset) => Math.abs(value - (actual[offset] ?? -1000)) > tolerance,
  )
  if (index < 0) return
  throw new Error(
    `${name}: byte ${index}, got ${actual[index]}, expected ${expected[index]}; pixels ${Array.from(actual)}`,
  )
}
