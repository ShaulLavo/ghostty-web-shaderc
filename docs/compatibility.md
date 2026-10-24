# Compatibility

What the project tests, what it has checked by hand, and what nobody has tried. The package is pre-1.0 (0.0.x). Anything not listed as tested is a gap, not a guarantee.

## Runtimes

| Runtime | Version                                      | Evidence                                                                             |
| ------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Node    | 24.12 or later (`engines` in `package.json`) | CI runs Node 24. The packed-consumer test compiles a shader and runs the CLI.        |
| Bun     | 1.4.4 (the version CI pins)                  | The packed-consumer test runs the same compile under Bun. The unit tests run on Bun. |

CI runs on `ubuntu-latest` only. Windows and macOS are untested in CI. Older Node versions are untested.

## Browsers

| Browser                    | Compiler and WebGPU              | Compiler and WebGL2              | Evidence                                                                                       |
| -------------------------- | -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| Chromium (Playwright 1.63) | Tested in CI with a software GPU | Tested in CI with a software GPU | `test:browser` compares pixels from both APIs and compiles in a Web Worker under a strict CSP. |
| iOS Safari 26.5            | Not covered                      | Checked by hand                  | An iPhone 17 Pro run of the showcase selected WebGL2. Not repeated in CI.                      |
| Firefox, desktop Safari    | Not tested                       | Not tested                       |                                                                                                |

A software GPU proves correctness and says nothing about speed. The package makes no performance claim.

The package needs WebAssembly. Under a Content Security Policy, the page needs `'wasm-unsafe-eval'` in `script-src`. Nothing else is needed. See [Run in the browser](guides/run-in-the-browser.md#allow-wasm-under-a-strict-csp).

## Bundlers

Vite 8 builds a consumer that compiles from the main thread and from a module worker. That is the only tested bundler.

## Shader sources

The package supports one ShaderToy image pass with the Ghostty uniforms and `iChannel0`. See the [shader contract](reference/shader-contract.md#source) for the rules.

Coverage is the set of fixtures in `test/fixtures/` (`crt`, `cursor-glow`, `language`, `texture-operations`), the pixel cases in `test/browser/cases.ts`, and the five bundled showcase shaders. Naga's GLSL front end decides everything else. A shader that works in desktop Ghostty can be rejected here, and the error says why.

## Related projects

| Project        | Relationship                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ghostty-webgpu | A separate project. This repository uses it only as a dev dependency (0.1.2) for the showcase terminal. Installing this package adds no shader support to it.        |
| naga-wasm      | The compiler this package wraps, pinned at 30.2.0. It brings Naga, the shader translator from the wgpu project.                                                      |
| Ghostty        | The source of the uniform names and cursor constants. Ghostty is not a dependency. The reference revision is in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). |
