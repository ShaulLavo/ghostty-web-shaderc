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

## Commands

- `bun run verify` runs typecheck, lint, format check, unit tests, build, and `docs:check`. Run it first.
- Run one test file with `bun test test/unit/compiler.test.ts`.
- `bun run test:package` then `bun run test:browser` need a built package and Playwright Chromium. `test:browser` needs the Linux SwiftShader driver, so run it in CI, not on macOS. On macOS set `SHADERC_TEST_TMPDIR=/private/tmp/shaderc` for `test:package`.
- Run `bun run format` after editing Markdown. `format:check` covers `.md` files.

## Traps

- `docs/reference/uniforms.md` is generated. Edit `src/uniforms.ts` or `scripts/uniform-reference.ts`, then run `bun scripts/uniform-reference.ts`.
- `src/source.ts` replaces `#version` and precision text with spaces so line and column positions stay valid. Keep that when you change it.
- `ghostty-webgpu` is a dev dependency of the showcase only. Never import it from `src/`.

## Where to read first

- Before you change `src/source.ts` or `src/compiler.ts`, read `docs/concepts/how-it-works.md` and `docs/adr/`.
- Before you change a public export, update `docs/reference/api.md`.
