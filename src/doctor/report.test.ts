import { describe, expect, test } from 'bun:test'

import type { Finding } from './checks'
import { renderReport } from './report'

const checkedAt = new Date('2026-04-07T12:00:00.000Z')

describe('renderReport', () => {
  test('starts with "Checked at" timestamp', () => {
    const report = renderReport([], checkedAt, 'darwin')
    expect(report).toStartWith('Checked at: 2026-04-07T12:00:00.000Z')
  })

  test('returns "All systems operational" when no findings', () => {
    const report = renderReport([], checkedAt, 'darwin')
    expect(report).toContain('All systems operational')
  })

  // -- Severity ordering --

  test('orders findings by severity: critical > error > warning > info', () => {
    const findings: Finding[] = [
      {
        kind: 'log-error',
        severity: 'info',
        task: 'sync',
        error: { name: 'E', message: 'fail' },
        ts: '2026-04-07T11:00:00.000Z',
      },
      { kind: 'task-never-ran', severity: 'warning', task: 'backup' },
      { kind: 'heartbeat-missing', severity: 'critical' },
      {
        kind: 'task-validation',
        severity: 'error',
        task: 'deploy',
        errors: ['schedule: invalid cron'],
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    const criticalPos = report.indexOf('[critical]')
    const errorPos = report.indexOf('[error]')
    const warningPos = report.indexOf('[warning]')
    const infoPos = report.indexOf('[info]')

    expect(criticalPos).toBeGreaterThan(-1)
    expect(errorPos).toBeGreaterThan(criticalPos)
    expect(warningPos).toBeGreaterThan(errorPos)
    expect(infoPos).toBeGreaterThan(warningPos)
  })

  // -- Heartbeat findings --

  test('renders heartbeat-stale finding', () => {
    const findings: Finding[] = [
      {
        kind: 'heartbeat-stale',
        severity: 'critical',
        heartbeatTime: '2026-04-07T08:23:00.000Z',
        relativeTime: '3h ago',
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('## Scheduler not ticking [critical]')
    expect(report).toContain('2026-04-07T08:23:00.000Z')
    expect(report).toContain('3h ago')
  })

  test('renders heartbeat-missing finding', () => {
    const findings: Finding[] = [
      { kind: 'heartbeat-missing', severity: 'critical' },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('## Scheduler never ticked [critical]')
  })

  // -- Scheduler findings --

  test('renders scheduler-not-installed finding with launchctl on darwin', () => {
    const findings: Finding[] = [
      {
        kind: 'scheduler-not-installed',
        severity: 'critical',
        platform: 'darwin',
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('## Scheduler not installed [critical]')
    expect(report).toContain('tm setup')
    expect(report).toContain('launchctl')
    expect(report).not.toContain('crontab')
  })

  test('renders scheduler-not-installed finding with crontab on linux', () => {
    const findings: Finding[] = [
      {
        kind: 'scheduler-not-installed',
        severity: 'critical',
        platform: 'linux',
      },
    ]

    const report = renderReport(findings, checkedAt, 'linux')
    expect(report).toContain('crontab')
    expect(report).not.toContain('launchctl')
  })

  // -- Task failure findings --

  test('renders critical task-failures with consecutive count and stderr path', () => {
    const findings: Finding[] = [
      {
        kind: 'task-failures',
        severity: 'critical',
        task: 'backup',
        consecutiveFailures: 5,
        lastFailureTimestamp: '2026-04-07T11:55:00.000Z',
        relativeTime: '5m ago',
        exitCode: 127,
        stderr_path:
          '/home/user/.config/taskmaster/history/backup/2026-04-07T11.55.00Z.stderr.txt',
        runDir: '/home/user/.config/taskmaster/history/backup',
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('[critical]')
    expect(report).toContain('backup')
    expect(report).toContain('5 consecutive failures')
    expect(report).toContain('exit code 127')
    expect(report).toContain('5m ago')
    expect(report).toContain('2026-04-07T11:55:00.000Z')
    expect(report).toContain(
      '/home/user/.config/taskmaster/history/backup/2026-04-07T11.55.00Z.stderr.txt',
    )
    expect(report).toContain('tm history backup --failures --last 5')
  })

  test('renders warning task-failures for single failure', () => {
    const findings: Finding[] = [
      {
        kind: 'task-failures',
        severity: 'warning',
        task: 'sync',
        consecutiveFailures: 1,
        lastFailureTimestamp: '2026-04-07T11:30:00.000Z',
        relativeTime: '30m ago',
        exitCode: 1,
        stderr_path: undefined,
        runDir: undefined,
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('[warning]')
    expect(report).toContain('sync')
    expect(report).toContain('1 consecutive failure')
    // No stderr path means no cat command
    expect(report).not.toContain('cat')
  })

  // -- Task validation findings --

  test('renders task-validation finding with error list', () => {
    const findings: Finding[] = [
      {
        kind: 'task-validation',
        severity: 'error',
        task: 'deploy',
        errors: ['schedule: invalid cron', 'agent: required'],
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('## Invalid task: deploy [error]')
    expect(report).toContain('schedule: invalid cron')
    expect(report).toContain('agent: required')
  })

  // -- Task never ran findings --

  test('renders task-never-ran finding', () => {
    const findings: Finding[] = [
      { kind: 'task-never-ran', severity: 'warning', task: 'backup' },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('## Task never ran: backup [warning]')
    expect(report).toContain('tm history backup')
    expect(report).toContain('tm run backup')
  })

  // -- Contention findings --

  test('renders contention finding with event count', () => {
    const findings: Finding[] = [
      {
        kind: 'contention',
        severity: 'warning',
        task: 'backup',
        eventCount: 7,
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('## Task contention: backup [warning]')
    expect(report).toContain('7')
    expect(report).toContain('tm history backup')
  })

  test('renders contention finding with singular form for 1 event', () => {
    const findings: Finding[] = [
      {
        kind: 'contention',
        severity: 'warning',
        task: 'backup',
        eventCount: 1,
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('1 skipped execution due')
    expect(report).not.toContain('executions')
  })

  // -- Task timeout findings --

  test('renders task-timeout finding with consecutive count and timeout value', () => {
    const findings: Finding[] = [
      {
        kind: 'task-timeout',
        severity: 'critical',
        task: 'backup',
        consecutiveTimeouts: 3,
        lastTimeoutTimestamp: '2026-04-07T11:55:00.000Z',
        relativeTime: '5m ago',
        timeout: '30s',
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('## Task timing out: backup [critical]')
    expect(report).toContain('3 consecutive timeouts')
    expect(report).toContain('2026-04-07T11:55:00.000Z')
    expect(report).toContain('5m ago')
    expect(report).toContain('Configured timeout: 30s')
    expect(report).toContain('tm history backup --failures --last 5')
  })

  test('renders task-timeout with singular form for 1 timeout', () => {
    const findings: Finding[] = [
      {
        kind: 'task-timeout',
        severity: 'warning',
        task: 'sync',
        consecutiveTimeouts: 1,
        lastTimeoutTimestamp: '2026-04-07T11:30:00.000Z',
        relativeTime: '30m ago',
        timeout: '5m',
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('1 consecutive timeout')
    expect(report).not.toContain('timeouts')
  })

  test('renders task-timeout without configured timeout when undefined', () => {
    const findings: Finding[] = [
      {
        kind: 'task-timeout',
        severity: 'warning',
        task: 'sync',
        consecutiveTimeouts: 1,
        lastTimeoutTimestamp: '2026-04-07T11:30:00.000Z',
        relativeTime: '30m ago',
        timeout: undefined,
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).not.toContain('Configured timeout')
  })

  // -- Timeout contention findings --

  test('renders timeout-contention finding', () => {
    const findings: Finding[] = [
      {
        kind: 'timeout-contention',
        severity: 'warning',
        task: 'backup',
        timeout: '10m',
        schedule: '*/5 * * * *',
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('## Timeout exceeds schedule: backup [warning]')
    expect(report).toContain('10m')
    expect(report).toContain('*/5 * * * *')
    expect(report).toContain('guaranteed to cause contention')
  })

  // -- Log error findings --

  test('renders log-error finding with timestamp and error details', () => {
    const findings: Finding[] = [
      {
        kind: 'log-error',
        severity: 'info',
        task: 'sync',
        error: { name: 'RunError', message: 'process exited with code 1' },
        ts: '2026-04-07T10:30:00.000Z',
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('[info]')
    expect(report).toContain('sync')
    expect(report).toContain('RunError')
    expect(report).toContain('process exited with code 1')
    expect(report).toContain('2026-04-07T10:30:00.000Z')
  })

  test('renders log-error with fallback when error.name/message are missing', () => {
    const findings: Finding[] = [
      {
        kind: 'log-error',
        severity: 'info',
        task: 'sync',
        error: {},
        ts: '2026-04-07T10:30:00.000Z',
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('Error: unknown')
  })

  // -- Platform-specific investigation commands --

  test('heartbeat-stale shows launchctl on darwin', () => {
    const findings: Finding[] = [
      {
        kind: 'heartbeat-stale',
        severity: 'critical',
        heartbeatTime: '2026-04-07T08:23:00.000Z',
        relativeTime: '3h ago',
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('launchctl')
    expect(report).not.toContain('crontab')
  })

  test('heartbeat-stale shows crontab on linux', () => {
    const findings: Finding[] = [
      {
        kind: 'heartbeat-stale',
        severity: 'critical',
        heartbeatTime: '2026-04-07T08:23:00.000Z',
        relativeTime: '3h ago',
      },
    ]

    const report = renderReport(findings, checkedAt, 'linux')
    expect(report).toContain('crontab')
    expect(report).not.toContain('launchctl')
  })

  // -- Multiple findings of same severity are stable --

  test('groups multiple findings correctly', () => {
    const findings: Finding[] = [
      { kind: 'heartbeat-missing', severity: 'critical' },
      {
        kind: 'scheduler-not-installed',
        severity: 'critical',
        platform: 'darwin',
      },
      { kind: 'task-never-ran', severity: 'warning', task: 'backup' },
      { kind: 'task-never-ran', severity: 'warning', task: 'sync' },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    const lines = report.split('\n')
    const headings = lines.filter((l) => l.startsWith('## '))

    expect(headings).toHaveLength(4)
    // Critical findings first
    expect(headings[0]).toContain('[critical]')
    expect(headings[1]).toContain('[critical]')
    // Then warnings
    expect(headings[2]).toContain('[warning]')
    expect(headings[3]).toContain('[warning]')
  })

  // -- Offline skip findings --

  test('renders offline-skips finding with skip count and hint', () => {
    const findings: Finding[] = [
      {
        kind: 'offline-skips',
        severity: 'warning',
        task: 'sync',
        skipCount: 5,
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('## Offline skips: sync [warning]')
    expect(report).toContain('5 skipped executions')
    expect(report).toContain("enabled: 'always'")
  })

  test('renders offline-skips with singular form for 1 skip', () => {
    const findings: Finding[] = [
      {
        kind: 'offline-skips',
        severity: 'warning',
        task: 'sync',
        skipCount: 1,
      },
    ]

    const report = renderReport(findings, checkedAt, 'darwin')
    expect(report).toContain('1 skipped execution due')
    expect(report).not.toContain('executions')
  })
})
