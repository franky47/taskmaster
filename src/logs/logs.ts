import fs from 'node:fs/promises'
import path from 'node:path'

import * as errore from 'errore'

import { configDir as defaultConfigDir } from '#lib/config'
import { readRunningMarker } from '#lib/lock'
import type { ReadMarkerDeps } from '#lib/lock'
import { queryHistory } from '#src/history'

// Errors --

export class NoLogsError extends errore.createTaggedError({
  name: 'NoLogsError',
  message:
    'No logs available for task "$taskName" (not running and no history)',
}) {}

// Types --

type LogsFollowResult = {
  mode: 'follow'
  outputPath: string
}

type LogsPrintResult = {
  mode: 'print'
  content: string
}

type LogsResult = LogsFollowResult | LogsPrintResult

type LogsOptions = {
  configDir?: string
  markerDeps?: ReadMarkerDeps
}

// Public API --

export async function getTaskLogs(
  taskName: string,
  options?: LogsOptions,
): Promise<Error | LogsResult> {
  const cfgDir = options?.configDir ?? defaultConfigDir
  const locksDir = path.join(cfgDir, 'locks')

  // Check if task is currently running
  const marker = readRunningMarker(taskName, locksDir, options?.markerDeps)
  if (marker) {
    const outputPath = path.join(
      cfgDir,
      'history',
      taskName,
      `${marker.timestamp}.output.txt`,
    )
    return { mode: 'follow', outputPath }
  }

  // Not running — find most recent history entry
  const history = await queryHistory(taskName, { configDir: cfgDir, last: 1 })
  if (history instanceof Error) return history

  const latest = history[0]
  if (!latest?.output_path) {
    return new NoLogsError({ taskName })
  }

  try {
    const content = await fs.readFile(latest.output_path, 'utf-8')
    return { mode: 'print', content }
  } catch {
    return new NoLogsError({ taskName })
  }
}
