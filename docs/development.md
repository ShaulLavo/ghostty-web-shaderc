# Development

How to build, test, and change this repository. For the design, read [How it works](concepts/how-it-works.md) first.

## Set up

You need Node 24.12 or later and Bun 1.4.4.

```sh
bun install --frozen-lockfile
bun run verify
```

`verify` runs typecheck, lint, format check, unit tests, the build, and the docs check.

## Scripts

| Script                                                                          | What it does                                                                                                         |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `bun run build`                                                                 | Compiles `src/` to `dist/` with `tsconfig.build.json`.                                                               |
| `bun run typecheck`                                                             | `tsc --noEmit`.                                                                                                      |
| `bun run lint`                                                                  | `oxlint` over `src`, `test`, `scripts`, and `examples`.                                                              |
| `bun run format`                                                                | `oxfmt --write .` rewrites files in place. `format:check` only reports.                                              |
| `bun test ./test/unit`                                                          | Unit tests. Also `bun run test`.                                                                                     |
| `bun run docs:check`                                                            | Fails if `docs/reference/uniforms.md` differs from what `scripts/uniform-reference.ts` generates.                    |
| `bun run test:package`                                                          | Packs the package, installs it in a scratch consumer, runs Node, Bun, and CLI smoke tests, and builds a Vite bundle. |
| `bun run test:browser`                                                          | Serves that bundle under a strict CSP and compares WebGPU and WebGL2 pixels in Chromium.                             |
| `bun run typecheck:showcase`, `bun run showcase:build`, `bun run test:showcase` | Type check, build, and browser-test the showcase.                                                                    |
| `bun run showcase:dev`                                                          | Builds the package and starts Vite on the showcase. See [Run the showcase](guides/run-the-showcase.md).              |

## What CI proves

CI (`.github/workflows/ci.yml`) runs on `ubuntu-latest` with Node 24 and Bun 1.4.4: `verify`, `typecheck:showcase`, `showcase:build`, `test:package`, then Playwright Chromium for `test:browser` and `test:showcase`.

## Running the browser tests locally

```sh
bunx playwright install chromium
bun run test:browser
```

`test:browser` looks for the SwiftShader Vulkan driver that Playwright's Chromium ships on Linux. On macOS it stops with `Cached Chromium SwiftShader driver missing; install Playwright Chromium first`. Run it on Linux or in CI.

`test:package` writes a scratch consumer under the system temp directory. On macOS the default temp path goes through a symlink, and the Vite build then fails with an `emitFile` error. Point the test at a real path:

```sh
SHADERC_TEST_TMPDIR=/private/tmp/shaderc bun run test:package
```

## Layout

| Path                 | Contents                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| `src/compiler.ts`    | `compileGhosttyShader`, contract checks, and diagnostic mapping.         |
| `src/source.ts`      | `createShaderSource`: the prefix, your code, and the suffix.             |
| `src/uniforms.ts`    | The uniform table, `packShaderUniforms`, and the generated uniform GLSL. |
| `src/runtime.ts`     | The `/runtime` entry and the fullscreen vertex shaders.                  |
| `src/loader.ts`      | Lazy `naga-wasm` initialization.                                         |
| `src/diagnostics.ts` | `ShaderCompileError`.                                                    |
| `src/cli.ts`         | The `ghostty-web-shaderc` executable.                                    |
| `test/unit/`         | Bun unit tests. `test/fixtures/` holds the authored shader corpus.       |
| `test/browser/`      | The page, worker, and renderers that `test:browser` runs.                |
| `examples/showcase/` | The showcase app and its bundled shaders.                                |
| `scripts/`           | Package, browser, and showcase test drivers, and `uniform-reference.ts`. |

## Change the uniform layout

Edit `UNIFORM_DEFINITIONS` in `src/uniforms.ts`, then regenerate the reference:

```sh
bun scripts/uniform-reference.ts
```

The result reports the layout name `'ghostty-v1'`, typed in `src/types.ts` and set in `src/compiler.ts`.

## Change the docs

`format:check` covers Markdown, so run `bun run format` after editing. `docs/reference/uniforms.md` is generated. Edit the text in `scripts/uniform-reference.ts`, not in the file.

## Decisions

[docs/adr/](adr/) records why the compiler wraps source, why it uses Naga, and why it supports one image pass.
