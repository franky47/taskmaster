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

export class TaskNotFoundError extends errore.createTaggedError({
  name: 'TaskNotFoundError',
  message:
    'No task found at $path, create it or list available tasks with `tm list`.',
}) {}

export class TaskFileReadError extends errore.createTaggedError({
  name: 'TaskFileReadError',
  message: 'Failed to read task file $path',
}) {}

// --

export async function parseTaskFile(
  filePath: string,
): Promise<
  | TaskFileNameError
  | TaskNotFoundError
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

  const content = await fs.readFile(filePath, 'utf-8').catch((e) => {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      return new TaskNotFoundError({ path: filePath, cause: e })
    }
    return new TaskFileReadError({ path: filePath, cause: e })
  })
  if (content instanceof Error) return content

  return parseMarkdown(content)
}
