# API

The package has two entry points. `ghostty-web-shaderc` exports the compiler and everything in the runtime entry. `ghostty-web-shaderc/runtime` exports only the items that do not need the compiler. Types come from `dist/index.d.ts` and `dist/runtime.d.ts`.

| Entry point                   | Exports                                                                                                                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ghostty-web-shaderc`         | `compileGhosttyShader`, `initializeShaderCompiler`, `ShaderCompileError`, and every runtime export. Types: `CompileOptions`, `InitializeShaderCompilerOptions`, `ShaderCompileErrorKind`, `ShaderDiagnostic`.                                                    |
| `ghostty-web-shaderc/runtime` | `FULLSCREEN_VERTEX_GLSL`, `FULLSCREEN_VERTEX_WGSL`, `packShaderUniforms`, `SHADER_UNIFORM_BYTE_LENGTH`, `SHADER_UNIFORM_FIELDS`. Types: `CompiledGhosttyShader`, `ShaderUniformField`, `ShaderUniformValues`, `ShaderVector2`, `ShaderVector3`, `ShaderVector4`. |

Both entry points are ES modules with `sideEffects: false`.

## compileGhosttyShader

```ts
function compileGhosttyShader(
  source: string,
  options?: CompileOptions,
): Promise<CompiledGhosttyShader>
```

Compiles one ShaderToy-style `mainImage` source to a WebGPU fragment program and a WebGL2 fragment program. Initializes the compiler on first use. Rejects with `ShaderCompileError` on every failure.

`source` must be a string with at least one non-whitespace character. A leading byte order mark is removed and `\r\n` and `\r` become `\n`.

### CompileOptions

```ts
interface CompileOptions {
  readonly sourceName?: string
}
```

| Field        | Default         | Meaning                                                                                      |
| ------------ | --------------- | -------------------------------------------------------------------------------------------- |
| `sourceName` | `'shader.glsl'` | Name used in `formatted` text and in `ShaderCompileError.sourceName`. Nonempty, single line. |

### CompiledGhosttyShader

```ts
interface CompiledGhosttyShader {
  readonly schemaVersion: 1
  readonly uniformLayout: 'ghostty-v1'
  readonly glsl: string
  readonly wgsl: string
  readonly entryPoint: 'main'
  readonly webgl: {
    readonly uniformBlock: string | null
    readonly channel0: string | null
  }
}
```

| Field                | Meaning                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `schemaVersion`      | Shape of this object. Always `1`.                                                        |
| `uniformLayout`      | Uniform byte layout. Always `'ghostty-v1'`. See [uniform layout](uniforms.md).           |
| `glsl`               | GLSL ES 3.00 fragment shader for WebGL2. Includes its own `#version` and precision.      |
| `wgsl`               | WGSL module with the fragment entry point for WebGPU.                                    |
| `entryPoint`         | Name of the fragment entry point in `wgsl`.                                              |
| `webgl.uniformBlock` | Name of the uniform block in `glsl`, or `null` if the compiler removed it as unused.     |
| `webgl.channel0`     | Name of the `iChannel0` sampler uniform in `glsl`, or `null` if the compiler removed it. |

The object is plain JSON data. The CLI writes it with `JSON.stringify`.

## initializeShaderCompiler

```ts
function initializeShaderCompiler(options?: InitializeShaderCompilerOptions): Promise<void>

interface InitializeShaderCompilerOptions {
  readonly wasm?: InitInput // from naga-wasm
}
```

Loads the compiler. Calling it is optional, because `compileGhosttyShader` does it on demand. Concurrent calls share one load. The first call that starts a load fixes its options, and later options are ignored. A failed load is discarded, so the next call starts a new one.

`InitInput` is `RequestInfo | URL | Response | BufferSource | WebAssembly.Module`. Node and Bun ignore `wasm` and load the binary installed with `naga-wasm`. Rejects with `kind: 'initialization'` when the module cannot load, and with `kind: 'input'` when `options` is not an object.

