import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { RunningMarker } from '#lib/lock'
import { runIdSchema } from '#src/history'

import { getTaskStatuses } from './status'

const rid = (s: string) => runIdSchema.parse(s)

async function makeConfigDir(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-status-'))
  await fs.mkdir(path.join(tmp, 'tasks'), { recursive: true })
  return tmp
}

async function writeMarker(
  configDir: string,
  taskName: string,
  marker: RunningMarker,
): Promise<void> {
  const locksDir = path.join(configDir, 'locks')
  await fs.mkdir(locksDir, { recursive: true })
  await fs.writeFile(
    path.join(locksDir, `${taskName}.lock`),
    JSON.stringify(marker),
  )
}

async function writeTask(
  configDir: string,
  name: string,
  content: string,
): Promise<void> {
  await fs.writeFile(path.join(configDir, 'tasks', `${name}.md`), content)
}

async function writeMeta(
  configDir: string,
  taskName: string,
  timestamp: string,
  overrides: Partial<{
    started_at: string
    finished_at: string
    duration_ms: number
    exit_code: number
    success: boolean
    timed_out: boolean
  }> = {},
): Promise<void> {
  const histDir = path.join(configDir, 'history', taskName)
  await fs.mkdir(histDir, { recursive: true })

  const started_at =
    overrides.started_at ?? timestamp.replace(/\./g, ':').replace(/Z$/, '.000Z')
  const duration_ms = overrides.duration_ms ?? 0
  const finished_at =
    overrides.finished_at ??
    new Date(new Date(started_at).getTime() + duration_ms).toISOString()

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
  }

  await fs.writeFile(
    path.join(histDir, `${timestamp}.meta.json`),
    JSON.stringify(meta),
  )
}

async function writeStatusMeta(
  configDir: string,
  taskName: string,
  timestamp: string,
  meta: Record<string, unknown>,
): Promise<void> {
  const histDir = path.join(configDir, 'history', taskName)
  await fs.mkdir(histDir, { recursive: true })
  const started_at = timestamp.replace(/\./g, ':').replace(/Z$/, '.000Z')
  const duration_ms = 5
  const finished_at = new Date(
    new Date(started_at).getTime() + duration_ms,
  ).toISOString()
  await fs.writeFile(
    path.join(histDir, `${timestamp}.meta.json`),
    JSON.stringify({
      timestamp,
      started_at,
      finished_at,
      duration_ms,
      ...meta,
    }),
  )
}

const ENABLED_TASK = `---
on:
  schedule: '0 8 * * 1-5'
agent: opencode
---

Do something useful.
`

const DISABLED_TASK = `---
on:
  schedule: '30 6 * * *'
agent: opencode
enabled: false
---

Disabled task.
`

const TIMEZONE_TASK = `---
on:
  schedule: '0 9 * * 1'
agent: opencode
timezone: 'America/New_York'
---

Weekly task.
`

const RUN_TASK = `---
on:
  schedule: '0 12 * * *'
run: 'my-cmd $TM_PROMPT_FILE'
---

Run-based task.
`

// Fixed "now" for deterministic next_run calculations.
// 2026-04-05 is a Sunday.
const NOW = new Date('2026-04-05T12:00:00.000Z')

