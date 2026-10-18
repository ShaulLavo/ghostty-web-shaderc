import { compileGhosttyShader } from 'ghostty-web-shaderc'
import source from '../shaders/fireworks.glsl?raw'

export function compileExample() {
  return compileGhosttyShader(source, { sourceName: 'fireworks.glsl' })
}
