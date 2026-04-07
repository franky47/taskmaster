import { describe, expect, test } from 'bun:test'

import type { HistoryEntry } from '../history'
import type { LogEntry } from '../logger'
import type { ValidationResult } from '../validate'
import {
  checkContention,
  checkHeartbeat,
  checkLogErrors,
  checkSchedulerInstalled,
  checkTaskFailures,
  checkTaskNeverRan,
  checkTaskTimeouts,
  checkTaskValidation,
  checkTimeoutContention,
  formatRelativeTime,
} from './checks'

describe('checkLogErrors', () => {
  test('returns info findings for error events', () => {
    const entries: LogEntry[] = [
      {
        ts: '2026-04-07T10:00:00.000Z',
        event: 'error',
        task: 'backup',
        error: { name: 'RunError', message: 'process exited with code 1' },
      },
      {
        ts: '2026-04-07T11:00:00.000Z',
        event: 'error',
        task: 'sync',
        error: { name: 'TimeoutError', message: 'timed out' },
      },
    ]

    const findings = checkLogErrors(entries)
    expect(findings).toHaveLength(2)

    expect(findings[0]).toMatchObject({
      kind: 'log-error',
      severity: 'info',
      task: 'backup',
      ts: '2026-04-07T10:00:00.000Z',
      error: { name: 'RunError', message: 'process exited with code 1' },
    })

    expect(findings[1]).toMatchObject({
      kind: 'log-error',
      severity: 'info',
      task: 'sync',
    })
  })

  test('ignores non-error events', () => {
    const entries: LogEntry[] = [
      {
        ts: '2026-04-07T10:00:00.000Z',
        event: 'started',
        task: 'backup',
        trigger: 'tick',
      },
      {
        ts: '2026-04-07T10:01:00.000Z',
        event: 'skipped',
        task: 'backup',
        reason: 'contention',
      },
    ]

    const findings = checkLogErrors(entries)
    expect(findings).toHaveLength(0)
  })

  test('returns empty array for empty input', () => {
    const findings = checkLogErrors([])
    expect(findings).toHaveLength(0)
  })
})

// ------------------------------------------------------------------
// formatRelativeTime
// ------------------------------------------------------------------

describe('formatRelativeTime', () => {
  const base = new Date('2026-04-07T12:00:00.000Z')

  test('returns "now" for < 1 minute', () => {
    const from = new Date(base.getTime() - 30_000) // 30s ago
    expect(formatRelativeTime(from, base)).toBe('now')
  })

  test('returns minutes for < 1 hour', () => {
    const from = new Date(base.getTime() - 25 * 60_000) // 25m ago
    expect(formatRelativeTime(from, base)).toBe('25m ago')
  })

  test('uses largest unit for hours range', () => {
    const from = new Date(base.getTime() - (3 * 3600_000 + 37 * 60_000)) // 3h 37m
    expect(formatRelativeTime(from, base)).toBe('3h ago')
  })

  test('returns exact hours', () => {
    const from = new Date(base.getTime() - 2 * 3600_000) // exactly 2h
    expect(formatRelativeTime(from, base)).toBe('2h ago')
  })

  test('uses largest unit for days range', () => {
    const from = new Date(base.getTime() - (2 * 86400_000 + 5 * 3600_000)) // 2d 5h
    expect(formatRelativeTime(from, base)).toBe('2d ago')
  })

  test('returns "1m ago" at exactly 1 minute', () => {
    const from = new Date(base.getTime() - 60_000)
    expect(formatRelativeTime(from, base)).toBe('1m ago')
  })

  test('returns "1h ago" at exactly 1 hour', () => {
    const from = new Date(base.getTime() - 3600_000)
    expect(formatRelativeTime(from, base)).toBe('1h ago')
  })

  test('returns "yesterday" at exactly 1 day', () => {
    const from = new Date(base.getTime() - 86400_000)
    expect(formatRelativeTime(from, base)).toBe('yesterday')
  })
})

