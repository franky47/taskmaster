import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { HistoryReadError, TaskNotFoundError, queryHistory } from './query'

async function makeConfigDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tm-query-'))
}

async function writeTask(configDir: string, name: string): Promise<void> {
  const tasksDir = path.join(configDir, 'tasks')
  await fs.mkdir(tasksDir, { recursive: true })
  await fs.writeFile(
    path.join(tasksDir, `${name}.md`),
    '---\nschedule: "0 * * * *"\n---\ndo stuff\n',
  )
}

type MetaOverrides = Partial<{
  timestamp: string
  started_at: string
  finished_at: string
  duration_ms: number
  exit_code: number
  success: boolean
}>

async function writeMeta(
  configDir: string,
  taskName: string,
  timestamp: string,
  overrides: MetaOverrides = {},
): Promise<void> {
  const histDir = path.join(configDir, 'history', taskName)
  await fs.mkdir(histDir, { recursive: true })

  const meta = {
    timestamp,
    started_at: `${timestamp.replace(/\./g, ':')}`.replace(/Z$/, '.000Z'),
    finished_at: `${timestamp.replace(/\./g, ':')}`.replace(/Z$/, '.000Z'),
    duration_ms: 1000,
    exit_code: 0,
    success: true,
    ...overrides,
  }

  await fs.writeFile(
    path.join(histDir, `${timestamp}.meta.json`),
    JSON.stringify(meta, null, 2) + '\n',
  )
}

async function writeStderr(
  configDir: string,
  taskName: string,
  timestamp: string,
  content: string,
): Promise<void> {
  const histDir = path.join(configDir, 'history', taskName)
  await fs.writeFile(path.join(histDir, `${timestamp}.stderr.txt`), content)
}

describe('queryHistory', () => {
  test('returns TaskNotFoundError when task file does not exist', async () => {
    const configDir = await makeConfigDir()
    const result = await queryHistory('no-such-task', { configDir })
    expect(result).toBeInstanceOf(TaskNotFoundError)
  })

  test('returns empty array when task exists but has no history', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')

    const result = await queryHistory('daily-audit', { configDir })
    expect(result).toEqual([])
  })

  test('returns entries sorted most recent first', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-01T08.00.00Z')
    await writeMeta(configDir, 'daily-audit', '2026-04-03T08.00.00Z')
    await writeMeta(configDir, 'daily-audit', '2026-04-02T08.00.00Z')

    const result = await queryHistory('daily-audit', { configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.map((e) => e.timestamp)).toEqual([
      '2026-04-03T08.00.00Z',
      '2026-04-02T08.00.00Z',
      '2026-04-01T08.00.00Z',
    ])
  })

  test('--failures filters to only failed runs', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-01T08.00.00Z', {
      exit_code: 0,
      success: true,
    })
    await writeMeta(configDir, 'daily-audit', '2026-04-02T08.00.00Z', {
      exit_code: 1,
      success: false,
    })
    await writeMeta(configDir, 'daily-audit', '2026-04-03T08.00.00Z', {
      exit_code: 0,
      success: true,
    })

    const result = await queryHistory('daily-audit', {
      configDir,
      failures: true,
    })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toHaveLength(1)
    expect(result[0].timestamp).toBe('2026-04-02T08.00.00Z')
    expect(result[0].success).toBe(false)
  })

  test('--last N limits to N most recent entries', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-01T08.00.00Z')
    await writeMeta(configDir, 'daily-audit', '2026-04-02T08.00.00Z')
    await writeMeta(configDir, 'daily-audit', '2026-04-03T08.00.00Z')

    const result = await queryHistory('daily-audit', { configDir, last: 2 })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toHaveLength(2)
    expect(result[0].timestamp).toBe('2026-04-03T08.00.00Z')
    expect(result[1].timestamp).toBe('2026-04-02T08.00.00Z')
  })

  test('--failures + --last combines correctly', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-01T08.00.00Z', {
      exit_code: 1,
      success: false,
    })
    await writeMeta(configDir, 'daily-audit', '2026-04-02T08.00.00Z', {
      exit_code: 1,
      success: false,
    })
    await writeMeta(configDir, 'daily-audit', '2026-04-03T08.00.00Z', {
      exit_code: 1,
      success: false,
    })

    const result = await queryHistory('daily-audit', {
      configDir,
      failures: true,
      last: 2,
    })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toHaveLength(2)
    expect(result[0].timestamp).toBe('2026-04-03T08.00.00Z')
  })

  test('includes stderrPath when stderr file exists', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-01T08.00.00Z', {
      exit_code: 1,
      success: false,
    })
    await writeStderr(
      configDir,
      'daily-audit',
      '2026-04-01T08.00.00Z',
      'something failed',
    )

    const result = await queryHistory('daily-audit', { configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result[0].stderrPath).toBe(
      path.join(
        configDir,
        'history',
        'daily-audit',
        '2026-04-01T08.00.00Z.stderr.txt',
      ),
    )
  })

  test('omits stderrPath when stderr file does not exist', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-01T08.00.00Z')

    const result = await queryHistory('daily-audit', { configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result[0].stderrPath).toBeUndefined()
  })

  test('skips malformed meta.json files', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-01T08.00.00Z')

    // Write a malformed meta.json
    const histDir = path.join(configDir, 'history', 'daily-audit')
    await fs.writeFile(
      path.join(histDir, '2026-04-02T08.00.00Z.meta.json'),
      'not json',
    )

    const result = await queryHistory('daily-audit', { configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toHaveLength(1)
    expect(result[0].timestamp).toBe('2026-04-01T08.00.00Z')
  })

  test('parses all meta.json fields correctly', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-04T08.30.00Z', {
      started_at: '2026-04-04T08:30:00.000Z',
      finished_at: '2026-04-04T08:30:15.456Z',
      duration_ms: 15456,
      exit_code: 0,
      success: true,
    })

    const result = await queryHistory('daily-audit', { configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result[0]).toEqual({
      timestamp: '2026-04-04T08.30.00Z',
      started_at: '2026-04-04T08:30:00.000Z',
      finished_at: '2026-04-04T08:30:15.456Z',
      duration_ms: 15456,
      exit_code: 0,
      success: true,
      stderrPath: undefined,
    })
  })
})
