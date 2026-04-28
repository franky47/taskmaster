import { describe, expect, test } from 'bun:test'

import { historyMetaSchema, isAgentRanMeta } from './schema'
import { runIdSchema } from './timestamp'

const baseMeta = {
  timestamp: runIdSchema.parse('2026-04-04T08.30.00Z'),
  started_at: '2026-04-04T08:30:00.000Z',
  finished_at: '2026-04-04T08:30:15.456Z',
  duration_ms: 15456,
  exit_code: 0,
  success: true,
}

describe('historyMetaSchema', () => {
  test('parses record without timed_out (backwards compat)', () => {
    const result = historyMetaSchema.parse(baseMeta)
    if (!isAgentRanMeta(result)) throw new Error('expected agent-ran')
    expect(result.timed_out).toBe(false)
  })

  test('parses record with timed_out: true', () => {
    const result = historyMetaSchema.parse({ ...baseMeta, timed_out: true })
    if (!isAgentRanMeta(result)) throw new Error('expected agent-ran')
    expect(result.timed_out).toBe(true)
  })

  test('parses record with timed_out: false', () => {
    const result = historyMetaSchema.parse({ ...baseMeta, timed_out: false })
    if (!isAgentRanMeta(result)) throw new Error('expected agent-ran')
    expect(result.timed_out).toBe(false)
  })

  test('decode converts started_at and finished_at to Date objects', () => {
    const decoded = historyMetaSchema.decode(baseMeta)
    expect(decoded.started_at).toBeInstanceOf(Date)
    expect(decoded.finished_at).toBeInstanceOf(Date)
    expect(decoded.started_at.toISOString()).toBe('2026-04-04T08:30:00.000Z')
    expect(decoded.finished_at.toISOString()).toBe('2026-04-04T08:30:15.456Z')
  })

  test('encode converts Date objects back to ISO strings', () => {
    const encoded = historyMetaSchema.encode({
      timestamp: runIdSchema.parse('2026-04-04T08.30.00Z'),
      started_at: new Date('2026-04-04T08:30:00.000Z'),
      finished_at: new Date('2026-04-04T08:30:15.456Z'),
      duration_ms: 15456,
      exit_code: 0,
      success: true,
      timed_out: false,
    })
    expect(typeof encoded.started_at).toBe('string')
    expect(typeof encoded.finished_at).toBe('string')
    expect(encoded.started_at).toBe('2026-04-04T08:30:00.000Z')
    expect(encoded.finished_at).toBe('2026-04-04T08:30:15.456Z')
  })

  test('decode → encode round-trips correctly', () => {
    const decoded = historyMetaSchema.decode(baseMeta)
    const encoded = historyMetaSchema.encode(decoded)
    expect(encoded).toEqual({ ...baseMeta, timed_out: false })
  })

  test('rejects success: false when exit_code is 0', () => {
    expect(() =>
      historyMetaSchema.decode({ ...baseMeta, success: false }),
    ).toThrow()
  })

  test('rejects success: true when exit_code is non-zero', () => {
    expect(() =>
      historyMetaSchema.decode({ ...baseMeta, exit_code: 1, success: true }),
    ).toThrow()
  })

  test('rejects inconsistent duration_ms', () => {
    expect(() =>
      historyMetaSchema.decode({ ...baseMeta, duration_ms: 9999 }),
    ).toThrow()
  })

  test('parses record without trigger/event (backwards compat)', () => {
    const result = historyMetaSchema.decode(baseMeta)
    expect(result.trigger).toBeUndefined()
    expect(result.event).toBeUndefined()
  })

  test('parses record with trigger: dispatch and event', () => {
    const result = historyMetaSchema.decode({
      ...baseMeta,
      trigger: 'dispatch',
      event: 'deploy',
    })
    expect(result.trigger).toBe('dispatch')
    expect(result.event).toBe('deploy')
  })

  test('parses record with trigger: tick (no event)', () => {
    const result = historyMetaSchema.decode({
      ...baseMeta,
      trigger: 'tick',
    })
    expect(result.trigger).toBe('tick')
    expect(result.event).toBeUndefined()
  })

  test('parses record with trigger: manual (no event)', () => {
    const result = historyMetaSchema.decode({
      ...baseMeta,
      trigger: 'manual',
    })
    expect(result.trigger).toBe('manual')
    expect(result.event).toBeUndefined()
  })

  test('encode preserves trigger and event fields', () => {
    const decoded = historyMetaSchema.decode({
      ...baseMeta,
      trigger: 'dispatch',
      event: 'deploy',
    })
    const encoded = historyMetaSchema.encode(decoded)
    expect(encoded.trigger).toBe('dispatch')
    expect(encoded.event).toBe('deploy')
  })

  test('encode omits trigger/event when not set', () => {
    const decoded = historyMetaSchema.decode(baseMeta)
    const encoded = historyMetaSchema.encode(decoded)
    expect('trigger' in encoded).toBe(false)
    expect('event' in encoded).toBe(false)
  })

  test('rejects event without trigger: dispatch', () => {
    expect(() =>
      historyMetaSchema.decode({
        ...baseMeta,
        trigger: 'manual',
        event: 'deploy',
      }),
    ).toThrow()
  })

  test('rejects event with no trigger', () => {
    expect(() =>
      historyMetaSchema.decode({ ...baseMeta, event: 'deploy' }),
    ).toThrow()
  })

  test('rejects malformed timestamp (ISO with colons)', () => {
    expect(() =>
      historyMetaSchema.decode({
        ...baseMeta,
        timestamp: '2026-04-04T08:30:00Z',
      }),
    ).toThrow()
  })

  test('rejects malformed timestamp (arbitrary string)', () => {
    expect(() =>
      historyMetaSchema.decode({ ...baseMeta, timestamp: 'not-a-timestamp' }),
    ).toThrow()
  })

  describe('preflight variants', () => {
    const preflightFields = {
      timestamp: runIdSchema.parse('2026-04-04T08.30.00Z'),
      started_at: '2026-04-04T08:30:00.000Z',
      finished_at: '2026-04-04T08:30:00.050Z',
      duration_ms: 50,
    }
    const preflightBlock = {
      exit_code: 1,
      duration_ms: 30,
      stdout_bytes: 0,
      stderr_bytes: 0,
    }

    test('parses skipped-preflight record', () => {
      const result = historyMetaSchema.decode({
        ...preflightFields,
        status: 'skipped-preflight',
        preflight: preflightBlock,
      })
      if (isAgentRanMeta(result)) throw new Error('expected preflight variant')
      expect(result.status).toBe('skipped-preflight')
      expect(result.preflight).toEqual(preflightBlock)
    })

    test('parses preflight-error record with error_reason', () => {
      const result = historyMetaSchema.decode({
        ...preflightFields,
        status: 'preflight-error',
        preflight: { ...preflightBlock, exit_code: 2, error_reason: 'nonzero' },
      })
      if (isAgentRanMeta(result)) throw new Error('expected preflight variant')
      expect(result.status).toBe('preflight-error')
      expect(result.preflight.error_reason).toBe('nonzero')
    })

    test('rejects skipped-preflight without preflight block', () => {
      expect(() =>
        // @ts-expect-error intentionally missing preflight block
        historyMetaSchema.decode({
          ...preflightFields,
          status: 'skipped-preflight',
        }),
      ).toThrow()
    })

    test('encode round-trips skipped-preflight', () => {
      const decoded = historyMetaSchema.decode({
        ...preflightFields,
        status: 'skipped-preflight',
        preflight: preflightBlock,
      })
      const encoded = historyMetaSchema.encode(decoded)
      if (!('status' in encoded)) throw new Error('expected status field')
      expect(encoded.status).toBe('skipped-preflight')
      expect(encoded.preflight).toEqual(preflightBlock)
    })

    test('agent-ran record may carry optional preflight block', () => {
      const result = historyMetaSchema.decode({
        ...baseMeta,
        preflight: { ...preflightBlock, exit_code: 0 },
      })
      if (!isAgentRanMeta(result)) throw new Error('expected agent-ran')
      expect(result.preflight?.exit_code).toBe(0)
    })

    test('rejects unknown error_reason', () => {
      expect(() =>
        historyMetaSchema.decode({
          ...preflightFields,
          status: 'preflight-error',
          // @ts-expect-error invalid error_reason value
          preflight: { ...preflightBlock, error_reason: 'bogus' },
        }),
      ).toThrow()
    })
  })
})
