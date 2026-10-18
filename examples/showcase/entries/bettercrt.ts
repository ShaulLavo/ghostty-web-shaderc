import { compileGhosttyShader } from 'ghostty-web-shaderc'
import source from '../shaders/bettercrt.glsl?raw'

export function compileExample() {
  return compileGhosttyShader(source, { sourceName: 'bettercrt.glsl' })
}
