# Getting started

In this tutorial you compile a Ghostty shader, read a compile error, pack uniform values, and precompile a shader to JSON. It takes about ten minutes and needs only Node. Drawing the result on a canvas comes next, in the [WebGPU](guides/draw-with-webgpu.md) and [WebGL2](guides/draw-with-webgl2.md) guides.

You need Node 24.12 or later. That is the `engines` floor in `package.json`, and Node 24 runs the `.mts` files below directly, so there is no build step.

## Install the package

The package is not on npm yet. Install the tarball from the v0.0.2 release:

```sh
npm install https://github.com/ShaulLavo/ghostty-web-shaderc/releases/download/v0.0.2/ghostty-web-shaderc-0.0.2.tgz
```

pnpm, Yarn 1, and Bun install the same URL too. See [Package managers](../README.md#package-managers).

## Compile a shader

Save this as `step1.mts`. The shader multiplies the terminal texture by a pulse that follows `iTime`.

```ts
import { compileGhosttyShader } from 'ghostty-web-shaderc'

const source = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float pulse = 0.5 + 0.5 * sin(iTime);
    fragColor = texture(iChannel0, uv) * pulse;
}
`

const shader = await compileGhosttyShader(source, { sourceName: 'pulse.glsl' })

console.log(shader.entryPoint)
console.log(shader.uniformLayout)
console.log(shader.webgl)
console.log(shader.wgsl.includes('@fragment'))
console.log(shader.glsl.startsWith('#version 300 es'))
```

Run it:

```sh
node step1.mts
```

```text
main
ghostty-v1
{
  uniformBlock: 'GhosttyUniforms_block_0Fragment',
  channel0: '_group_0_binding_1_fs'
}
true
true
```

`shader.wgsl` is a fragment program for WebGPU. `shader.glsl` is a GLSL ES 3.00 fragment program for WebGL2. Both entry points are named `main`. The two names under `webgl` are what you pass to `getUniformBlockIndex` and `getUniformLocation` later. The first call loads the compiler, so it takes longer than the calls after it.

## Read an error

Save this as `step2.mts`. The shader uses a variable that does not exist.

```ts
import { compileGhosttyShader, ShaderCompileError } from 'ghostty-web-shaderc'

try {
  await compileGhosttyShader(
    `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = vec4(glow);
}`,
    { sourceName: 'broken.glsl' },
  )
} catch (error) {
  if (!(error instanceof ShaderCompileError)) throw error
  console.log(error.kind)
  console.log(error.diagnostics)
  console.log(error.formatted)
}
```

```sh
node step2.mts
```

```text
parse
[ { message: 'Unknown variable: glow', line: 2, column: 22 } ]
error: Unknown variable: glow
   ┌─ broken.glsl:2:22
   │
2 │     fragColor = vec4(glow);
   │                      ^^^^
```

Line 2, column 22 is a position in your source. The compiler adds a prefix and a suffix around your code, and it maps every position back before it reports. Parse and validation errors carry a line and column in `diagnostics`. Some errors from the package itself, such as a missing `mainImage`, carry `null` positions.

## Pack uniform values

Save this as `step3.mts`. Your shader reads uniforms such as `iResolution` and `iTime` from one buffer. The `/runtime` export fills that buffer for you.

```ts
import { packShaderUniforms, SHADER_UNIFORM_BYTE_LENGTH } from 'ghostty-web-shaderc/runtime'

const bytes = packShaderUniforms({ iResolution: [800, 600, 1], iTime: 1.5 })

console.log(SHADER_UNIFORM_BYTE_LENGTH)
console.log(bytes.byteLength)
console.log(new Float32Array(bytes, 0, 4))
```

```sh
node step3.mts
```

```text
4496
4496
Float32Array(4) [ 800, 600, 1, 1.5 ]
```

`iResolution` sits at byte 0 and `iTime` at byte 12. You upload these bytes to a GPU uniform buffer on every frame. The full table of offsets is in the [uniform layout](reference/uniforms.md).

## Precompile with the CLI

The CLI writes the same result as JSON, so a build step can compile once and ship the file.

```sh
cat > shader.glsl <<'EOF'
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = texture(iChannel0, fragCoord / iResolution.xy);
}
EOF
npx --no-install ghostty-web-shaderc shader.glsl --out shader.json
```

`shader.json` has the keys `schemaVersion`, `uniformLayout`, `glsl`, `wgsl`, `entryPoint`, and `webgl`.

## Next

- [Draw with WebGPU](guides/draw-with-webgpu.md) or [draw with WebGL2](guides/draw-with-webgl2.md) to put the output on a canvas.
- [How it works](concepts/how-it-works.md) for the pipeline behind these calls.
- [Shader contract](reference/shader-contract.md) for what a shader may and may not do.
