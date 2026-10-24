# 001. Compile with Naga in WebAssembly

Status: accepted
Date: 2026-10-18

## Context

Ghostty custom shaders are GLSL files. A web terminal that wants them must produce WGSL for WebGPU and GLSL ES 3.00 for WebGL2, from a shader string it only has at run time. The page may run under a strict Content Security Policy, so generating and evaluating JavaScript is off the table. The same code should also work at build time, in Node and Bun.

## Decision

Parse, type check, and generate code with [Naga](https://github.com/gfx-rs/wgpu/tree/trunk/naga), the shader translator from the wgpu project, compiled to WebAssembly and loaded through `naga-wasm` (pinned at 30.2.0). The package contains no GLSL parser of its own. The CLI and the runtime call the same `compileGhosttyShader`.

## Alternatives considered

- **Three.js.** It brings a renderer and a node-based shader system, when the job is a string-to-string compile. `AGENTS.md` rules it out.
- **A second GLSL parser, such as one built on Tree-sitter.** It parses syntax but does no type checking or code generation, so the package would own a front end and an emitter. `AGENTS.md` rules out a second parser while Naga covers parsing, type checking, and code generation.
- **Compile at build time only.** It needs no WASM in the page, but it cannot compile a shader the user edits. The CLI keeps this path, as an option over the same implementation.

## Consequences

The package inherits Naga's GLSL front end. Anything Naga rejects, the package rejects, and a Naga bug becomes a package bug: a global initializer that depends on a uniform loses its assignment in 30.2.0. The page downloads a 2.0 MB WASM file (756,602 bytes gzipped) on first use. A strict CSP needs `'wasm-unsafe-eval'` and nothing more. The compiler lives or dies with one third-party package, `naga-wasm`, so upgrades need the pixel tests.
