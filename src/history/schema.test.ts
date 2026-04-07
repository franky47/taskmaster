import { describe, expect, test } from 'bun:test'

import { historyMetaSchema } from './schema'

const baseMeta = {
  timestamp: '2026-04-04T08.30.00Z',
  started_at: '2026-04-04T08:30:00.000Z',
  finished_at: '2026-04-04T08:30:15.456Z',
  duration_ms: 15456,
  exit_code: 0,
  success: true,
}

describe('historyMetaSchema', () => {
  test('parses record without timed_out (backwards compat)', () => {
    const result = historyMetaSchema.parse(baseMeta)
    expect(result.timed_out).toBe(false)
  })

  test('parses record with timed_out: true', () => {
    const result = historyMetaSchema.parse({ ...baseMeta, timed_out: true })
    expect(result.timed_out).toBe(true)
  })

  test('parses record with timed_out: false', () => {
    const result = historyMetaSchema.parse({ ...baseMeta, timed_out: false })
    expect(result.timed_out).toBe(false)
  })
})
