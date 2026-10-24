# How to run the compiler in a browser or Web Worker

This guide gets `compileGhosttyShader` running in a bundled web page, in a Web Worker, and under a strict Content Security Policy.

## Bundle the compiler

Import the package as usual and let your bundler emit the WASM file. The compiler is a WebAssembly module from `naga-wasm`, about 2.0 MB (2,053,200 bytes, 756,602 bytes gzipped for naga-wasm 30.2.0). Check the size yourself:

```sh
ls -l node_modules/naga-wasm/dist/wasm/naga_bg.wasm
gzip -c node_modules/naga-wasm/dist/wasm/naga_bg.wasm | wc -c
```

The repository's package test builds a consumer with Vite 8 and `worker: { format: 'es' }`, and compiles from both the main thread and a module worker. No other bundler is tested.

Compilation loads lazily. The first `compileGhosttyShader` call fetches and instantiates the WASM module, and later calls reuse it. To pay that cost before the user needs a shader, call `initializeShaderCompiler()` once at startup:

```js
import { initializeShaderCompiler } from 'ghostty-web-shaderc'

await initializeShaderCompiler()
```

## Compile in a Web Worker

Compile off the main thread so a large shader does not block input. The browser test compiles in a module worker like this one.

```js
// worker.js
import { compileGhosttyShader } from 'ghostty-web-shaderc'

self.onmessage = async (event) => {
  try {
    self.postMessage({ shader: await compileGhosttyShader(event.data) })
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
```

```js
// main.js
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
worker.onmessage = (event) => console.log(event.data.shader ?? event.data.error)
worker.postMessage('void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0); }')
```

`CompiledGhosttyShader` is plain data, so `postMessage` clones it. A `ShaderCompileError` loses its `kind` and `diagnostics` when you stringify it, so post those fields too if the page needs them.

## Serve the WASM file yourself

If your bundler cannot emit the asset, or you host it on a CDN, point the compiler at the file before the first compile:

```js
import { initializeShaderCompiler } from 'ghostty-web-shaderc'

await initializeShaderCompiler({
  wasm: new URL('/assets/shader-compiler.wasm', location.href),
})
```

`wasm` accepts a URL string, a `URL`, a `Request`, a `Response`, bytes, or a compiled `WebAssembly.Module`. The override applies only to the first initialization. After a compile or an initialization has succeeded or is in progress, later options are ignored. Node and Bun always load the binary installed with `naga-wasm` and ignore `wasm`. Serve a copy of `node_modules/naga-wasm/dist/wasm/naga_bg.wasm`.

## Allow WASM under a strict CSP

If the page sets a `Content-Security-Policy`, add `'wasm-unsafe-eval'` to `script-src`. The compiler needs nothing else: no `unsafe-eval`, no `blob:` scripts, no generated modules. The browser test serves the bundle under this policy:

```text
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'
```

## Handle a failed load

When the WASM file does not load, the call rejects with a `ShaderCompileError` whose `kind` is `'initialization'`. The failure is not cached, so a later call retries the load. See [troubleshooting](../troubleshooting.md#the-compiler-fails-to-initialize-in-the-browser).
