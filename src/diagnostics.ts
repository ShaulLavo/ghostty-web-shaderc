export type ShaderCompileErrorKind =
  | 'input'
  | 'initialization'
  | 'parse'
  | 'validation'
  | 'write'
  | 'contract'

export interface ShaderDiagnostic {
  readonly message: string
  readonly line: number | null
  readonly column: number | null
}

interface ShaderErrorDetails {
  readonly kind: ShaderCompileErrorKind
  readonly sourceName: string
  readonly message: string
  readonly formatted?: string
  readonly diagnostics?: readonly ShaderDiagnostic[]
  readonly cause?: unknown
}

export class ShaderCompileError extends Error {
  override readonly name = 'ShaderCompileError'
  readonly kind: ShaderCompileErrorKind
  readonly sourceName: string
  readonly formatted: string
  readonly diagnostics: readonly ShaderDiagnostic[]

  constructor(details: ShaderErrorDetails) {
    super(details.message, { cause: details.cause })
    this.kind = details.kind
    this.sourceName = details.sourceName
    this.formatted = details.formatted ?? `${details.sourceName}: ${details.message}`
    this.diagnostics = details.diagnostics ?? [
      { message: details.message, line: null, column: null },
    ]
  }
}

export function sourceError(
  sourceName: string,
  message: string,
  source: string,
  offset: number,
): ShaderCompileError {
  const before = source.slice(0, offset)
  const line = before.split('\n').length
  const column = offset - before.lastIndexOf('\n')
  return new ShaderCompileError({
    kind: 'contract',
    sourceName,
    message,
    formatted: `${sourceName}:${line}:${column}: ${message}`,
    diagnostics: [{ message, line, column }],
  })
}
