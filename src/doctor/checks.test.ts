import { describe, expect, test } from 'bun:test'

import type { LogEntry } from '../logger'
import { checkLogErrors } from './checks'

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
    })
    expect(findings[0]!.error).toMatchObject({
      name: 'RunError',
      message: 'process exited with code 1',
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
