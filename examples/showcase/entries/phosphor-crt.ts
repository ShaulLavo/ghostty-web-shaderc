import { compileGhosttyShader } from 'ghostty-web-shaderc'
import source from '../shaders/phosphor-crt.glsl?raw'

export function compileExample() {
  return compileGhosttyShader(source, { sourceName: 'phosphor-crt.glsl' })
}
