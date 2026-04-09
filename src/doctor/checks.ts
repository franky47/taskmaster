import path from 'node:path'

import ms from 'ms'

import type { HistoryEntry } from '#src/history'
import type { LogEntry } from '#src/logger'
import { minCronIntervalMs } from '#src/schedule'
import type { ValidationResult } from '#src/validate'

// Finding types --

type LogErrorFinding = {
  kind: 'log-error'
  severity: 'info'
  task: string
  error: Record<string, unknown>
  ts: string
}

type HeartbeatStaleFinding = {
  kind: 'heartbeat-stale'
  severity: 'critical'
  heartbeatTime: string
  relativeTime: string
}

type HeartbeatMissingFinding = {
  kind: 'heartbeat-missing'
  severity: 'critical'
}

type SchedulerNotInstalledFinding = {
  kind: 'scheduler-not-installed'
  severity: 'critical'
  platform: 'darwin' | 'linux'
}

type TaskFailureFinding = {
  kind: 'task-failures'
  severity: 'critical' | 'warning'
  task: string
  consecutiveFailures: number
  lastFailureTimestamp: string
  relativeTime: string
  exitCode: number
  output_path: string | undefined
  runDir: string | undefined
}

type TaskValidationFinding = {
  kind: 'task-validation'
  severity: 'error'
  task: string
  errors: string[]
}

type TaskNeverRanFinding = {
  kind: 'task-never-ran'
  severity: 'warning'
  task: string
}

type ContentionFinding = {
  kind: 'contention'
  severity: 'warning'
  task: string
  eventCount: number
}

type TaskTimeoutFinding = {
  kind: 'task-timeout'
  severity: 'critical' | 'warning'
  task: string
  consecutiveTimeouts: number
  lastTimeoutTimestamp: string
  relativeTime: string
  timeout: string | undefined
}

type TimeoutContentionFinding = {
  kind: 'timeout-contention'
  severity: 'warning'
  task: string
  timeout: string
  schedule: string
}

type OfflineSkipsFinding = {
  kind: 'offline-skips'
  severity: 'warning'
  task: string
  skipCount: number
}

export type Finding =
  | LogErrorFinding
  | HeartbeatStaleFinding
  | HeartbeatMissingFinding
  | SchedulerNotInstalledFinding
  | TaskFailureFinding
  | TaskValidationFinding
  | TaskNeverRanFinding
  | ContentionFinding
  | TaskTimeoutFinding
  | TimeoutContentionFinding
  | OfflineSkipsFinding

// Helpers --

const rtf = new Intl.RelativeTimeFormat('en', {
  style: 'narrow',
  numeric: 'auto',
})

export function formatRelativeTime(from: Date, to: Date): string {
  const diffMs = to.getTime() - from.getTime()
  const totalMinutes = Math.floor(diffMs / 60_000)
  const totalHours = Math.floor(totalMinutes / 60)
  const totalDays = Math.floor(totalHours / 24)

  if (totalDays >= 1) return rtf.format(-totalDays, 'day')
  if (totalHours >= 1) return rtf.format(-totalHours, 'hour')
  if (totalMinutes >= 1) return rtf.format(-totalMinutes, 'minute')
  return rtf.format(0, 'second')
}

// Check functions --

// Heartbeat staleness threshold: the scheduler is configured to tick every
// minute, so 5 minutes means 5 missed ticks — enough to rule out transient delays.
const HEARTBEAT_STALE_THRESHOLD_MS = 5 * 60_000

export function checkHeartbeat(
  heartbeatTime: Date | null,
  now: Date,
): HeartbeatStaleFinding | HeartbeatMissingFinding | null {
  if (heartbeatTime === null) {
    return { kind: 'heartbeat-missing', severity: 'critical' }
  }
  const ageMs = now.getTime() - heartbeatTime.getTime()
  if (ageMs <= HEARTBEAT_STALE_THRESHOLD_MS) return null
  return {
    kind: 'heartbeat-stale',
    severity: 'critical',
    heartbeatTime: heartbeatTime.toISOString(),
    relativeTime: formatRelativeTime(heartbeatTime, now),
  }
}

