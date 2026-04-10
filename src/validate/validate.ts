import fs from 'node:fs/promises'
import path from 'node:path'

import * as errore from 'errore'

import {
  FrontmatterValidationError,
  parseTaskFile,
  TaskFileNameError,
} from '#lib/task'

type ValidResult = {
  name: string
  valid: true
}

type InvalidResult = {
  name: string
  valid: false
  errors: string[]
}

export type ValidationResult = ValidResult | InvalidResult

export class TasksDirReadError extends errore.createTaggedError({
  name: 'TasksDirReadError',
  message: 'Failed to read tasks directory $path',
}) {}

export async function validateTasks(
  tasksDir: string,
): Promise<TasksDirReadError | ValidationResult[]> {
  const entries = await fs.readdir(tasksDir).catch((e: unknown) => {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      return []
    }
    return new TasksDirReadError({ path: tasksDir, cause: e })
  })
  if (entries instanceof Error) return entries

  const mdFiles = entries.filter((f) => f.endsWith('.md')).sort()
  const results: ValidationResult[] = []

  for (const file of mdFiles) {
    const filePath = path.join(tasksDir, file)
    const name = file.replace(/\.md$/, '')
    const parsed = await parseTaskFile(filePath)

    if (parsed instanceof Error) {
      results.push({
        name,
        valid: false,
        errors: extractErrors(parsed),
      })
    } else {
      results.push({ name, valid: true })
    }
  }

  return results
}

function extractErrors(error: Error): string[] {
  if (error instanceof FrontmatterValidationError) {
    return error.errors.map((e) => `${e.key}: ${e.message}`)
  }
  if (error instanceof TaskFileNameError) {
    return [error.message]
  }
  return [error.message]
}
