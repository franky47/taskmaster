import fs from 'node:fs/promises'
import path from 'node:path'

import * as errore from 'errore'

import { configDir as defaultConfigDir } from '../config'
import type { HistoryMeta } from './schema'

// Errors --

export class HistoryWriteError extends errore.createTaggedError({
  name: 'HistoryWriteError',
  message: 'Failed to write history for task "$taskName": $reason',
}) {}

export type RecordHistoryInput = {
  taskName: string
  timestamp: string
  startedAt: Date
  finishedAt: Date
  exitCode: number
  stdout: string
  stderr: string
  prompt: string
  cwd: { path: string; isTemp: boolean }
  timedOut: boolean
}

type RecordHistoryDeps = {
  configDir?: string
}

// Implementation --

async function moveTempDir(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest)
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EXDEV') {
      // Cross-filesystem: copy then remove
      await fs.cp(src, dest, { recursive: true })
      await fs.rm(src, { recursive: true })
    } else {
      throw err
    }
  }
}

// Public API --

export async function recordHistory(
  input: RecordHistoryInput,
  deps?: RecordHistoryDeps,
): Promise<HistoryWriteError | undefined> {
  const {
    taskName,
    timestamp,
    startedAt,
    finishedAt,
    exitCode,
    stdout,
    stderr,
    prompt,
    cwd,
    timedOut,
  } = input
  const success = exitCode === 0
  const cfgDir = deps?.configDir ?? defaultConfigDir

  try {
    // Write history files
    const histDir = path.join(cfgDir, 'history', taskName)
    await fs.mkdir(histDir, { recursive: true })

    const meta: HistoryMeta = {
      timestamp,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      exit_code: exitCode,
      success,
      timed_out: timedOut,
    }

    await fs.writeFile(
      path.join(histDir, `${timestamp}.meta.json`),
      JSON.stringify(meta, null, 2) + '\n',
    )

    await fs.writeFile(path.join(histDir, `${timestamp}.stdout.txt`), stdout)

    if (stderr) {
      await fs.writeFile(path.join(histDir, `${timestamp}.stderr.txt`), stderr)
    }

    // Temp dir lifecycle
    if (cwd.isTemp) {
      if (success) {
        // S4.5: delete temp dir on success
        await fs.rm(cwd.path, { recursive: true })
      } else {
        // S4.6: move temp dir to runs/ on failure, write artifacts
        const runsPath = path.join(cfgDir, 'runs', taskName, timestamp)
        await fs.mkdir(path.dirname(runsPath), { recursive: true })
        await moveTempDir(cwd.path, runsPath)

        // Write prompt, stdout, stderr into the preserved directory
        await fs.writeFile(path.join(runsPath, 'prompt.md'), prompt)
        await fs.writeFile(path.join(runsPath, 'stdout.txt'), stdout)
        if (stderr) {
          await fs.writeFile(path.join(runsPath, 'stderr.txt'), stderr)
        }
      }
    }
    // S4.7: explicit cwd — no directory operations
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return new HistoryWriteError({ taskName, reason })
  }

  return undefined
}