## ShaderCompileError

```ts
class ShaderCompileError extends Error {
  readonly name: 'ShaderCompileError'
  readonly kind: ShaderCompileErrorKind
  readonly sourceName: string
  readonly formatted: string
  readonly diagnostics: readonly ShaderDiagnostic[]
  readonly cause?: unknown
}

interface ShaderDiagnostic {
  readonly message: string
  readonly line: number | null
  readonly column: number | null
}
```

`message` is a short summary. `formatted` is a multi-line report with the source excerpt when Naga produced one, and otherwise `<sourceName>: <message>`. `diagnostics` always has at least one entry. `line` and `column` are 1-based positions in your source, or `null` when the error has no position in it. `cause` holds the original error.

### ShaderCompileErrorKind

| Kind             | Raised when                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `input`          | `source` is empty or not a string, `options` is not an object, or `sourceName` is invalid.            |
| `initialization` | The WASM module could not load.                                                                       |
| `parse`          | Naga could not parse the GLSL.                                                                        |
| `validation`     | Naga parsed the shader but rejected it.                                                               |
| `write`          | Naga could not write the output, or the generated WGSL failed validation.                             |
| `contract`       | The shader breaks a rule of the [shader contract](shader-contract.md), such as a missing `mainImage`. |

## packShaderUniforms

```ts
function packShaderUniforms(
  values?: Partial<ShaderUniformValues>,
  output?: ArrayBuffer,
): ArrayBuffer
```

Writes `values` into a std140 buffer of `SHADER_UNIFORM_BYTE_LENGTH` bytes and returns it. Without `output`, it allocates a new buffer. With `output`, it zeroes that buffer first and reuses it. Omitted values stay zero, except `iResolution`, which defaults to `[0, 0, 1]`.

Throws `TypeError` for an unknown uniform name, a value that is not a finite number, a vector of the wrong length, or an array of the wrong length. Throws `RangeError` for a float that does not fit in 32 bits, an `int` value that is not a signed 32-bit integer, or an `output` that is not an `ArrayBuffer` of exactly `SHADER_UNIFORM_BYTE_LENGTH` bytes.

### ShaderUniformValues

An object keyed by the GLSL uniform names in the [uniform layout](uniforms.md). Value types:

| Shader type | JavaScript value                                              |
| ----------- | ------------------------------------------------------------- |
| `float`     | `number`                                                      |
| `int`       | `number`                                                      |
| `vec3`      | `readonly [number, number, number]` (`ShaderVector3`)         |
| `vec4`      | `readonly [number, number, number, number]` (`ShaderVector4`) |
| `T[4]`      | A tuple of four `T` (`iChannelTime`, `iChannelResolution`)    |
| `T[256]`    | An array of 256 `T` (`iPalette`)                              |

`ShaderVector2` is exported as `readonly [number, number]`. No uniform uses it.

## SHADER_UNIFORM_BYTE_LENGTH and SHADER_UNIFORM_FIELDS

```ts
const SHADER_UNIFORM_BYTE_LENGTH: number // 4496
const SHADER_UNIFORM_FIELDS: readonly ShaderUniformField[]

interface ShaderUniformField {
  readonly name: string
  readonly type: 'float' | 'int' | 'vec3' | 'vec4'
  readonly offset: number // bytes
  readonly count: number // 1 for non-arrays
  readonly stride: number // bytes between elements
}
```

`SHADER_UNIFORM_FIELDS` is frozen and in declaration order. The [uniform layout](uniforms.md) page is generated from it.

## FULLSCREEN_VERTEX_WGSL and FULLSCREEN_VERTEX_GLSL

Strings. A vertex shader that draws one triangle from `vertex_index` (WGSL) or `gl_VertexID` (GLSL) with no vertex buffers. Draw three vertices. The WGSL vertex entry point is `main`. The GLSL output is `_vs2fs_location0`, the name the generated fragment shader reads.
