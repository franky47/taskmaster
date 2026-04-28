import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  TaskNotFoundError,
  buildDisplayEntries,
  queryGlobalHistory,
  queryHistory,
} from './query'
import { isAgentRanMeta } from './schema'
import { runIdSchema } from './timestamp'

const rid = (s: string) => runIdSchema.parse(s)

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
  timed_out: boolean
  trigger: 'manual' | 'tick' | 'dispatch'
  event: string
}>

async function writeMeta(
  configDir: string,
  taskName: string,
  timestamp: string,
  overrides: MetaOverrides = {},
): Promise<void> {
  const histDir = path.join(configDir, 'history', taskName)
  await fs.mkdir(histDir, { recursive: true })

  const started_at =
    overrides.started_at ??
    `${timestamp.replace(/\./g, ':')}`.replace(/Z$/, '.000Z')
  const finished_at =
    overrides.finished_at ??
    `${timestamp.replace(/\./g, ':')}`.replace(/Z$/, '.000Z')
  const duration_ms =
    overrides.duration_ms ??
    new Date(finished_at).getTime() - new Date(started_at).getTime()

  const meta = {
    timestamp,
    started_at,
    finished_at,
    duration_ms,
    exit_code: overrides.exit_code ?? 0,
    success: overrides.success ?? true,
    ...(overrides.timed_out !== undefined && {
      timed_out: overrides.timed_out,
    }),
    ...(overrides.trigger !== undefined && { trigger: overrides.trigger }),
    ...(overrides.event !== undefined && { event: overrides.event }),
  }

  await fs.writeFile(
    path.join(histDir, `${timestamp}.meta.json`),
    JSON.stringify(meta, null, 2) + '\n',
  )
}

async function writeOutput(
  configDir: string,
  taskName: string,
  timestamp: string,
  content: string,
): Promise<void> {
  const histDir = path.join(configDir, 'history', taskName)
  await fs.writeFile(path.join(histDir, `${timestamp}.output.txt`), content)
}

