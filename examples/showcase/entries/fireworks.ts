import { compileGhosttyShader } from '@ghostty-webgpu/shaderc'
import source from '../shaders/fireworks.glsl?raw'

export function compileExample() {
  return compileGhosttyShader(source, { sourceName: 'fireworks.glsl' })
}
