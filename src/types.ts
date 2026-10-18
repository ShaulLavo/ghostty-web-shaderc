export type ShaderVector2 = readonly [number, number]
export type ShaderVector3 = readonly [number, number, number]
export type ShaderVector4 = readonly [number, number, number, number]

export interface CompileOptions {
  readonly sourceName?: string
}

export interface CompiledGhosttyShader {
  readonly schemaVersion: 1
  readonly uniformLayout: 'ghostty-v1'
  readonly glsl: string
  readonly wgsl: string
  readonly entryPoint: 'main'
  readonly webgl: {
    readonly uniformBlock: string | null
    readonly channel0: string | null
  }
}

export interface ShaderUniformField {
  readonly name: string
  readonly type: 'float' | 'int' | 'vec3' | 'vec4'
  readonly offset: number
  readonly count: number
  readonly stride: number
}
