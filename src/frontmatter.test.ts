import { describe, expect, test } from 'bun:test'

import { z, type ZodSafeParseError } from 'zod'

import { filenameSchema, frontmatterSchema } from './frontmatter.ts'

function fieldErrors<Schema>(result: ZodSafeParseError<Schema>) {
  return z.flattenError(result.error).fieldErrors
}

describe('filenameSchema', () => {
  test('accepts lowercase with hyphens and digits', () => {
    expect(filenameSchema.safeParse('my-task-123').success).toBe(true)
  })

  test('rejects uppercase letters', () => {
    const result = filenameSchema.safeParse('Bad-Name')
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]!.message).toContain('must match [a-z0-9-]+')
  })

  test('rejects underscores', () => {
    expect(filenameSchema.safeParse('bad_name').success).toBe(false)
  })

  test('rejects spaces', () => {
    expect(filenameSchema.safeParse('bad name').success).toBe(false)
  })
})

describe('frontmatterSchema', () => {
  describe('schedule', () => {
    test('accepts valid 5-field cron', () => {
      const result = frontmatterSchema.safeParse({ schedule: '0 8 * * 1-5' })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.schedule).toBe('0 8 * * 1-5')
    })

    test('accepts every-minute cron', () => {
      const result = frontmatterSchema.safeParse({ schedule: '* * * * *' })
      expect(result.success).toBe(true)
    })

    test('rejects missing schedule', () => {
      const result = frontmatterSchema.safeParse({})
      expect(result.success).toBe(false)
      if (result.success) return
      expect(fieldErrors(result).schedule).toContain('schedule is required')
    })

    test('rejects null schedule', () => {
      const result = frontmatterSchema.safeParse({ schedule: null })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(fieldErrors(result).schedule).toContain('schedule is required')
    })

    test('rejects non-string schedule', () => {
      const result = frontmatterSchema.safeParse({ schedule: 12345 })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(fieldErrors(result).schedule).toContain(
        'schedule must be a string',
      )
    })

    test('rejects 6-field cron', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 0 8 * * 1-5',
      })
      expect(result.success).toBe(false)
      if (result.success) return
      const msgs = fieldErrors(result).schedule ?? []
      expect(msgs.some((m) => m.includes('6 fields'))).toBe(true)
    })

    test('rejects malformed cron', () => {
      const result = frontmatterSchema.safeParse({ schedule: '60 * * * *' })
      expect(result.success).toBe(false)
      if (result.success) return
      const msgs = fieldErrors(result).schedule ?? []
      expect(msgs.some((m) => m.includes('Invalid cron expression'))).toBe(true)
    })
  })

  describe('timezone', () => {
    test('accepts valid IANA timezone', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        timezone: 'Europe/Paris',
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.timezone).toBe('Europe/Paris')
    })

    test('accepts UTC', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        timezone: 'UTC',
      })
      expect(result.success).toBe(true)
    })

    test('allows missing timezone', () => {
      const result = frontmatterSchema.safeParse({ schedule: '0 8 * * *' })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.timezone).toBeUndefined()
    })

    test('rejects non-string timezone', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        timezone: 123,
      })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(fieldErrors(result).timezone).toContain(
        'timezone must be a string',
      )
    })

    test('rejects invalid timezone', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        timezone: 'Mars/Olympus',
      })
      expect(result.success).toBe(false)
      if (result.success) return
      const msgs = fieldErrors(result).timezone ?? []
      expect(msgs.some((m) => m.includes('Mars/Olympus'))).toBe(true)
    })
  })

  describe('cwd', () => {
    test('allows missing cwd', () => {
      const result = frontmatterSchema.safeParse({ schedule: '0 8 * * *' })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.cwd).toBeUndefined()
    })

    test('accepts string cwd', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        cwd: '~/projects/app',
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.cwd).toBe('~/projects/app')
    })

    test('rejects non-string cwd', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        cwd: 42,
      })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(fieldErrors(result).cwd).toContain('cwd must be a string')
    })
  })

  describe('claude_args', () => {
    test('allows missing claude_args', () => {
      const result = frontmatterSchema.safeParse({ schedule: '0 8 * * *' })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.claude_args).toBeUndefined()
    })

    test('accepts string array', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        claude_args: ['--model', 'sonnet'],
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.claude_args).toEqual(['--model', 'sonnet'])
    })

    test('accepts empty array', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        claude_args: [],
      })
      expect(result.success).toBe(true)
    })

    test('rejects non-array', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        claude_args: 'not-an-array',
      })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(fieldErrors(result).claude_args).toContain(
        'claude_args must be an array',
      )
    })

    test('rejects array with non-string elements', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        claude_args: ['--model', 42],
      })
      expect(result.success).toBe(false)
      if (result.success) return
      const msgs = fieldErrors(result).claude_args ?? []
      expect(
        msgs.some((m) => m.includes('All claude_args values must be strings')),
      ).toBe(true)
    })
  })

  describe('env', () => {
    test('allows missing env', () => {
      const result = frontmatterSchema.safeParse({ schedule: '0 8 * * *' })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.env).toBeUndefined()
    })

    test('accepts string-valued object', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        env: { KEY: 'value' },
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.env).toEqual({ KEY: 'value' })
    })

    test('accepts empty object', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        env: {},
      })
      expect(result.success).toBe(true)
    })

    test('rejects non-object env', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        env: 'not-an-object',
      })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(fieldErrors(result).env).toContain('env must be an object')
    })

    test('rejects non-string values', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        env: { KEY: 'ok', BAD: 123 },
      })
      expect(result.success).toBe(false)
      if (result.success) return
      const msgs = fieldErrors(result).env ?? []
      expect(
        msgs.some((m) => m.includes('All env values must be strings')),
      ).toBe(true)
    })
  })

  describe('enabled', () => {
    test('allows missing enabled', () => {
      const result = frontmatterSchema.safeParse({ schedule: '0 8 * * *' })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.enabled).toBeUndefined()
    })

    test('accepts true', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        enabled: true,
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.enabled).toBe(true)
    })

    test('accepts false', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        enabled: false,
      })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.enabled).toBe(false)
    })

    test('rejects non-boolean', () => {
      const result = frontmatterSchema.safeParse({
        schedule: '0 8 * * *',
        enabled: 'yes',
      })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(fieldErrors(result).enabled).toContain('enabled must be a boolean')
    })
  })

  describe('error accumulation', () => {
    test('reports errors for multiple fields at once', () => {
      const result = frontmatterSchema.safeParse({
        schedule: 'bad',
        timezone: 'Fake/Zone',
        claude_args: 42,
        enabled: 'nope',
      })
      expect(result.success).toBe(false)
      if (result.success) return
      const flat = z.flattenError(result.error)
      expect(flat.fieldErrors.schedule).toBeDefined()
      expect(flat.fieldErrors.timezone).toBeDefined()
      expect(flat.fieldErrors.claude_args).toBeDefined()
      expect(flat.fieldErrors.enabled).toBeDefined()
    })
  })
})