async function writeRawMeta(
  configDir: string,
  taskName: string,
  timestamp: string,
  meta: Record<string, unknown>,
): Promise<void> {
  const histDir = path.join(configDir, 'history', taskName)
  await fs.mkdir(histDir, { recursive: true })
  const started_at = timestamp.replace(/\./g, ':').replace(/Z$/, '.000Z')
  const finished_at = new Date(new Date(started_at).getTime() + 5).toISOString()
  await fs.writeFile(
    path.join(histDir, `${timestamp}.meta.json`),
    JSON.stringify(
      {
        timestamp,
        started_at,
        finished_at,
        duration_ms: 5,
        ...meta,
      },
      null,
      2,
    ) + '\n',
  )
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
      rid('2026-04-03T08.00.00Z'),
      rid('2026-04-02T08.00.00Z'),
      rid('2026-04-01T08.00.00Z'),
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
    const failureEntry = result[0]!
    expect(failureEntry.timestamp).toBe(rid('2026-04-02T08.00.00Z'))
    if (!isAgentRanMeta(failureEntry)) throw new Error('expected agent-ran')
    expect(failureEntry.success).toBe(false)
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
    expect(result[0]!.timestamp).toBe(rid('2026-04-03T08.00.00Z'))
    expect(result[1]!.timestamp).toBe(rid('2026-04-02T08.00.00Z'))
  })

  test('--failures includes preflight-error rows', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'pf-task')
    await writeMeta(configDir, 'pf-task', '2026-04-01T08.00.00Z', {
      exit_code: 0,
      success: true,
    })
    await writeRawMeta(configDir, 'pf-task', '2026-04-02T08.00.00Z', {
      status: 'preflight-error',
      preflight: {
        exit_code: 2,
        duration_ms: 3,
        stdout_bytes: 0,
        stderr_bytes: 0,
        error_reason: 'nonzero',
      },
    })

    const result = await queryHistory('pf-task', { configDir, failures: true })
    if (result instanceof Error) throw result
    expect(result).toHaveLength(1)
    expect(result[0]!.timestamp).toBe(rid('2026-04-02T08.00.00Z'))
  })

  test('--failures excludes skipped-preflight rows', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'pf-skip')
    await writeRawMeta(configDir, 'pf-skip', '2026-04-01T08.00.00Z', {
      status: 'skipped-preflight',
      preflight: {
        exit_code: 1,
        duration_ms: 3,
        stdout_bytes: 0,
        stderr_bytes: 0,
      },
    })
    await writeMeta(configDir, 'pf-skip', '2026-04-02T08.00.00Z', {
      exit_code: 1,
      success: false,
    })

    const result = await queryHistory('pf-skip', { configDir, failures: true })
    if (result instanceof Error) throw result
    expect(result).toHaveLength(1)
    expect(result[0]!.timestamp).toBe(rid('2026-04-02T08.00.00Z'))
  })

  test('--failures includes payload-error rows', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'pay-task')
    await writeRawMeta(configDir, 'pay-task', '2026-04-01T08.00.00Z', {
      status: 'payload-error',
      trigger: 'dispatch',
      event: 'deploy',
      payload: { bytes: 2_000_000, error_reason: 'oversize' },
    })

    const result = await queryHistory('pay-task', { configDir, failures: true })
    if (result instanceof Error) throw result
    expect(result).toHaveLength(1)
  })

  test('history default (no --failures) includes skipped-preflight inline', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'pf-skip-inline')
    await writeRawMeta(configDir, 'pf-skip-inline', '2026-04-01T08.00.00Z', {
      status: 'skipped-preflight',
      preflight: {
        exit_code: 1,
        duration_ms: 3,
        stdout_bytes: 0,
        stderr_bytes: 0,
      },
    })
    await writeMeta(configDir, 'pf-skip-inline', '2026-04-02T08.00.00Z', {
      exit_code: 0,
      success: true,
    })

    const result = await queryHistory('pf-skip-inline', { configDir })
    if (result instanceof Error) throw result
    expect(result).toHaveLength(2)
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
    expect(result[0]!.timestamp).toBe(rid('2026-04-03T08.00.00Z'))
  })

  test('includes output_path when output file exists', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-01T08.00.00Z', {
      exit_code: 1,
      success: false,
    })
    await writeOutput(
      configDir,
      'daily-audit',
      '2026-04-01T08.00.00Z',
      'something failed',
    )

    const result = await queryHistory('daily-audit', { configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result[0]!.output_path).toBe(
      path.join(
        configDir,
        'history',
        'daily-audit',
        '2026-04-01T08.00.00Z.output.txt',
      ),
    )
  })

  test('omits output_path when no output file exists', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-01T08.00.00Z')

    const result = await queryHistory('daily-audit', { configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result[0]!.output_path).toBeUndefined()
  })

  test('skips malformed meta.json files and warns on stderr', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-01T08.00.00Z')

    const histDir = path.join(configDir, 'history', 'daily-audit')
    await fs.writeFile(
      path.join(histDir, '2026-04-02T08.00.00Z.meta.json'),
      'not json',
    )

    const stderrChunks: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk))
      return true
    }
    try {
      const result = await queryHistory('daily-audit', { configDir })
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return

      expect(result).toHaveLength(1)
      expect(result[0]!.timestamp).toBe(rid('2026-04-01T08.00.00Z'))
      expect(stderrChunks.join('')).toContain(
        'skipped 1 malformed history file',
      )
    } finally {
      process.stderr.write = origWrite
    }
  })

  test('decodes started_at and finished_at as Date objects', async () => {
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

    const entry = result[0]!
    if (!isAgentRanMeta(entry)) throw new Error('expected agent-ran')
    expect(entry.started_at).toBeInstanceOf(Date)
    expect(entry.finished_at).toBeInstanceOf(Date)
    expect(entry.started_at.toISOString()).toBe('2026-04-04T08:30:00.000Z')
    expect(entry.finished_at.toISOString()).toBe('2026-04-04T08:30:15.456Z')
    expect(entry.duration_ms).toBe(15456)
    expect(entry.exit_code).toBe(0)
    expect(entry.success).toBe(true)
    expect(entry.timed_out).toBe(false)
    expect(entry.output_path).toBeUndefined()
  })
})

