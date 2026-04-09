import fs from 'node:fs/promises'
import path from 'node:path'

import { parseTaskFile } from '#src/task'
import type { TaskDefinition } from '#src/task'
import { TasksDirReadError } from '#src/validate'

export type TaskListEntry = Pick<
  TaskDefinition,
  'schedule' | 'timezone' | 'enabled' | 'timeout'
> & {
  name: string
  agent?: string
  run?: string
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
  const entries = await fs.readdir(tasksDir).catch((e: unknown) => {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      return []
    }
    return new TasksDirReadError({ path: tasksDir, cause: e })
  })
  if (entries instanceof Error) return entries
  if (entries.length === 0) return { tasks: [], warnings: [] }

  const mdFiles = entries.filter((f) => f.endsWith('.md')).sort()
  const tasks: TaskListEntry[] = []
  const warnings: TaskListWarning[] = []

  for (const file of mdFiles) {
    const filePath = path.join(tasksDir, file)
    const parsed = await parseTaskFile(filePath)
    if (parsed instanceof Error) {
      warnings.push({ file, error: parsed })
      continue
    }

    const entry: TaskListEntry = {
      name: file.replace(/\.md$/, ''),
      schedule: parsed.schedule,
      enabled: parsed.enabled,
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
    tasks.push(entry)
  }

  return { tasks, warnings }
}
