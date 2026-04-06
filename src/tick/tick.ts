import fs from 'node:fs/promises'
import path from 'node:path'

import { CronExpressionParser } from 'cron-parser'

import { configDir as defaultConfigDir } from '../config'
import { formatTimestamp, purgeHistory, queryHistory } from '../history'
import { listTasks } from '../list'
import type { TasksDirReadError } from '../validate'

// Types --

type TickOptions = {
  configDir?: string
  now?: Date
  spawnRun?: (name: string, timestamp: string) => void
}

export type TickResult = {
  dispatched: string[]
  skipped: string[]
  heartbeat: string
  purged: number
}

// Helpers --

function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000)
}

function isCronMatch(
  schedule: string,
  floored: Date,
  timezone?: string,
): boolean {
  try {
    const cronOpts: { currentDate: Date; tz?: string } = {
      // Set currentDate to 1ms before the floored time so that
      // expr.next() returns the floored time itself if it matches
      currentDate: new Date(floored.getTime() - 1),
    }
    if (timezone) {
      cronOpts.tz = timezone
    }
    const expr = CronExpressionParser.parse(schedule, cronOpts)
    const next = expr.next().toDate()
    return next.getTime() === floored.getTime()
  } catch {
    return false
  }
}

function defaultSpawnRun(name: string, timestamp: string): void {
  const args = [
    ...process.argv.slice(0, 2),
    'run',
    name,
    '--timestamp',
    timestamp,
  ]
  const proc = Bun.spawn(args, {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })
  proc.unref()
}

// Public API --

export async function tick(
  options?: TickOptions,
): Promise<TasksDirReadError | TickResult> {
  const cfgDir = options?.configDir ?? defaultConfigDir
  const now = options?.now ?? new Date()
  const spawnRun = options?.spawnRun ?? defaultSpawnRun

  const tasksDir = path.join(cfgDir, 'tasks')
  const floored = floorToMinute(now)
  const timestamp = formatTimestamp(floored)

  // S8.1: Read all task files, filter to enabled
  const tasks = await listTasks(tasksDir)
  if (tasks instanceof Error) return tasks

  const enabledTasks = tasks.filter((t) => t.enabled)

  const dispatched: string[] = []
  const skipped: string[] = []

  for (const task of enabledTasks) {
    // S8.3: Evaluate cron expression against floored time
    if (!isCronMatch(task.schedule, floored, task.timezone)) continue

    // S8.4: Dedup against most recent history entry
    const history = await queryHistory(task.name, {
      configDir: cfgDir,
      last: 1,
    })
    if (
      !(history instanceof Error) &&
      history.length > 0 &&
      history[0]!.timestamp === timestamp
    ) {
      skipped.push(task.name)
      continue
    }

    // S8.5: Spawn detached tm run
    spawnRun(task.name, timestamp)
    dispatched.push(task.name)
  }

  // S8.9: Purge history
  const purgeResult = await purgeHistory({ configDir: cfgDir, now })
  const purged = purgeResult instanceof Error ? 0 : purgeResult.deleted

  // S8.7: Write heartbeat
  const heartbeatPath = path.join(cfgDir, 'heartbeat')
  await fs.writeFile(heartbeatPath, now.toISOString())

  return { dispatched, skipped, heartbeat: now.toISOString(), purged }
}
