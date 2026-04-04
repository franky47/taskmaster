import * as errore from 'errore'

export type ParseErrorField =
  | 'filename'
  | 'frontmatter'
  | 'schedule'
  | 'timezone'
  | 'cwd'
  | 'claude_args'
  | 'env'
  | 'enabled'

export type FieldError = {
  field: ParseErrorField
  message: string
}

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

export class TaskFileReadError extends errore.createTaggedError({
  name: 'TaskFileReadError',
  message: 'Failed to read task file $path',
}) {}

export class TaskParseError extends errore.createTaggedError({
  name: 'TaskParseError',
  message: 'Task "$taskName" has validation errors',
}) {
  readonly fieldErrors: FieldError[]
  constructor(args: {
    taskName: string
    fieldErrors: FieldError[]
    cause?: unknown
  }) {
    super(args)
    this.fieldErrors = args.fieldErrors
  }
}
