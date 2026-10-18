import { compileGhosttyShader } from 'ghostty-web-shaderc'
import source from '../shaders/cursor-warp.glsl?raw'

export function compileExample() {
  return compileGhosttyShader(source, { sourceName: 'cursor-warp.glsl' })
}
