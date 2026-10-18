import { compileGhosttyShader } from 'ghostty-web-shaderc'
import source from '../shaders/cursor-lightning.glsl?raw'

export function compileExample() {
  return compileGhosttyShader(source, { sourceName: 'cursor-lightning.glsl' })
}
