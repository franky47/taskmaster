import * as errore from 'errore'
import { z } from 'zod'

export class SinceParseError extends errore.createTaggedError({
  name: 'SinceParseError',
  message: 'Invalid --since value "$value"',
}) {}

export const isoUtcSchema = z.iso.datetime()

type IsoUtc = z.infer<typeof isoUtcSchema>

export function isoNow(now?: Date): IsoUtc {
  return (now ?? new Date()).toISOString()
}

const rtf = new Intl.RelativeTimeFormat('en', {
  style: 'narrow',
  numeric: 'auto',
})

export function formatRelative(from: Date, to: Date): string {
  const diffMs = to.getTime() - from.getTime()
  const totalMinutes = Math.floor(diffMs / 60_000)
  const totalHours = Math.floor(totalMinutes / 60)
  const totalDays = Math.floor(totalHours / 24)

  if (totalDays >= 1) return rtf.format(-totalDays, 'day')
  if (totalHours >= 1) return rtf.format(-totalHours, 'hour')
  if (totalMinutes >= 1) return rtf.format(-totalMinutes, 'minute')
  return rtf.format(0, 'second')
}

export function parseSinceFlag(value: string): SinceParseError | Date {
  const parsed = isoUtcSchema.safeParse(value)
  if (!parsed.success) return new SinceParseError({ value })
  return new Date(parsed.data)
}
