import { describe, expect, mock, test } from 'bun:test'

import type { LogEntry } from '#src/logger'

import { doctor } from './doctor'
import type { DoctorDeps } from './doctor'

const now = new Date('2026-04-07T12:00:00.000Z')
const sevenDaysAgo = new Date('2026-03-31T12:00:00.000Z')

function healthyDeps(): DoctorDeps {
  return {
    readHeartbeat: async () => new Date('2026-04-07T11:59:00.000Z'),
    listTasks: async () => [
      {
        name: 'backup',
        schedule: '0 * * * *',
        enabled: 'when-online',
        timeout: 1_800_000,
      },
    ],
    validateTasks: async () => [{ name: 'backup', valid: true as const }],
    queryHistory: async () => [
      {
        timestamp: '2026-04-07T11.00.00Z',
        started_at: new Date('2026-04-07T11:00:00.000Z'),
        finished_at: new Date('2026-04-07T11:00:05.000Z'),
        duration_ms: 5000,
        exit_code: 0,
        success: true,
        timed_out: false,
        output_path: undefined,
      },
    ],
    readLog: () => [],
    isSchedulerInstalled: async () => true,
  }
}

describe('doctor', () => {
  test('returns ok when no findings', async () => {
    const result = await doctor({ now, deps: healthyDeps() })
    expect(result).toEqual({ ok: true, message: 'All systems operational' })
  })

  test('reports heartbeat missing', async () => {
    const deps = healthyDeps()
    deps.readHeartbeat = async () => null
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Scheduler never ticked')
    }
  })

  test('reports heartbeat stale', async () => {
    const deps = healthyDeps()
    deps.readHeartbeat = async () => new Date('2026-04-07T11:00:00.000Z')
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Scheduler not ticking')
    }
  })

  test('reports scheduler not installed', async () => {
    const deps = healthyDeps()
    deps.isSchedulerInstalled = async () => false
    const result = await doctor({ now, platform: 'darwin', deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Scheduler not installed')
    }
  })

  test('reports task failures', async () => {
    const deps = healthyDeps()
    deps.queryHistory = async () => [
      {
        timestamp: '2026-04-07T11.00.00Z',
        started_at: new Date('2026-04-07T11:00:00.000Z'),
        finished_at: new Date('2026-04-07T11:00:05.000Z'),
        duration_ms: 5000,
        exit_code: 1,
        success: false,
        timed_out: false,
        output_path: '/tmp/output.txt',
      },
    ]
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Task failing: backup')
    }
  })

  test('reports task validation errors', async () => {
    const deps = healthyDeps()
    deps.validateTasks = async () => [
      {
        name: 'broken',
        valid: false as const,
        errors: ['schedule: invalid cron expression'],
      },
    ]
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Invalid task: broken')
    }
  })

  test('reports task never ran', async () => {
    const deps = healthyDeps()
    deps.queryHistory = async () => []
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Task never ran: backup')
    }
  })

  test('reports contention', async () => {
    const deps = healthyDeps()
    deps.readLog = () => [
      {
        ts: '2026-04-07T11:00:00.000Z',
        event: 'skipped' as const,
        task: 'backup',
        reason: 'contention' as const,
      },
    ]
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Task contention: backup')
    }
  })

  test('reports log errors', async () => {
    const deps = healthyDeps()
    deps.readLog = () => [
      {
        ts: '2026-04-07T11:00:00.000Z',
        event: 'error' as const,
        task: 'backup',
        error: { name: 'RunError', message: 'process exited with code 1' },
      },
    ]
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Log error: backup')
    }
  })

  test('defaults since to 7 days before now', async () => {
    const readLog = mock((_since: Date) => [] as LogEntry[])
    const deps = healthyDeps()
    deps.readLog = readLog
    await doctor({ now, deps })
    expect(readLog).toHaveBeenCalledTimes(1)
    const calledWith = readLog.mock.calls[0]![0]
    expect(calledWith.getTime()).toBe(sevenDaysAgo.getTime())
  })

  test('uses custom since when provided', async () => {
    const customSince = new Date('2026-04-01T00:00:00.000Z')
    const readLog = mock((_since: Date) => [] as LogEntry[])
    const deps = healthyDeps()
    deps.readLog = readLog
    await doctor({ now, since: customSince, deps })
    expect(readLog).toHaveBeenCalledTimes(1)
    const calledWith = readLog.mock.calls[0]![0]
    expect(calledWith.getTime()).toBe(customSince.getTime())
  })

  test('reports internal error when listTasks fails', async () => {
    const deps = healthyDeps()
    deps.listTasks = async () => new Error('tasks dir missing')
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Internal error: listTasks')
      expect(result.report).toContain('tasks dir missing')
    }
  })

  test('reports internal error when validateTasks fails', async () => {
    const deps = healthyDeps()
    deps.validateTasks = async () => new Error('validate failed')
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Internal error: validateTasks')
      expect(result.report).toContain('validate failed')
    }
  })

  test('reports internal error when queryHistory fails for a task', async () => {
    const deps = healthyDeps()
    deps.queryHistory = async () => new Error('history read failed')
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Internal error: queryHistory')
      expect(result.report).toContain('history read failed')
    }
  })

  test('filters contention log entries per task', async () => {
    const deps = healthyDeps()
    deps.listTasks = async () => [
      {
        name: 'backup',
        schedule: '0 * * * *',
        enabled: 'when-online',
        timeout: 3_600_000,
      },
      {
        name: 'sync',
        schedule: '*/5 * * * *',
        enabled: 'when-online',
        timeout: 300_000,
      },
    ]
    deps.readLog = () => [
      {
        ts: '2026-04-07T11:00:00.000Z',
        event: 'skipped' as const,
        task: 'sync',
        reason: 'contention' as const,
      },
    ]
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Task contention: sync')
      expect(result.report).not.toContain('Task contention: backup')
    }
  })

  test('skips disabled tasks for never-ran check', async () => {
    const deps = healthyDeps()
    deps.listTasks = async () => [
      {
        name: 'backup',
        schedule: '0 * * * *',
        enabled: false,
        timeout: 1_800_000,
      },
    ]
    deps.queryHistory = async () => []
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(true)
  })

  test('reports task timeouts separately from regular failures', async () => {
    const deps = healthyDeps()
    deps.queryHistory = async () => [
      {
        timestamp: '2026-04-07T11.00.00Z',
        started_at: new Date('2026-04-07T11:00:00.000Z'),
        finished_at: new Date('2026-04-07T11:00:30.000Z'),
        duration_ms: 30_000,
        exit_code: 124,
        success: false,
        timed_out: true,
        output_path: undefined,
      },
    ]
    deps.listTasks = async () => [
      {
        name: 'backup',
        schedule: '0 * * * *',
        enabled: 'when-online',
        timeout: 30_000,
      },
    ]
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Task timing out: backup')
      expect(result.report).not.toContain('Task failing: backup')
    }
  })

  test('reports timeout contention when timeout >= schedule interval', async () => {
    const deps = healthyDeps()
    deps.listTasks = async () => [
      {
        name: 'backup',
        schedule: '*/5 * * * *',
        enabled: 'when-online',
        timeout: 600_000,
      },
    ]
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.report).toContain('Timeout exceeds schedule: backup')
    }
  })

  test('does not report timeout contention when timeout < schedule interval', async () => {
    const deps = healthyDeps()
    deps.listTasks = async () => [
      {
        name: 'backup',
        schedule: '0 * * * *',
        enabled: 'when-online',
        timeout: 30_000,
      },
    ]
    const result = await doctor({ now, deps })
    expect(result.ok).toBe(true)
  })

  test('reports offline skip diagnostic', async () => {
    const offlineEntries: LogEntry[] = [
      {
        ts: '2026-04-06T10:00:00.000Z',
        event: 'skipped',
        task: 'backup',
        reason: 'offline',
      },
      {
        ts: '2026-04-06T11:00:00.000Z',
        event: 'skipped',
        task: 'backup',
        reason: 'offline',
      },
    ]
    const deps = healthyDeps()
    deps.readLog = () => offlineEntries

    const result = await doctor({ now, deps })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.report).toContain('offline')
    expect(result.report).toContain('backup')
    expect(result.report).toContain('2')
    expect(result.report).toContain("enabled: 'always'")
  })
})
