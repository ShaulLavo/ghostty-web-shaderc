# Shader contract

The rules a shader must follow, and the bindings, coordinates, and resources the compiled output uses. For the pipeline behind these rules, see [How it works](../concepts/how-it-works.md). For function signatures, see the [API](api.md).

## Source

`compileGhosttyShader(source, { sourceName? })` accepts one ShaderToy-style image pass. The entry point is:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord)
```

| Rule             | Detail                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Entry point      | `mainImage` with an `out vec4` and a `vec2`. `inout` on the color works. Defining `main` is an error.                |
| Input channel    | `iChannel0` only. It is a 2D floating-point texture with a sampler. `texture`, `texelFetch`, and `textureSize` work. |
| Version line     | Any `#version` line is blanked. The compiler sets the version.                                                       |
| Precision        | `precision` declarations and `lowp`, `mediump`, `highp` qualifiers are blanked. Both outputs use 32-bit floats.      |
| Legacy sampling  | `texture2D` is defined as `texture`.                                                                                 |
| Preprocessor     | Macros, comments, and CRLF line endings work. `#include` is a parse error.                                           |
| Reserved names   | Identifiers beginning with `_ghostty` are an error outside comments.                                                 |
| Custom resources | A resource other than the Ghostty uniform block and `iChannel0` is an error.                                         |
| Custom I/O       | An input or output other than `mainImage` is an error. Depth and sample-mask outputs are an error.                   |
| Unavailable      | ShaderToy buffer graphs, audio and video inputs, `iChannel1` to `iChannel3`, custom resource declarations.           |

GLSL features are subject to Naga's front end and to WebGPU validation. A shader that compiles in desktop Ghostty can be rejected here. Compatibility is established by the fixtures in `test/fixtures/` and by the pixel tests, not by a list of supported extensions.

## Result

The compiled object has `glsl`, `wgsl`, `entryPoint: 'main'`, `schemaVersion: 1`, `uniformLayout: 'ghostty-v1'`, and `webgl.uniformBlock` and `webgl.channel0`. Either WebGL name is `null` when the compiler removed an unused resource. See [`CompiledGhosttyShader`](api.md#compiledghosttyshader).

Both outputs use 32-bit floats. Diagnostics report positions in your source, not in the generated wrapper.

## Vertex stage and coordinates

| Item                | Value                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Fragment input      | Location 0, a `vec2` UV with the origin at the bottom left of the output and the range 0 to 1. |
| `fragCoord`         | UV multiplied by `iResolution.xy`, in physical pixels from the bottom left.                    |
| `gl_FragCoord`      | Same XY as `fragCoord`, with Z zero and W one.                                                 |
| `dFdy`              | WebGPU output negates `dFdy`, `dFdyFine`, and `dFdyCoarse` so the GLSL direction is preserved. |
| Vertex shaders      | `FULLSCREEN_VERTEX_WGSL` and `FULLSCREEN_VERTEX_GLSL` from `ghostty-web-shaderc/runtime`.      |
| Draw call           | One triangle, three vertices, no vertex buffers.                                               |
| WebGPU entry points | Vertex `main`, fragment `main`.                                                                |
| WebGL vertex output | Named `_vs2fs_location0`, matching the generated fragment input.                               |

## Texture and color

| Item             | Value                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `iChannel0` rows | Row zero is the logical bottom row in both APIs. A top-first texture must be flipped before binding. |
| Color space      | Chosen by the application.                                                                           |
| Alpha            | Chosen by the application. The compiler applies no premultiplication or tone mapping.                |
| Filter and wrap  | Chosen by the application.                                                                           |
| CPU access       | None. The compiler never reads texture pixels.                                                       |

## WebGPU bindings

All resources are in group 0.

| Binding | Resource                                           |
| ------- | -------------------------------------------------- |
| 0       | Uniform buffer, `SHADER_UNIFORM_BYTE_LENGTH` bytes |
| 1       | `iChannel0` floating-point 2D texture              |
| 2       | `iChannel0` sampler                                |

A pipeline created with `layout: 'auto'` includes only the bindings the shader reads. A bind group that lists all three bindings needs an explicit bind group layout.

## WebGL2 bindings

| Item                  | Value                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Uniform block         | `shader.webgl.uniformBlock`. Select it with `getUniformBlockIndex` and bind it with `uniformBlockBinding`. |
| Uniform data          | The bytes from `packShaderUniforms`, uploaded to a uniform buffer at the block's binding point.            |
| Texture unit          | `shader.webgl.channel0` names a sampler uniform. Set it with `getUniformLocation` and `uniform1i`.         |
| Version and precision | Declared in `shader.glsl`. Pass the string to `shaderSource` unchanged.                                    |

A `null` name means the compiler removed that resource. Skip the corresponding call.

## Uniforms

Fields, byte offsets, strides, and value types are in the generated [uniform layout](uniforms.md). Pack them with `packShaderUniforms`, which takes the GLSL names. The application supplies all state: resolution, time, cursor, focus, colors, palette. No timer or animation loop runs inside the package.

## Known compiler limitation

With naga-wasm 30.2.0, a global initializer that depends on a uniform is accepted, and its assignment is omitted from the generated code. Constant global initializers work.

```glsl
float k = iTime * 2.0; // accepted, but the WGSL declares k and never assigns it

void mainImage(out vec4 c, in vec2 p) { c = vec4(k); }
```

The workaround is to declare the variable globally and assign it inside `mainImage`:

```glsl
float k;

void mainImage(out vec4 c, in vec2 p) {
  k = iTime * 2.0;
  c = vec4(k);
}
```
