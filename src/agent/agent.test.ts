import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import {
  AgentNotFoundError,
  AgentsFileReadError,
  AgentsFileValidationError,
  resolveAgent,
} from './agent'

const FIXTURES = join(import.meta.dir, 'fixtures')

function fixture(name: string): string {
  return join(FIXTURES, name)
}

describe('resolveAgent', () => {
  describe('built-in agents', () => {
    test('resolves claude', async () => {
      const result = await resolveAgent('claude')
      expect(result).toBe('claude -p < $TM_PROMPT_FILE')
    })

    test('resolves opencode', async () => {
      const result = await resolveAgent('opencode')
      expect(result).toBe('opencode run -f $TM_PROMPT_FILE')
    })

    test('resolves codex', async () => {
      const result = await resolveAgent('codex')
      expect(result).toBe('codex exec - < $TM_PROMPT_FILE')
    })

    test('resolves pi', async () => {
      const result = await resolveAgent('pi')
      expect(result).toBe('pi -p @$TM_PROMPT_FILE')
    })
  })

  describe('unknown agent', () => {
    test('returns AgentNotFoundError listing available agents', async () => {
      const result = await resolveAgent('unknown')
      expect(result).toBeInstanceOf(AgentNotFoundError)
      if (!(result instanceof AgentNotFoundError)) return
      expect(result.agentName).toBe('unknown')
      expect(result.available).toContain('claude')
      expect(result.available).toContain('opencode')
      expect(result.available).toContain('codex')
      expect(result.available).toContain('pi')
    })
  })

  describe('user overrides (agents.yml)', () => {
    test('user override takes precedence over built-in', async () => {
      const result = await resolveAgent('claude', {
        configPath: fixture('valid-overrides.yml'),
      })
      expect(result).toBe('claude --model sonnet -p < $TM_PROMPT_FILE')
    })

    test('custom agent in agents.yml resolves correctly', async () => {
      const result = await resolveAgent('my-agent', {
        configPath: fixture('valid-overrides.yml'),
      })
      expect(result).toBe('my-agent --prompt-file $TM_PROMPT_FILE')
    })

    test('built-in still works when agents.yml has no override for it', async () => {
      const result = await resolveAgent('codex', {
        configPath: fixture('valid-overrides.yml'),
      })
      expect(result).toBe('codex exec - < $TM_PROMPT_FILE')
    })

    test('unknown agent lists both user-defined and built-in agents', async () => {
      const result = await resolveAgent('nope', {
        configPath: fixture('valid-overrides.yml'),
      })
      expect(result).toBeInstanceOf(AgentNotFoundError)
      if (!(result instanceof AgentNotFoundError)) return
      expect(result.available).toContain('my-agent')
      expect(result.available).toContain('claude')
    })
  })

  describe('missing agents.yml', () => {
    test('falls back to built-ins without error', async () => {
      const result = await resolveAgent('claude', {
        configPath: fixture('nonexistent.yml'),
      })
      expect(result).toBe('claude -p < $TM_PROMPT_FILE')
    })
  })

  describe('malformed agents.yml', () => {
    test('returns AgentsFileValidationError', async () => {
      const result = await resolveAgent('claude', {
        configPath: fixture('malformed.yml'),
      })
      expect(result).toBeInstanceOf(AgentsFileValidationError)
    })
  })

  describe('agents.yml with missing $TM_PROMPT_FILE', () => {
    test('returns AgentsFileValidationError mentioning the offending agent', async () => {
      const result = await resolveAgent('my-agent', {
        configPath: fixture('missing-prompt-ref.yml'),
      })
      expect(result).toBeInstanceOf(AgentsFileValidationError)
      if (!(result instanceof AgentsFileValidationError)) return
      expect(result.message).toContain('my-agent')
      expect(result.message).toContain('TM_PROMPT_FILE')
    })
  })

  describe('unreadable agents.yml', () => {
    test('returns AgentsFileReadError', async () => {
      // Use a directory path as the config file to trigger a read error
      const result = await resolveAgent('claude', {
        configPath: FIXTURES,
      })
      expect(result).toBeInstanceOf(AgentsFileReadError)
    })
  })
})