describe('getTaskStatuses', () => {
  test('returns empty array when no tasks exist', async () => {
    const configDir = await makeConfigDir()
    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).toEqual([])
  })

  test('returns status for enabled task with no history', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', ENABLED_TASK)

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toHaveLength(1)
    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first).toEqual({
      name: 'my-task',
      on: { schedule: '0 8 * * 1-5' },
      enabled: true,
      requires: ['network'],
      timeout: '1h',
      agent: 'opencode',
      // Next weekday after Sunday 2026-04-05 is Monday 2026-04-06 at 08:00 UTC
      next_run: '2026-04-06T08:00:00.000Z',
    })
  })

  test('omits last_run when task has no history', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', ENABLED_TASK)

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first).not.toHaveProperty('last_run')
  })

  test('omits timezone when not set on task', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', ENABLED_TASK)

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first).not.toHaveProperty('timezone')
  })

  test('includes last_run with ok status for successful history', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', ENABLED_TASK)
    await writeMeta(configDir, 'my-task', '2026-04-04T08.00.00Z', {
      duration_ms: 1500,
      exit_code: 0,
      success: true,
    })

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.last_run).toEqual({
      timestamp: rid('2026-04-04T08.00.00Z'),
      status: 'ok',
      exit_code: 0,
      duration_ms: 1500,
    })
  })

  test('includes last_run with err status for failed history', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', ENABLED_TASK)
    await writeMeta(configDir, 'my-task', '2026-04-04T08.00.00Z', {
      duration_ms: 500,
      exit_code: 1,
      success: false,
    })

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.last_run).toEqual({
      timestamp: rid('2026-04-04T08.00.00Z'),
      status: 'err',
      exit_code: 1,
      duration_ms: 500,
    })
  })

  test('uses most recent history entry for last_run', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', ENABLED_TASK)
    await writeMeta(configDir, 'my-task', '2026-04-01T08.00.00Z', {
      exit_code: 1,
      success: false,
    })
    await writeMeta(configDir, 'my-task', '2026-04-04T08.00.00Z', {
      exit_code: 0,
      success: true,
    })

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.last_run?.status).toBe('ok')
    expect(first.last_run?.timestamp).toBe(rid('2026-04-04T08.00.00Z'))
  })

  test('always-run task (requires: []) computes next_run', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'local-task',
      `---
on:
  schedule: '0 8 * * 1-5'
agent: opencode
requires: []
---

Local model task.
`,
    )

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.enabled).toBe(true)
    expect(first.requires).toEqual([])
    expect(first.next_run).toBe('2026-04-06T08:00:00.000Z')
  })

  test('disabled task omits next_run', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'off-task', DISABLED_TASK)

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.enabled).toBe(false)
    expect(first).not.toHaveProperty('next_run')
  })

  test('respects timezone for next_run computation', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'weekly', TIMEZONE_TASK)

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.timezone).toBe('America/New_York')
    // Monday 9am EDT (UTC-4 in April) = 13:00 UTC
    expect(first.next_run).toBe('2026-04-06T13:00:00.000Z')
  })

  test('returns multiple tasks sorted by name', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'zz-last', ENABLED_TASK)
    await writeTask(configDir, 'aa-first', ENABLED_TASK)

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.map((t) => t.name)).toEqual(['aa-first', 'zz-last'])
  })

  test('returns status for run-based task', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'run-task', RUN_TASK)

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toHaveLength(1)
    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.name).toBe('run-task')
    expect(first.on).toEqual({ schedule: '0 12 * * *' })
    expect(first.enabled).toBe(true)
    expect(first.run).toBe('my-cmd $TM_PROMPT_FILE')
    expect(first.next_run).toBe('2026-04-06T12:00:00.000Z')
  })

  test('includes timeout when task has one set', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'timed-task',
      `---
on:
  schedule: '0 8 * * *'
agent: opencode
timeout: '5m'
---

Task with timeout.
`,
    )

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.timeout).toBe('5m')
  })

  test('includes last_run with timeout status for timed-out history', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', ENABLED_TASK)
    await writeMeta(configDir, 'my-task', '2026-04-04T08.00.00Z', {
      duration_ms: 30000,
      exit_code: 124,
      success: false,
      timed_out: true,
    })

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.last_run).toEqual({
      timestamp: rid('2026-04-04T08.00.00Z'),
      status: 'timeout',
      exit_code: 124,
      duration_ms: 30000,
    })
  })

  test('includes running state when marker present and PID alive', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', ENABLED_TASK)
    await writeMarker(configDir, 'my-task', {
      pid: process.pid,
      started_at: '2026-04-05T11:50:00.000Z',
      timestamp: rid('2026-04-05T11.50.00Z'),
    })

    const result = await getTaskStatuses({
      configDir,
      now: NOW,
      markerDeps: { isProcessAlive: () => true },
    })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.running).toEqual({
      started_at: '2026-04-05T11:50:00.000Z',
      timestamp: rid('2026-04-05T11.50.00Z'),
      pid: process.pid,
      duration_ms: 600_000, // 10 minutes: 12:00 - 11:50
    })
  })

  test('omits running state when no marker exists', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', ENABLED_TASK)

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first).not.toHaveProperty('running')
  })

  test('omits running state when PID is dead', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', ENABLED_TASK)
    await writeMarker(configDir, 'my-task', {
      pid: 999999,
      started_at: '2026-04-05T11:50:00.000Z',
      timestamp: rid('2026-04-05T11.50.00Z'),
    })

    const result = await getTaskStatuses({
      configDir,
      now: NOW,
      markerDeps: { isProcessAlive: () => false },
    })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first).not.toHaveProperty('running')
  })

  test('defaults timeout to 1h for daily schedule', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'no-timeout', ENABLED_TASK)

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.timeout).toBe('1h')
  })

  test('event task omits next_run', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'on-deploy',
      `---
on:
  event: deploy
agent: opencode
---

Post-deploy checks.
`,
    )

    const result = await getTaskStatuses({ configDir, now: NOW })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result).toHaveLength(1)
    const first = result[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.on).toEqual({ event: 'deploy' })
    expect(first).not.toHaveProperty('next_run')
    expect(first.timeout).toBe('1h')
  })

  test('last_run shows skipped-preflight verbatim when latest is a skip', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'pf-task', ENABLED_TASK)
    await writeStatusMeta(configDir, 'pf-task', '2026-04-04T08.00.00Z', {
      status: 'skipped-preflight',
      preflight: {
        exit_code: 1,
        duration_ms: 3,
        stdout_bytes: 0,
        stderr_bytes: 0,
      },
    })

    const result = await getTaskStatuses({ configDir, now: NOW })
    if (result instanceof Error) throw result
    const first = result[0]
    if (!first) throw new Error('expected status entry')
    expect(first.last_run?.status).toBe('skipped-preflight')
    expect(first.last_run?.timestamp).toBe(rid('2026-04-04T08.00.00Z'))
  })

  test('last_run shows preflight-error verbatim when latest is an error', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'pf-err', ENABLED_TASK)
    await writeStatusMeta(configDir, 'pf-err', '2026-04-04T08.00.00Z', {
      status: 'preflight-error',
      preflight: {
        exit_code: 2,
        duration_ms: 3,
        stdout_bytes: 0,
        stderr_bytes: 0,
        error_reason: 'nonzero',
      },
    })

    const result = await getTaskStatuses({ configDir, now: NOW })
    if (result instanceof Error) throw result
    const first = result[0]
    if (!first) throw new Error('expected status entry')
    expect(first.last_run?.status).toBe('preflight-error')
  })

  test('last_run shows payload-error verbatim when latest is a payload error', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'pay-err', ENABLED_TASK)
    await writeStatusMeta(configDir, 'pay-err', '2026-04-04T08.00.00Z', {
      status: 'payload-error',
      trigger: 'dispatch',
      event: 'deploy',
      payload: { bytes: 2_000_000, error_reason: 'oversize' },
    })

    const result = await getTaskStatuses({ configDir, now: NOW })
    if (result instanceof Error) throw result
    const first = result[0]
    if (!first) throw new Error('expected status entry')
    expect(first.last_run?.status).toBe('payload-error')
  })

  test('last_run picks the most recent regardless of variant', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'mix', ENABLED_TASK)
    await writeMeta(configDir, 'mix', '2026-04-01T08.00.00Z', {
      exit_code: 0,
      success: true,
    })
    await writeStatusMeta(configDir, 'mix', '2026-04-04T08.00.00Z', {
      status: 'skipped-preflight',
      preflight: {
        exit_code: 1,
        duration_ms: 3,
        stdout_bytes: 0,
        stderr_bytes: 0,
      },
    })

    const result = await getTaskStatuses({ configDir, now: NOW })
    if (result instanceof Error) throw result
    const first = result[0]
    if (!first) throw new Error('expected status entry')
    expect(first.last_run?.status).toBe('skipped-preflight')
    expect(first.last_run?.timestamp).toBe(rid('2026-04-04T08.00.00Z'))
  })
})
