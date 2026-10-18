# ghostty-web-shaderc

Runtime compilation is the main API. Build-time compilation uses the same implementation.
Keep this compiler separate from ghostty-webgpu. Do not add Three.js or a second GLSL parser
when Naga already owns parsing, type checking, and code generation.

Use exact file imports, strict TypeScript, and at most three levels of control-flow nesting.
Combine arrays with concat. Parse untrusted inputs at the public boundary.

Changes must pass typecheck, lint, formatting, unit tests, the built-package consumer test,
and real Chromium WebGPU/WebGL2 pixel tests. GPU software tests prove correctness only.
Test processes, servers, profiles, and scratch files must be cleaned in finally blocks.
Never open GitHub issues; record larger follow-ups in plans/ instead.

Publish as a public package. Only patch version bumps before launch. Own PRs through review,
required checks, merge, and post-merge verification.
