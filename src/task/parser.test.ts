import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { FrontmatterValidationError } from './frontmatter.ts'
import {
  parseTaskFile,
  TaskFileNameError,
  TaskNotFoundError,
} from './parser.ts'

const FIXTURES = join(import.meta.dir, 'fixtures')

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
      expect(result).toHaveProperty('agent', 'opencode')
      expect(result).toHaveProperty('args', '--model sonnet')
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

    test('defaults args to empty string when omitted', async () => {
      const result = await parseTaskFile(fixture('valid-basic.md'))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result).toHaveProperty('args', '')
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

    test('parses run-based task', async () => {
      const result = await parseTaskFile(fixture('valid-run.md'))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result).toHaveProperty('run', 'my-cmd $TM_PROMPT_FILE')
      expect(result).not.toHaveProperty('agent')
      expect(result).not.toHaveProperty('args')
      expect(result.prompt).toBe('Run a shell command with the prompt file.')
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

  describe('missing file', () => {
    test('returns TaskNotFoundError for non-existent file', async () => {
      const result = await parseTaskFile('/tmp/no-such-task.md')
      expect(result).toBeInstanceOf(TaskNotFoundError)
    })
  })

  describe('validation error propagation', () => {
    test('returns FrontmatterValidationError for invalid files', async () => {
      const result = await parseTaskFile(fixture('multiple-errors.md'))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.length).toBeGreaterThanOrEqual(3)
    })
  })
})
