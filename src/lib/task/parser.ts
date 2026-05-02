import fs from 'node:fs/promises'

import * as errore from 'errore'

import {
  FrontmatterParseError,
  FrontmatterValidationError,
  parseMarkdown,
} from './frontmatter'
import type { TaskDefinition } from './frontmatter'

// Errors --

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

// Filename validity is owned by `#lib/task/name`; callers are expected to
// resolve `filePath` from a canonical task name (see `taskFilePath` and
// `normalizeTaskName`). This function only handles I/O + frontmatter.
export async function parseTaskFile(
  filePath: string,
): Promise<
  | TaskNotFoundError
  | TaskFileReadError
  | FrontmatterParseError
  | FrontmatterValidationError
  | TaskDefinition
> {
  const content = await fs.readFile(filePath, 'utf-8').catch((e) => {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      return new TaskNotFoundError({ path: filePath, cause: e })
    }
    return new TaskFileReadError({ path: filePath, cause: e })
  })
  if (content instanceof Error) return content

  return parseMarkdown(content)
}
