import { describe, expect, test } from 'bun:test'

import { minCronIntervalMs } from '#lib/schedule.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

describe('minCronIntervalMs', () => {
  // --- Happy path ---

  test('every minute → 1 minute', () => {
    expect(minCronIntervalMs('* * * * *')).toBe(MINUTE)
  })

  test('every 5 minutes → 5 minutes', () => {
    expect(minCronIntervalMs('*/5 * * * *')).toBe(5 * MINUTE)
  })

  test('every hour → 1 hour', () => {
    expect(minCronIntervalMs('0 * * * *')).toBe(HOUR)
  })

  test('daily at midnight → 24 hours', () => {
    expect(minCronIntervalMs('0 0 * * *')).toBe(24 * HOUR)
  })

  test('weekly (Sunday midnight) → 7 days', () => {
    expect(minCronIntervalMs('0 0 * * 0')).toBe(7 * 24 * HOUR)
  })

  // --- Non-uniform / edge cases ---

  test('non-uniform hours: 9am and 5pm → shortest gap is 8 hours', () => {
    // Gaps alternate: 8h (09→17) and 16h (17→09 next day)
    expect(minCronIntervalMs('0 9,17 * * *')).toBe(8 * HOUR)
  })

  test('non-uniform minutes: :00 and :45 → shortest gap is 15 minutes', () => {
    // Gaps alternate: 45min (00→45) and 15min (45→00 next hour)
    expect(minCronIntervalMs('0,45 * * * *')).toBe(15 * MINUTE)
  })

  test('clustered minutes: :00, :01, :30 → shortest gap is 1 minute', () => {
    expect(minCronIntervalMs('0,1,30 * * * *')).toBe(MINUTE)
  })

  test('specific weekdays (Mon-Fri daily) → shortest gap is 24 hours', () => {
    // Mon–Fri: gaps are 24h except Fri→Mon which is 72h
    expect(minCronIntervalMs('0 0 * * 1-5')).toBe(24 * HOUR)
  })

  test('two specific days (Mon, Thu) → shortest gap is 72 hours', () => {
    // Mon→Thu = 3 days, Thu→Mon = 4 days
    expect(minCronIntervalMs('0 0 * * 1,4')).toBe(3 * 24 * HOUR)
  })

  test('every 15 and 45 past on specific hours → shortest gap is 15 minutes', () => {
    // At :15 and :45 during hours 8,12,18
    // Within an hour: 30min gap (15→45)
    // Across hours: e.g. 8:45→12:15 = 3h30m, but 12:45→18:15 = 5h30m
    // The 30-minute intra-hour gap is the shortest... wait let me reconsider
    // Actually :15 and :45 within the same hour = 30 min
    // But between the last :45 of one active hour and the first :15 of the next:
    //   8:45 → 12:15 = 3.5h,  12:45 → 18:15 = 5.5h
    // So the minimum is 30 minutes
    expect(minCronIntervalMs('15,45 8,12,18 * * *')).toBe(30 * MINUTE)
  })

  test('invalid cron expression throws', () => {
    expect(() => minCronIntervalMs('not a cron')).toThrow()
  })
})
