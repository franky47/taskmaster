import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { logFilePath } from './config'

// Schema --

const startedEntrySchema = z.object({
  ts: z.iso.datetime(),
  event: z.literal('started'),
  task: z.string(),
  trigger: z.enum(['manual', 'tick']),
})

const skippedEntrySchema = z.object({
  ts: z.iso.datetime(),
  event: z.literal('skipped'),
  task: z.string(),
  reason: z.enum(['contention', 'offline']),
})

const errorEntrySchema = z.object({
  ts: z.iso.datetime(),
  event: z.literal('error'),
  task: z.string(),
  error: z.record(z.string(), z.unknown()),
})

export const logEntrySchema = z.discriminatedUnion('event', [
  startedEntrySchema,
  skippedEntrySchema,
  errorEntrySchema,
])

// Types --

export type LogEntry = z.infer<typeof logEntrySchema>

type LogInput =
  | { event: 'started'; task: string; trigger: 'manual' | 'tick' }
  | { event: 'skipped'; task: string; reason: 'contention' | 'offline' }
  | { event: 'error'; task: string; error: Error }

// Serialization --

const SKIP_KEYS = new Set([
  // errore internals
  '_tag',
  'messageTemplate',
  // properties that are already captured in the top-level fields
  'name',
  'message',
  'stack',
])

export function serializeError(err: Error): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    name: err.name,
    message: err.message,
  }
  for (const [key, value] of Object.entries(err)) {
    if (!SKIP_KEYS.has(key)) {
      serialized[key] = value
    }
  }
  return serialized
}

function serializeEntry(entry: LogInput): Record<string, unknown> {
  if (entry.event === 'error') {
    return {
      ts: new Date().toISOString(),
      ...entry,
      error: serializeError(entry.error),
    }
  }
  return { ts: new Date().toISOString(), ...entry }
}

// Public API --

export function log(entry: LogInput, target = logFilePath): void {
  try {
    mkdirSync(path.dirname(target), { recursive: true })
    appendFileSync(target, JSON.stringify(serializeEntry(entry)) + '\n')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    try {
      process.stderr.write(`tm: log write failed: ${msg}\n`)
    } catch {
      // truly hopeless — stderr itself is broken
    }
  }
}

export function readLog(since: Date, logPath = logFilePath): LogEntry[] {
  const sinceISO = since.toISOString()
  let content: string
  try {
    content = readFileSync(logPath, 'utf-8')
  } catch (e: unknown) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      return []
    }
    const msg = e instanceof Error ? e.message : String(e)
    process.stderr.write(`tm: log read failed: ${msg}\n`)
    return []
  }
  const entries: LogEntry[] = []
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = logEntrySchema.parse(JSON.parse(line))
      if (parsed.ts >= sinceISO) {
        entries.push(parsed)
      }
    } catch {
      // Skip malformed lines
      continue
    }
  }
  return entries
}
