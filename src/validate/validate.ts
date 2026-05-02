import { FrontmatterValidationError, parseTaskFile } from '#lib/task'
import { TasksDirReadError, walkTasksDir } from '#lib/task/walk'

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

export async function validateTasks(
  tasksDir: string,
): Promise<TasksDirReadError | ValidationResult[]> {
  const walked = await walkTasksDir(tasksDir)
  if (walked instanceof Error) return walked

  const results: ValidationResult[] = []

  for (const w of walked.warnings) {
    results.push({
      name: w.relativePath.replace(/\.md$/, ''),
      valid: false,
      errors: [w.error.message],
    })
  }

  for (const entry of walked.entries) {
    const parsed = await parseTaskFile(entry.filePath)
    if (parsed instanceof Error) {
      results.push({
        name: entry.canonical,
        valid: false,
        errors: extractErrors(parsed),
      })
    } else {
      results.push({ name: entry.canonical, valid: true })
    }
  }

  // Invalid-by-walker entries carry the slash-form relativePath as `name`
  // while valid entries carry the underscore-form canonical. Normalize the
  // sort key so both surfaces order by directory position consistently.
  results.sort((a, b) =>
    a.name.replaceAll('/', '_').localeCompare(b.name.replaceAll('/', '_')),
  )
  return results
}

function extractErrors(error: Error): string[] {
  if (error instanceof FrontmatterValidationError) {
    return error.errors.map((e) => `${e.key}: ${e.message}`)
  }
  return [error.message]
}
