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

  test('decode converts started_at and finished_at to Date objects', () => {
    const decoded = historyMetaSchema.decode(baseMeta)
    expect(decoded.started_at).toBeInstanceOf(Date)
    expect(decoded.finished_at).toBeInstanceOf(Date)
    expect(decoded.started_at.toISOString()).toBe('2026-04-04T08:30:00.000Z')
    expect(decoded.finished_at.toISOString()).toBe('2026-04-04T08:30:15.456Z')
  })

  test('encode converts Date objects back to ISO strings', () => {
    const encoded = historyMetaSchema.encode({
      timestamp: '2026-04-04T08.30.00Z',
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
})
