import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { purgeHistory } from './purge'

async function makeConfigDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tm-purge-'))
}

type MetaOpts = {
  success: boolean
  finished_at: string
}

function makeMeta(opts: MetaOpts): string {
  return JSON.stringify({
    timestamp: '2026-01-01T00.00.00Z',
    started_at: opts.finished_at,
    finished_at: opts.finished_at,
    duration_ms: 0,
    exit_code: opts.success ? 0 : 1,
    success: opts.success,
  })
}

async function writeHistoryEntry(
  configDir: string,
  taskName: string,
  timestamp: string,
  meta: MetaOpts,
): Promise<void> {
  const dir = path.join(configDir, 'history', taskName)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `${timestamp}.meta.json`), makeMeta(meta))
  await fs.writeFile(path.join(dir, `${timestamp}.output.txt`), 'output')
}

describe('purgeHistory', () => {
  test('deletes successful entries older than 30 days', async () => {
    const configDir = await makeConfigDir()
    const oldTs = '2026-01-01T00.00.00Z'
    await writeHistoryEntry(configDir, 'my-task', oldTs, {
      success: true,
      finished_at: '2026-01-01T00:00:00Z',
    })

    const now = new Date('2026-03-01T00:00:00Z') // 59 days later
    const result = await purgeHistory({ configDir, now })
    if (result instanceof Error) throw result

    expect(result.deleted).toBe(1)

    const dir = path.join(configDir, 'history', 'my-task')
    expect(fs.access(path.join(dir, `${oldTs}.meta.json`))).rejects.toThrow()
    expect(fs.access(path.join(dir, `${oldTs}.output.txt`))).rejects.toThrow()
  })

  test('preserves successful entries newer than 30 days', async () => {
    const configDir = await makeConfigDir()
    const recentTs = '2026-03-15T10.00.00Z'
    await writeHistoryEntry(configDir, 'my-task', recentTs, {
      success: true,
      finished_at: '2026-03-15T10:00:00Z',
    })

    const now = new Date('2026-04-01T00:00:00Z') // 17 days later
    const result = await purgeHistory({ configDir, now })
    if (result instanceof Error) throw result

    expect(result.deleted).toBe(0)

    const dir = path.join(configDir, 'history', 'my-task')
    await fs.access(path.join(dir, `${recentTs}.meta.json`)) // should exist
  })

  test('never deletes failed entries regardless of age', async () => {
    const configDir = await makeConfigDir()
    const oldTs = '2025-01-01T00.00.00Z'
    await writeHistoryEntry(configDir, 'my-task', oldTs, {
      success: false,
      finished_at: '2025-01-01T00:00:00Z',
    })

    const now = new Date('2026-04-01T00:00:00Z') // over a year later
    const result = await purgeHistory({ configDir, now })
    if (result instanceof Error) throw result

    expect(result.deleted).toBe(0)

    const dir = path.join(configDir, 'history', 'my-task')
    await fs.access(path.join(dir, `${oldTs}.meta.json`)) // should exist
  })

  test('handles missing output.txt gracefully', async () => {
    const configDir = await makeConfigDir()
    const ts = '2026-01-01T00.00.00Z'
    // Write only meta (no output file)
    const dir = path.join(configDir, 'history', 'my-task')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, `${ts}.meta.json`),
      makeMeta({ success: true, finished_at: '2026-01-01T00:00:00Z' }),
    )

    const now = new Date('2026-03-01T00:00:00Z')
    const result = await purgeHistory({ configDir, now })
    if (result instanceof Error) throw result

    expect(result.deleted).toBe(1)
  })

  test('handles empty history directory', async () => {
    const configDir = await makeConfigDir()
    await fs.mkdir(path.join(configDir, 'history'), { recursive: true })

    const result = await purgeHistory({ configDir })
    if (result instanceof Error) throw result
    expect(result.deleted).toBe(0)
  })

  test('handles non-existent history directory', async () => {
    const configDir = await makeConfigDir()
    // No history dir created

    const result = await purgeHistory({ configDir })
    if (result instanceof Error) throw result
    expect(result.deleted).toBe(0)
  })

  test('purges across multiple tasks', async () => {
    const configDir = await makeConfigDir()
    const oldTs = '2026-01-01T00.00.00Z'

    await writeHistoryEntry(configDir, 'task-a', oldTs, {
      success: true,
      finished_at: '2026-01-01T00:00:00Z',
    })
    await writeHistoryEntry(configDir, 'task-b', oldTs, {
      success: true,
      finished_at: '2026-01-01T00:00:00Z',
    })

    const now = new Date('2026-03-01T00:00:00Z')
    const result = await purgeHistory({ configDir, now })
    if (result instanceof Error) throw result

    expect(result.deleted).toBe(2)
  })
})