// ------------------------------------------------------------------
// checkHeartbeat
// ------------------------------------------------------------------

describe('checkHeartbeat', () => {
  const now = new Date('2026-04-07T12:00:00.000Z')

  test('returns null when heartbeat is fresh (< 5 minutes old)', () => {
    const heartbeat = new Date(now.getTime() - 2 * 60_000) // 2m ago
    expect(checkHeartbeat(heartbeat, now)).toBeNull()
  })

  test('returns null at exactly 5 minutes (boundary, not stale yet)', () => {
    const heartbeat = new Date(now.getTime() - 5 * 60_000)
    expect(checkHeartbeat(heartbeat, now)).toBeNull()
  })

  test('returns critical finding when heartbeat > 5 minutes old', () => {
    const heartbeat = new Date(now.getTime() - 6 * 60_000) // 6m ago
    const finding = checkHeartbeat(heartbeat, now)

    expect(finding).toMatchObject({
      kind: 'heartbeat-stale',
      severity: 'critical',
      heartbeatTime: heartbeat.toISOString(),
      relativeTime: '6m ago', // Intl narrow format
    })
  })

  test('returns critical finding when heartbeat is very old', () => {
    const heartbeat = new Date(now.getTime() - (3 * 3600_000 + 37 * 60_000)) // 3h 37m ago
    const finding = checkHeartbeat(heartbeat, now)

    expect(finding).toMatchObject({
      kind: 'heartbeat-stale',
      severity: 'critical',
      heartbeatTime: heartbeat.toISOString(),
      relativeTime: '3h ago',
    })
  })

  test('returns critical finding when heartbeat is null (never ticked)', () => {
    const finding = checkHeartbeat(null, now)

    expect(finding).toMatchObject({
      kind: 'heartbeat-missing',
      severity: 'critical',
    })
  })
})

// ------------------------------------------------------------------
// checkSchedulerInstalled
// ------------------------------------------------------------------

describe('checkSchedulerInstalled', () => {
  test('returns null when scheduler is present', () => {
    expect(checkSchedulerInstalled('darwin', true)).toBeNull()
    expect(checkSchedulerInstalled('linux', true)).toBeNull()
  })

  test('returns critical finding when scheduler is not present on darwin', () => {
    const finding = checkSchedulerInstalled('darwin', false)

    expect(finding).toMatchObject({
      kind: 'scheduler-not-installed',
      severity: 'critical',
      platform: 'darwin',
    })
  })

  test('returns critical finding when scheduler is not present on linux', () => {
    const finding = checkSchedulerInstalled('linux', false)

    expect(finding).toMatchObject({
      kind: 'scheduler-not-installed',
      severity: 'critical',
      platform: 'linux',
    })
  })
})

// ------------------------------------------------------------------
// checkTaskFailures
// ------------------------------------------------------------------

