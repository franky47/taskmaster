import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import { CronExpressionParser } from 'cron-parser'
import matter from 'gray-matter'

import type { ParseError, ParseResult } from './types.ts'

const TASK_NAME_RE = /^[a-z0-9-]+$/

const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'))

export async function parseTaskFile(filePath: string): Promise<ParseResult> {
  const filename = basename(filePath)
  const content = await readFile(filePath, 'utf-8')
  return parseTaskContent(filename, content)
}

export function parseTaskContent(
  filename: string,
  content: string,
): ParseResult {
  const errors: ParseError[] = []

  // Validate filename
  const name = filename.replace(/\.md$/, '')
  if (!TASK_NAME_RE.test(name)) {
    errors.push({
      field: 'filename',
      message: `Task name "${name}" must match [a-z0-9-]+`,
    })
  }

  // Parse frontmatter
  let data: Record<string, unknown>
  let body: string
  try {
    const parsed = matter(content)
    data = parsed.data as Record<string, unknown>
    body = parsed.content.trim()
  } catch {
    return {
      ok: false,
      errors: [
        ...errors,
        { field: 'frontmatter', message: 'Failed to parse YAML frontmatter' },
      ],
    }
  }

  // Validated values accumulated during checks
  let schedule: string | undefined
  let timezone: string | undefined
  let cwd: string | undefined
  let claudeArgs: string[] | undefined
  let env: Record<string, string> | undefined
  let enabled: boolean | undefined

  // Validate schedule (required)
  if (data.schedule === undefined || data.schedule === null) {
    errors.push({ field: 'schedule', message: 'schedule is required' })
  } else if (typeof data.schedule !== 'string') {
    errors.push({ field: 'schedule', message: 'schedule must be a string' })
  } else {
    const fields = data.schedule.trim().split(/\s+/)
    if (fields.length !== 5) {
      errors.push({
        field: 'schedule',
        message: `schedule must be a 5-field cron expression, got ${fields.length} fields`,
      })
    } else {
      try {
        CronExpressionParser.parse(data.schedule)
        schedule = data.schedule
      } catch (err) {
        errors.push({
          field: 'schedule',
          message: `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }
  }

  // Validate timezone (optional)
  if (data.timezone !== undefined) {
    if (typeof data.timezone !== 'string') {
      errors.push({ field: 'timezone', message: 'timezone must be a string' })
    } else if (!VALID_TIMEZONES.has(data.timezone)) {
      errors.push({
        field: 'timezone',
        message: `"${data.timezone}" is not a valid IANA timezone`,
      })
    } else {
      timezone = data.timezone
    }
  }

  // Validate cwd (optional)
  if (data.cwd !== undefined) {
    if (typeof data.cwd !== 'string') {
      errors.push({ field: 'cwd', message: 'cwd must be a string' })
    } else {
      cwd = data.cwd
    }
  }

  // Validate claude_args (optional)
  if (data.claude_args !== undefined) {
    if (!Array.isArray(data.claude_args)) {
      errors.push({
        field: 'claude_args',
        message: 'claude_args must be an array',
      })
    } else if (!data.claude_args.every((v: unknown) => typeof v === 'string')) {
      errors.push({
        field: 'claude_args',
        message: 'All claude_args values must be strings',
      })
    } else {
      claudeArgs = data.claude_args
    }
  }

  // Validate env (optional)
  if (data.env !== undefined) {
    if (
      typeof data.env !== 'object' ||
      data.env === null ||
      Array.isArray(data.env)
    ) {
      errors.push({ field: 'env', message: 'env must be an object' })
    } else {
      const envObj = data.env as Record<string, unknown>
      if (!Object.values(envObj).every((v) => typeof v === 'string')) {
        errors.push({ field: 'env', message: 'All env values must be strings' })
      } else {
        env = envObj as Record<string, string>
      }
    }
  }

  // Validate enabled (optional)
  if (data.enabled !== undefined) {
    if (typeof data.enabled !== 'boolean') {
      errors.push({ field: 'enabled', message: 'enabled must be a boolean' })
    } else {
      enabled = data.enabled
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    task: {
      name,
      schedule: schedule!,
      timezone,
      cwd,
      claudeArgs: claudeArgs ?? [],
      env: env ?? {},
      enabled: enabled ?? true,
      prompt: body,
    },
  }
}
