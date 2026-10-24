# How to draw a compiled shader with WebGPU

This guide draws a compiled shader onto a canvas with the WebGPU API. It assumes you can already create a WebGPU device and a render pipeline. The same shader draws with [WebGL2](draw-with-webgl2.md).

The input texture is a 2x2 test image so you can see the result without a terminal. Replace it with your own texture. Row zero of that texture must be the bottom row of the picture. See [texture orientation](../concepts/how-it-works.md#texture-orientation).

```ts
import { compileGhosttyShader } from 'ghostty-web-shaderc'
import {
  FULLSCREEN_VERTEX_WGSL,
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
if (!canvas) throw new Error('The page has no canvas')
const shader = await compileGhosttyShader(source)

const adapter = await navigator.gpu.requestAdapter()
if (!adapter) throw new Error('No WebGPU adapter')
const device = await adapter.requestDevice()
const context = canvas.getContext('webgpu')
if (!context) throw new Error('WebGPU is not available')
const format = navigator.gpu.getPreferredCanvasFormat()
context.configure({ device, format })

// Declare all three bindings, even if the shader reads only some of them.
const bindGroupLayout = device.createBindGroupLayout({
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform', minBindingSize: SHADER_UNIFORM_BYTE_LENGTH },
    },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
  ],
})

const pipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
  vertex: {
    module: device.createShaderModule({ code: FULLSCREEN_VERTEX_WGSL }),
    entryPoint: 'main',
  },
  fragment: {
    module: device.createShaderModule({ code: shader.wgsl }),
    entryPoint: shader.entryPoint,
    targets: [{ format }],
  },
  primitive: { topology: 'triangle-list' },
})

const uniformBuffer = device.createBuffer({
  size: SHADER_UNIFORM_BYTE_LENGTH,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
})
const input = device.createTexture({
  size: [2, 2],
  format: 'rgba8unorm',
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
})
device.queue.writeTexture({ texture: input }, pixels, { bytesPerRow: 2 * 4 }, [2, 2])

const bindGroup = device.createBindGroup({
  layout: bindGroupLayout,
  entries: [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: input.createView() },
    { binding: 2, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
  ],
})

const draw = (seconds: number): void => {
  const uniforms = packShaderUniforms({
    iResolution: [canvas.width, canvas.height, 1],
    iTime: seconds,
  })
  device.queue.writeBuffer(uniformBuffer, 0, uniforms)

  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
    ],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.draw(3)
  pass.end()
  device.queue.submit([encoder.finish()])
}

draw(Math.PI / 2)
```

`draw(Math.PI / 2)` sets the pulse factor to 1. The canvas shows the input texture smoothed by the linear filter, with red at the bottom left and yellow at the top right. Change the argument to `Math.PI * 1.5` and the canvas goes black.

To animate, call `draw` from `requestAnimationFrame` with elapsed seconds. The package runs no timer of its own.

## Details that matter

- **Binding layout.** Create the bind group layout yourself, as shown. With `layout: 'auto'`, a shader that never reads the texture gets a layout without bindings 1 and 2, and a bind group that lists all three bindings fails validation.
- **Entry points.** The vertex entry point and the fragment entry point are both named `main`. Use `shader.entryPoint` for the fragment stage.
- **Draw call.** `pass.draw(3)` draws one triangle with no vertex buffers.
- **Resolution units.** `iResolution` is in physical pixels. Pass `canvas.width` and `canvas.height`, not CSS sizes.

## See also

- [Shader contract](../reference/shader-contract.md#webgpu-bindings) for the binding table.
- `examples/showcase/gpu-pass.ts` in the repository for a complete adapter that chains a terminal canvas into a shader pass.
