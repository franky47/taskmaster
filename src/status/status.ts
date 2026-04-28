import path from 'node:path'

import { CronExpressionParser } from 'cron-parser'
import ms from 'ms'

import { configDir as defaultConfigDir } from '#lib/config'
import { readRunningMarker } from '#lib/lock'
import type { ReadMarkerDeps } from '#lib/lock'
import type { Requirement } from '#lib/task'
import { queryHistory } from '#src/history'
import type { RunId } from '#src/history'
import { isAgentRanMeta } from '#src/history/schema'
import { listTasks } from '#src/list'
import type { TasksDirReadError } from '#src/validate'

// Types --

type LastRun = {
  timestamp: RunId
  status:
    | 'ok'
    | 'timeout'
    | 'err'
    | 'skipped-preflight'
    | 'preflight-error'
    | 'payload-error'
  exit_code?: number
  duration_ms: number
}

type Running = {
  started_at: string
  timestamp: RunId
  pid: number
  duration_ms: number
}

type TaskStatus = {
  name: string
  on: { schedule: string } | { event: string }
  enabled: boolean
  requires: Requirement[]
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
      on: task.on,
      enabled: task.enabled,
      requires: task.requires,
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
        if (isAgentRanMeta(latest)) {
          status.last_run = {
            timestamp: latest.timestamp,
            status: latest.success
              ? 'ok'
              : latest.timed_out
                ? 'timeout'
                : 'err',
            exit_code: latest.exit_code,
            duration_ms: latest.duration_ms,
          }
        } else {
          status.last_run = {
            timestamp: latest.timestamp,
            status: latest.status,
            duration_ms: latest.duration_ms,
          }
        }
      }
    }

    // Next run (only for enabled scheduled tasks)
    if (task.enabled && 'schedule' in task.on) {
      const cronOpts: { currentDate: Date; tz?: string } = { currentDate: now }
      if (task.timezone) {
        cronOpts.tz = task.timezone
      }
      const expr = CronExpressionParser.parse(task.on.schedule, cronOpts)
      status.next_run = expr.next().toDate().toISOString()
    }

    statuses.push(status)
  }

  return statuses
}