describe('checkTaskFailures', () => {
  const now = new Date('2026-04-07T12:00:00.000Z')

  function makeEntry(
    overrides: Partial<HistoryEntry> & { success: boolean },
  ): HistoryEntry {
    return {
      timestamp: '2026-04-07T11-00-00',
      started_at: '2026-04-07T11:00:00.000Z',
      finished_at: '2026-04-07T11:00:05.000Z',
      duration_ms: 5000,
      exit_code: overrides.success ? 0 : 1,
      timed_out: false,
      stderrPath: '/history/backup/2026-04-07T11-00-00.stderr.txt',
      ...overrides,
    }
  }

  test('returns null for empty history', () => {
    expect(checkTaskFailures('backup', [], now)).toBeNull()
  })

  test('returns null when most recent run succeeded', () => {
    const history: HistoryEntry[] = [
      makeEntry({ success: true }),
      makeEntry({ success: false }),
      makeEntry({ success: false }),
    ]
    expect(checkTaskFailures('backup', history, now)).toBeNull()
  })

  test('returns warning when only the last run failed (1 failure)', () => {
    const history: HistoryEntry[] = [
      makeEntry({
        success: false,
        exit_code: 2,
        finished_at: '2026-04-07T11:30:00.000Z',
        stderrPath: '/history/backup/run1.stderr.txt',
      }),
      makeEntry({ success: true }),
    ]

    const finding = checkTaskFailures('backup', history, now)

    expect(finding).toMatchObject({
      kind: 'task-failures',
      severity: 'warning',
      task: 'backup',
      consecutiveFailures: 1,
      lastFailureTimestamp: '2026-04-07T11:30:00.000Z',
      exitCode: 2,
      stderrPath: '/history/backup/run1.stderr.txt',
    })
    expect(finding!.relativeTime).toBe('30m ago')
    expect(finding!.runDir).toBe('/history/backup')
  })

  test('returns warning when 2 consecutive failures', () => {
    const history: HistoryEntry[] = [
      makeEntry({
        success: false,
        finished_at: '2026-04-07T11:50:00.000Z',
      }),
      makeEntry({ success: false }),
      makeEntry({ success: true }),
    ]

    const finding = checkTaskFailures('backup', history, now)

    expect(finding).toMatchObject({
      kind: 'task-failures',
      severity: 'warning',
      consecutiveFailures: 2,
    })
  })

  test('returns critical when exactly 3 consecutive failures', () => {
    const history: HistoryEntry[] = [
      makeEntry({
        success: false,
        finished_at: '2026-04-07T11:55:00.000Z',
        exit_code: 127,
        stderrPath: '/history/sync/latest.stderr.txt',
      }),
      makeEntry({ success: false }),
      makeEntry({ success: false }),
      makeEntry({ success: true }),
    ]

    const finding = checkTaskFailures('sync', history, now)

    expect(finding).toMatchObject({
      kind: 'task-failures',
      severity: 'critical',
      task: 'sync',
      consecutiveFailures: 3,
      lastFailureTimestamp: '2026-04-07T11:55:00.000Z',
      exitCode: 127,
      stderrPath: '/history/sync/latest.stderr.txt',
      runDir: '/history/sync',
    })
    expect(finding!.relativeTime).toBe('5m ago')
  })

  test('returns critical when more than 3 consecutive failures', () => {
    const history: HistoryEntry[] = [
      makeEntry({
        success: false,
        finished_at: '2026-04-07T11:00:00.000Z',
      }),
      makeEntry({ success: false }),
      makeEntry({ success: false }),
      makeEntry({ success: false }),
      makeEntry({ success: false }),
    ]

    const finding = checkTaskFailures('backup', history, now)

    expect(finding).toMatchObject({
      kind: 'task-failures',
      severity: 'critical',
      consecutiveFailures: 5,
    })
  })

  test('returns warning when history has only 1 entry and it failed', () => {
    const history: HistoryEntry[] = [
      makeEntry({
        success: false,
        finished_at: '2026-04-07T10:00:00.000Z',
        exit_code: 1,
      }),
    ]

    const finding = checkTaskFailures('backup', history, now)

    expect(finding).toMatchObject({
      kind: 'task-failures',
      severity: 'warning',
      consecutiveFailures: 1,
    })
    expect(finding!.relativeTime).toBe('2h ago')
  })

  test('returns null when history has only 1 entry and it succeeded', () => {
    const history: HistoryEntry[] = [makeEntry({ success: true })]
    expect(checkTaskFailures('backup', history, now)).toBeNull()
  })

  test('handles undefined stderrPath', () => {
    const history: HistoryEntry[] = [
      makeEntry({
        success: false,
        stderrPath: undefined,
      }),
    ]

    const finding = checkTaskFailures('backup', history, now)

    expect(finding).toMatchObject({
      kind: 'task-failures',
      stderrPath: undefined,
      runDir: undefined,
    })
  })

  test('old failures after a successful run are not reported', () => {
    const history: HistoryEntry[] = [
      makeEntry({ success: true }),
      makeEntry({ success: false }),
      makeEntry({ success: false }),
      makeEntry({ success: false }),
      makeEntry({ success: false }),
    ]

    expect(checkTaskFailures('backup', history, now)).toBeNull()
  })

  test('returns null when most recent failure is a timeout', () => {
    const history: HistoryEntry[] = [
      makeEntry({ success: false, timed_out: true, exit_code: 124 }),
      makeEntry({ success: false }),
    ]

    expect(checkTaskFailures('backup', history, now)).toBeNull()
  })

  test('skips timeout entries when counting consecutive failures', () => {
    const history: HistoryEntry[] = [
      makeEntry({
        success: false,
        timed_out: false,
        exit_code: 1,
        finished_at: '2026-04-07T11:50:00.000Z',
      }),
      makeEntry({ success: false, timed_out: true, exit_code: 124 }),
      makeEntry({ success: false, timed_out: false }),
      makeEntry({ success: true }),
    ]

    const finding = checkTaskFailures('backup', history, now)

    expect(finding).toMatchObject({
      kind: 'task-failures',
      consecutiveFailures: 1,
      severity: 'warning',
    })
  })
})