describe('buildDisplayEntries', () => {
  test('prepends running entry when marker is present', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-01T08.00.00Z')

    const entries = await queryHistory('daily-audit', { configDir })
    if (entries instanceof Error) throw entries

    const display = buildDisplayEntries(entries, {
      marker: {
        pid: 42,
        started_at: '2026-04-05T11:50:00.000Z',
        timestamp: rid('2026-04-05T11.50.00Z'),
      },
      taskName: 'daily-audit',
      configDir,
    })

    expect(display).toHaveLength(2)
    const first = display[0]!
    expect(first.status).toBe('running')
    if (first.status !== 'running') return
    expect(first.pid).toBe(42)
    expect(first.started_at).toEqual(new Date('2026-04-05T11:50:00.000Z'))
    expect(first.timestamp).toBe('2026-04-05T11.50.00Z')
    expect(first.output_path).toBe(
      path.join(
        configDir,
        'history',
        'daily-audit',
        '2026-04-05T11.50.00Z.output.txt',
      ),
    )

    const second = display[1]!
    expect(second.status).toBe('ok')
  })

  test('returns only completed entries when no marker', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-01T08.00.00Z')
    await writeMeta(configDir, 'daily-audit', '2026-04-02T08.00.00Z', {
      exit_code: 1,
      success: false,
    })

    const entries = await queryHistory('daily-audit', { configDir })
    if (entries instanceof Error) throw entries

    const display = buildDisplayEntries(entries, {
      marker: null,
      taskName: 'daily-audit',
      configDir,
    })

    expect(display).toHaveLength(2)
    expect(display[0]!.status).toBe('err')
    expect(display[1]!.status).toBe('ok')
    expect(display.every((e) => e.status !== 'running')).toBe(true)
  })

  test('maps completed entry status correctly', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-03T08.00.00Z', {
      exit_code: 0,
      success: true,
    })
    await writeMeta(configDir, 'daily-audit', '2026-04-02T08.00.00Z', {
      exit_code: 1,
      success: false,
    })

    const entries = await queryHistory('daily-audit', { configDir })
    if (entries instanceof Error) throw entries

    const display = buildDisplayEntries(entries, {
      marker: null,
      taskName: 'daily-audit',
      configDir,
    })

    expect(display[0]!.status).toBe('ok')
    expect(display[1]!.status).toBe('err')
  })

  test('maps timed_out entry to timeout status', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily-audit')
    await writeMeta(configDir, 'daily-audit', '2026-04-01T08.00.00Z', {
      exit_code: 124,
      success: false,
      timed_out: true,
    })

    const entries = await queryHistory('daily-audit', { configDir })
    if (entries instanceof Error) throw entries

    const display = buildDisplayEntries(entries, {
      marker: null,
      taskName: 'daily-audit',
      configDir,
    })

    expect(display[0]!.status).toBe('timeout')
  })
})

