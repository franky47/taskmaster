import fs from 'node:fs/promises'
import path from 'node:path'

import * as errore from 'errore'

import { configDir as defaultConfigDir } from '#src/config'

import type { HistoryMeta } from './schema'
import { historyMetaSchema } from './schema'

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

type QueryHistoryOptions = {
  failures?: boolean
  last?: number
  configDir?: string
}

// Public API --

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

  // Read history directory
  const histDir = path.join(cfgDir, 'history', taskName)
  let files: string[]
  try {
    files = await fs.readdir(histDir)
  } catch (e: unknown) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      return [] // Task exists but no history yet
    }
    const reason = e instanceof Error ? e.message : String(e)
    return new HistoryReadError({ taskName, reason })
  }

  // Parse meta files, sorted newest first
  const fileSet = new Set(files)
  const metaFiles = files
    .filter((f) => f.endsWith('.meta.json'))
    .sort()
    .reverse()

  const entries: HistoryEntry[] = []
  for (const file of metaFiles) {
    try {
      const content = await fs.readFile(path.join(histDir, file), 'utf-8')
      const parsed = historyMetaSchema.decode(JSON.parse(content))

      const outputFile = file.replace(/\.meta\.json$/, '.output.txt')
      const stdoutFile = file.replace(/\.meta\.json$/, '.stdout.txt')
      const output_path = fileSet.has(outputFile)
        ? path.join(histDir, outputFile)
        : fileSet.has(stdoutFile)
          ? path.join(histDir, stdoutFile)
          : undefined

      entries.push({ ...parsed, output_path })
    } catch {
      // Skip malformed meta files
      continue
    }
  }

  // Filter failures (S6.3)
  let result = options?.failures ? entries.filter((e) => !e.success) : entries

  // Limit (S6.4)
  if (options?.last !== undefined) {
    result = result.slice(0, options.last)
  }

  return result
}
