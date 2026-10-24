# 002. Wrap the source in a generated prefix and suffix

Status: accepted
Date: 2026-10-18

## Context

A ShaderToy-style shader defines `mainImage` and reads uniforms and `iChannel0` that it never declares. Naga needs a complete fragment shader with declared bindings and an entry point. The WebGPU and WebGL2 outputs must expose identical bindings, so one uniform buffer and one bind group layout work for every shader. Compile errors should name the lines in the author's file.

## Decision

`createShaderSource` builds one GLSL 450 text from a generated prefix, the author's code, and a generated suffix. The prefix declares the uniform block at set 0 binding 0, the texture at binding 1, the sampler at binding 2, and the fragment input and output at location 0. The suffix defines `main` and calls `mainImage`. The author's `#version` line and precision qualifiers are replaced by spaces, not removed, so every line and column stays in place. The package subtracts the prefix length from every position Naga reports.

## Alternatives considered

- **Require a complete shader from the author.** It gives full control, but every shader would repeat the Ghostty declarations, and a shader could declare bindings that the two backends do not share.
- **Delete the version and precision lines.** It is simpler, but it shifts lines and columns, so diagnostics would need a second mapping.
- **Report Naga's positions as they are.** Authors would see line numbers that are off by the length of the prefix.

## Consequences

Authors cannot use `#version`, precision qualifiers, or names that begin with `_ghostty`, and cannot define `main`. Shaders keep their desktop-Ghostty shape. The WebGPU run adds a prefix that negates `dFdy`, so the package compiles each shader twice. The contract checks read the generated WGSL with regular expressions, which makes them only as stable as Naga's output format.
