import { compileGhosttyShader } from '@ghostty-webgpu/shaderc'
import source from '../shaders/regular.glsl?raw'

export function compileExample() {
  return compileGhosttyShader(source, { sourceName: 'regular.glsl' })
}
