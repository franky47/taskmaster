import { CronExpressionParser } from 'cron-parser'

const ONE_WEEK_MS = 7 * 24 * 60 * 60_000

/**
 * Compute the minimum gap between consecutive cron ticks over a full week.
 * Non-uniform schedules like "0 9,17 * * *" have variable gaps (8h and 16h);
 * this returns the shortest one.
 */
export function minCronIntervalMs(schedule: string): number {
  const expr = CronExpressionParser.parse(schedule)
  let prev = expr.next().toDate().getTime()
  let minInterval = Infinity
  const horizon = prev + ONE_WEEK_MS
  while (true) {
    const next = expr.next().toDate().getTime()
    const gap = next - prev
    if (gap < minInterval) minInterval = gap
    prev = next
    if (prev >= horizon) break
  }
  return minInterval
}
