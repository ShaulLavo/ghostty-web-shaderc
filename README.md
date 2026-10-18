# ghostty-web-shaderc

Compile Ghostty and ShaderToy GLSL strings to WebGPU WGSL and WebGL2 GLSL at runtime.

```sh
npm install https://github.com/ShaulLavo/ghostty-web-shaderc/releases/download/v0.0.1/ghostty-web-shaderc-0.0.1.tgz
```

```ts
import { compileGhosttyShader } from 'ghostty-web-shaderc'

const { wgsl, glsl } = await compileGhosttyShader(shaderSource)
```

[Runtime and CLI](docs/getting-started.md) · [Shader contract](docs/shader-contract.md) · [Live showcase setup](docs/showcase.md)

[Public release](https://github.com/ShaulLavo/ghostty-web-shaderc/releases) · MIT license
