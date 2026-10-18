import { compileGhosttyShader } from 'ghostty-web-shaderc'
import source from '../shaders/pixels.glsl?raw'

export function compileExample() {
  return compileGhosttyShader(source, { sourceName: 'pixels.glsl' })
}
