import { describe, expect, test } from 'bun:test'

import {
  formatRelative,
  isoNow,
  isoUtcSchema,
  parseSinceFlag,
  SinceParseError,
} from './observability-time'

describe('isoNow', () => {
  test('returns a string accepted by isoUtcSchema', () => {
    const now = new Date('2026-04-24T12:34:56.789Z')
    const iso = isoNow(now)
    expect(isoUtcSchema.safeParse(iso).success).toBe(true)
  })
})

describe('isoUtcSchema', () => {
  test('rejects non-UTC offset', () => {
    expect(isoUtcSchema.safeParse('2026-04-24T12:34:56+02:00').success).toBe(
      false,
    )
  })

  test('rejects malformed strings', () => {
    expect(isoUtcSchema.safeParse('not-a-date').success).toBe(false)
    expect(isoUtcSchema.safeParse('').success).toBe(false)
  })
})

describe('formatRelative', () => {
  const base = new Date('2026-04-07T12:00:00.000Z')

  test('returns "now" for < 1 minute', () => {
    const from = new Date(base.getTime() - 30_000) // 30s ago
    expect(formatRelative(from, base)).toBe('now')
  })

  test('returns minutes for < 1 hour', () => {
    const from = new Date(base.getTime() - 25 * 60_000)
    expect(formatRelative(from, base)).toBe('25m ago')
  })

  test('uses largest unit for hours range', () => {
    const from = new Date(base.getTime() - (3 * 3600_000 + 37 * 60_000))
    expect(formatRelative(from, base)).toBe('3h ago')
  })

  test('returns exact hours', () => {
    const from = new Date(base.getTime() - 2 * 3600_000)
    expect(formatRelative(from, base)).toBe('2h ago')
  })

  test('uses largest unit for days range', () => {
    const from = new Date(base.getTime() - (2 * 86400_000 + 5 * 3600_000))
    expect(formatRelative(from, base)).toBe('2d ago')
  })

  test('returns "1m ago" at exactly 1 minute', () => {
    const from = new Date(base.getTime() - 60_000)
    expect(formatRelative(from, base)).toBe('1m ago')
  })

  test('returns "1h ago" at exactly 1 hour', () => {
    const from = new Date(base.getTime() - 3600_000)
    expect(formatRelative(from, base)).toBe('1h ago')
  })

  test('returns "yesterday" at exactly 1 day', () => {
    const from = new Date(base.getTime() - 86400_000)
    expect(formatRelative(from, base)).toBe('yesterday')
  })
})

describe('parseSinceFlag', () => {
  test('parses a valid ISO UTC string to a Date', () => {
    const result = parseSinceFlag('2026-04-20T10:00:00.000Z')
    if (result instanceof Error) throw result
    expect(result.toISOString()).toBe('2026-04-20T10:00:00.000Z')
  })

  test('returns SinceParseError for malformed input', () => {
    expect(parseSinceFlag('not-a-date')).toBeInstanceOf(SinceParseError)
    expect(parseSinceFlag('')).toBeInstanceOf(SinceParseError)
  })

  test('rejects non-UTC offsets to match the module UTC contract', () => {
    expect(parseSinceFlag('2026-04-20T10:00:00+02:00')).toBeInstanceOf(
      SinceParseError,
    )
  })
})
