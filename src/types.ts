export type ParseErrorField =
  | 'filename'
  | 'frontmatter'
  | 'schedule'
  | 'timezone'
  | 'cwd'
  | 'claude_args'
  | 'env'
  | 'enabled'

export type TaskDefinition = {
  name: string
  schedule: string
  timezone: string | undefined
  cwd: string | undefined
  claudeArgs: string[]
  env: Record<string, string>
  enabled: boolean
  prompt: string
}

export type ParseError = {
  field: ParseErrorField
  message: string
}

export type ParseSuccess = {
  ok: true
  task: TaskDefinition
}

export type ParseFailure = {
  ok: false
  errors: ParseError[]
}

export type ParseResult = ParseSuccess | ParseFailure

export function isParseSuccess(result: ParseResult): result is ParseSuccess {
  return result.ok
}

export function isParseFailure(result: ParseResult): result is ParseFailure {
  return !result.ok
}
