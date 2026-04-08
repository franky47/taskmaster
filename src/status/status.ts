import path from 'node:path'

import { CronExpressionParser } from 'cron-parser'
import ms from 'ms'

import { configDir as defaultConfigDir } from '../config'
import { queryHistory } from '../history'
import { listTasks } from '../list'
import type { TasksDirReadError } from '../validate'

// Types --

type LastRun = {
  timestamp: string
  status: 'ok' | 'timeout' | 'err'
  exit_code: number
  duration_ms: number
}

type TaskStatus = {
  name: string
  schedule: string
  enabled: false | 'when-online' | 'always'
  timezone?: string
  timeout?: string
  last_run?: LastRun
  next_run?: string
}

type StatusOptions = {
  configDir?: string
  now?: Date
}

// Public API --

export async function getTaskStatuses(
  options?: StatusOptions,
): Promise<TasksDirReadError | TaskStatus[]> {
  const cfgDir = options?.configDir ?? defaultConfigDir
  const now = options?.now ?? new Date()
  const tasksDir = path.join(cfgDir, 'tasks')

  const tasks = await listTasks(tasksDir)
  if (tasks instanceof Error) return tasks

  const statuses: TaskStatus[] = []

  for (const task of tasks) {
    const status: TaskStatus = {
      name: task.name,
      schedule: task.schedule,
      enabled: task.enabled,
    }

    if (task.timezone) {
      status.timezone = task.timezone
    }

    if (task.timeout) {
      status.timeout = ms(task.timeout)
    }

    // Last run
    const history = await queryHistory(task.name, {
      configDir: cfgDir,
      last: 1,
    })
    if (!(history instanceof Error)) {
      const latest = history[0]
      if (latest) {
        status.last_run = {
          timestamp: latest.started_at,
          status: latest.success ? 'ok' : latest.timed_out ? 'timeout' : 'err',
          exit_code: latest.exit_code,
          duration_ms: latest.duration_ms,
        }
      }
    }

    // Next run (only for enabled tasks)
    if (task.enabled !== false) {
      const cronOpts: { currentDate: Date; tz?: string } = { currentDate: now }
      if (task.timezone) {
        cronOpts.tz = task.timezone
      }
      const expr = CronExpressionParser.parse(task.schedule, cronOpts)
      status.next_run = expr.next().toDate().toISOString()
    }

    statuses.push(status)
  }

  return statuses
}
