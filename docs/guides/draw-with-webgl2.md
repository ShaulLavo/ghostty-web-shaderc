# How to draw a compiled shader with WebGL2

This guide draws a compiled shader onto a canvas with a WebGL2 context. The same shader draws with [WebGPU](draw-with-webgpu.md).

The input texture is a 2x2 test image so you can see the result without a terminal. Replace it with your own texture. Row zero of that texture must be the bottom row of the picture. See [texture orientation](../concepts/how-it-works.md#texture-orientation).

```js
import { compileGhosttyShader } from 'ghostty-web-shaderc'
import {
  FULLSCREEN_VERTEX_GLSL,
  packShaderUniforms,
  SHADER_UNIFORM_BYTE_LENGTH,
} from 'ghostty-web-shaderc/runtime'

const source = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = vec4(texture(iChannel0, uv).rgb * (0.5 + 0.5 * sin(iTime)), 1.0);
}
`

// Row zero is the bottom row: red and green at the bottom, blue and yellow at the top.
const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255])

const canvas = document.querySelector('canvas')
const shader = await compileGhosttyShader(source)
const gl = canvas.getContext('webgl2')

function compile(type, text) {
  const object = gl.createShader(type)
  gl.shaderSource(object, text)
  gl.compileShader(object)
  if (!gl.getShaderParameter(object, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(object))
  }
  return object
}

const program = gl.createProgram()
gl.attachShader(program, compile(gl.VERTEX_SHADER, FULLSCREEN_VERTEX_GLSL))
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, shader.glsl))
gl.linkProgram(program)
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(program))
}
gl.useProgram(program)

// The names are null when the compiler removed an unused resource.
if (shader.webgl.uniformBlock !== null) {
  const block = gl.getUniformBlockIndex(program, shader.webgl.uniformBlock)
  gl.uniformBlockBinding(program, block, 0)
}
if (shader.webgl.channel0 !== null) {
  gl.uniform1i(gl.getUniformLocation(program, shader.webgl.channel0), 0)
}

const uniformBuffer = gl.createBuffer()
gl.bindBuffer(gl.UNIFORM_BUFFER, uniformBuffer)
gl.bufferData(gl.UNIFORM_BUFFER, SHADER_UNIFORM_BYTE_LENGTH, gl.DYNAMIC_DRAW)
gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, uniformBuffer)

const input = gl.createTexture()
gl.activeTexture(gl.TEXTURE0)
gl.bindTexture(gl.TEXTURE_2D, input)
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

gl.bindVertexArray(gl.createVertexArray())

function draw(seconds) {
  const uniforms = packShaderUniforms({
    iResolution: [canvas.width, canvas.height, 1],
    iTime: seconds,
  })
  gl.bindBuffer(gl.UNIFORM_BUFFER, uniformBuffer)
  gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uniforms)
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}

draw(Math.PI / 2)
```

`draw(Math.PI / 2)` sets the pulse factor to 1. The canvas shows the input texture smoothed by the linear filter, with red at the bottom left and yellow at the top right. The orientation matches the WebGPU guide. Change the argument to `Math.PI * 1.5` and the canvas goes black.

To animate, call `draw` from `requestAnimationFrame` with elapsed seconds. The package runs no timer of its own.

## Points that matter

- **Pass the generated GLSL unchanged.** It declares its own `#version 300 es` and precision.
- **Uniform block binding.** The uniform block is bound to binding point 0 here. Any point works if the buffer and `uniformBlockBinding` agree.
- **Vertex shader.** `FULLSCREEN_VERTEX_GLSL` outputs the varying `_vs2fs_location0`, the name the generated fragment shader reads. A vertex shader of your own must output the same name.
- **Vertex array.** Bind a vertex array object before `drawArrays`. No buffers are attached.
- **Resolution units.** `iResolution` is in physical pixels. Pass `canvas.width` and `canvas.height`, not CSS sizes.

## See also

- [Shader contract](../reference/shader-contract.md#webgl2-bindings) for the reflected names.
- `examples/showcase/gpu-pass.ts` in the repository for a complete adapter that uploads a terminal canvas as the input texture.
