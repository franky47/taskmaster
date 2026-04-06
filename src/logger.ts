import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import { logFilePath } from './config'

// Types --

type LogEntry =
  | { event: 'started'; task: string; trigger: 'manual' | 'tick' }
  | { event: 'skipped'; task: string; reason: 'contention' }
  | { event: 'error'; task: string; error: Error }

export type { LogEntry }

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

function serializeEntry(entry: LogEntry): Record<string, unknown> {
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

export function log(entry: LogEntry, target = logFilePath): void {
  try {
    mkdirSync(path.dirname(target), { recursive: true })
    appendFileSync(target, JSON.stringify(serializeEntry(entry)) + '\n')
  } catch {
    // best-effort: logging must never break the program
  }
}
