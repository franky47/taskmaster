import { describe, expect, test } from 'bun:test'

import type { FieldError } from './types.ts'
import {
  collect,
  fail,
  validateClaudeArgs,
  validateCwd,
  validateEnabled,
  validateEnv,
  validateFilename,
  validateSchedule,
  validateTimezone,
} from './validators.ts'

describe('collect', () => {
  test('returns value for non-failure result', () => {
    const errors: FieldError[] = []
    expect(collect('hello', errors)).toBe('hello')
    expect(errors).toEqual([])
  })

  test('pushes errors and returns undefined for failure', () => {
    const errors: FieldError[] = []
    const result = collect(fail({ field: 'schedule', message: 'bad' }), errors)
    expect(result).toBeUndefined()
    expect(errors).toEqual([{ field: 'schedule', message: 'bad' }])
  })

  test('passes through undefined as a value', () => {
    const errors: FieldError[] = []
    expect(collect(undefined, errors)).toBeUndefined()
    expect(errors).toEqual([])
  })

  test('passes through false as a value', () => {
    const errors: FieldError[] = []
    expect(collect(false, errors)).toBe(false)
    expect(errors).toEqual([])
  })

  test('passes through string array as a value', () => {
    const errors: FieldError[] = []
    expect(collect(['a', 'b'], errors)).toEqual(['a', 'b'])
    expect(errors).toEqual([])
  })

  test('accumulates errors from multiple calls', () => {
    const errors: FieldError[] = []
    collect(fail({ field: 'schedule', message: 'first' }), errors)
    collect(fail({ field: 'timezone', message: 'second' }), errors)
    expect(errors).toEqual([
      { field: 'schedule', message: 'first' },
      { field: 'timezone', message: 'second' },
    ])
  })
})

describe('validateFilename', () => {
  test('accepts lowercase with hyphens and digits', () => {
    expect(validateFilename('my-task-123')).toBe('my-task-123')
  })

  test('rejects uppercase letters', () => {
    expect(validateFilename('Bad-Name')).toEqual(
      fail({
        field: 'filename',
        message: 'Task name "Bad-Name" must match [a-z0-9-]+',
      }),
    )
  })

  test('rejects underscores', () => {
    expect(validateFilename('bad_name')).toEqual(
      fail({
        field: 'filename',
        message: 'Task name "bad_name" must match [a-z0-9-]+',
      }),
    )
  })

  test('rejects spaces', () => {
    expect(validateFilename('bad name')).toEqual(
      fail({
        field: 'filename',
        message: 'Task name "bad name" must match [a-z0-9-]+',
      }),
    )
  })
})

describe('validateSchedule', () => {
  test('accepts valid 5-field cron', () => {
    expect(validateSchedule('0 8 * * 1-5')).toBe('0 8 * * 1-5')
  })

  test('accepts every-minute cron', () => {
    expect(validateSchedule('* * * * *')).toBe('* * * * *')
  })

  test('rejects undefined', () => {
    expect(validateSchedule(undefined)).toEqual(
      fail({ field: 'schedule', message: 'schedule is required' }),
    )
  })

  test('rejects null', () => {
    expect(validateSchedule(null)).toEqual(
      fail({ field: 'schedule', message: 'schedule is required' }),
    )
  })

  test('rejects non-string', () => {
    expect(validateSchedule(12345)).toEqual(
      fail({ field: 'schedule', message: 'schedule must be a string' }),
    )
  })

  test('rejects 6-field cron', () => {
    const result = validateSchedule('0 0 8 * * 1-5')
    expect(result).toHaveProperty('_tag', 'validation_failure')
    if (typeof result === 'string') return
    expect(result.errors[0]?.field).toBe('schedule')
    expect(result.errors[0]?.message).toContain('6 fields')
  })

  test('rejects malformed cron', () => {
    const result = validateSchedule('60 * * * *')
    expect(result).toHaveProperty('_tag', 'validation_failure')
    if (typeof result === 'string') return
    expect(result.errors[0]?.field).toBe('schedule')
    expect(result.errors[0]?.message).toContain('Invalid cron expression')
  })
})

