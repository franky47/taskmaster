import fs from 'node:fs/promises'
import path from 'node:path'

import { CronExpressionParser } from 'cron-parser'

import { configDir as defaultConfigDir } from '#src/config'
import { formatTimestamp, purgeHistory, queryHistory } from '#src/history'
import type { TaskListEntry } from '#src/list'
import { listTasks } from '#src/list'
import { log } from '#src/logger'
import { isOnline as defaultIsOnline } from '#src/network'
import type { TasksDirReadError } from '#src/validate'

// Types --

type TickOptions = {
  configDir?: string
  now?: Date
  spawnRun?: (name: string, timestamp: string) => void
  isOnline?: () => Promise<boolean>
  dryRun?: boolean
}

type TickResult =
  | { dry_run: true; dispatched: string[]; skipped: string[] }
  | {
      dry_run: false
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
  // Compiled SFE: argv = ['bun', '/$bunfs/root/tm', ...], execPath = real path
  // Dev mode:     argv = ['/path/to/bun', 'src/main.ts', ...], Bun.main = script
  // In both cases, process.execPath is the reliable absolute path to the runtime.
  const tmCommand = /\.[jt]s$/.test(Bun.main)
    ? [process.execPath, path.resolve(Bun.main)]
    : [process.execPath]
  const args = [...tmCommand, 'run', name, '--timestamp', timestamp]
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
  const checkOnline = options?.isOnline ?? defaultIsOnline
  const dryRun = options?.dryRun ?? false

  const tasksDir = path.join(cfgDir, 'tasks')
  const floored = floorToMinute(now)
  const timestamp = formatTimestamp(floored)

  // Stage 1: Read all task files, filter out disabled
  const tasks = await listTasks(tasksDir)
  if (tasks instanceof Error) return tasks

  const enabledTasks = tasks.filter((t) => t.enabled !== false)

  const dispatched: string[] = []
  const skipped: string[] = []

  // Stage 2-3: Evaluate cron + dedup — collect tasks ready to dispatch
  const ready: TaskListEntry[] = []

  for (const task of enabledTasks) {
    if (!isCronMatch(task.schedule, floored, task.timezone)) continue

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

    ready.push(task)
  }

  // Stage 4: Connectivity filter
  let toDispatch = ready
  if (ready.some((t) => t.enabled === 'when-online')) {
    const online = await checkOnline()
    if (!online) {
      toDispatch = []
      for (const task of ready) {
        if (task.enabled === 'when-online') {
          log({ event: 'skipped', task: task.name, reason: 'offline' })
          skipped.push(task.name)
        } else {
          toDispatch.push(task)
        }
      }
    }
  }

  // Stage 5: Dispatch (skip in dry-run)
  for (const task of toDispatch) {
    if (!dryRun) {
      spawnRun(task.name, timestamp)
    }
    dispatched.push(task.name)
  }

  if (dryRun) {
    return { dry_run: true, dispatched, skipped }
  }

  // S8.9: Purge history
  const purgeResult = await purgeHistory({ configDir: cfgDir, now })
  const purged = purgeResult instanceof Error ? 0 : purgeResult.deleted

  // S8.7: Write heartbeat
  const heartbeatPath = path.join(cfgDir, 'heartbeat')
  await fs.writeFile(heartbeatPath, now.toISOString())

  return {
    dispatched,
    skipped,
    heartbeat: now.toISOString(),
    purged,
    dry_run: false,
  }
}