// ------------------------------------------------------------------
// checkTaskTimeouts
// ------------------------------------------------------------------

describe('checkTaskTimeouts', () => {
  const now = new Date('2026-04-07T12:00:00.000Z')

  function makeEntry(
    overrides: Partial<HistoryEntry> & { success: boolean },
  ): HistoryEntry {
    return {
      timestamp: '2026-04-07T11-00-00',
      started_at: '2026-04-07T11:00:00.000Z',
      finished_at: '2026-04-07T11:00:05.000Z',
      duration_ms: 5000,
      exit_code: overrides.success ? 0 : 1,
      timed_out: false,
      stderrPath: undefined,
      ...overrides,
    }
  }

  test('returns null for empty history', () => {
    expect(checkTaskTimeouts('backup', [], 30_000, now)).toBeNull()
  })

  test('returns null when most recent run succeeded', () => {
    const history = [
      makeEntry({ success: true }),
      makeEntry({ success: false, timed_out: true, exit_code: 124 }),
    ]
    expect(checkTaskTimeouts('backup', history, 30_000, now)).toBeNull()
  })

  test('returns null when most recent failure is not a timeout', () => {
    const history = [makeEntry({ success: false, timed_out: false })]
    expect(checkTaskTimeouts('backup', history, 30_000, now)).toBeNull()
  })

  test('returns warning for a single timeout', () => {
    const history = [
      makeEntry({
        success: false,
        timed_out: true,
        exit_code: 124,
        finished_at: '2026-04-07T11:30:00.000Z',
      }),
      makeEntry({ success: true }),
    ]

    const finding = checkTaskTimeouts('backup', history, 30_000, now)

    expect(finding).toMatchObject({
      kind: 'task-timeout',
      severity: 'warning',
      task: 'backup',
      consecutiveTimeouts: 1,
      lastTimeoutTimestamp: '2026-04-07T11:30:00.000Z',
      timeout: '30s',
    })
    expect(finding!.relativeTime).toBe('30m ago')
  })

  test('returns critical when 3+ consecutive timeouts', () => {
    const history = [
      makeEntry({
        success: false,
        timed_out: true,
        exit_code: 124,
        finished_at: '2026-04-07T11:55:00.000Z',
      }),
      makeEntry({ success: false, timed_out: true, exit_code: 124 }),
      makeEntry({ success: false, timed_out: true, exit_code: 124 }),
      makeEntry({ success: true }),
    ]

    const finding = checkTaskTimeouts('backup', history, 300_000, now)

    expect(finding).toMatchObject({
      kind: 'task-timeout',
      severity: 'critical',
      task: 'backup',
      consecutiveTimeouts: 3,
      timeout: '5m',
    })
  })

  test('stops counting at non-timeout entry', () => {
    const history = [
      makeEntry({ success: false, timed_out: true, exit_code: 124 }),
      makeEntry({ success: false, timed_out: true, exit_code: 124 }),
      makeEntry({ success: false, timed_out: false, exit_code: 1 }),
      makeEntry({ success: false, timed_out: true, exit_code: 124 }),
    ]

    const finding = checkTaskTimeouts('backup', history, 30_000, now)

    expect(finding).toMatchObject({
      consecutiveTimeouts: 2,
      severity: 'warning',
    })
  })

  test('includes undefined timeout display when timeoutMs not provided', () => {
    const history = [
      makeEntry({
        success: false,
        timed_out: true,
        exit_code: 124,
        finished_at: '2026-04-07T11:55:00.000Z',
      }),
    ]

    const finding = checkTaskTimeouts('backup', history, undefined, now)

    expect(finding).toMatchObject({
      kind: 'task-timeout',
      severity: 'warning',
      timeout: undefined,
    })
  })
})

