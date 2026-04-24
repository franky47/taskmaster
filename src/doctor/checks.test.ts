import { describe, expect, test } from 'bun:test'

import type { LogEntry } from '#lib/logger'
import type { HistoryEntry } from '#src/history'
import { runIdSchema } from '#src/history'
import type { ValidationResult } from '#src/validate'

import {
  checkConsecutiveRequirementSkips,
  checkContention,
  checkHeartbeat,
  checkLogErrors,
  checkOfflineSkips,
  checkSchedulerInstalled,
  checkTaskFailures,
  checkTaskNeverRan,
  checkTaskTimeouts,
  checkTaskValidation,
  checkTimeoutContention,
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
      timestamp: runIdSchema.parse('2026-04-07T11.00.00Z'),
      started_at: new Date('2026-04-07T11:00:00.000Z'),
      finished_at: new Date('2026-04-07T11:00:05.000Z'),
      duration_ms: 5000,
      exit_code: overrides.success ? 0 : 1,
      timed_out: false,
      output_path: '/history/backup/2026-04-07T11-00-00.output.txt',
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
        finished_at: new Date('2026-04-07T11:30:00.000Z'),
        output_path: '/history/backup/run1.output.txt',
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
      output_path: '/history/backup/run1.output.txt',
    })
    expect(finding!.relativeTime).toBe('30m ago')
    expect(finding!.runDir).toBe('/history/backup')
  })

  test('returns warning when 2 consecutive failures', () => {
    const history: HistoryEntry[] = [
      makeEntry({
        success: false,
        finished_at: new Date('2026-04-07T11:50:00.000Z'),
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
        finished_at: new Date('2026-04-07T11:55:00.000Z'),
        exit_code: 127,
        output_path: '/history/sync/latest.output.txt',
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
      output_path: '/history/sync/latest.output.txt',
      runDir: '/history/sync',
    })
    expect(finding!.relativeTime).toBe('5m ago')
  })

  test('returns critical when more than 3 consecutive failures', () => {
    const history: HistoryEntry[] = [
      makeEntry({
        success: false,
        finished_at: new Date('2026-04-07T11:00:00.000Z'),
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
        finished_at: new Date('2026-04-07T10:00:00.000Z'),
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

  test('handles undefined output_path', () => {
    const history: HistoryEntry[] = [
      makeEntry({
        success: false,
        output_path: undefined,
      }),
    ]

    const finding = checkTaskFailures('backup', history, now)

    expect(finding).toMatchObject({
      kind: 'task-failures',
      output_path: undefined,
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
        finished_at: new Date('2026-04-07T11:50:00.000Z'),
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
      timestamp: runIdSchema.parse('2026-04-07T11.00.00Z'),
      started_at: new Date('2026-04-07T11:00:00.000Z'),
      finished_at: new Date('2026-04-07T11:00:05.000Z'),
      duration_ms: 5000,
      exit_code: overrides.success ? 0 : 1,
      timed_out: false,
      output_path: undefined,
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
        finished_at: new Date('2026-04-07T11:30:00.000Z'),
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
        finished_at: new Date('2026-04-07T11:55:00.000Z'),
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
        finished_at: new Date('2026-04-07T11:55:00.000Z'),
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
    expect(checkTimeoutContention('backup', 30_000, '0 * * * *')).toBeNull()
  })

  test('returns warning when timeout equals schedule interval', () => {
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
    expect(checkTimeoutContention('backup', 3_600_000, '0 0 * * *')).toBeNull()
  })

  test('uses minimum gap for non-uniform schedules', () => {
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

// ------------------------------------------------------------------
// checkOfflineSkips
// ------------------------------------------------------------------

describe('checkOfflineSkips', () => {
  test('returns warning with skip count when offline skip events exist', () => {
    const entries: LogEntry[] = [
      {
        ts: '2026-04-07T10:00:00.000Z',
        event: 'skipped',
        task: 'sync',
        reason: 'requirement-unmet',
        requirement: ['network'],
      },
      {
        ts: '2026-04-07T11:00:00.000Z',
        event: 'skipped',
        task: 'sync',
        reason: 'requirement-unmet',
        requirement: ['network'],
      },
      {
        ts: '2026-04-07T12:00:00.000Z',
        event: 'skipped',
        task: 'sync',
        reason: 'requirement-unmet',
        requirement: ['network'],
      },
    ]

    const finding = checkOfflineSkips('sync', entries)

    expect(finding).toMatchObject({
      kind: 'offline-skips',
      severity: 'warning',
      task: 'sync',
      skipCount: 3,
    })
  })

  test('returns null when no offline skip events exist', () => {
    const entries: LogEntry[] = [
      {
        ts: '2026-04-07T10:00:00.000Z',
        event: 'started',
        task: 'sync',
        trigger: 'tick',
      },
    ]

    expect(checkOfflineSkips('sync', entries)).toBeNull()
  })

  test('returns null for empty entries', () => {
    expect(checkOfflineSkips('sync', [])).toBeNull()
  })
})

// ------------------------------------------------------------------
// checkConsecutiveRequirementSkips
// ------------------------------------------------------------------

describe('checkConsecutiveRequirementSkips', () => {
  function skip(ts: string, requirement: ('network' | 'ac-power')[]): LogEntry {
    return {
      ts,
      event: 'skipped',
      task: 'llm-digest',
      reason: 'requirement-unmet',
      requirement,
    }
  }

  test('returns warning when exactly 3 consecutive skips share the same requirement', () => {
    const entries: LogEntry[] = [
      skip('2026-04-07T10:00:00.000Z', ['ac-power']),
      skip('2026-04-07T11:00:00.000Z', ['ac-power']),
      skip('2026-04-07T12:00:00.000Z', ['ac-power']),
    ]

    const findings = checkConsecutiveRequirementSkips('llm-digest', entries)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      kind: 'consecutive-requirement-skips',
      severity: 'warning',
      task: 'llm-digest',
      requirement: 'ac-power',
      consecutiveSkips: 3,
    })
  })

  test('returns warning when more than 3 consecutive skips share the same requirement', () => {
    const entries: LogEntry[] = [
      skip('2026-04-07T09:00:00.000Z', ['ac-power']),
      skip('2026-04-07T10:00:00.000Z', ['ac-power']),
      skip('2026-04-07T11:00:00.000Z', ['ac-power']),
      skip('2026-04-07T12:00:00.000Z', ['ac-power']),
      skip('2026-04-07T13:00:00.000Z', ['ac-power']),
    ]

    const findings = checkConsecutiveRequirementSkips('llm-digest', entries)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      requirement: 'ac-power',
      consecutiveSkips: 5,
    })
  })

  test('returns empty when fewer than 3 consecutive skips', () => {
    const entries: LogEntry[] = [
      skip('2026-04-07T11:00:00.000Z', ['ac-power']),
      skip('2026-04-07T12:00:00.000Z', ['ac-power']),
    ]

    expect(
      checkConsecutiveRequirementSkips('llm-digest', entries),
    ).toHaveLength(0)
  })

  test('returns empty when no skip events at all', () => {
    expect(checkConsecutiveRequirementSkips('llm-digest', [])).toHaveLength(0)
  })

  test('returns empty when only non-requirement events exist', () => {
    const entries: LogEntry[] = [
      {
        ts: '2026-04-07T10:00:00.000Z',
        event: 'started',
        task: 'llm-digest',
        trigger: 'tick',
      },
      {
        ts: '2026-04-07T10:05:00.000Z',
        event: 'skipped',
        task: 'llm-digest',
        reason: 'contention',
      },
    ]

    expect(
      checkConsecutiveRequirementSkips('llm-digest', entries),
    ).toHaveLength(0)
  })

  test('streak resets when a different single-requirement skip breaks the run', () => {
    const entries: LogEntry[] = [
      skip('2026-04-07T09:00:00.000Z', ['ac-power']),
      skip('2026-04-07T10:00:00.000Z', ['ac-power']),
      skip('2026-04-07T11:00:00.000Z', ['network']),
      skip('2026-04-07T12:00:00.000Z', ['ac-power']),
      skip('2026-04-07T13:00:00.000Z', ['ac-power']),
    ]

    // Most recent run of ac-power is only 2, not enough.
    expect(
      checkConsecutiveRequirementSkips('llm-digest', entries),
    ).toHaveLength(0)
  })

  test('emits one finding per requirement when multiple are chronically unmet', () => {
    const entries: LogEntry[] = [
      skip('2026-04-07T10:00:00.000Z', ['network', 'ac-power']),
      skip('2026-04-07T11:00:00.000Z', ['network', 'ac-power']),
      skip('2026-04-07T12:00:00.000Z', ['network', 'ac-power']),
    ]

    const findings = checkConsecutiveRequirementSkips('llm-digest', entries)

    expect(findings).toHaveLength(2)
    const byReq = new Map(findings.map((f) => [f.requirement, f]))
    expect(byReq.get('network')).toMatchObject({
      consecutiveSkips: 3,
      severity: 'warning',
    })
    expect(byReq.get('ac-power')).toMatchObject({
      consecutiveSkips: 3,
      severity: 'warning',
    })
  })

  test('continues streak for requirement present in every recent skip, even when other requirements are mixed in', () => {
    const entries: LogEntry[] = [
      skip('2026-04-07T10:00:00.000Z', ['network']),
      skip('2026-04-07T11:00:00.000Z', ['network', 'ac-power']),
      skip('2026-04-07T12:00:00.000Z', ['network']),
    ]

    const findings = checkConsecutiveRequirementSkips('llm-digest', entries)

    // network streak continues across entries; ac-power only appears once so no finding.
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      requirement: 'network',
      consecutiveSkips: 3,
    })
  })

  test('non-requirement-unmet events between skips do not break the streak', () => {
    const entries: LogEntry[] = [
      skip('2026-04-07T09:00:00.000Z', ['ac-power']),
      {
        ts: '2026-04-07T09:30:00.000Z',
        event: 'started',
        task: 'llm-digest',
        trigger: 'manual',
      },
      skip('2026-04-07T10:00:00.000Z', ['ac-power']),
      {
        ts: '2026-04-07T10:30:00.000Z',
        event: 'skipped',
        task: 'llm-digest',
        reason: 'contention',
      },
      skip('2026-04-07T11:00:00.000Z', ['ac-power']),
    ]

    const findings = checkConsecutiveRequirementSkips('llm-digest', entries)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      requirement: 'ac-power',
      consecutiveSkips: 3,
    })
  })

  test('only counts the most recent tail — earlier broken streaks are ignored', () => {
    const entries: LogEntry[] = [
      // Older run of 3: would qualify on its own but a different requirement
      // broke the streak after it.
      skip('2026-04-07T07:00:00.000Z', ['ac-power']),
      skip('2026-04-07T08:00:00.000Z', ['ac-power']),
      skip('2026-04-07T09:00:00.000Z', ['ac-power']),
      skip('2026-04-07T10:00:00.000Z', ['network']),
      // Most recent tail is a single network skip.
      skip('2026-04-07T11:00:00.000Z', ['network']),
    ]

    // Only 2 consecutive network skips at the tail, 0 consecutive ac-power.
    expect(
      checkConsecutiveRequirementSkips('llm-digest', entries),
    ).toHaveLength(0)
  })
})