describe('validateTimezone', () => {
  test('returns undefined when absent', () => {
    expect(validateTimezone(undefined)).toBeUndefined()
  })

  test('accepts valid IANA timezone', () => {
    expect(validateTimezone('Europe/Paris')).toBe('Europe/Paris')
  })

  test('accepts UTC', () => {
    expect(validateTimezone('UTC')).toBe('UTC')
  })

  test('rejects non-string', () => {
    expect(validateTimezone(123)).toEqual(
      fail({ field: 'timezone', message: 'timezone must be a string' }),
    )
  })

  test('rejects invalid timezone', () => {
    expect(validateTimezone('Mars/Olympus')).toEqual(
      fail({
        field: 'timezone',
        message: '"Mars/Olympus" is not a valid IANA timezone',
      }),
    )
  })
})

describe('validateCwd', () => {
  test('returns undefined when absent', () => {
    expect(validateCwd(undefined)).toBeUndefined()
  })

  test('accepts string', () => {
    expect(validateCwd('~/projects/app')).toBe('~/projects/app')
  })

  test('rejects non-string', () => {
    expect(validateCwd(42)).toEqual(
      fail({ field: 'cwd', message: 'cwd must be a string' }),
    )
  })
})

describe('validateClaudeArgs', () => {
  test('returns undefined when absent', () => {
    expect(validateClaudeArgs(undefined)).toBeUndefined()
  })

  test('accepts string array', () => {
    expect(validateClaudeArgs(['--model', 'sonnet'])).toEqual([
      '--model',
      'sonnet',
    ])
  })

  test('accepts empty array', () => {
    expect(validateClaudeArgs([])).toEqual([])
  })

  test('rejects non-array', () => {
    expect(validateClaudeArgs('not-an-array')).toEqual(
      fail({ field: 'claude_args', message: 'claude_args must be an array' }),
    )
  })

  test('rejects array with non-string elements', () => {
    expect(validateClaudeArgs(['--model', 42])).toEqual(
      fail({
        field: 'claude_args',
        message: 'All claude_args values must be strings',
      }),
    )
  })
})

describe('validateEnv', () => {
  test('returns undefined when absent', () => {
    expect(validateEnv(undefined)).toBeUndefined()
  })

  test('accepts string-valued object', () => {
    expect(validateEnv({ KEY: 'value', OTHER: 'val' })).toEqual({
      KEY: 'value',
      OTHER: 'val',
    })
  })

  test('accepts empty object', () => {
    expect(validateEnv({})).toEqual({})
  })

  test('rejects non-object', () => {
    expect(validateEnv('not-an-object')).toEqual(
      fail({ field: 'env', message: 'env must be an object' }),
    )
  })

  test('rejects array', () => {
    expect(validateEnv(['a', 'b'])).toEqual(
      fail({ field: 'env', message: 'env must be an object' }),
    )
  })

  test('rejects null', () => {
    expect(validateEnv(null)).toEqual(
      fail({ field: 'env', message: 'env must be an object' }),
    )
  })

  test('rejects non-string values', () => {
    expect(validateEnv({ KEY: 'ok', BAD: 123 })).toEqual(
      fail({ field: 'env', message: 'All env values must be strings' }),
    )
  })
})

describe('validateEnabled', () => {
  test('returns undefined when absent', () => {
    expect(validateEnabled(undefined)).toBeUndefined()
  })

  test('accepts true', () => {
    expect(validateEnabled(true)).toBe(true)
  })

  test('accepts false', () => {
    expect(validateEnabled(false)).toBe(false)
  })

  test('rejects string', () => {
    expect(validateEnabled('yes')).toEqual(
      fail({ field: 'enabled', message: 'enabled must be a boolean' }),
    )
  })

  test('rejects number', () => {
    expect(validateEnabled(1)).toEqual(
      fail({ field: 'enabled', message: 'enabled must be a boolean' }),
    )
  })
})