export function checkSchedulerInstalled(
  platform: 'darwin' | 'linux',
  schedulerPresent: boolean,
): SchedulerNotInstalledFinding | null {
  if (schedulerPresent) return null
  return { kind: 'scheduler-not-installed', severity: 'critical', platform }
}

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

const CRITICAL_FAILURE_THRESHOLD = 3

export function checkTaskFailures(
  taskName: string,
  history: HistoryEntry[],
  now: Date,
): TaskFailureFinding | null {
  const first = history[0]
  if (first === undefined || first.success || first.timed_out) return null

  let consecutiveFailures = 0
  for (const entry of history) {
    if (entry.success || entry.timed_out) break
    consecutiveFailures++
  }

  return {
    kind: 'task-failures',
    severity:
      consecutiveFailures >= CRITICAL_FAILURE_THRESHOLD
        ? 'critical'
        : 'warning',
    task: taskName,
    consecutiveFailures,
    lastFailureTimestamp: first.finished_at.toISOString(),
    relativeTime: formatRelativeTime(first.finished_at, now),
    exitCode: first.exit_code,
    output_path: first.output_path,
    runDir: first.output_path ? path.dirname(first.output_path) : undefined,
  }
}

export function checkTaskTimeouts(
  taskName: string,
  history: HistoryEntry[],
  timeoutMs: number | undefined,
  now: Date,
): TaskTimeoutFinding | null {
  const first = history[0]
  if (first === undefined || first.success || !first.timed_out) return null

  let consecutiveTimeouts = 0
  for (const entry of history) {
    if (!entry.timed_out) break
    consecutiveTimeouts++
  }

  return {
    kind: 'task-timeout',
    severity:
      consecutiveTimeouts >= CRITICAL_FAILURE_THRESHOLD
        ? 'critical'
        : 'warning',
    task: taskName,
    consecutiveTimeouts,
    lastTimeoutTimestamp: first.finished_at.toISOString(),
    relativeTime: formatRelativeTime(first.finished_at, now),
    timeout: timeoutMs !== undefined ? ms(timeoutMs) : undefined,
  }
}

export function checkTimeoutContention(
  taskName: string,
  timeoutMs: number | undefined,
  schedule: string,
): TimeoutContentionFinding | null {
  if (timeoutMs === undefined) return null

  const minInterval = minCronIntervalMs(schedule)
  if (timeoutMs < minInterval) return null

  return {
    kind: 'timeout-contention',
    severity: 'warning',
    task: taskName,
    timeout: ms(timeoutMs),
    schedule,
  }
}

export function checkTaskValidation(
  results: ValidationResult[],
): TaskValidationFinding[] {
  const findings: TaskValidationFinding[] = []
  for (const result of results) {
    if (!result.valid) {
      findings.push({
        kind: 'task-validation',
        severity: 'error',
        task: result.name,
        errors: result.errors,
      })
    }
  }
  return findings
}

export function checkTaskNeverRan(
  taskName: string,
  enabled: false | 'when-online' | 'always',
  historyLength: number,
): TaskNeverRanFinding | null {
  if (enabled === false || historyLength > 0) return null
  return { kind: 'task-never-ran', severity: 'warning', task: taskName }
}

export function checkOfflineSkips(
  taskName: string,
  entries: LogEntry[],
): OfflineSkipsFinding | null {
  let count = 0
  for (const entry of entries) {
    if (entry.event === 'skipped' && entry.reason === 'offline') {
      count++
    }
  }
  if (count === 0) return null
  return {
    kind: 'offline-skips',
    severity: 'warning',
    task: taskName,
    skipCount: count,
  }
}

export function checkContention(
  taskName: string,
  entries: LogEntry[],
): ContentionFinding | null {
  let count = 0
  for (const entry of entries) {
    if (entry.event === 'skipped' && entry.reason === 'contention') {
      count++
    }
  }
  if (count === 0) return null
  return {
    kind: 'contention',
    severity: 'warning',
    task: taskName,
    eventCount: count,
  }
}
