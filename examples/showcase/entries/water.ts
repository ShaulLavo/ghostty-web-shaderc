import { compileGhosttyShader } from 'ghostty-web-shaderc'
import source from '../shaders/water.glsl?raw'

export function compileExample() {
  return compileGhosttyShader(source, { sourceName: 'water.glsl' })
}
