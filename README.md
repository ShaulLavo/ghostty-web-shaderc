# ghostty-web-shaderc

Compile Ghostty and ShaderToy GLSL strings to WebGPU WGSL and WebGL2 GLSL at runtime.
The compiler uses Naga in WebAssembly. It does not depend on Three.js, Tree-sitter, or a terminal renderer.

```sh
npm install https://github.com/ShaulLavo/ghostty-web-shaderc/releases/download/v0.0.1/ghostty-web-shaderc-0.0.1.tgz
```

```ts
import { compileGhosttyShader } from 'ghostty-web-shaderc'

const shader = await compileGhosttyShader(`
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = texture(iChannel0, uv);
}
`)

// Pass these to your renderer's shader pipeline.
shader.wgsl
shader.glsl
```

The package is distributed as a public GitHub release tarball. npm registry publication is pending.
Node requires version 24.12 or later. Bun 1.4.2 is also tested.

The first call loads and initializes the compiler. Concurrent calls share that initialization.
Later calls reuse the WASM instance. Compilation does not execute the shader as JavaScript.

The package compiles shaders. Applications own render targets, animation, shader chaining,
GPU resource disposal, and renderer integration. Installing this package does not add shader
support to ghostty-webgpu by itself.

## Runtime and build-time use

Runtime compilation is the default. Use the same compiler in Node, Bun, a browser, or a Web Worker.
The browser's bundler must serve the compiler's WASM asset. Vite support is covered by the package tests.
The WASM compiler requires CSP `script-src 'wasm-unsafe-eval'` when a page uses a restrictive policy.
It does not require JavaScript `unsafe-eval`, generated modules, or `blob:` script access.

For optional precompilation, use the CLI:

```sh
npx --no-install ghostty-web-shaderc crt.glsl --out crt.shader.json
cat crt.glsl | npx --no-install ghostty-web-shaderc - > crt.shader.json
```

The JSON contains both shader strings and their binding metadata. A precompiled consumer can
import the dependency-free `ghostty-web-shaderc/runtime` helpers without loading the compiler.

See [the shader contract](docs/shader-contract.md) for bindings, uniforms, coordinates, and supported source.

## Development

```sh
bun install --frozen-lockfile
bun run verify
bun run test:package
bunx playwright install chromium
bun run test:browser
```

Browser tests compile shaders through a packed Vite consumer, create real WebGPU and WebGL2
pipelines, and compare pixel output. Software GPU runs establish correctness, not performance.
