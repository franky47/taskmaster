import type { LogEntry } from '../logger'

// Finding types --

type LogErrorFinding = {
  kind: 'log-error'
  severity: 'info'
  task: string
  error: Record<string, unknown>
  ts: string
}

export type Finding = LogErrorFinding

// Check functions --

export function checkLogErrors(entries: LogEntry[]): Finding[] {
  const findings: Finding[] = []
  for (const entry of entries) {
    if (entry.event === 'error') {
      findings.push({
        kind: 'log-error',
        severity: 'info',
        task: entry.task,
        error: entry.error,
        ts: entry.ts,
      })
    }
  }
  return findings
}
