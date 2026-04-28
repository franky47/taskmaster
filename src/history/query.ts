import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import * as errore from 'errore'

import { configDir as defaultConfigDir } from '#lib/config'
import type { RunningMarker } from '#lib/lock'

import type { HistoryMeta } from './schema'
import { historyMetaSchema, isAgentRanMeta } from './schema'

function isFailureEntry(entry: HistoryMeta): boolean {
  if (isAgentRanMeta(entry)) return !entry.success
  return entry.status !== 'skipped-preflight'
}

// Errors --

export class TaskNotFoundError extends errore.createTaggedError({
  name: 'TaskNotFoundError',
  message:
    'No task found named "$taskName", list available tasks with `tm list`.',
}) {}

class HistoryReadError extends errore.createTaggedError({
  name: 'HistoryReadError',
  message: 'Failed to read history for task "$taskName": $reason',
}) {}

// Types --

export type HistoryEntry = HistoryMeta & {
  output_path: string | undefined
}

type CompletedHistoryEntry = HistoryEntry & {
  status:
    | 'ok'
    | 'timeout'
    | 'err'
    | 'skipped-preflight'
    | 'preflight-error'
    | 'payload-error'
}

type RunningHistoryEntry = {
  status: 'running'
  timestamp: string
  started_at: Date
  pid: number
  output_path: string
}

type HistoryDisplayEntry = RunningHistoryEntry | CompletedHistoryEntry

type GlobalHistoryEntry = HistoryEntry & {
  task_name: string
}

type QueryHistoryOptions = {
  failures?: boolean
  last?: number
  configDir?: string
}

type DisplayOptions = {
  marker: RunningMarker | null
  taskName: string
  configDir: string
}

// Internals --

type ParseHistoryResult = {
  entries: HistoryEntry[]
  skipped: number
}

async function parseHistoryDir(histDir: string): Promise<ParseHistoryResult> {
  let files: string[]
  try {
    files = await fs.readdir(histDir)
  } catch {
    return { entries: [], skipped: 0 }
  }

  const fileSet = new Set(files)
  const metaFiles = files
    .filter((f) => f.endsWith('.meta.json'))
    .sort()
    .reverse()

  const entries: HistoryEntry[] = []
  let skipped = 0
  for (const file of metaFiles) {
    try {
      const content = await fs.readFile(path.join(histDir, file), 'utf-8')
      const parsed = historyMetaSchema.decode(JSON.parse(content))

      const outputFile = file.replace(/\.meta\.json$/, '.output.txt')
      const output_path = fileSet.has(outputFile)
        ? path.join(histDir, outputFile)
        : undefined

      entries.push({ ...parsed, output_path })
    } catch {
      skipped++
      continue
    }
  }

  return { entries, skipped }
}

// Public API --

export function buildDisplayEntries(
  entries: HistoryEntry[],
  options: DisplayOptions,
): HistoryDisplayEntry[] {
  const completed: CompletedHistoryEntry[] = entries.map((e) => {
    if (isAgentRanMeta(e)) {
      const status: 'ok' | 'timeout' | 'err' = e.success
        ? 'ok'
        : e.timed_out
          ? 'timeout'
          : 'err'
      return { ...e, status }
    }
    return e
  })

  if (!options.marker) return completed

  const histDir = path.join(options.configDir, 'history', options.taskName)
  const running: RunningHistoryEntry = {
    status: 'running',
    timestamp: options.marker.timestamp,
    started_at: new Date(options.marker.started_at),
    pid: options.marker.pid,
    output_path: path.join(histDir, `${options.marker.timestamp}.output.txt`),
  }

  return [running, ...completed]
}

export async function queryHistory(
  taskName: string,
  options?: QueryHistoryOptions,
): Promise<TaskNotFoundError | HistoryReadError | HistoryEntry[]> {
  const cfgDir = options?.configDir ?? defaultConfigDir

  // Check task file exists (S6.6)
  const taskPath = path.join(cfgDir, 'tasks', `${taskName}.md`)
  try {
    await fs.access(taskPath)
  } catch {
    return new TaskNotFoundError({ taskName })
  }

  const { entries, skipped } = await parseHistoryDir(
    path.join(cfgDir, 'history', taskName),
  )

  if (skipped > 0) {
    process.stderr.write(
      `warning: ${taskName}: skipped ${skipped} malformed history file${skipped > 1 ? 's' : ''}\n`,
    )
  }

  // Filter failures (S6.3)
  // A failure is an agent-ran-failure OR a non-skip terminal error variant.
  // skipped-preflight is a clean "no work to do" — not a failure.
  let result = options?.failures ? entries.filter(isFailureEntry) : entries

  // Limit (S6.4)
  if (options?.last !== undefined) {
    result = result.slice(0, options.last)
  }

  return result
}

const DEFAULT_GLOBAL_LIMIT = 20

export async function queryGlobalHistory(
  options?: QueryHistoryOptions,
): Promise<HistoryReadError | GlobalHistoryEntry[]> {
  const cfgDir = options?.configDir ?? defaultConfigDir
  const historyRoot = path.join(cfgDir, 'history')

  let dirents: Dirent[]
  try {
    dirents = await fs.readdir(historyRoot, { withFileTypes: true })
  } catch (e: unknown) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      return []
    }
    const reason = e instanceof Error ? e.message : String(e)
    return new HistoryReadError({ taskName: '(global)', reason })
  }

  const allEntries: GlobalHistoryEntry[] = []

  let totalSkipped = 0
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue
    const taskName = dirent.name
    const histDir = path.join(historyRoot, taskName)
    const { entries, skipped } = await parseHistoryDir(histDir)
    totalSkipped += skipped
    for (const entry of entries) {
      allEntries.push({ ...entry, task_name: taskName })
    }
  }

  if (totalSkipped > 0) {
    process.stderr.write(
      `warning: skipped ${totalSkipped} malformed history file${totalSkipped > 1 ? 's' : ''}\n`,
    )
  }

  allEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

  // Filter failures (see queryHistory comment)
  let result: GlobalHistoryEntry[] = options?.failures
    ? allEntries.filter(isFailureEntry)
    : allEntries

  // Limit (default 20)
  const limit = options?.last ?? DEFAULT_GLOBAL_LIMIT
  result = result.slice(0, limit)

  return result
}
