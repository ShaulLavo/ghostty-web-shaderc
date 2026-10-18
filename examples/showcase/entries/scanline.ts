import { compileGhosttyShader } from 'ghostty-web-shaderc'
import source from '../shaders/scanline.glsl?raw'

export function compileExample() {
  return compileGhosttyShader(source, { sourceName: 'scanline.glsl' })
}
