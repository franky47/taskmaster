import fs from 'node:fs/promises'
import path from 'node:path'

import { configDir, tasksDir } from '#lib/config'
import { readLog } from '#lib/logger'
import type { LogEntry } from '#lib/logger'
import { queryHistory } from '#src/history'
import type { HistoryEntry } from '#src/history'
import { listTasks } from '#src/list'
import type { TaskListEntry } from '#src/list'
import { isSchedulerInstalled } from '#src/setup'
import { validateTasks } from '#src/validate'
import type { ValidationResult } from '#src/validate'

import {
  checkConsecutiveRequirementSkips,
  checkContention,
  checkHeartbeat,
  checkLogErrors,
  checkOfflineSkips,
  checkSchedulerInstalled,
  checkTaskFailures,
  checkTaskNeverRan,
  checkTaskTimeouts,
  checkTaskValidation,
  checkTimeoutContention,
} from './checks'
import type { Finding } from './checks'
import { renderReport } from './report'

// Types --

export type DoctorDeps = {
  readHeartbeat: () => Promise<Date | null>
  listTasks: () => Promise<TaskListEntry[] | Error>
  validateTasks: () => Promise<ValidationResult[] | Error>
  queryHistory: (taskName: string) => Promise<HistoryEntry[] | Error>
  readLog: (since: Date) => LogEntry[]
  isSchedulerInstalled: () => Promise<boolean>
}

type DoctorOptions = {
  since?: Date
  now?: Date
  platform?: 'darwin' | 'linux'
  deps?: Partial<DoctorDeps>
}

type DoctorResult =
  | { ok: true; message: string }
  | { ok: false; report: string }

// Default dep implementations --

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000

async function defaultReadHeartbeat(): Promise<Date | null> {
  const heartbeatPath = path.join(configDir, 'heartbeat')
  try {
    const content = await fs.readFile(heartbeatPath, 'utf-8')
    const date = new Date(content.trim())
    return isNaN(date.getTime()) ? null : date
  } catch {
    return null
  }
}

// Public API --

export async function doctor(options?: DoctorOptions): Promise<DoctorResult> {
  const now = options?.now ?? new Date()
  const since = options?.since ?? new Date(now.getTime() - SEVEN_DAYS_MS)
  const platform =
    options?.platform ?? (process.platform === 'darwin' ? 'darwin' : 'linux')

  const deps: DoctorDeps = {
    readHeartbeat: options?.deps?.readHeartbeat ?? defaultReadHeartbeat,
    listTasks:
      options?.deps?.listTasks ??
      (async () => {
        const result = await listTasks(tasksDir)
        if (result instanceof Error) return result
        return result.tasks
      }),
    validateTasks:
      options?.deps?.validateTasks ?? (() => validateTasks(tasksDir)),
    queryHistory: options?.deps?.queryHistory ?? ((name) => queryHistory(name)),
    readLog: options?.deps?.readLog ?? readLog,
    isSchedulerInstalled:
      options?.deps?.isSchedulerInstalled ?? isSchedulerInstalled,
  }

  const findings: Finding[] = []

  // Global checks (run in parallel)
  const [
    heartbeatTime,
    schedulerPresent,
    logEntries,
    validationResults,
    tasks,
  ] = await Promise.all([
    deps.readHeartbeat(),
    deps.isSchedulerInstalled(),
    Promise.resolve(deps.readLog(since)),
    deps.validateTasks(),
    deps.listTasks(),
  ])

  // Heartbeat
  const heartbeatFinding = checkHeartbeat(heartbeatTime, now)
  if (heartbeatFinding) findings.push(heartbeatFinding)

  // Scheduler
  const schedulerFinding = checkSchedulerInstalled(platform, schedulerPresent)
  if (schedulerFinding) findings.push(schedulerFinding)

  // Log errors (global)
  findings.push(...checkLogErrors(logEntries))

  // Task validation
  if (validationResults instanceof Error) {
    findings.push({
      kind: 'internal-error',
      severity: 'critical',
      source: 'validateTasks',
      message: validationResults.message,
    })
  } else {
    findings.push(...checkTaskValidation(validationResults))
  }

  // Per-task checks
  if (tasks instanceof Error) {
    findings.push({
      kind: 'internal-error',
      severity: 'critical',
      source: 'listTasks',
      message: tasks.message,
    })
  } else {
    for (const task of tasks) {
      const history = await deps.queryHistory(task.name)
      if (history instanceof Error) {
        findings.push({
          kind: 'internal-error',
          severity: 'critical',
          source: 'queryHistory',
          message: `${task.name}: ${history.message}`,
        })
        continue
      }

      const failureFinding = checkTaskFailures(task.name, history, now)
      if (failureFinding) findings.push(failureFinding)

      const timeoutFinding = checkTaskTimeouts(
        task.name,
        history,
        task.timeout,
        now,
      )
      if (timeoutFinding) findings.push(timeoutFinding)

      if ('schedule' in task.on) {
        const timeoutContentionFinding = checkTimeoutContention(
          task.name,
          task.timeout,
          task.on.schedule,
        )
        if (timeoutContentionFinding) findings.push(timeoutContentionFinding)
      }

      if ('schedule' in task.on) {
        const neverRanFinding = checkTaskNeverRan(
          task.name,
          task.enabled,
          history.length,
        )
        if (neverRanFinding) findings.push(neverRanFinding)
      }

      const taskLogEntries = logEntries.filter((e) => e.task === task.name)
      const contentionFinding = checkContention(task.name, taskLogEntries)
      if (contentionFinding) findings.push(contentionFinding)

      const offlineSkipsFinding = checkOfflineSkips(task.name, taskLogEntries)
      if (offlineSkipsFinding) findings.push(offlineSkipsFinding)

      findings.push(
        ...checkConsecutiveRequirementSkips(task.name, taskLogEntries),
      )
    }
  }

  if (findings.length === 0) {
    return { ok: true, message: 'All systems operational' }
  }

  return { ok: false, report: renderReport(findings, now, platform) }
}
