export interface TaskDefinition {
  name: string
  schedule: string
  timezone: string | undefined
  cwd: string | undefined
  claudeArgs: string[]
  env: Record<string, string>
  enabled: boolean
  prompt: string
}

export interface ParseError {
  field: string
  message: string
}

export interface ParseSuccess {
  ok: true
  task: TaskDefinition
}

export interface ParseFailure {
  ok: false
  errors: ParseError[]
}

export type ParseResult = ParseSuccess | ParseFailure
