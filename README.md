# ghostty-web-shaderc

Compile Ghostty and ShaderToy GLSL strings to WebGPU WGSL and WebGL2 GLSL, at runtime, in the browser or in Node.

```ts
import { compileGhosttyShader } from 'ghostty-web-shaderc'

const shader = await compileGhosttyShader(`
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = texture(iChannel0, uv) * vec4(1.0, 0.8, 0.6, 1.0);
}
`)

console.log(shader.wgsl.match(/fn mainImage[\s\S]*?\n}/)[0])
console.log(shader.webgl)
```

```text
fn mainImage(fragColor: ptr<function, vec4<f32>>, fragCoord: vec2<f32>) {
    var fragCoord_1: vec2<f32>;
    var uv: vec2<f32>;

    fragCoord_1 = fragCoord;
    let _e62 = fragCoord_1;
    let _e63 = global.iResolution;
    uv = (_e62 / _e63.xy);
    let _e67 = uv;
    let _e68 = textureSample(_ghosttyChannel0Texture, _ghosttyChannel0Sampler, _e67);
    (*fragColor) = (_e68 * vec4<f32>(1f, 0.8f, 0.6f, 1f));
    return;
}
{
  uniformBlock: 'GhosttyUniforms_block_0Fragment',
  channel0: '_group_0_binding_1_fs'
}
```

The example prints two things: the `mainImage` function from `shader.wgsl`, and `shader.webgl`, the two names you bind in WebGL2. `shader.wgsl` is the full program for a WebGPU pipeline. `shader.glsl` is the full program for a WebGL2 program, and the example does not print it. Ghostty shaders are plain GLSL files, and browsers cannot run them directly. This package is the missing compile step.

