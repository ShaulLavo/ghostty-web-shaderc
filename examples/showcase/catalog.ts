import type { CompiledGhosttyShader } from 'ghostty-web-shaderc'
import { compileExample as compileCrt } from './entries/phosphor-crt.js'
import crtTypescript from './entries/phosphor-crt.ts?raw'
import crtSource from './shaders/phosphor-crt.glsl?raw'
import { compileExample as compileCursorWarp } from './entries/cursor-warp.js'
import cursorTypescript from './entries/cursor-warp.ts?raw'
import cursorSource from './shaders/cursor-warp.glsl?raw'
import { compileExample as compileScanline } from './entries/scanline.js'
import scanlineTypescript from './entries/scanline.ts?raw'
import scanlineSource from './shaders/scanline.glsl?raw'
import { compileExample as compilePixels } from './entries/pixels.js'
import pixelsTypescript from './entries/pixels.ts?raw'
import pixelsSource from './shaders/pixels.glsl?raw'
import { compileExample as compilePassthrough } from './entries/passthrough.js'
import passthroughTypescript from './entries/passthrough.ts?raw'
import passthroughSource from './shaders/passthrough.glsl?raw'

export interface ShaderExample {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly source: string
  readonly sourceFilename: string
  readonly typescript: string
  readonly compile: () => Promise<CompiledGhosttyShader>
  readonly credit: {
    readonly author: string
    readonly url: string
    readonly license: string
  } | null
}

export const examples: readonly [ShaderExample, ...ShaderExample[]] = [
  {
    id: 'phosphor-crt',
    title: 'Phosphor CRT',
    description: 'Curved glass, RGB separation, scanlines and a soft phosphor glow.',
    source: crtSource,
    sourceFilename: 'phosphor-crt.glsl',
    typescript: crtTypescript,
    compile: compileCrt,
    credit: null,
  },
  {
    id: 'cursor-warp',
    title: 'Cursor warp',
    description: "A cursor trail from Sahaj Bhatt's Ghostty shader collection.",
    source: cursorSource,
    sourceFilename: 'cursor-warp.glsl',
    typescript: cursorTypescript,
    compile: compileCursorWarp,
    credit: {
      author: 'Sahaj Bhatt',
      url: 'https://github.com/sahaj-b/cursor-shaders/blob/9ad9158a93c0de0c045e1c6b27df37da698bc8af/ghostty/cursor_warp.glsl',
      license: 'MIT',
    },
  },
  {
    id: 'scanline',
    title: 'Rolling scanline',
    description: 'A bright scanline rolls across the terminal with a slight horizontal shift.',
    source: scanlineSource,
    sourceFilename: 'scanline.glsl',
    typescript: scanlineTypescript,
    compile: compileScanline,
    credit: {
      author: 'zoitrok',
      url: 'https://github.com/zoitrok/ghostty-shaders/blob/e4d5b433511101539760d0e6bee9ac41d9bcd225/shaders/scanline.glsl',
      license: 'Unlicense',
    },
  },
  {
    id: 'pixels',
    title: 'Pixel grid',
    description: 'A three-pixel display grid adds hard edges and extra contrast.',
    source: pixelsSource,
    sourceFilename: 'pixels.glsl',
    typescript: pixelsTypescript,
    compile: compilePixels,
    credit: {
      author: 'zoitrok',
      url: 'https://github.com/zoitrok/ghostty-shaders/blob/e4d5b433511101539760d0e6bee9ac41d9bcd225/shaders/pixels.glsl',
      license: 'Unlicense',
    },
  },
  {
    id: 'passthrough',
    title: 'Original terminal',
    description: 'A single texture sample. Compare the original image with the other effects.',
    source: passthroughSource,
    sourceFilename: 'passthrough.glsl',
    typescript: passthroughTypescript,
    compile: compilePassthrough,
    credit: null,
  },
]
