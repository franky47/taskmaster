import fs from 'node:fs/promises'
import path from 'node:path'

import * as errore from 'errore'

import {
  configDir as defaultConfigDir,
  runsDir as defaultRunsDir,
} from '#src/config'

import type { HistoryMetaInput } from './schema'
import { historyMetaSchema } from './schema'

// Errors --

export class HistoryWriteError extends errore.createTaggedError({
  name: 'HistoryWriteError',
  message: 'Failed to write history for task "$task_name": $reason',
}) {}

// Types --

export type RecordArtifacts = {
  task_name: string
  output: string
  prompt: string
  cwd: { path: string; is_temp: boolean }
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
  meta: HistoryMetaInput,
  artifacts: RecordArtifacts,
  deps?: RecordHistoryDeps,
): Promise<HistoryWriteError | undefined> {
  const { task_name, output, prompt, cwd } = artifacts
  const success = meta.exit_code === 0
  const duration_ms = meta.finished_at.getTime() - meta.started_at.getTime()
  const cfgDir = deps?.configDir ?? defaultConfigDir

  try {
    // Write history files
    const histDir = path.join(cfgDir, 'history', task_name)
    await fs.mkdir(histDir, { recursive: true })

    const serialized = historyMetaSchema.encode({
      ...meta,
      success,
      duration_ms,
    })

    await fs.writeFile(
      path.join(histDir, `${meta.timestamp}.meta.json`),
      JSON.stringify(serialized, null, 2) + '\n',
    )

    await fs.writeFile(
      path.join(histDir, `${meta.timestamp}.output.txt`),
      output,
    )

    // Temp dir lifecycle
    if (cwd.is_temp) {
      if (success) {
        // S4.5: delete temp dir on success
        await fs.rm(cwd.path, { recursive: true })
      } else {
        // S4.6: move temp dir to runs/ on failure, write artifacts
        const runsBase = deps?.configDir
          ? path.join(deps.configDir, 'runs')
          : defaultRunsDir
        const runsPath = path.join(runsBase, task_name, meta.timestamp)
        await fs.mkdir(path.dirname(runsPath), { recursive: true })
        await moveTempDir(cwd.path, runsPath)

        await fs.writeFile(path.join(runsPath, 'prompt.md'), prompt)
        await fs.writeFile(path.join(runsPath, 'output.txt'), output)
      }
    }
    // S4.7: explicit cwd — no directory operations
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return new HistoryWriteError({ task_name, reason })
  }

  return undefined
}
