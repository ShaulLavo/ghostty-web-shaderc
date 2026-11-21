import { compileGhosttyShader } from '@ghostty-webgpu/shaderc'
import source from '../shaders/inside-the-matrix.glsl?raw'

export function compileExample() {
  return compileGhosttyShader(source, { sourceName: 'inside-the-matrix.glsl' })
}
