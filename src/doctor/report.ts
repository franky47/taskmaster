import { toDisplayForm } from '#lib/task/name'

import type { Finding } from './checks'

type Platform = 'darwin' | 'linux'

const SEVERITY_ORDER = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
} as const

function sortBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
}

function schedulerCheckCommand(platform: Platform): string {
  return platform === 'darwin'
    ? 'launchctl list | grep taskmaster'
    : 'crontab -l'
}

function renderFinding(finding: Finding, platform: Platform): string {
  switch (finding.kind) {
    case 'heartbeat-stale':
      return [
        `## Scheduler not ticking [${finding.severity}]`,
        '',
        `Last heartbeat: ${finding.heartbeatTime} (${finding.relativeTime})`,
        '',
        'Investigate:',
        `  ${schedulerCheckCommand(platform)}`,
        '  tm tick',
      ].join('\n')

    case 'heartbeat-missing':
      return [
        `## Scheduler never ticked [${finding.severity}]`,
        '',
        'No heartbeat file found. The scheduler has never run.',
        '',
        'Investigate:',
        `  ${schedulerCheckCommand(platform)}`,
        '  tm setup',
      ].join('\n')

    case 'scheduler-not-installed':
      return [
        `## Scheduler not installed [${finding.severity}]`,
        '',
        `No system scheduler found (${finding.platform === 'darwin' ? 'launchd' : 'crontab'}).`,
        '',
        'Fix:',
        '  tm setup',
        '',
        'Verify:',
        `  ${schedulerCheckCommand(finding.platform)}`,
      ].join('\n')

    case 'task-failures': {
      const t = toDisplayForm(finding.task)
      const lines = [
        `## Task failing: ${t} [${finding.severity}]`,
        '',
        `${finding.consecutiveFailures} consecutive failure${finding.consecutiveFailures === 1 ? '' : 's'}, exit code ${finding.exitCode}`,
        `Last failure: ${finding.lastFailureTimestamp} (${finding.relativeTime})`,
      ]
      if (finding.output_path) {
        lines.push('', `Output: ${finding.output_path}`)
      }
      if (finding.runDir) {
        lines.push(`Run dir: ${finding.runDir}`)
      }
      lines.push('', 'Investigate:', `  tm history ${t} --failures --last 5`)
      return lines.join('\n')
    }

    case 'task-validation': {
      const t = toDisplayForm(finding.task)
      return [
        `## Invalid task: ${t} [${finding.severity}]`,
        '',
        ...finding.errors.map((e) => `- ${e}`),
        '',
        'Fix the task file and re-validate:',
        '  tm validate',
      ].join('\n')
    }

    case 'task-never-ran': {
      const t = toDisplayForm(finding.task)
      return [
        `## Task never ran: ${t} [${finding.severity}]`,
        '',
        `Task is enabled but has no run history.`,
        '',
        'Investigate:',
        `  tm history ${t}`,
        `  tm run ${t}`,
      ].join('\n')
    }

    case 'contention': {
      const t = toDisplayForm(finding.task)
      return [
        `## Task contention: ${t} [${finding.severity}]`,
        '',
        `${finding.eventCount} skipped execution${finding.eventCount === 1 ? '' : 's'} due to contention.`,
        'The task may be running longer than its schedule interval.',
        '',
        'Investigate:',
        `  tm history ${t}`,
      ].join('\n')
    }

    case 'task-timeout': {
      const t = toDisplayForm(finding.task)
      const lines = [
        `## Task timing out: ${t} [${finding.severity}]`,
        '',
        `${finding.consecutiveTimeouts} consecutive timeout${finding.consecutiveTimeouts === 1 ? '' : 's'}`,
        `Last timeout: ${finding.lastTimeoutTimestamp} (${finding.relativeTime})`,
      ]
      if (finding.timeout) {
        lines.push(`Configured timeout: ${finding.timeout}`)
      }
      lines.push(
        '',
        'Consider increasing the timeout or investigating why the task is slow.',
        '',
        'Investigate:',
        `  tm history ${t} --failures --last 5`,
      )
      return lines.join('\n')
    }

    case 'timeout-contention': {
      const t = toDisplayForm(finding.task)
      return [
        `## Timeout exceeds schedule: ${t} [${finding.severity}]`,
        '',
        `Timeout (${finding.timeout}) meets or exceeds the schedule interval (${finding.schedule}).`,
        'A timed-out run is guaranteed to cause contention with the next scheduled run.',
        '',
        'Fix:',
        '  Increase the schedule interval or decrease the timeout.',
      ].join('\n')
    }

    case 'offline-skips': {
      const t = toDisplayForm(finding.task)
      return [
        `## Offline skips: ${t} [${finding.severity}]`,
        '',
        `${finding.skipCount} skipped execution${finding.skipCount === 1 ? '' : 's'} due to offline connectivity.`,
        '',
        'Hint:',
        `  Set \`requires: []\` if this task can run without network.`,
      ].join('\n')
    }

    case 'consecutive-requirement-skips': {
      const t = toDisplayForm(finding.task)
      return [
        `## Chronically blocked: ${t} [${finding.severity}]`,
        '',
        `${finding.consecutiveSkips} consecutive skip${finding.consecutiveSkips === 1 ? '' : 's'} — requirement \`${finding.requirement}\` unmet.`,
        '',
        'Investigate:',
        `  Check whether \`${finding.requirement}\` is reachable, or drop it from this task's \`requires\`.`,
      ].join('\n')
    }

    case 'log-error': {
      const t = toDisplayForm(finding.task)
      const name =
        typeof finding.error['name'] === 'string'
          ? finding.error['name']
          : 'Error'
      const message =
        typeof finding.error['message'] === 'string'
          ? finding.error['message']
          : 'unknown'
      return [
        `## Log error: ${t} [${finding.severity}]`,
        '',
        `${name}: ${message}`,
        `At: ${finding.ts}`,
      ].join('\n')
    }

    case 'internal-error':
      return [
        `## Internal error: ${finding.source} [${finding.severity}]`,
        '',
        finding.message,
      ].join('\n')

    case 'chronic-preflight-error': {
      const t = toDisplayForm(finding.task)
      return [
        `## Preflight chronically failing: ${t} [${finding.severity}]`,
        '',
        `${finding.consecutiveErrors} consecutive preflight-error runs.`,
        `Last error: ${finding.lastErrorTimestamp} (${finding.relativeTime})`,
        '',
        'Investigate:',
        `  tm history ${t} --failures --last 5`,
      ].join('\n')
    }

    case 'stale-preflight-success': {
      const t = toDisplayForm(finding.task)
      return [
        `## Preflight task stale: ${t} [${finding.severity}]`,
        '',
        `Last successful run was ${finding.lastSuccessTimestamp}, more than ${finding.thresholdDays} days ago.`,
        'Either the preflight gate is silently broken, or the trigger is no longer firing.',
        '',
        'Investigate:',
        `  tm history ${t} --last 10`,
      ].join('\n')
    }
  }
}

export function renderReport(
  findings: Finding[],
  checkedAt: Date,
  platform: Platform,
): string {
  const header = `Checked at: ${checkedAt.toISOString()}`

  if (findings.length === 0) {
    return `${header}\n\nAll systems operational.\n`
  }

  const sorted = sortBySeverity(findings)
  const sections = sorted.map((f) => renderFinding(f, platform))

  return `${header}\n\n${sections.join('\n\n')}\n`
}