- **Same source, both APIs.** One `mainImage` shader becomes WGSL and GLSL ES 3.00 with the same uniform layout and the same coordinates.
- **Errors point at your lines.** A diagnostic reports the line and column in your source, not in the generated wrapper.
- **Strict-CSP friendly.** [Naga](https://github.com/gfx-rs/wgpu/tree/trunk/naga) compiles the shader inside a WebAssembly module. The page needs `wasm-unsafe-eval`, not `unsafe-eval`.
- **Compiler only.** You keep control of render targets, animation, and GPU resources. [ghostty-webgpu](https://github.com/ShaulLavo/fregat/tree/main/ghostty-webgpu) is a separate project, and installing this package adds no shader support to it.

<img alt="The showcase with the Inside the Matrix shader on a Ghostty terminal. Green glyphs fall behind the Ghostty logo, and the right pane shows the TypeScript entry point with tabs for the input GLSL and the generated WGSL and GLSL." src="https://raw.githubusercontent.com/ShaulLavo/ghostty-web-shaderc/main/docs/assets/showcase-matrix.webp">

_The [showcase](docs/guides/run-the-showcase.md) compiles the shader in your browser and shows the input and both outputs. The Matrix shader is by its listed authors, with its license in [SHADER_LICENSES.md](examples/showcase/SHADER_LICENSES.md)._

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ShaulLavo/ghostty-web-shaderc/main/docs/assets/pipeline.dark.svg">
  <img alt="Your mainImage shader is wrapped by createShaderSource, compiled by naga-wasm, checked against the contract, and returned as a CompiledGhosttyShader. The runtime export supplies uniform packing and vertex shaders. Your renderer draws the result." src="https://raw.githubusercontent.com/ShaulLavo/ghostty-web-shaderc/main/docs/assets/pipeline.light.svg">
</picture>

_One shader goes in and two programs come out. The renderer on the right is yours to write._

## Quick start

The package is not on npm yet. Install the tarball from the [v0.0.2 release](https://github.com/ShaulLavo/ghostty-web-shaderc/releases/tag/v0.0.2). You need Node 24.12 or later.

1. Install it.

   ```sh
   npm install https://github.com/ShaulLavo/ghostty-web-shaderc/releases/download/v0.0.2/ghostty-web-shaderc-0.0.2.tgz
   ```

   The same URL installs with `pnpm add`, `yarn add`, and `bun add`. See [Package managers](#package-managers).

2. Save the example above as `demo.mjs` and run it.

   ```sh
   node demo.mjs
   ```

   You see the output above.

3. Compile a file from the command line.

   ```sh
   cat > shader.glsl <<'EOF'
   void mainImage(out vec4 fragColor, in vec2 fragCoord) {
       fragColor = texture(iChannel0, fragCoord / iResolution.xy);
   }
   EOF
   npx --no-install ghostty-web-shaderc shader.glsl --out shader.json
   ```

   `shader.json` holds `wgsl`, `glsl`, and the WebGL binding names.

[Getting started](docs/getting-started.md) takes this to a working draw call.

### Package managers

The tarball install was run end to end, with the demo script and the CLI, on Node 24.22.1 with these tools:

| Tool | Version | Install command             | Result |
| ---- | ------- | --------------------------- | ------ |
| npm  | 11.19.1 | `npm install <tarball-url>` | Works  |
| pnpm | 8.11.0  | `pnpm add <tarball-url>`    | Works  |
| Yarn | 1.22.22 | `yarn add <tarball-url>`    | Works  |
| Bun  | 1.4.4   | `bun add <tarball-url>`     | Works  |

Bun also runs the demo (`bun demo.mjs`) and the CLI (`bunx --no-install ghostty-web-shaderc`). Yarn 2 and later were not tried.

### In a browser

Install the same tarball into your web project and import the package from your bundler entry. A Vite 8.3.5 production build of this page emitted the 2.0 MB `naga_bg-*.wasm` file as an asset, and the compiled shader came back in Chromium:

```js
// main.js
import { compileGhosttyShader } from 'ghostty-web-shaderc'

const shader = await compileGhosttyShader(`
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = texture(iChannel0, fragCoord / iResolution.xy);
}
`)
document.body.textContent = shader.wgsl
```

Vite is the only bundler tested. [Run in the browser](docs/guides/run-in-the-browser.md) covers Web Workers, serving the WASM file yourself, and the CSP.

## What you can do

| Task                                           | Guide                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| Draw a compiled shader with WebGPU             | [Draw with WebGPU](docs/guides/draw-with-webgpu.md)               |
| Draw a compiled shader with WebGL2             | [Draw with WebGL2](docs/guides/draw-with-webgl2.md)               |
| Bundle the compiler for a page or a Web Worker | [Run in the browser](docs/guides/run-in-the-browser.md)           |
| Compile ahead of time and ship JSON            | [Precompile with the CLI](docs/guides/precompile-with-the-cli.md) |
| See five shaders on a Ghostty terminal         | [Run the showcase](docs/guides/run-the-showcase.md)               |
| Find out why a shader fails                    | [Troubleshooting](docs/troubleshooting.md)                        |

## How it works

`compileGhosttyShader` wraps your `mainImage` in a generated GLSL prefix and suffix. The prefix declares the Ghostty uniform block and the `iChannel0` texture. Naga parses the result, validates it, and writes WGSL and GLSL ES 3.00. The package then checks that the output matches the fixed binding contract and maps every diagnostic back to your source lines. See [How it works](docs/concepts/how-it-works.md).

## Docs

- Tutorial: [Getting started](docs/getting-started.md)
- Guides: [docs/guides/](docs/guides/)
- Concepts: [How it works](docs/concepts/how-it-works.md)
- Reference: [API](docs/reference/api.md) · [CLI](docs/reference/cli.md) · [Shader contract](docs/reference/shader-contract.md) · [Uniform layout](docs/reference/uniforms.md)
- [Compatibility](docs/compatibility.md) · [Troubleshooting](docs/troubleshooting.md) · [Development](docs/development.md) · [Decisions](docs/adr/)

## Status

Pre-1.0 (0.0.x), experimental. The API and the `ghostty-v1` uniform layout can change between patch releases.

- Not on npm. The installable artifact is the GitHub release tarball.
- Supports one ShaderToy image pass with `iChannel0`. No buffer passes, audio, video, or extra channels.
- Compatibility covers the tested fixtures and pixel tests, not every GLSL extension. A shader that runs in desktop Ghostty can fail here. See [Compatibility](docs/compatibility.md).
- Tested in CI on Chromium (software GPU), Node, and Bun. iOS Safari 26.5 was checked by hand on the WebGL2 path. Firefox and desktop Safari are untested.

## License

[MIT](LICENSE). Bundled example shaders keep their own licenses, listed in [examples/showcase/SHADER_LICENSES.md](examples/showcase/SHADER_LICENSES.md). See also [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
