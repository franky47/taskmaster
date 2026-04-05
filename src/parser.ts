import fs from 'node:fs/promises'
import path from 'node:path'

import * as errore from 'errore'
import matter from 'gray-matter'
import { z } from 'zod'

import { filenameSchema, frontmatterSchema } from './frontmatter.ts'
import {
  TaskFileReadError,
  TaskParseError,
  type FieldError,
  type ParseErrorField,
  type TaskDefinition,
} from './types.ts'

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
  const nameResult = filenameSchema.safeParse(name)
  if (!nameResult.success) {
    errors.push(
      ...nameResult.error.issues.map((issue) => ({
        field: 'filename' as const,
        message: issue.message,
      })),
    )
  }

  const fm = errore.try({
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
  if (fm instanceof Error) return fm

  const result = frontmatterSchema.safeParse(fm.data)

  if (!result.success) {
    const flat = z.flattenError(result.error)
    for (const [field, messages] of Object.entries(flat.fieldErrors)) {
      for (const message of messages ?? []) {
        errors.push({ field: field as ParseErrorField, message })
      }
    }
    return new TaskParseError({ taskName: name, fieldErrors: errors })
  }

  if (errors.length > 0) {
    return new TaskParseError({ taskName: name, fieldErrors: errors })
  }

  return {
    name,
    schedule: result.data.schedule,
    timezone: result.data.timezone,
    cwd: result.data.cwd,
    claudeArgs: result.data.claude_args ?? [],
    env: result.data.env ?? {},
    enabled: result.data.enabled ?? true,
    prompt: fm.content.trim(),
  }
}
