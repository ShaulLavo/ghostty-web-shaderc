import type { CompiledGhosttyShader } from 'ghostty-web-shaderc'
import { compileExample as compileRegular } from './entries/regular.js'
import regularTypescript from './entries/regular.ts?raw'
import regularSource from './shaders/regular.glsl?raw'
import { compileExample as compileBetterCrt } from './entries/bettercrt.js'
import betterCrtTypescript from './entries/bettercrt.ts?raw'
import betterCrtSource from './shaders/bettercrt.glsl?raw'
import { compileExample as compileMatrix } from './entries/inside-the-matrix.js'
import matrixTypescript from './entries/inside-the-matrix.ts?raw'
import matrixSource from './shaders/inside-the-matrix.glsl?raw'
import { compileExample as compileFireworks } from './entries/fireworks.js'
import fireworksTypescript from './entries/fireworks.ts?raw'
import fireworksSource from './shaders/fireworks.glsl?raw'
import { compileExample as compileWater } from './entries/water.js'
import waterTypescript from './entries/water.ts?raw'
import waterSource from './shaders/water.glsl?raw'
import { compileExample as compileCursorLightning } from './entries/cursor-lightning.js'
import cursorLightningTypescript from './entries/cursor-lightning.ts?raw'
import cursorLightningSource from './shaders/cursor-lightning.glsl?raw'

export interface ShaderExample {
  readonly id: string
  readonly title: string
  readonly source: string
  readonly sourceFilename: string
  readonly typescript: string
  readonly compile: () => Promise<CompiledGhosttyShader>
}

export const examples: readonly [ShaderExample, ...ShaderExample[]] = [
  {
    id: 'regular',
    title: 'Regular',
    source: regularSource,
    sourceFilename: 'regular.glsl',
    typescript: regularTypescript,
    compile: compileRegular,
  },
  {
    id: 'bettercrt',
    title: 'Better CRT',
    source: betterCrtSource,
    sourceFilename: 'bettercrt.glsl',
    typescript: betterCrtTypescript,
    compile: compileBetterCrt,
  },
  {
    id: 'inside-the-matrix',
    title: 'Inside the Matrix',
    source: matrixSource,
    sourceFilename: 'inside-the-matrix.glsl',
    typescript: matrixTypescript,
    compile: compileMatrix,
  },
  {
    id: 'fireworks',
    title: 'Fireworks',
    source: fireworksSource,
    sourceFilename: 'fireworks.glsl',
    typescript: fireworksTypescript,
    compile: compileFireworks,
  },
  {
    id: 'water',
    title: 'Water',
    source: waterSource,
    sourceFilename: 'water.glsl',
    typescript: waterTypescript,
    compile: compileWater,
  },
  {
    id: 'cursor-lightning',
    title: 'Cursor lightning',
    source: cursorLightningSource,
    sourceFilename: 'cursor-lightning.glsl',
    typescript: cursorLightningTypescript,
    compile: compileCursorLightning,
  },
]
