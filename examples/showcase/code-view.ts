import highlight from 'highlight.js/lib/core'
import glsl from 'highlight.js/lib/languages/glsl'
import typescript from 'highlight.js/lib/languages/typescript'

highlight.registerLanguage('typescript', typescript)
highlight.registerLanguage('glsl', glsl)
highlight.registerLanguage('wgsl', () => ({
  name: 'WGSL',
  keywords: {
    keyword:
      'alias break case const const_assert continue continuing default diagnostic discard else enable false fn for if let loop override requires return struct switch true var while',
    type: 'array atomic bool f16 f32 i32 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 ptr sampler sampler_comparison texture_1d texture_2d texture_2d_array texture_3d texture_cube texture_cube_array texture_depth_2d texture_depth_2d_array texture_depth_cube texture_depth_cube_array texture_depth_multisampled_2d texture_external texture_multisampled_2d texture_storage_1d texture_storage_2d texture_storage_2d_array texture_storage_3d u32 vec2 vec3 vec4',
    built_in:
      'abs acos acosh all any arrayLength asin asinh atan atan2 atanh ceil clamp cos cosh countLeadingZeros countOneBits countTrailingZeros cross degrees determinant distance dot exp exp2 faceForward firstLeadingBit firstTrailingBit floor fma fract frexp inverseSqrt ldexp length log log2 max min mix modf normalize pow quantizeToF16 radians reflect refract reverseBits round saturate select sign sin sinh smoothstep sqrt step tan tanh textureDimensions textureGather textureGatherCompare textureLoad textureNumLayers textureNumLevels textureNumSamples textureSample textureSampleBias textureSampleCompare textureSampleCompareLevel textureSampleGrad textureSampleLevel textureSampleBaseClampToEdge textureStore transpose trunc',
  },
  contains: [
    highlight.C_LINE_COMMENT_MODE,
    highlight.C_BLOCK_COMMENT_MODE,
    highlight.C_NUMBER_MODE,
    { className: 'meta', begin: /@[a-z_]+/ },
  ],
}))

export type CodeLanguage = 'typescript' | 'glsl' | 'wgsl'

export function showCode(
  elements: { code: HTMLElement; gutter: HTMLElement; lineCount: HTMLElement; scroll: HTMLElement },
  source: string,
  language: CodeLanguage,
): void {
  const normalized = source.trimEnd()
  const lines = normalized.split('\n').length
  elements.code.innerHTML = highlight.highlight(normalized, { language }).value
  elements.gutter.textContent = Array.from({ length: lines }, (_, index) => String(index + 1)).join(
    '\n',
  )
  elements.lineCount.textContent = `${lines} lines`
  elements.scroll.scrollTo({ top: 0, left: 0 })
}
