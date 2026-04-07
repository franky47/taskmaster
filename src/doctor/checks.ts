import type { LogEntry } from '../logger'

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

export type Finding =
  | LogErrorFinding
  | HeartbeatStaleFinding
  | HeartbeatMissingFinding
  | SchedulerNotInstalledFinding

// Helpers --

export function formatRelativeTime(from: Date, to: Date): string {
  const diffMs = to.getTime() - from.getTime()
  const totalMinutes = Math.floor(diffMs / 60_000)
  const totalHours = Math.floor(totalMinutes / 60)
  const totalDays = Math.floor(totalHours / 24)

  if (totalMinutes < 1) return 'just now'
  if (totalHours < 1) return `${totalMinutes}m ago`
  if (totalDays < 1) return `${totalHours}h ${totalMinutes % 60}m ago`
  return `${totalDays}d ${totalHours % 24}h ago`
}

// Check functions --

// Heartbeat staleness threshold: tick runs every 60s, so 5 minutes
// means 5 missed ticks — enough to rule out transient delays.
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
