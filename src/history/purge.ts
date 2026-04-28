import fs from 'node:fs/promises'
import path from 'node:path'

import * as errore from 'errore'

import { historyDir as defaultHistoryDir } from '#lib/config'

import { historyMetaSchema, isAgentRanMeta } from './schema'

// Errors --

class PurgeError extends errore.createTaggedError({
  name: 'PurgeError',
  message: 'Failed to purge history: $reason',
}) {}

// Types --

type PurgeDeps = {
  configDir?: string
  now?: Date
  maxAgeDays?: number
}

// Implementation --

const MS_PER_DAY = 86_400_000

async function tryReaddir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

async function tryUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
  } catch {
    // Best-effort: file may not exist (legacy or partial history entries)
  }
}

// Public API --

export async function purgeHistory(
  deps?: PurgeDeps,
): Promise<PurgeError | { deleted: number }> {
  const histDir = deps?.configDir
    ? path.join(deps.configDir, 'history')
    : defaultHistoryDir
  const now = deps?.now ?? new Date()
  const maxAge = (deps?.maxAgeDays ?? 30) * MS_PER_DAY

  try {
    const taskDirs = await tryReaddir(histDir)
    let deleted = 0

    for (const taskName of taskDirs) {
      const taskDir = path.join(histDir, taskName)
      const stat = await fs.stat(taskDir)
      if (!stat.isDirectory()) continue

      const files = await fs.readdir(taskDir)
      const metaFiles = files.filter((f) => f.endsWith('.meta.json'))

      for (const metaFile of metaFiles) {
        const metaPath = path.join(taskDir, metaFile)
        const raw = await fs.readFile(metaPath, 'utf-8')
        const result = historyMetaSchema.safeDecode(JSON.parse(raw))
        if (!result.success) continue
        const meta = result.data

        // S4.9: never purge failed entries; non-agent-ran entries are also kept
        if (!isAgentRanMeta(meta) || !meta.success) continue

        const age = now.getTime() - meta.finished_at.getTime()
        if (age <= maxAge) continue

        // Delete the entry set
        const tsPrefix = metaFile.replace('.meta.json', '')
        await fs.unlink(metaPath)
        await tryUnlink(path.join(taskDir, `${tsPrefix}.output.txt`))
        await tryUnlink(path.join(taskDir, `${tsPrefix}.preflight.txt`))
        deleted++
      }
    }

    return { deleted }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return new PurgeError({ reason })
  }
}
