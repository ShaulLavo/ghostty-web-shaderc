import { compileGhosttyShader } from '@ghostty-webgpu/shaderc'
import source from '../shaders/water.glsl?raw'

export function compileExample() {
  return compileGhosttyShader(source, { sourceName: 'water.glsl' })
}