// ------------------------------------------------------------------
// checkTimeoutContention
// ------------------------------------------------------------------

describe('checkTimeoutContention', () => {
  test('returns null when timeout is undefined', () => {
    expect(checkTimeoutContention('backup', undefined, '0 * * * *')).toBeNull()
  })

  test('returns null when timeout is less than schedule interval', () => {
    // Schedule: every hour (3_600_000ms), timeout: 30s
    expect(checkTimeoutContention('backup', 30_000, '0 * * * *')).toBeNull()
  })

  test('returns warning when timeout equals schedule interval', () => {
    // Schedule: every 5 minutes (300_000ms), timeout: 5m (300_000ms)
    const finding = checkTimeoutContention('backup', 300_000, '*/5 * * * *')

    expect(finding).toMatchObject({
      kind: 'timeout-contention',
      severity: 'warning',
      task: 'backup',
      timeout: '5m',
      schedule: '*/5 * * * *',
    })
  })

  test('returns warning when timeout exceeds schedule interval', () => {
    // Schedule: every 5 minutes, timeout: 10m
    const finding = checkTimeoutContention('backup', 600_000, '*/5 * * * *')

    expect(finding).toMatchObject({
      kind: 'timeout-contention',
      severity: 'warning',
      task: 'backup',
      timeout: '10m',
      schedule: '*/5 * * * *',
    })
  })

  test('returns null when timeout is well under interval', () => {
    // Schedule: daily at midnight, timeout: 1h
    expect(checkTimeoutContention('backup', 3_600_000, '0 0 * * *')).toBeNull()
  })

  test('uses minimum gap for non-uniform schedules', () => {
    // Schedule: 9am and 5pm daily — minimum gap is 8h (9am→5pm)
    // Timeout: 10h exceeds the 8h minimum gap
    const finding = checkTimeoutContention(
      'backup',
      10 * 3_600_000,
      '0 9,17 * * *',
    )

    expect(finding).toMatchObject({
      kind: 'timeout-contention',
      severity: 'warning',
      task: 'backup',
    })
  })

  test('returns null for non-uniform schedule when timeout under minimum gap', () => {
    // Schedule: 9am and 5pm daily — minimum gap is 8h
    // Timeout: 7h is under the 8h minimum gap
    expect(
      checkTimeoutContention('backup', 7 * 3_600_000, '0 9,17 * * *'),
    ).toBeNull()
  })
})

// ------------------------------------------------------------------
// checkTaskValidation
// ------------------------------------------------------------------

