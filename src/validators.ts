import { CronExpressionParser } from 'cron-parser'
import * as errore from 'errore'

import type { FieldError } from './types.ts'

// ------------------------------------------------------------------
// ValidationFailure: tagged result for validator errors.
// Discriminated by _tag so collect() never confuses errors with values.
// ------------------------------------------------------------------

export type ValidationFailure = {
  readonly _tag: 'validation_failure'
  readonly errors: FieldError[]
}

export function fail(...errors: FieldError[]): ValidationFailure {
  return { _tag: 'validation_failure', errors }
}

// ------------------------------------------------------------------
// collect: partitions a validator result into errors or a value.
// ------------------------------------------------------------------

function isValidationFailure(result: unknown): result is ValidationFailure {
  if (typeof result !== 'object' || result === null) return false
  if (!('_tag' in result)) return false
  return result._tag === 'validation_failure'
}

export function collect<T>(
  result: ValidationFailure | T,
  errors: FieldError[],
): T | undefined {
  if (isValidationFailure(result)) {
    errors.push(...result.errors)
    return undefined
  }
  return result
}

// ------------------------------------------------------------------
// Type guards
// ------------------------------------------------------------------

function isStringArray(arr: unknown[]): arr is string[] {
  return arr.every((v): v is string => typeof v === 'string')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringRecord(
  obj: Record<string, unknown>,
): obj is Record<string, string> {
  return Object.values(obj).every((v): v is string => typeof v === 'string')
}

// ------------------------------------------------------------------
// Validators: pure functions, unknown in, ValidationFailure | T out.
// ------------------------------------------------------------------

const TASK_NAME_RE = /^[a-z0-9-]+$/

export function validateFilename(name: string): ValidationFailure | string {
  if (!TASK_NAME_RE.test(name)) {
    return fail({
      field: 'filename',
      message: `Task name "${name}" must match [a-z0-9-]+`,
    })
  }
  return name
}

export function validateSchedule(value: unknown): ValidationFailure | string {
  if (value === undefined || value === null) {
    return fail({ field: 'schedule', message: 'schedule is required' })
  }
  if (typeof value !== 'string') {
    return fail({ field: 'schedule', message: 'schedule must be a string' })
  }
  const fields = value.trim().split(/\s+/)
  if (fields.length !== 5) {
    return fail({
      field: 'schedule',
      message: `schedule must be a 5-field cron expression, got ${fields.length} fields`,
    })
  }
  const cronResult = errore.try({
    try: () => CronExpressionParser.parse(value),
    catch: (e) => e,
  })
  if (cronResult instanceof Error) {
    return fail({
      field: 'schedule',
      message: `Invalid cron expression: ${cronResult.message}`,
    })
  }
  return value
}

const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'))

export function validateTimezone(
  value: unknown,
): ValidationFailure | string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    return fail({ field: 'timezone', message: 'timezone must be a string' })
  }
  if (!VALID_TIMEZONES.has(value)) {
    return fail({
      field: 'timezone',
      message: `"${value}" is not a valid IANA timezone`,
    })
  }
  return value
}

export function validateCwd(
  value: unknown,
): ValidationFailure | string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    return fail({ field: 'cwd', message: 'cwd must be a string' })
  }
  return value
}

export function validateClaudeArgs(
  value: unknown,
): ValidationFailure | string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    return fail({
      field: 'claude_args',
      message: 'claude_args must be an array',
    })
  }
  if (!isStringArray(value)) {
    return fail({
      field: 'claude_args',
      message: 'All claude_args values must be strings',
    })
  }
  return value
}

export function validateEnv(
  value: unknown,
): ValidationFailure | Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!isPlainObject(value)) {
    return fail({ field: 'env', message: 'env must be an object' })
  }
  if (!isStringRecord(value)) {
    return fail({ field: 'env', message: 'All env values must be strings' })
  }
  return value
}

export function validateEnabled(
  value: unknown,
): ValidationFailure | boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    return fail({ field: 'enabled', message: 'enabled must be a boolean' })
  }
  return value
}
