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

    test('accepts timeout shorter than schedule interval', () => {
      // Schedule: every hour, timeout: 30s — well under
      const result = parseMarkdown(
        md(`schedule: '0 * * * *'\n${VALID_AGENT}\ntimeout: '30s'`),
      )
      expect(result).not.toBeInstanceOf(Error)
    })

    test('rejects timeout equal to schedule interval', () => {
      // Schedule: every 5 minutes, timeout: 5m
      const result = parseMarkdown(
        md(`schedule: '*/5 * * * *'\n${VALID_AGENT}\ntimeout: '5m'`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) =>
            e.key === 'timeout' &&
            e.message.includes('less than the schedule interval'),
        ),
      ).toBe(true)
    })

    test('rejects timeout exceeding schedule interval', () => {
      // Schedule: every 5 minutes, timeout: 10m
      const result = parseMarkdown(
        md(`schedule: '*/5 * * * *'\n${VALID_AGENT}\ntimeout: '10m'`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) =>
            e.key === 'timeout' &&
            e.message.includes('less than the schedule interval'),
        ),
      ).toBe(true)
    })

    test('uses minimum gap for non-uniform cron schedules', () => {
      // Schedule: 9am and 5pm — minimum gap is 8h
      // Timeout: 10h exceeds the 8h gap
      const result = parseMarkdown(
        md(`schedule: '0 9,17 * * *'\n${VALID_AGENT}\ntimeout: '10h'`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) =>
            e.key === 'timeout' &&
            e.message.includes('less than the schedule interval'),
        ),
      ).toBe(true)
    })

    test('does not crash when schedule is invalid and timeout is set', () => {
      const result = parseMarkdown(
        md(`schedule: 'bad'\n${VALID_AGENT}\ntimeout: '5m'`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'schedule')).toBe(true)
    })

    test('includes both timeout and interval in error message', () => {
      const result = parseMarkdown(
        md(`schedule: '*/5 * * * *'\n${VALID_AGENT}\ntimeout: '10m'`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      const err = result.errors.find((e) => e.key === 'timeout')
      expect(err?.message).toContain('10m')
      expect(err?.message).toContain('5m')
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
    test("defaults to 'when-online' when missing", () => {
      const result = parseMarkdown(md(`schedule: '0 8 * * *'\n${VALID_AGENT}`))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.enabled).toBe('when-online')
    })

    test("accepts 'when-online'", () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\nenabled: 'when-online'`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.enabled).toBe('when-online')
    })

    test("accepts 'always'", () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\nenabled: 'always'`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.enabled).toBe('always')
    })

    test('accepts false', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\nenabled: false`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.enabled).toBe(false)
    })

    test('rejects true', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\nenabled: true`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'enabled')).toBe(true)
    })

    test('rejects invalid string', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\nenabled: 'yes'`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(result.errors.some((e) => e.key === 'enabled')).toBe(true)
    })
  })

  describe('timeout', () => {
    test('allows missing timeout', () => {
      const result = parseMarkdown(md(`schedule: '0 8 * * *'\n${VALID_AGENT}`))
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.timeout).toBeUndefined()
    })

    test('accepts "30s" and converts to 30000ms', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\ntimeout: '30s'`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.timeout).toBe(30_000)
    })

    test('accepts "5m" and converts to 300000ms', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\ntimeout: '5m'`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.timeout).toBe(300_000)
    })

    test('accepts "2h" and converts to 7200000ms', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\ntimeout: '2h'`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.timeout).toBe(7_200_000)
    })

    test('accepts exactly 1s (boundary)', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\ntimeout: '1s'`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result.timeout).toBe(1000)
    })

    test('rejects unparseable string', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\ntimeout: 'abc'`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'timeout' && e.message.includes('invalid'),
        ),
      ).toBe(true)
    })

    test('rejects empty string', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\ntimeout: ''`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'timeout' && e.message.includes('invalid'),
        ),
      ).toBe(true)
    })

    test('rejects sub-1s value "500ms"', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\ntimeout: '500ms'`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'timeout' && e.message.includes('at least 1 second'),
        ),
      ).toBe(true)
    })

    test('rejects "0s"', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\ntimeout: '0s'`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'timeout' && e.message.includes('at least 1 second'),
        ),
      ).toBe(true)
    })

    test('rejects non-string timeout', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\ntimeout: 30`),
      )
      expect(result).toBeInstanceOf(FrontmatterValidationError)
      if (!(result instanceof FrontmatterValidationError)) return
      expect(
        result.errors.some(
          (e) => e.key === 'timeout' && e.message.includes('must be a string'),
        ),
      ).toBe(true)
    })

    test('threads through agent variant', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_AGENT}\ntimeout: '5m'`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result).toHaveProperty('agent')
      expect(result.timeout).toBe(300_000)
    })

    test('threads through run variant', () => {
      const result = parseMarkdown(
        md(`schedule: '0 8 * * *'\n${VALID_RUN}\ntimeout: '5m'`),
      )
      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return
      expect(result).toHaveProperty('run')
      expect(result.timeout).toBe(300_000)
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
