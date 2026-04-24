import * as errore from 'errore'
import { z } from 'zod'

export class TimestampParseError extends errore.createTaggedError({
  name: 'TimestampParseError',
  message: 'Invalid timestamp "$value"',
}) {}

const RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}\.\d{2}\.\d{2}Z$/

export const runIdSchema = z
  .string()
  .regex(RUN_ID_PATTERN, 'Invalid run ID format')
  .brand('RunId')

export type RunId = z.output<typeof runIdSchema>

export function formatTimestamp(date: Date): RunId {
  const noMs = date.toISOString().slice(0, 19) + 'Z'
  return runIdSchema.parse(noMs.replaceAll(':', '.'))
}

export function manualTimestamp(now?: Date): RunId {
  const date = now ?? new Date()
  // Floor to second precision by zeroing milliseconds
  const floored = new Date(date)
  floored.setUTCMilliseconds(0)
  return formatTimestamp(floored)
}

export function parseTimestampFlag(value: string): TimestampParseError | Date {
  // formatTimestamp replaces ':' with '.' for safe filenames — reverse it
  const normalized = value.replace(/T(\d{2})\.(\d{2})\.(\d{2})Z$/, 'T$1:$2:$3Z')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime()) || value === '') {
    return new TimestampParseError({ value })
  }
  return date
}
