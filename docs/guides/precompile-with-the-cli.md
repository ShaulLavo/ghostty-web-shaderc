# How to precompile shaders with the CLI

This guide compiles `.glsl` files at build time and loads the JSON at run time, so the page never loads the compiler. Skip it if you compile at run time. That is the default and needs no build step.

## Compile one file

```sh
npx --no-install ghostty-web-shaderc shaders/crt.glsl --out shaders/crt.shader.json
```

With `--out`, the command prints nothing on success. Without it, the JSON goes to stdout. Pass `-` to read the shader from stdin:

```sh
cat shaders/crt.glsl | npx --no-install ghostty-web-shaderc - > shaders/crt.shader.json
```

## Compile a folder

Add the loop to a build script. A compile error prints the diagnostic and exits 1, and `|| exit 1` stops the build at the first bad shader.

```sh
for f in shaders/*.glsl; do
  npx --no-install ghostty-web-shaderc "$f" --out "${f%.glsl}.shader.json" || exit 1
done
```

An error names your file and the position in it:

```text
error: Unknown variable: nope
   ┌─ shaders/bad.glsl:1:50
   │
1 │ void mainImage(out vec4 c, in vec2 p) { c = vec4(nope); }
   │                                                  ^^^^
```

## Load the JSON

The JSON has the same shape as the result of `compileGhosttyShader`. Pass it to the draw code from the [WebGPU](draw-with-webgpu.md) or [WebGL2](draw-with-webgl2.md) guide in place of `shader`:

```js
import shader from './shaders/crt.shader.json' with { type: 'json' }
import { packShaderUniforms } from 'ghostty-web-shaderc/runtime'
```

The `/runtime` export has no dependency on the compiler. A page that imports only `/runtime` and precompiled JSON never loads the WASM file. Import `ghostty-web-shaderc/runtime`, not the package root, because a bundler follows the root's dynamic import of `naga-wasm` and emits the WASM file.

The JSON is tied to the package version that wrote it. It carries `schemaVersion: 1` and `uniformLayout: 'ghostty-v1'`. Check both fields before you trust a JSON file from another build, and regenerate the files when you upgrade the package.

See the [CLI reference](../reference/cli.md) for every argument and exit code.
