import fs from 'node:fs/promises'
import path from 'node:path'

import * as errore from 'errore'
import { z } from 'zod'

import {
  FrontmatterParseError,
  FrontmatterValidationError,
  parseMarkdown,
} from './frontmatter'
import type { TaskDefinition } from './frontmatter'

const TASK_NAME_RE = /^[a-z0-9-]+$/

const filenameSchema = z.string().refine((v) => TASK_NAME_RE.test(v), {
  error: (issue) => `Task name "${String(issue.input)}" must match [a-z0-9-]+`,
})

// Errors --

export class TaskFileNameError extends errore.createTaggedError({
  name: 'TaskFileNameError',
  message: 'Task file name "$filename" is invalid',
}) {}

export class TaskFileReadError extends errore.createTaggedError({
  name: 'TaskFileReadError',
  message: 'Failed to read task file $path',
}) {}

export class TaskParseError extends errore.createTaggedError({
  name: 'TaskParseError',
  message: 'Task "$taskName" has validation errors',
}) {}

// --

export async function parseTaskFile(
  filePath: string,
): Promise<
  | TaskFileNameError
  | TaskFileReadError
  | FrontmatterParseError
  | FrontmatterValidationError
  | TaskDefinition
> {
  const filename = path.basename(filePath).replace(/\.md$/, '')
  const nameResult = filenameSchema.safeParse(filename)
  if (!nameResult.success) {
    return new TaskFileNameError({ filename })
  }

  const content = await fs
    .readFile(filePath, 'utf-8')
    .catch((e) => new TaskFileReadError({ path: filePath, cause: e }))
  if (content instanceof Error) return content

  return parseMarkdown(content)
}