describe('queryGlobalHistory', () => {
  test('returns entries across all tasks sorted newest-first', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'task-a')
    await writeTask(configDir, 'task-b')
    await writeMeta(configDir, 'task-a', '2026-04-01T08.00.00Z')
    await writeMeta(configDir, 'task-b', '2026-04-03T08.00.00Z')
    await writeMeta(configDir, 'task-a', '2026-04-02T08.00.00Z')

    const result = await queryGlobalHistory({ configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.map((e) => e.task_name)).toEqual([
      'task-b',
      'task-a',
      'task-a',
    ])
    expect(result.map((e) => e.timestamp)).toEqual([
      rid('2026-04-03T08.00.00Z'),
      rid('2026-04-02T08.00.00Z'),
      rid('2026-04-01T08.00.00Z'),
    ])
  })

  test('defaults to 20 entries', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'task-a')
    for (let i = 1; i <= 25; i++) {
      const day = String(i).padStart(2, '0')
      await writeMeta(configDir, 'task-a', `2026-01-${day}T08.00.00Z`)
    }

    const result = await queryGlobalHistory({ configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toHaveLength(20)
    expect(result[0]!.timestamp).toBe(rid('2026-01-25T08.00.00Z'))
  })

  test('--last overrides default limit', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'task-a')
    await writeMeta(configDir, 'task-a', '2026-04-01T08.00.00Z')
    await writeMeta(configDir, 'task-a', '2026-04-02T08.00.00Z')
    await writeMeta(configDir, 'task-a', '2026-04-03T08.00.00Z')

    const result = await queryGlobalHistory({ configDir, last: 1 })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toHaveLength(1)
    expect(result[0]!.timestamp).toBe(rid('2026-04-03T08.00.00Z'))
  })

  test('--failures filter works in global mode', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'task-a')
    await writeTask(configDir, 'task-b')
    await writeMeta(configDir, 'task-a', '2026-04-01T08.00.00Z', {
      exit_code: 0,
      success: true,
    })
    await writeMeta(configDir, 'task-b', '2026-04-02T08.00.00Z', {
      exit_code: 1,
      success: false,
    })
    await writeMeta(configDir, 'task-a', '2026-04-03T08.00.00Z', {
      exit_code: 1,
      success: false,
    })

    const result = await queryGlobalHistory({ configDir, failures: true })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toHaveLength(2)
    expect(result[0]!.task_name).toBe('task-a')
    expect(result[1]!.task_name).toBe('task-b')
  })

  test('returns empty array when no history exists', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'task-a')

    const result = await queryGlobalHistory({ configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toEqual([])
  })

  test('returns empty array when history dir does not exist', async () => {
    const configDir = await makeConfigDir()

    const result = await queryGlobalHistory({ configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toEqual([])
  })

  test('skips malformed meta files in global mode', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'task-a')
    await writeMeta(configDir, 'task-a', '2026-04-01T08.00.00Z')

    const histDir = path.join(configDir, 'history', 'task-a')
    await fs.writeFile(
      path.join(histDir, '2026-04-02T08.00.00Z.meta.json'),
      'not json',
    )

    const result = await queryGlobalHistory({ configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toHaveLength(1)
    expect(result[0]!.timestamp).toBe(rid('2026-04-01T08.00.00Z'))
  })

  test('includes trigger and event fields for dispatch entries', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'on-deploy')
    await writeMeta(configDir, 'on-deploy', '2026-04-01T08.00.00Z', {
      trigger: 'dispatch',
      event: 'deploy',
    })

    const result = await queryHistory('on-deploy', { configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toHaveLength(1)
    expect(result[0]!.trigger).toBe('dispatch')
    expect(result[0]!.event).toBe('deploy')
  })

  test('includes trigger and event in global history entries', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'on-deploy')
    await writeMeta(configDir, 'on-deploy', '2026-04-01T08.00.00Z', {
      trigger: 'dispatch',
      event: 'deploy',
    })

    const result = await queryGlobalHistory({ configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toHaveLength(1)
    expect(result[0]!.trigger).toBe('dispatch')
    expect(result[0]!.event).toBe('deploy')
    expect(result[0]!.task_name).toBe('on-deploy')
  })

  test('includes output_path in global entries', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'task-a')
    await writeMeta(configDir, 'task-a', '2026-04-01T08.00.00Z')
    await writeOutput(configDir, 'task-a', '2026-04-01T08.00.00Z', 'output')

    const result = await queryGlobalHistory({ configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result[0]!.output_path).toBe(
      path.join(
        configDir,
        'history',
        'task-a',
        '2026-04-01T08.00.00Z.output.txt',
      ),
    )
  })
})