describe('checkTaskValidation', () => {
  test('returns error finding per invalid task with error messages', () => {
    const results: ValidationResult[] = [
      { name: 'backup', valid: false, errors: ['schedule: invalid cron'] },
      {
        name: 'sync',
        valid: false,
        errors: ['agent: required', 'schedule: required'],
      },
    ]

    const findings = checkTaskValidation(results)

    expect(findings).toHaveLength(2)
    expect(findings[0]).toMatchObject({
      kind: 'task-validation',
      severity: 'error',
      task: 'backup',
      errors: ['schedule: invalid cron'],
    })
    expect(findings[1]).toMatchObject({
      kind: 'task-validation',
      severity: 'error',
      task: 'sync',
      errors: ['agent: required', 'schedule: required'],
    })
  })

  test('returns empty array for all-valid tasks', () => {
    const results: ValidationResult[] = [
      { name: 'backup', valid: true },
      { name: 'sync', valid: true },
    ]

    expect(checkTaskValidation(results)).toHaveLength(0)
  })

  test('returns empty array for empty input', () => {
    expect(checkTaskValidation([])).toHaveLength(0)
  })

  test('filters to only invalid tasks in mixed input', () => {
    const results: ValidationResult[] = [
      { name: 'backup', valid: true },
      { name: 'sync', valid: false, errors: ['schedule: required'] },
      { name: 'deploy', valid: true },
    ]

    const findings = checkTaskValidation(results)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      kind: 'task-validation',
      task: 'sync',
    })
  })
})

// ------------------------------------------------------------------
// checkTaskNeverRan
// ------------------------------------------------------------------

describe('checkTaskNeverRan', () => {
  test('returns warning for enabled task with zero history', () => {
    const finding = checkTaskNeverRan('backup', true, 0)

    expect(finding).toMatchObject({
      kind: 'task-never-ran',
      severity: 'warning',
      task: 'backup',
    })
  })

  test('returns null for disabled tasks', () => {
    expect(checkTaskNeverRan('backup', false, 0)).toBeNull()
  })

  test('returns null for tasks with history', () => {
    expect(checkTaskNeverRan('backup', true, 3)).toBeNull()
  })

  test('returns null for disabled tasks even with zero history', () => {
    expect(checkTaskNeverRan('backup', false, 0)).toBeNull()
  })
})

// ------------------------------------------------------------------
// checkContention
// ------------------------------------------------------------------

describe('checkContention', () => {
  test('returns warning with event count when contention events exist', () => {
    const entries: LogEntry[] = [
      {
        ts: '2026-04-07T10:00:00.000Z',
        event: 'skipped',
        task: 'backup',
        reason: 'contention',
      },
      {
        ts: '2026-04-07T10:05:00.000Z',
        event: 'skipped',
        task: 'backup',
        reason: 'contention',
      },
      {
        ts: '2026-04-07T10:10:00.000Z',
        event: 'skipped',
        task: 'backup',
        reason: 'contention',
      },
    ]

    const finding = checkContention('backup', entries)

    expect(finding).toMatchObject({
      kind: 'contention',
      severity: 'warning',
      task: 'backup',
      eventCount: 3,
    })
  })

  test('returns null when entries contain no contention events', () => {
    const entries: LogEntry[] = [
      {
        ts: '2026-04-07T10:00:00.000Z',
        event: 'started',
        task: 'backup',
        trigger: 'tick',
      },
      {
        ts: '2026-04-07T10:05:00.000Z',
        event: 'error',
        task: 'backup',
        error: { name: 'RunError', message: 'failed' },
      },
    ]

    expect(checkContention('backup', entries)).toBeNull()
  })

  test('returns null for empty entries', () => {
    expect(checkContention('backup', [])).toBeNull()
  })

  test('returns warning with count of 1 for single contention event', () => {
    const entries: LogEntry[] = [
      {
        ts: '2026-04-07T10:00:00.000Z',
        event: 'skipped',
        task: 'backup',
        reason: 'contention',
      },
    ]

    const finding = checkContention('backup', entries)

    expect(finding).toMatchObject({
      kind: 'contention',
      severity: 'warning',
      task: 'backup',
      eventCount: 1,
    })
  })
})
