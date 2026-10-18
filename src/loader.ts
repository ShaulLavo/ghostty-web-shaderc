import type { InitInput } from 'naga-wasm'
import { ShaderCompileError } from './diagnostics.js'

export interface InitializeShaderCompilerOptions {
  /** Browser override. Node and Bun load the binary installed with naga-wasm. */
  readonly wasm?: InitInput
}

export type ShaderCompiler = typeof import('naga-wasm')

let initialization: Promise<ShaderCompiler> | undefined

function checkedOptions(options: InitializeShaderCompilerOptions): void {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ShaderCompileError({
      kind: 'input',
      sourceName: 'shader compiler',
      message: 'Compiler initialization options must be an object',
    })
  }
}

async function loadCompiler(options: InitializeShaderCompilerOptions): Promise<ShaderCompiler> {
  try {
    const compiler = await import('naga-wasm')
    await compiler.init(options.wasm === undefined ? undefined : { module_or_path: options.wasm })
    return compiler
  } catch (cause) {
    initialization = undefined
    throw new ShaderCompileError({
      kind: 'initialization',
      sourceName: 'shader compiler',
      message: 'Could not initialize the shader compiler WebAssembly module',
      cause,
    })
  }
}

export function getShaderCompiler(
  options: InitializeShaderCompilerOptions = {},
): Promise<ShaderCompiler> {
  checkedOptions(options)
  initialization ??= loadCompiler(options)
  return initialization
}

/** Optional prewarming. Compilation initializes the shared compiler automatically. */
export async function initializeShaderCompiler(
  options: InitializeShaderCompilerOptions = {},
): Promise<void> {
  await getShaderCompiler(options)
}
