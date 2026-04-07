import fs from 'node:fs/promises'
import path from 'node:path'

import { parseTaskFile } from '../task'
import type { TaskDefinition } from '../task'
import { TasksDirReadError } from '../validate'

export type TaskListEntry = Pick<
  TaskDefinition,
  'schedule' | 'timezone' | 'enabled' | 'timeout'
> & {
  name: string
}

export async function listTasks(
  tasksDir: string,
): Promise<TasksDirReadError | TaskListEntry[]> {
  const entries = await fs.readdir(tasksDir).catch((e: unknown) => {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      return []
    }
    return new TasksDirReadError({ path: tasksDir, cause: e })
  })
  if (entries instanceof Error) return entries
  if (entries.length === 0) return []

  const mdFiles = entries.filter((f) => f.endsWith('.md')).sort()
  const results: TaskListEntry[] = []

  for (const file of mdFiles) {
    const filePath = path.join(tasksDir, file)
    const parsed = await parseTaskFile(filePath)
    if (parsed instanceof Error) continue

    const entry: TaskListEntry = {
      name: file.replace(/\.md$/, ''),
      schedule: parsed.schedule,
      enabled: parsed.enabled,
    }
    if (parsed.timezone) {
      entry.timezone = parsed.timezone
    }
    if (parsed.timeout) {
      entry.timeout = parsed.timeout
    }
    results.push(entry)
  }

  return results
}
