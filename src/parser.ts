import fs from 'node:fs/promises'
import path from 'node:path'

import { CronExpressionParser } from 'cron-parser'
import * as errore from 'errore'
import matter from 'gray-matter'

import {
  TaskFileReadError,
  TaskParseError,
  type FieldError,
  type TaskDefinition,
} from './types.ts'

const TASK_NAME_RE = /^[a-z0-9-]+$/

const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'))

export async function parseTaskFile(
  filePath: string,
): Promise<TaskFileReadError | TaskParseError | TaskDefinition> {
  const content = await fs
    .readFile(filePath, 'utf-8')
    .catch((e) => new TaskFileReadError({ path: filePath, cause: e }))
  if (content instanceof Error) return content

  return parseTaskContent(path.basename(filePath), content)
}

export function parseTaskContent(
  filename: string,
  content: string,
): TaskParseError | TaskDefinition {
  const errors: FieldError[] = []

  const name = filename.replace(/\.md$/, '')
  if (!TASK_NAME_RE.test(name)) {
    errors.push({
      field: 'filename',
      message: `Task name "${name}" must match [a-z0-9-]+`,
    })
  }

  const frontmatter = errore.try({
    try: () => matter(content),
    catch: (e) =>
      new TaskParseError({
        taskName: name,
        fieldErrors: [
          ...errors,
          { field: 'frontmatter', message: 'Failed to parse YAML frontmatter' },
        ],
        cause: e,
      }),
  })
  if (frontmatter instanceof Error) return frontmatter

  const data = frontmatter.data as Record<string, unknown>
  const body = frontmatter.content.trim()

  const schedule = (() => {
    if (data.schedule === undefined || data.schedule === null) {
      errors.push({ field: 'schedule', message: 'schedule is required' })
      return undefined
    }
    if (typeof data.schedule !== 'string') {
      errors.push({ field: 'schedule', message: 'schedule must be a string' })
      return undefined
    }
    const fields = data.schedule.trim().split(/\s+/)
    if (fields.length !== 5) {
      errors.push({
        field: 'schedule',
        message: `schedule must be a 5-field cron expression, got ${fields.length} fields`,
      })
      return undefined
    }
    const scheduleStr = data.schedule
    const cronResult = errore.try({
      try: () => CronExpressionParser.parse(scheduleStr),
      catch: (e) => e,
    })
    if (cronResult instanceof Error) {
      errors.push({
        field: 'schedule',
        message: `Invalid cron expression: ${cronResult.message}`,
      })
      return undefined
    }
    return scheduleStr
  })()

  const timezone = (() => {
    if (data.timezone === undefined) return undefined
    if (typeof data.timezone !== 'string') {
      errors.push({ field: 'timezone', message: 'timezone must be a string' })
      return undefined
    }
    if (!VALID_TIMEZONES.has(data.timezone)) {
      errors.push({
        field: 'timezone',
        message: `"${data.timezone}" is not a valid IANA timezone`,
      })
      return undefined
    }
    return data.timezone
  })()

  const cwd = (() => {
    if (data.cwd === undefined) return undefined
    if (typeof data.cwd !== 'string') {
      errors.push({ field: 'cwd', message: 'cwd must be a string' })
      return undefined
    }
    return data.cwd
  })()

  const claudeArgs = (() => {
    if (data.claude_args === undefined) return undefined
    if (!Array.isArray(data.claude_args)) {
      errors.push({
        field: 'claude_args',
        message: 'claude_args must be an array',
      })
      return undefined
    }
    if (!data.claude_args.every((v: unknown) => typeof v === 'string')) {
      errors.push({
        field: 'claude_args',
        message: 'All claude_args values must be strings',
      })
      return undefined
    }
    return data.claude_args as string[]
  })()

  const env = (() => {
    if (data.env === undefined) return undefined
    if (
      typeof data.env !== 'object' ||
      data.env === null ||
      Array.isArray(data.env)
    ) {
      errors.push({ field: 'env', message: 'env must be an object' })
      return undefined
    }
    const envObj = data.env as Record<string, unknown>
    if (!Object.values(envObj).every((v) => typeof v === 'string')) {
      errors.push({ field: 'env', message: 'All env values must be strings' })
      return undefined
    }
    return envObj as Record<string, string>
  })()

  const enabled = (() => {
    if (data.enabled === undefined) return undefined
    if (typeof data.enabled !== 'boolean') {
      errors.push({ field: 'enabled', message: 'enabled must be a boolean' })
      return undefined
    }
    return data.enabled
  })()

  if (errors.length > 0 || schedule === undefined) {
    return new TaskParseError({ taskName: name, fieldErrors: errors })
  }

  return {
    name,
    schedule,
    timezone,
    cwd,
    claudeArgs: claudeArgs ?? [],
    env: env ?? {},
    enabled: enabled ?? true,
    prompt: body,
  }
}
