import * as errore from 'errore'

export class TimestampParseError extends errore.createTaggedError({
  name: 'TimestampParseError',
  message: 'Invalid timestamp "$value"',
}) {}

export function formatTimestamp(date: Date): string {
  const noMs = date.toISOString().slice(0, 19) + 'Z'
  return noMs.replaceAll(':', '.')
}

export function manualTimestamp(now?: Date): string {
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
