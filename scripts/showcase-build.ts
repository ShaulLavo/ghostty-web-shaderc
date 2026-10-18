import { cp, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = new URL('../examples/showcase/', import.meta.url)
const output = new URL('../.artifacts/showcase/', import.meta.url)

await build({
  root: fileURLToPath(root),
  base: './',
  build: { outDir: fileURLToPath(output), emptyOutDir: true, target: 'es2022' },
})

await cp(new URL('SHADER_LICENSES.md', root), new URL('SHADER_LICENSES.md', output))
await cp(new URL('shaders/', root), new URL('shaders/', output), { recursive: true })
await cp(new URL('../LICENSE', import.meta.url), new URL('LICENSE', output))
await cp(
  new URL('../THIRD_PARTY_NOTICES.md', import.meta.url),
  new URL('THIRD_PARTY_NOTICES.md', output),
)
await mkdir(new URL('licenses/', output))
const licenses: readonly (readonly [string, string])[] = [
  ['naga-wasm/LICENSE-MIT', 'naga-MIT.txt'],
  ['naga-wasm/LICENSE-APACHE', 'naga-APACHE.txt'],
  ['ghostty-webgpu/LICENSE', 'ghostty-webgpu.txt'],
  ['ghostty-webgpu/THIRD_PARTY_NOTICES.md', 'ghostty-notices.md'],
  ['highlight.js/LICENSE', 'highlight.js.txt'],
  ['@tanstack/hotkeys/LICENSE', 'tanstack-hotkeys.txt'],
  ['@tanstack/store/LICENSE', 'tanstack-store.txt'],
]
for (const [source, destination] of licenses) {
  await cp(
    new URL(`../node_modules/${source}`, import.meta.url),
    new URL(`licenses/${destination}`, output),
  )
}
