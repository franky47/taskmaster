import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { configDir as defaultConfigDir } from '#lib/config'
import { log } from '#lib/logger'
import type { Probes } from '#lib/requirements'
import { defaultProbes, filterByRequirements } from '#lib/requirements'
import type { Requirement } from '#lib/task'
import { manualTimestamp } from '#src/history'
import type { TaskListEntry } from '#src/list'
import { listTasks } from '#src/list'
import type { TasksDirReadError } from '#src/validate'

// Types --

type SkippedTask =
  | { name: string; reason: 'disabled' }
  | { name: string; reason: 'requirement-unmet'; requirement: Requirement[] }

type DispatchResult = {
  event: string
  dispatched: string[]
  skipped: SkippedTask[]
}

type DispatchOptions = {
  payload?: string
  configDir?: string
  spawnRun?: (name: string, timestamp: string, extraArgs: string[]) => void
  probes?: Probes
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
  const probes = { ...defaultProbes, ...options?.probes }

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

  // Stage 3: Requirements filter
  const filtered = await filterByRequirements(enabled, probes)
  for (const { task, unmet } of filtered.skipped) {
    log({
      event: 'skipped',
      task: task.name,
      reason: 'requirement-unmet',
      requirement: unmet,
    })
    skipped.push({
      name: task.name,
      reason: 'requirement-unmet',
      requirement: unmet,
    })
  }
  const toDispatch = filtered.ready

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
