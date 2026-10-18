import { compileGhosttyShader } from 'ghostty-web-shaderc'

self.onmessage = async (event: MessageEvent<string>) => {
  try {
    const shader = await compileGhosttyShader(event.data)
    self.postMessage({
      ok: shader.wgsl.includes('@fragment') && shader.glsl.includes('void main'),
    })
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
