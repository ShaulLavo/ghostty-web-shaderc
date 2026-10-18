# Shader contract

`compileGhosttyShader(source, { sourceName? })` accepts ShaderToy source with this entry point:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = texture(iChannel0, fragCoord / iResolution.xy);
}
```

Naga parses GLSL, checks types, generates WGSL and GLSL ES 3.00, and validates the WGSL again.
This package supplies the entry-point wrapper, Ghostty uniforms, and terminal texture binding.
It does not use JavaScript evaluation or a second syntax parser.

Both outputs use full 32-bit float precision. Source precision declarations and qualifiers are normalized.
The compiler preserves user source line and column positions for diagnostics.

The result contains `glsl`, `wgsl`, `entryPoint: 'main'`, `schemaVersion: 1`,
and `uniformLayout: 'ghostty-v1'`. It also includes the generated WebGL uniform block
and sampler names under `webgl.uniformBlock` and `webgl.channel0`.
Either name can be null when the compiler removes an unused resource.

## Vertex stage and coordinates

The fragment input at location zero is a bottom-left normalized UV coordinate.
`fragCoord` is that coordinate multiplied by `iResolution.xy`, in physical pixels.
Direct `gl_FragCoord` reads use the same bottom-left coordinates, with Z zero and W one.
The WebGPU wrapper adjusts Y derivatives to preserve GLSL `dFdy` direction.
The dependency-free runtime entry provides matching vertex shaders:

```ts
import {
  FULLSCREEN_VERTEX_GLSL,
  FULLSCREEN_VERTEX_WGSL,
  packShaderUniforms,
  SHADER_UNIFORM_BYTE_LENGTH,
} from 'ghostty-web-shaderc/runtime'
```

Draw one triangle with three vertices and no vertex buffers. The WebGPU vertex entry point is `main`.
The WebGL vertex output name matches the generated fragment input name.

`iChannel0` uses row zero as the logical bottom row in both APIs. Render an input texture
with that orientation, or flip an existing top-first texture before using it as this input.
An adapter can perform that flip in a GPU render pass. The compiler never reads texture pixels on the CPU.
Pixel comparison tests normalize WebGPU and WebGL readback row order before comparison.

The application chooses the color space, alpha convention, texture filter, and wrap mode.
The compiler preserves shader output, including alpha, without applying tone mapping or premultiplication.

## WebGPU bindings

All resources occupy group zero:

| Binding | Resource                                           |
| ------- | -------------------------------------------------- |
| 0       | Uniform buffer, `SHADER_UNIFORM_BYTE_LENGTH` bytes |
| 1       | `iChannel0` floating-point 2D texture              |
| 2       | `iChannel0` sampler                                |

Use an explicit bind group layout when the shader does not read every resource.
The WebGPU pipeline's fragment entry point is `main`.

## WebGL2 bindings

Use `shader.webgl.uniformBlock` with `getUniformBlockIndex` and `uniformBlockBinding`.
Upload the same packed bytes to a uniform buffer at the selected block binding.
Use `shader.webgl.channel0` with `getUniformLocation` and `uniform1i` to select the texture unit.
Skip a resource whose reflected name is null.

The generated GLSL declares its own version and precision. Pass it unchanged to `shaderSource`.

## Uniform values

The [generated uniform reference](uniforms.md) lists every field, byte offset, and array stride.
Pack values with the GLSL names:

```ts
const uniformBytes = packShaderUniforms({
  iResolution: [canvas.width, canvas.height, 1],
  iTime: performance.now() / 1000,
  iFocus: document.hasFocus() ? 1 : 0,
})
```

The application supplies state and schedules animation. No timer or animation loop runs inside this package.

## Initialization and diagnostics

`compileGhosttyShader` initializes the compiler on demand. `initializeShaderCompiler()` allows prewarming.
Browser hosts can override WASM loading before the first compile:

```ts
import { initializeShaderCompiler } from 'ghostty-web-shaderc'

await initializeShaderCompiler({
  wasm: new URL('/assets/shader-compiler.wasm', location.href),
})
```

The override accepts a URL, response, bytes, or a compiled WebAssembly module. Node and Bun use
the binary installed with naga-wasm. The browser default resolves that binary beside its JavaScript module.

Failures throw `ShaderCompileError`. Its `kind` distinguishes input, initialization, parsing,
validation, writing, and contract errors. `sourceName`, `formatted`, and `diagnostics` identify the source.
Diagnostic entries contain a message and nullable line and column positions.

## Source scope

The package supports one ShaderToy image pass using `iChannel0` and Ghostty's uniform names.
It does not implement ShaderToy buffer graphs, audio or video inputs, extra channel resources,
or custom resource declarations. Applications chain compiled image passes themselves.

GLSL features remain subject to Naga's frontend and WebGPU's validation rules.
A shader that compiles in desktop Ghostty can still be rejected here. Errors remain visible to the caller.
Compatibility claims cover the checked fixtures and rendered pixel tests, rather than every GLSL extension.
