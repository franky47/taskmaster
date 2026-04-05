import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { FrontmatterValidationError, parseMarkdown } from './frontmatter.ts'
import { parseTaskFile, TaskFileNameError } from './parser.ts'

const FIXTURES = join(import.meta.dir, '..', 'fixtures')

function fixture(name: string): string {
  return join(FIXTURES, name)
}

describe('parseTaskFile', () => {
  describe('valid files', () => {
    test('parses basic task with only required fields', async () => {
      const result = await parseTaskFile(fixture('valid-basic.md'))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.schedule).toBe('0 8 * * 1-5')
      expect(result.prompt).toBe(
        'Review open pull requests and summarize status.',
      )
    })

    test('parses task with all optional fields', async () => {
      const result = await parseTaskFile(fixture('valid-all-fields.md'))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.schedule).toBe('30 9 * * *')
      expect(result.timezone).toBe('Europe/Paris')
      expect(result.cwd).toBe('~/projects/saas-app')
      expect(result.args).toEqual(['--model', 'sonnet'])
      expect(result.env).toEqual({
        GITHUB_TOKEN_SCOPE: 'read',
        LOG_LEVEL: 'debug',
      })
      expect(result.enabled).toBe(false)
      expect(result.prompt).toBe('Run npm audit and report vulnerabilities.')
    })

    test('handles empty prompt body', async () => {
      const result = await parseTaskFile(fixture('valid-minimal.md'))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.prompt).toBe('')
    })

    test('defaults enabled to true when omitted', async () => {
      const result = await parseTaskFile(fixture('valid-basic.md'))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.enabled).toBe(true)
    })

    test('defaults args to [] when omitted', async () => {
      const result = await parseTaskFile(fixture('valid-basic.md'))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.args).toEqual([])
    })

    test('defaults env to {} when omitted', async () => {
      const result = await parseTaskFile(fixture('valid-basic.md'))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.env).toEqual({})
    })

    test('defaults timezone to undefined when omitted', async () => {
      const result = await parseTaskFile(fixture('valid-basic.md'))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.timezone).toBeUndefined()
    })

    test('defaults cwd to undefined when omitted', async () => {
      const result = await parseTaskFile(fixture('valid-basic.md'))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.cwd).toBeUndefined()
    })
  })

  describe('filename validation', () => {
    test('rejects uppercase letters in filename', async () => {
      const result = await parseTaskFile('/tmp/Bad-Name.md')
      expect(result).toBeInstanceOf(TaskFileNameError)
    })

    test('rejects spaces in filename', async () => {
      const result = await parseTaskFile('/tmp/bad name.md')
      expect(result).toBeInstanceOf(TaskFileNameError)
    })

    test('rejects underscores in filename', async () => {
      const result = await parseTaskFile('/tmp/bad_name.md')
      expect(result).toBeInstanceOf(TaskFileNameError)
    })
  })

  describe('schedule validation', () => {
    test('rejects missing schedule field', async () => {
      const result = await parseTaskFile(fixture('missing-schedule.md'))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'schedule')).toBe(true)
    })

    test('rejects malformed cron expression', async () => {
      const result = await parseTaskFile(fixture('malformed-cron.md'))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'schedule')).toBe(true)
    })

    test('rejects 6-field cron expression', async () => {
      const result = await parseTaskFile(fixture('six-field-cron.md'))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'schedule')).toBe(true)
    })

    test('rejects non-string schedule', () => {
      const result = parseMarkdown('---\nschedule: 12345\n---\nhi')
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'schedule')).toBe(true)
    })

    test('rejects empty frontmatter (no schedule)', async () => {
      const result = await parseTaskFile(fixture('empty-frontmatter.md'))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'schedule')).toBe(true)
    })
  })

  describe('timezone validation', () => {
    test('accepts valid IANA timezone', async () => {
      const result = await parseTaskFile(fixture('valid-all-fields.md'))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.timezone).toBe('Europe/Paris')
    })

    test('rejects invalid timezone string', async () => {
      const result = await parseTaskFile(fixture('invalid-timezone.md'))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'timezone')).toBe(true)
    })

    test('allows missing timezone', async () => {
      const result = await parseTaskFile(fixture('valid-basic.md'))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.timezone).toBeUndefined()
    })
  })

  describe('type validation', () => {
    test('rejects non-array args', async () => {
      const result = await parseTaskFile(fixture('invalid-claude-args.md'))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'args')).toBe(true)
    })

    test('rejects non-string values in args array', () => {
      const result = parseMarkdown(
        '---\nschedule: "0 8 * * *"\nargs:\n  - "--model"\n  - 42\n---\nhi',
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'args')).toBe(true)
    })

    test('rejects non-string env values', async () => {
      const result = await parseTaskFile(fixture('invalid-env-values.md'))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'env')).toBe(true)
    })

    test('rejects non-boolean enabled', async () => {
      const result = await parseTaskFile(fixture('invalid-enabled.md'))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'enabled')).toBe(true)
    })

    test('rejects non-object env', () => {
      const result = parseMarkdown(
        '---\nschedule: "0 8 * * *"\nenv: "not-an-object"\n---\nhi',
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'env')).toBe(true)
    })
  })

  describe('error accumulation', () => {
    test('returns multiple errors for file with multiple problems', async () => {
      const result = await parseTaskFile(fixture('multiple-errors.md'))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.length).toBeGreaterThanOrEqual(3)
    })
  })
})
