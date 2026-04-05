import { describe, expect, test } from 'bun:test'

import { FrontmatterValidationError, parseMarkdown } from './frontmatter.ts'

function md(yaml: string, body = ''): string {
  return `---\n${yaml}\n---\n${body}`
}

describe('parseMarkdown', () => {
  describe('schedule', () => {
    test('accepts valid 5-field cron', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * 1-5'"))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.schedule).toBe('0 8 * * 1-5')
    })

    test('accepts every-minute cron', () => {
      const result = parseMarkdown(md("schedule: '* * * * *'"))
      expect(result).not.toBeInstanceOf(Error)
    })

    test('rejects missing schedule', () => {
      const result = parseMarkdown(md(''))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'schedule' && e.message.includes('required'),
        ),
      ).toBe(true)
    })

    test('rejects null schedule', () => {
      const result = parseMarkdown(md('schedule: null'))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'schedule' && e.message.includes('required'),
        ),
      ).toBe(true)
    })

    test('rejects non-string schedule', () => {
      const result = parseMarkdown(md('schedule: 12345'))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'schedule' && e.message.includes('must be a string'),
        ),
      ).toBe(true)
    })

    test('rejects 6-field cron', () => {
      const result = parseMarkdown(md("schedule: '0 0 8 * * 1-5'"))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'schedule' && e.message.includes('6 fields'),
        ),
      ).toBe(true)
    })

    test('rejects malformed cron', () => {
      const result = parseMarkdown(md("schedule: '60 * * * *'"))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) =>
            e.key === 'schedule' &&
            e.message.includes('Invalid cron expression'),
        ),
      ).toBe(true)
    })
  })

  describe('timezone', () => {
    test('accepts valid IANA timezone', () => {
      const result = parseMarkdown(
        md("schedule: '0 8 * * *'\ntimezone: 'Europe/Paris'"),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.timezone).toBe('Europe/Paris')
    })

    test('accepts UTC', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * *'\ntimezone: 'UTC'"))
      expect(result).not.toBeInstanceOf(Error)
    })

    test('allows missing timezone', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * *'"))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.timezone).toBeUndefined()
    })

    test('rejects non-string timezone', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * *'\ntimezone: 123"))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'timezone' && e.message.includes('must be a string'),
        ),
      ).toBe(true)
    })

    test('rejects invalid timezone', () => {
      const result = parseMarkdown(
        md("schedule: '0 8 * * *'\ntimezone: 'Mars/Olympus'"),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'timezone' && e.message.includes('Mars/Olympus'),
        ),
      ).toBe(true)
    })
  })

  describe('cwd', () => {
    test('allows missing cwd', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * *'"))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.cwd).toBeUndefined()
    })

    test('accepts string cwd', () => {
      const result = parseMarkdown(
        md("schedule: '0 8 * * *'\ncwd: '~/projects/app'"),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.cwd).toBe('~/projects/app')
    })

    test('rejects non-string cwd', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * *'\ncwd: 42"))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'cwd' && e.message.includes('must be a string'),
        ),
      ).toBe(true)
    })
  })

  describe('args', () => {
    test('defaults to empty array when missing', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * *'"))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.args).toEqual([])
    })

    test('accepts string array', () => {
      const result = parseMarkdown(
        md("schedule: '0 8 * * *'\nargs: ['--model', 'sonnet']"),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.args).toEqual(['--model', 'sonnet'])
    })

    test('accepts empty array', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * *'\nargs: []"))
      expect(result).not.toBeInstanceOf(Error)
    })

    test('rejects non-array', () => {
      const result = parseMarkdown(
        md("schedule: '0 8 * * *'\nargs: 'not-an-array'"),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'args' && e.message.includes('must be an array'),
        ),
      ).toBe(true)
    })

    test('rejects array with non-string elements', () => {
      const result = parseMarkdown(
        md("schedule: '0 8 * * *'\nargs:\n  - '--model'\n  - 42"),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'args' && e.message.includes('must be strings'),
        ),
      ).toBe(true)
    })
  })

  describe('env', () => {
    test('defaults to empty object when missing', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * *'"))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.env).toEqual({})
    })

    test('accepts string-valued object', () => {
      const result = parseMarkdown(
        md("schedule: '0 8 * * *'\nenv:\n  KEY: 'value'"),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.env).toEqual({ KEY: 'value' })
    })

    test('accepts empty object', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * *'\nenv: {}"))
      expect(result).not.toBeInstanceOf(Error)
    })

    test('rejects non-object env', () => {
      const result = parseMarkdown(
        md("schedule: '0 8 * * *'\nenv: 'not-an-object'"),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'env' && e.message.includes('must be an object'),
        ),
      ).toBe(true)
    })

    test('rejects non-string values', () => {
      const result = parseMarkdown(
        md("schedule: '0 8 * * *'\nenv:\n  KEY: 'ok'\n  BAD: 123"),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'env' && e.message.includes('must be strings'),
        ),
      ).toBe(true)
    })
  })

  describe('enabled', () => {
    test('defaults to true when missing', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * *'"))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.enabled).toBe(true)
    })

    test('accepts true', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * *'\nenabled: true"))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.enabled).toBe(true)
    })

    test('accepts false', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * *'\nenabled: false"))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.enabled).toBe(false)
    })

    test('rejects non-boolean', () => {
      const result = parseMarkdown(md("schedule: '0 8 * * *'\nenabled: 'yes'"))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'enabled' && e.message.includes('must be a boolean'),
        ),
      ).toBe(true)
    })
  })

  describe('error accumulation', () => {
    test('reports errors for multiple fields at once', () => {
      const result = parseMarkdown(
        md("schedule: 'bad'\ntimezone: 'Fake/Zone'\nargs: 42\nenabled: 'nope'"),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      const keys = result.errors.map((e) => e.key)
      expect(keys).toContain('schedule')
      expect(keys).toContain('timezone')
      expect(keys).toContain('args')
      expect(keys).toContain('enabled')
    })
  })
})
