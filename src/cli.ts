#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { compileGhosttyShader } from './compiler.js'
import { ShaderCompileError } from './diagnostics.js'

function argumentsFrom(values: readonly string[]) {
  if (values.length === 1 && (values[0] === '--help' || values[0] === '-h')) return null
  const [input, outputFlag, output] = values
  if (
    !input ||
    (values.length !== 1 && (values.length !== 3 || outputFlag !== '--out' || !output))
  ) {
    throw new Error('Usage: ghostty-web-shaderc <shader.glsl|-> [--out shader.json]')
  }
  return { input, output }
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding('utf8')
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  return source
}

async function main(): Promise<void> {
  const args = argumentsFrom(process.argv.slice(2))
  if (!args) {
    process.stdout.write('Usage: ghostty-web-shaderc <shader.glsl|-> [--out shader.json]\n')
    return
  }
  const source = args.input === '-' ? await readStdin() : await readFile(args.input, 'utf8')
  const shader = await compileGhosttyShader(source, { sourceName: args.input })
  const serialized = `${JSON.stringify(shader, null, 2)}\n`
  if (args.output) {
    await writeFile(args.output, serialized)
    return
  }
  process.stdout.write(serialized)
}

try {
  await main()
} catch (error) {
  const message = error instanceof ShaderCompileError ? error.formatted : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}
