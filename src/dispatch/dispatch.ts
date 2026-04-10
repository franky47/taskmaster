import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { configDir as defaultConfigDir } from '#src/config'
import { manualTimestamp } from '#src/history'
import type { TaskListEntry } from '#src/list'
import { listTasks } from '#src/list'
import { log } from '#src/logger'
import { isOnline as defaultIsOnline } from '#src/network'
import type { TasksDirReadError } from '#src/validate'

// Types --

type SkippedTask = { name: string; reason: 'disabled' | 'offline' }

type DispatchResult = {
  event: string
  dispatched: string[]
  skipped: SkippedTask[]
}

type DispatchOptions = {
  payload?: string
  configDir?: string
  spawnRun?: (name: string, timestamp: string, extraArgs: string[]) => void
  isOnline?: () => Promise<boolean>
}

// Helpers --

function defaultSpawnRun(
  name: string,
  timestamp: string,
  extraArgs: string[],
): void {
  const tmCommand = /\.[jt]s$/.test(Bun.main)
    ? [process.execPath, path.resolve(Bun.main)]
    : [process.execPath]
  const args = [
    ...tmCommand,
    'run',
    name,
    '--timestamp',
    timestamp,
    ...extraArgs,
  ]
  const proc = Bun.spawn(args, {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })
  proc.unref()
}

async function writePayloadFile(
  eventName: string,
  taskName: string,
  payload: string,
): Promise<string> {
  const payloadPath = path.join(
    os.tmpdir(),
    `tm-dispatch-${eventName}-${taskName}-${Date.now()}.payload`,
  )
  await fs.writeFile(payloadPath, payload, { mode: 0o600 })
  return payloadPath
}

// Public API --

export async function dispatch(
  eventName: string,
  options?: DispatchOptions,
): Promise<TasksDirReadError | DispatchResult> {
  const cfgDir = options?.configDir ?? defaultConfigDir
  const spawnRun = options?.spawnRun ?? defaultSpawnRun
  const checkOnline = options?.isOnline ?? defaultIsOnline

  const tasksDir = path.join(cfgDir, 'tasks')
  const timestamp = manualTimestamp()

  // Stage 1: List all tasks, find event matches
  const listResult = await listTasks(tasksDir)
  if (listResult instanceof Error) return listResult

  for (const w of listResult.warnings) {
    log({ event: 'error', task: w.file.replace(/\.md$/, ''), error: w.error })
  }

  const matching = listResult.tasks.filter(
    (t) => 'event' in t.on && t.on.event === eventName,
  )

  // Stage 2: Filter disabled
  const enabled: TaskListEntry[] = []
  const skipped: SkippedTask[] = []

  for (const task of matching) {
    if (task.enabled === false) {
      log({ event: 'skipped', task: task.name, reason: 'disabled' })
      skipped.push({ name: task.name, reason: 'disabled' })
    } else {
      enabled.push(task)
    }
  }

  // Stage 3: Connectivity filter
  let toDispatch = enabled
  if (enabled.some((t) => t.enabled === 'when-online')) {
    const online = await checkOnline()
    if (!online) {
      toDispatch = []
      for (const task of enabled) {
        if (task.enabled === 'when-online') {
          log({ event: 'skipped', task: task.name, reason: 'offline' })
          skipped.push({ name: task.name, reason: 'offline' })
        } else {
          toDispatch.push(task)
        }
      }
    }
  }

  // Stage 4: Dispatch (write per-task payload file if present)
  const dispatched: string[] = []
  for (const task of toDispatch) {
    const extraArgs = ['--trigger', 'dispatch', '--event', eventName]
    if (options?.payload) {
      const payloadPath = await writePayloadFile(
        eventName,
        task.name,
        options.payload,
      )
      extraArgs.push('--payload-file', payloadPath)
    }
    spawnRun(task.name, timestamp, extraArgs)
    log({ event: 'started', task: task.name, trigger: 'dispatch' })
    dispatched.push(task.name)
  }

  return { event: eventName, dispatched, skipped }
}
