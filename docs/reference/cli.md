# CLI

The package installs one executable, `ghostty-web-shaderc`, from `dist/cli.js`.

## Synopsis

```text
ghostty-web-shaderc <shader.glsl|-> [--out shader.json]
```

## Arguments

| Argument        | Meaning                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `<shader.glsl>` | Path to a shader that defines `mainImage`. Read as UTF-8.                   |
| `-`             | Read the shader from stdin.                                                 |
| `--out <file>`  | Write the JSON to `<file>` instead of stdout. Must follow the input path.   |
| `--help`, `-h`  | Print the usage line to stdout and exit 0. Only valid as the sole argument. |

Any other argument form prints `Error: Usage: ghostty-web-shaderc <shader.glsl|-> [--out shader.json]` to stderr and exits 1.

## Output

The JSON document is `JSON.stringify(shader, null, 2)` followed by a newline, where `shader` is a [`CompiledGhosttyShader`](api.md#compiledghosttyshader). Keys appear in this order: `schemaVersion`, `uniformLayout`, `glsl`, `wgsl`, `entryPoint`, `webgl`.

With `--out`, stdout stays empty on success.

## Diagnostics

The CLI passes the input path as `sourceName`. For stdin, `sourceName` is `-`. A `ShaderCompileError` prints its `formatted` text to stderr. Any other error prints `String(error)`.

## Exit codes

| Code | Condition                                                                     |
| ---- | ----------------------------------------------------------------------------- |
| 0    | Compiled successfully, or `--help` was the only argument.                     |
| 1    | Bad arguments, unreadable input, compile error, or an unwritable output path. |
