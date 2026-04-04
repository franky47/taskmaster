import fs from 'node:fs/promises'
import path from 'node:path'

import * as errore from 'errore'
import matter from 'gray-matter'

import {
  TaskFileReadError,
  TaskParseError,
  type FieldError,
  type TaskDefinition,
} from './types.ts'
import {
  collect,
  validateClaudeArgs,
  validateCwd,
  validateEnabled,
  validateEnv,
  validateFilename,
  validateSchedule,
  validateTimezone,
} from './validators.ts'

export async function parseTaskFile(
  filePath: string,
): Promise<TaskFileReadError | TaskParseError | TaskDefinition> {
  const content = await fs
    .readFile(filePath, 'utf-8')
    .catch((e) => new TaskFileReadError({ path: filePath, cause: e }))
  if (content instanceof Error) return content

  return parseTaskContent(path.basename(filePath), content)
}

export function parseTaskContent(
  filename: string,
  content: string,
): TaskParseError | TaskDefinition {
  const errors: FieldError[] = []

  const name = filename.replace(/\.md$/, '')
  collect(validateFilename(name), errors)

  const frontmatter = errore.try({
    try: () => matter(content),
    catch: (e) =>
      new TaskParseError({
        taskName: name,
        fieldErrors: [
          ...errors,
          { field: 'frontmatter', message: 'Failed to parse YAML frontmatter' },
        ],
        cause: e,
      }),
  })
  if (frontmatter instanceof Error) return frontmatter

  const data = frontmatter.data as Record<string, unknown>

  const schedule = collect(validateSchedule(data.schedule), errors)
  const timezone = collect(validateTimezone(data.timezone), errors)
  const cwd = collect(validateCwd(data.cwd), errors)
  const claudeArgs = collect(validateClaudeArgs(data.claude_args), errors)
  const env = collect(validateEnv(data.env), errors)
  const enabled = collect(validateEnabled(data.enabled), errors)

  if (errors.length > 0 || schedule === undefined) {
    return new TaskParseError({ taskName: name, fieldErrors: errors })
  }

  return {
    name,
    schedule,
    timezone,
    cwd,
    claudeArgs: claudeArgs ?? [],
    env: env ?? {},
    enabled: enabled ?? true,
    prompt: frontmatter.content.trim(),
  }
}
