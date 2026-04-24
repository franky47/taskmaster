import { describe, expect, test } from 'bun:test'

import {
  TimestampParseError,
  formatTimestamp,
  manualTimestamp,
  parseTimestampFlag,
  runIdSchema,
} from './timestamp'

describe('runIdSchema', () => {
  test('accepts canonical dotted UTC format', () => {
    const result = runIdSchema.safeParse('2026-04-04T08.30.45Z')
    expect(result.success).toBe(true)
  })

  test.each([
    ['empty string', ''],
    ['ISO with colons', '2026-04-04T08:30:45Z'],
    ['missing Z', '2026-04-04T08.30.45'],
    ['non-UTC offset', '2026-04-04T08.30.45+00.00'],
    ['sub-second precision', '2026-04-04T08.30.45.123Z'],
    ['wrong separator', '2026/04/04T08.30.45Z'],
    ['arbitrary junk', 'not-a-timestamp'],
  ])('rejects %s', (_label, raw) => {
    const result = runIdSchema.safeParse(raw)
    expect(result.success).toBe(false)
  })
})

describe('formatTimestamp', () => {
  test('produces YYYY-MM-DDTHH.MM.SSZ format', () => {
    const date = new Date('2026-04-04T08:30:45Z')
    expect(formatTimestamp(date)).toBe(
      runIdSchema.parse('2026-04-04T08.30.45Z'),
    )
  })

  test('zero-pads single-digit values', () => {
    const date = new Date('2026-01-02T03:04:05Z')
    expect(formatTimestamp(date)).toBe(
      runIdSchema.parse('2026-01-02T03.04.05Z'),
    )
  })

  test('handles midnight', () => {
    const date = new Date('2026-12-31T00:00:00Z')
    expect(formatTimestamp(date)).toBe(
      runIdSchema.parse('2026-12-31T00.00.00Z'),
    )
  })
})

describe('manualTimestamp', () => {
  test('uses injected date', () => {
    const date = new Date('2026-04-04T08:30:45.123Z')
    expect(manualTimestamp(date)).toBe(
      runIdSchema.parse('2026-04-04T08.30.45Z'),
    )
  })

  test('drops milliseconds', () => {
    const date = new Date('2026-04-04T08:30:45.999Z')
    expect(manualTimestamp(date)).toBe(
      runIdSchema.parse('2026-04-04T08.30.45Z'),
    )
  })

  test('returns a canonical RunId when called without arguments', () => {
    const result = manualTimestamp()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}\.\d{2}\.\d{2}Z$/)
  })
})

describe('parseTimestampFlag', () => {
  test('parses valid ISO 8601 string', () => {
    const result = parseTimestampFlag('2026-04-04T08:30:00Z')
    expect(result).toBeInstanceOf(Date)
    if (result instanceof Error) throw result
    expect(result.toISOString()).toBe('2026-04-04T08:30:00.000Z')
  })

  test('returns TimestampParseError for garbage input', () => {
    const result = parseTimestampFlag('not-a-date')
    expect(result).toBeInstanceOf(TimestampParseError)
  })

  test('returns TimestampParseError for empty string', () => {
    const result = parseTimestampFlag('')
    expect(result).toBeInstanceOf(TimestampParseError)
  })
})
