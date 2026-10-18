# Run the live shader showcase

The showcase displays a Ghostty terminal with a Regular control and switchable shaders, their TypeScript entry points,
the input GLSL, and the WGSL and GLSL generated in your browser. All source panes are read-only.

From a source checkout, run:

```sh
bun install --frozen-lockfile
bun run showcase:dev --port 4177
```

Open the local URL printed by Vite. To produce a static deployment:

```sh
bun run showcase:build
```

Serve `.artifacts/showcase/` over HTTPS or localhost. The directory includes JavaScript, WASM,
bundled shader sources, and their license notices. It can be served by any static host.
Shaders are bundled locally; changing examples does not fetch source from GitHub.

The terminal shows a scripted demo session. Shader compilation runs through
`compileGhosttyShader` when an example is selected. The TypeScript pane displays the actual
entry module called by the showcase, and the generated panes display its returned output.

The sample integration lives under `examples/showcase/`. Its post-processing adapter belongs
to this example and is separate from the compiler package's runtime exports.

The Regular entry is a local pass-through control. The [bundled shader manifest](../examples/showcase/SHADER_LICENSES.md) records authors,
licenses, and the exact upstream revision. The five bundled examples come from
[0xhckr/ghostty-shaders](https://github.com/0xhckr/ghostty-shaders).

## Verification

```sh
bun run typecheck:showcase
bun run showcase:build
bunx playwright install chromium
bun run test:showcase
```

The browser check exercises example selection, generated-code panes, visible GPU output, the
WebGL2 fallback, rapid switching, the narrow mobile layout, and visible load errors. It owns its
browser, server, and temporary profile and removes them before it exits.

## iOS Safari

The minimal layout and upstream examples were checked on an iPhone 17 Pro simulator running iOS
26.5 Safari. The simulator selected WebGL2. Chromium GPU tests cover the WebGPU path.

Runtime compilation releases WASM handles explicitly. It does not require `Symbol.dispose`, which
was unavailable in the tested Safari runtime.
