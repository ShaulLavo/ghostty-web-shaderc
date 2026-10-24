# Troubleshooting

Each entry gives the symptom, the cause, and the fix. Messages are from naga-wasm 30.2.0 and this package at the commit that wrote this page. Run the failing shader through `compileGhosttyShader` and read `error.kind`, `error.diagnostics`, and `error.formatted` first. The [API reference](reference/api.md#shadercompileerror) describes them.

## Shader must define void mainImage

```text
nomain.glsl: Shader must define void mainImage(out vec4 color, in vec2 fragCoord)
```

`kind` is `'contract'`. The shader has no `mainImage`, or `mainImage` has a different signature, such as one parameter. Define `void mainImage(out vec4 fragColor, in vec2 fragCoord)`.

If the message ends with "without defining main", the shader also defines `main`. Delete it. The compiler adds its own `main` and calls `mainImage` from it.

## Unknown variable: iChannel1

```text
error: Unknown variable: iChannel1
```

`kind` is `'parse'`. Only `iChannel0` exists. The package supports one image pass with one input texture. Chain several shaders yourself by drawing each pass to a texture and binding it as the next pass's `iChannel0`. The uniforms `iChannelTime` and `iChannelResolution` still exist as arrays of four.

## Only the Ghostty uniform block and iChannel0 are supported resources

`kind` is `'contract'`. The shader declares a uniform block or a binding of its own, for example `layout(set=0, binding=3) uniform Block { float k; };`. Declaring a plain `uniform float k;` fails earlier in Naga with "uniform/buffer blocks require layout(binding=X)". Remove the declaration and pass the value through an existing Ghostty uniform, or turn it into a `const`.

## Identifiers beginning with _ghostty are reserved

`kind` is `'contract'`, with the line and column of the identifier. The compiler's wrapper uses that prefix. Rename your variable. Comments may contain the prefix.

## A global variable always reads zero

A global declared as `float k = iTime * 2.0;` compiles but reads as zero, because naga-wasm 30.2.0 omits the assignment when the initializer depends on a uniform. Declare `float k;` and assign `k` at the start of `mainImage`. See the [known compiler limitation](reference/shader-contract.md#known-compiler-limitation).

## The compiler fails to initialize in the browser

`compileGhosttyShader` rejects with `kind: 'initialization'` and the message "Could not initialize the shader compiler WebAssembly module". The WASM file did not load or could not compile. Check two things:

1. The network panel shows a successful response for the `.wasm` file. If your bundler did not emit it, [serve it yourself](guides/run-in-the-browser.md#serve-the-wasm-file-yourself).
2. The page's Content Security Policy allows `'wasm-unsafe-eval'` in `script-src`. Without it, `error.cause` is a `CompileError` that says the module "violates the following Content Security policy directive" because `'unsafe-eval'` is not allowed.

A failed load is not cached. Fix the cause and call again.

## The picture is upside down

`iChannel0` reads row zero as the bottom row. A canvas or image source stores its top row first. Flip it on upload, with `UNPACK_FLIP_Y_WEBGL` in WebGL2 or a flip render pass in WebGPU. See [Texture orientation](concepts/how-it-works.md#texture-orientation).

## WebGPU rejects the bind group

```text
In entries[1], binding index 1 not present in the bind group layout.
```

The pipeline uses `layout: 'auto'`, and the shader never reads the texture, so the generated layout lacks bindings 1 and 2. Create the bind group layout yourself with all three bindings, as in [Draw with WebGPU](guides/draw-with-webgpu.md).

## The output is black or NaN

If the shader divides by `iResolution.xy`, check that you passed `iResolution`. An omitted `iResolution` packs as `[0, 0, 1]`, so the division is by zero. Call `packShaderUniforms({ iResolution: [width, height, 1] })` with the canvas size in physical pixels, and upload the buffer before every draw.
