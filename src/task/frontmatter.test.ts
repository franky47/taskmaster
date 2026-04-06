import { describe, expect, test } from 'bun:test'

import {
  FrontmatterParseError,
  FrontmatterValidationError,
  parseMarkdown,
} from './frontmatter.ts'

function md(yaml: string, body = ''): string {
  return `---\n${yaml}\n---\n${body}`
}

const VALID_AGENT = 'agent: opencode'
const VALID_RUN = "run: 'my-cmd $TM_PROMPT_FILE'"

describe('parseMarkdown', () => {
  describe('schedule', () => {
    test('accepts valid 5-field cron', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * 1-5'\n${VALID_AGENT}`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.schedule).toBe('0 8 * * 1-5')
    })

    test('accepts every-minute cron', () => {
      const result = parseMarkdown(md(`schedule: '* * * * *'\n${VALID_AGENT}`))
      expect(result).not.toBeInstanceOf(Error)
    })

    test('gives actionable error for unquoted stars in schedule', () => {
      const result = parseMarkdown(md(`schedule: * * * * *\n${VALID_AGENT}`))
      expect(result).toBeInstanceOf(FrontmatterParseError)
      if (!(result instanceof FrontmatterParseError)) return
      expect(result.message).toContain('must be quoted')
    })

    test('rejects missing schedule', () => {
      const result = parseMarkdown(md(VALID_AGENT))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'schedule' && e.message.includes('required'),
        ),
      ).toBe(true)
    })

    test('rejects null schedule', () => {
      const result = parseMarkdown(md(`schedule: null\n${VALID_AGENT}`))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'schedule' && e.message.includes('required'),
        ),
      ).toBe(true)
    })

    test('rejects non-string schedule', () => {
      const result = parseMarkdown(md(`schedule: 12345\n${VALID_AGENT}`))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'schedule' && e.message.includes('must be a string'),
        ),
      ).toBe(true)
    })

    test('rejects 6-field cron', () => {
      const result = parseMarkdown(
        md(`schedule: '0 0 8 * * 1-5'\n${VALID_AGENT}`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'schedule' && e.message.includes('6 fields'),
        ),
      ).toBe(true)
    })

    test('rejects malformed cron', () => {
      const result = parseMarkdown(md(`schedule: '60 * * * *'\n${VALID_AGENT}`))
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
        md(`schedule: '0 8 * * *'\ntimezone: 'Europe/Paris'\n${VALID_AGENT}`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.timezone).toBe('Europe/Paris')
    })

    test('accepts UTC', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\ntimezone: 'UTC'\n${VALID_AGENT}`),
      )
      expect(result).not.toBeInstanceOf(Error)
    })

    test('allows missing timezone', () => {
      const result = parseMarkdown(md(`schedule: '0 8 * * *'\n${VALID_AGENT}`))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.timezone).toBeUndefined()
    })

    test('rejects non-string timezone', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\ntimezone: 123\n${VALID_AGENT}`),
      )
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
        md(`schedule: '0 8 * * *'\ntimezone: 'Mars/Olympus'\n${VALID_AGENT}`),
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
      const result = parseMarkdown(md(`schedule: '0 8 * * *'\n${VALID_AGENT}`))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.cwd).toBeUndefined()
    })

    test('accepts string cwd', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\ncwd: '~/projects/app'\n${VALID_AGENT}`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.cwd).toBe('~/projects/app')
    })

    test('rejects non-string cwd', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\ncwd: 42\n${VALID_AGENT}`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'cwd' && e.message.includes('must be a string'),
        ),
      ).toBe(true)
    })
  })

  describe('agent', () => {
    test('accepts string agent', () => {
      const result = parseMarkdown(md(`schedule: '0 8 * * *'\nagent: opencode`))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result).toHaveProperty('agent', 'opencode')
    })

    test('rejects non-string agent', () => {
      const result = parseMarkdown(md(`schedule: '0 8 * * *'\nagent: 42`))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'agent' && e.message.includes('must be a string'),
        ),
      ).toBe(true)
    })
  })

  describe('run', () => {
    test('accepts run with TM_PROMPT_FILE', () => {
      const result = parseMarkdown(md(`schedule: '0 8 * * *'\n${VALID_RUN}`))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result).toHaveProperty('run', 'my-cmd $TM_PROMPT_FILE')
    })

    test('rejects run without TM_PROMPT_FILE', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\nrun: 'my-cmd --flag'`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'run' && e.message.includes('TM_PROMPT_FILE'),
        ),
      ).toBe(true)
    })

    test('rejects non-string run', () => {
      const result = parseMarkdown(md(`schedule: '0 8 * * *'\nrun: 42`))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'run' && e.message.includes('must be a string'),
        ),
      ).toBe(true)
    })
  })

  describe('cross-field validation', () => {
    test('rejects both agent and run', () => {
      const result = parseMarkdown(
        md(
          `schedule: '0 8 * * *'\nagent: opencode\nrun: 'cmd $TM_PROMPT_FILE'`,
        ),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'agent' && e.message.includes('not both'),
        ),
      ).toBe(true)
    })

    test('rejects neither agent nor run', () => {
      const result = parseMarkdown(md(`schedule: '0 8 * * *'`))
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) =>
            e.key === 'agent' &&
            e.message.includes('exactly one of "agent" or "run"'),
        ),
      ).toBe(true)
    })

    test('rejects args with run', () => {
      const result = parseMarkdown(
        md(
          `schedule: '0 8 * * *'\nrun: 'cmd $TM_PROMPT_FILE'\nargs: '--verbose'`,
        ),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) =>
            e.key === 'args' &&
            e.message.includes('can only be used with "agent"'),
        ),
      ).toBe(true)
    })
  })

  describe('args', () => {
    test('defaults to empty string when missing', () => {
      const result = parseMarkdown(md(`schedule: '0 8 * * *'\n${VALID_AGENT}`))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      if (!('agent' in result)) throw new Error('expected agent variant')
      expect(result.args).toBe('')
    })

    test('accepts string', () => {
      const result = parseMarkdown(
        md(
          `schedule: '0 8 * * *'\n${VALID_AGENT}\nargs: '--model sonnet --verbose'`,
        ),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      if (!('agent' in result)) throw new Error('expected agent variant')
      expect(result.args).toBe('--model sonnet --verbose')
    })

    test('rejects non-string', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\nargs: 42`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'args' && e.message.includes('must be a string'),
        ),
      ).toBe(true)
    })
  })

  describe('env', () => {
    test('defaults to empty object when missing', () => {
      const result = parseMarkdown(md(`schedule: '0 8 * * *'\n${VALID_AGENT}`))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.env).toEqual({})
    })

    test('accepts string-valued object', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\nenv:\n  KEY: 'value'`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.env).toEqual({ KEY: 'value' })
    })

    test('accepts empty object', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\nenv: {}`),
      )
      expect(result).not.toBeInstanceOf(Error)
    })

    test('rejects non-object env', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\nenv: 'not-an-object'`),
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
        md(
          `schedule: '0 8 * * *'\n${VALID_AGENT}\nenv:\n  KEY: 'ok'\n  BAD: 123`,
        ),
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
      const result = parseMarkdown(md(`schedule: '0 8 * * *'\n${VALID_AGENT}`))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.enabled).toBe(true)
    })

    test('accepts true', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\nenabled: true`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.enabled).toBe(true)
    })

    test('accepts false', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\nenabled: false`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.enabled).toBe(false)
    })

    test('rejects non-boolean', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\nenabled: 'yes'`),
      )
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
        md(
          `schedule: 'bad'\nagent: opencode\ntimezone: 'Fake/Zone'\nargs: 42\nenabled: 'nope'`,
        ),
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
