import { compileGhosttyShader } from 'ghostty-web-shaderc'
import source from '../shaders/passthrough.glsl?raw'

export function compileExample() {
  return compileGhosttyShader(source, { sourceName: 'passthrough.glsl' })
}
