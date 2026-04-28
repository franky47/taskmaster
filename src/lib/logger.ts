import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { isoNow, isoUtcSchema } from '#lib/observability-time'
import { REQUIREMENT_TOKENS } from '#lib/task'
import type { Requirement } from '#lib/task'

// Schema --

const startedEntrySchema = z.object({
  ts: isoUtcSchema,
  event: z.literal('started'),
  task: z.string(),
  trigger: z.enum(['manual', 'tick', 'dispatch']),
})

const skippedPlainEntrySchema = z.object({
  ts: isoUtcSchema,
  event: z.literal('skipped'),
  task: z.string(),
  reason: z.enum(['contention', 'disabled', 'preflight-skip']),
})

const preflightErrorEntrySchema = z.object({
  ts: isoUtcSchema,
  event: z.literal('error'),
  task: z.string(),
  reason: z.literal('preflight-error'),
})

const skippedRequirementEntrySchema = z.object({
  ts: isoUtcSchema,
  event: z.literal('skipped'),
  task: z.string(),
  reason: z.literal('requirement-unmet'),
  requirement: z.array(z.enum(REQUIREMENT_TOKENS)),
})

const errorEntrySchema = z.object({
  ts: isoUtcSchema,
  event: z.literal('error'),
  task: z.string(),
  error: z.record(z.string(), z.unknown()),
})

export const logEntrySchema = z.union([
  startedEntrySchema,
  skippedPlainEntrySchema,
  skippedRequirementEntrySchema,
  errorEntrySchema,
  preflightErrorEntrySchema,
])

// Types --

export type LogEntry = z.infer<typeof logEntrySchema>

type LogInput =
  | { event: 'started'; task: string; trigger: 'manual' | 'tick' | 'dispatch' }
  | {
      event: 'skipped'
      task: string
      reason: 'contention' | 'disabled' | 'preflight-skip'
    }
  | {
      event: 'skipped'
      task: string
      reason: 'requirement-unmet'
      requirement: Requirement[]
    }
  | { event: 'error'; task: string; error: Error }
  | { event: 'error'; task: string; reason: 'preflight-error' }

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
  if (entry.event === 'error' && 'error' in entry) {
    return {
      ts: isoNow(),
      ...entry,
      error: serializeError(entry.error),
    }
  }
  return { ts: isoNow(), ...entry }
}

// Public API --

export function log(entry: LogInput, target: string): void {
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

export function readLog(since: Date, logPath: string): LogEntry[] {
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
