import { parseTaskFile } from '#lib/task'
import type { TaskDefinition } from '#lib/task'
import { TaskNameError } from '#lib/task/name'
import { TasksDirReadError, walkTasksDir } from '#lib/task/walk'

export type TaskListEntry = Pick<
  TaskDefinition,
  'on' | 'timezone' | 'enabled' | 'requires' | 'timeout'
> & {
  name: string
  agent?: string
  run?: string
  preflight?: string
}

type TaskListWarning = {
  file: string
  error: Error
}

type TaskListResult = {
  tasks: TaskListEntry[]
  warnings: TaskListWarning[]
}

export async function listTasks(
  tasksDir: string,
): Promise<TasksDirReadError | TaskListResult> {
  const walked = await walkTasksDir(tasksDir)
  if (walked instanceof Error) return walked

  const tasks: TaskListEntry[] = []
  const warnings: TaskListWarning[] = []

  for (const w of walked.warnings) {
    warnings.push({ file: w.relativePath, error: w.error })
  }

  for (const walkEntry of walked.entries) {
    const parsed = await parseTaskFile(walkEntry.filePath)
    if (parsed instanceof Error) {
      warnings.push({ file: walkEntry.relativePath, error: parsed })
      continue
    }

    const entry: TaskListEntry = {
      name: walkEntry.canonical,
      on: parsed.on,
      enabled: parsed.enabled,
      requires: parsed.requires,
      timeout: parsed.timeout,
    }
    if (parsed.timezone) {
      entry.timezone = parsed.timezone
    }
    if ('agent' in parsed) {
      entry.agent = parsed.agent
    }
    if ('run' in parsed) {
      entry.run = parsed.run
    }
    if (parsed.preflight !== undefined) {
      entry.preflight = parsed.preflight
    }
    tasks.push(entry)
  }

  tasks.sort((a, b) => a.name.localeCompare(b.name))
  return { tasks, warnings }
}

// Invalid-filename warnings should be surfaced by `tm validate`; commands
// running on a hot path (`tm tick`, `tm dispatch`) drop them so the JSONL
// log isn't cluttered with the same offending file every cycle.
export function isInvalidFilenameWarning(warning: TaskListWarning): boolean {
  return warning.error instanceof TaskNameError
}
