import { describe, expect, test } from 'bun:test'

import { notifyHistoryWriteFailure } from './notify-failure'
import { HistoryWriteError } from './record'

describe('notifyHistoryWriteFailure', () => {
  test('writes JSONL log entry with errore-tagged HistoryWriteError', () => {
    const logCalls: Array<{ entry: unknown; target: string }> = []
    const stderrCalls: string[] = []

    const err = new HistoryWriteError({
      task_name: 'foo',
      reason: 'disk full',
    })

    notifyHistoryWriteFailure(err, 'foo', {
      log: (entry, target) => {
        logCalls.push({ entry, target })
      },
      logFilePath: '/tmp/log.jsonl',
      stderr: (msg) => stderrCalls.push(msg),
    })

    expect(logCalls).toHaveLength(1)
    expect(logCalls[0]?.target).toBe('/tmp/log.jsonl')
    expect(logCalls[0]?.entry).toMatchObject({
      event: 'error',
      task: 'foo',
      error: err,
    })

    expect(stderrCalls).toEqual([err.message])
  })

  test('log entry shape matches checkLogErrors predicate (event=error + error key)', () => {
    let captured: unknown
    const err = new HistoryWriteError({ task_name: 'bar', reason: 'EACCES' })

    notifyHistoryWriteFailure(err, 'bar', {
      log: (entry) => {
        captured = entry
      },
      logFilePath: '/tmp/log.jsonl',
      stderr: () => {},
    })

    // checkLogErrors in src/doctor/checks.ts buckets entries that satisfy
    // `entry.event === 'error' && 'error' in entry`. Assert directly.
    expect(captured).toMatchObject({ event: 'error' })
    expect(
      captured && typeof captured === 'object' && 'error' in captured,
    ).toBe(true)
  })
})
