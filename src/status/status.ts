import path from 'node:path'

import { CronExpressionParser } from 'cron-parser'
import ms from 'ms'

import { configDir as defaultConfigDir } from '#src/config'
import { queryHistory } from '#src/history'
import { listTasks } from '#src/list'
import { readRunningMarker } from '#src/lock'
import type { ReadMarkerDeps } from '#src/lock'
import type { TasksDirReadError } from '#src/validate'

// Types --

type LastRun = {
  timestamp: string
  status: 'ok' | 'timeout' | 'err'
  exit_code: number
  duration_ms: number
}

type Running = {
  started_at: string
  timestamp: string
  pid: number
  duration_ms: number
}

type TaskStatus = {
  name: string
  schedule: string
  enabled: false | 'when-online' | 'always'
  timezone?: string
  timeout: string
  agent?: string
  run?: string
  last_run?: LastRun
  next_run?: string
  running?: Running
}

type StatusOptions = {
  configDir?: string
  now?: Date
  markerDeps?: ReadMarkerDeps
}

// Public API --

export async function getTaskStatuses(
  options?: StatusOptions,
): Promise<TasksDirReadError | TaskStatus[]> {
  const cfgDir = options?.configDir ?? defaultConfigDir
  const now = options?.now ?? new Date()
  const tasksDir = path.join(cfgDir, 'tasks')

  const listResult = await listTasks(tasksDir)
  if (listResult instanceof Error) return listResult

  for (const w of listResult.warnings) {
    process.stderr.write(`warning: ${w.file}: ${w.error.message}\n`)
  }

  const locksDir = path.join(cfgDir, 'locks')
  const statuses: TaskStatus[] = []

  for (const task of listResult.tasks) {
    const status: TaskStatus = {
      name: task.name,
      schedule: task.schedule,
      enabled: task.enabled,
      timeout: ms(task.timeout),
    }

    if (task.timezone) {
      status.timezone = task.timezone
    }
    if (task.agent) {
      status.agent = task.agent
    }
    if (task.run) {
      status.run = task.run
    }

    // Running state
    const marker = readRunningMarker(task.name, locksDir, options?.markerDeps)
    if (marker) {
      status.running = {
        started_at: marker.started_at,
        timestamp: marker.timestamp,
        pid: marker.pid,
        duration_ms: now.getTime() - new Date(marker.started_at).getTime(),
      }
    }

    // Last run
    const history = await queryHistory(task.name, {
      configDir: cfgDir,
      last: 1,
    })
    if (history instanceof Error) {
      process.stderr.write(
        `warning: ${task.name}: could not read history: ${history.message}\n`,
      )
    } else {
      const latest = history[0]
      if (latest) {
        status.last_run = {
          timestamp: latest.started_at.toISOString(),
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
