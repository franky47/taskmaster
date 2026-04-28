import { describe, expect, test } from 'bun:test'

import { findTokens, substituteTokens } from './substitute'

describe('substituteTokens', () => {
  test('substitutes <PREFLIGHT/> with provided value', () => {
    const result = substituteTokens('Before <PREFLIGHT/> after', {
      PREFLIGHT: 'INJECTED',
    })
    expect(result.resolved).toBe('Before INJECTED after')
    expect(result.nonEmptyCount).toBe(1)
  })

  test('matches <PREFLIGHT /> with internal whitespace', () => {
    const result = substituteTokens('a <PREFLIGHT /> b', { PREFLIGHT: 'x' })
    expect(result.resolved).toBe('a x b')
    expect(result.nonEmptyCount).toBe(1)
  })

  test('does not match lowercase tokens', () => {
    const result = substituteTokens('<preflight/>', { PREFLIGHT: 'x' })
    expect(result.resolved).toBe('<preflight/>')
    expect(result.nonEmptyCount).toBe(0)
  })

  test('does not match opening tag without slash', () => {
    const result = substituteTokens('<PREFLIGHT>', { PREFLIGHT: 'x' })
    expect(result.resolved).toBe('<PREFLIGHT>')
    expect(result.nonEmptyCount).toBe(0)
  })

  test('does not match opening/closing pair', () => {
    const result = substituteTokens('<PREFLIGHT></PREFLIGHT>', {
      PREFLIGHT: 'x',
    })
    expect(result.resolved).toBe('<PREFLIGHT></PREFLIGHT>')
    expect(result.nonEmptyCount).toBe(0)
  })

  test('does not match tags with attributes', () => {
    const result = substituteTokens('<PREFLIGHT id="x"/>', { PREFLIGHT: 'v' })
    expect(result.resolved).toBe('<PREFLIGHT id="x"/>')
    expect(result.nonEmptyCount).toBe(0)
  })

  test('substitutes all occurrences', () => {
    const result = substituteTokens(
      '<PREFLIGHT/> and <PREFLIGHT/> and <PREFLIGHT/>',
      { PREFLIGHT: 'X' },
    )
    expect(result.resolved).toBe('X and X and X')
    expect(result.nonEmptyCount).toBe(3)
  })

  test('trims leading and trailing whitespace from values', () => {
    const result = substituteTokens('[<PREFLIGHT/>]', {
      PREFLIGHT: '\n\n  hello world  \n\n',
    })
    expect(result.resolved).toBe('[hello world]')
    expect(result.nonEmptyCount).toBe(1)
  })

  test('preserves internal whitespace', () => {
    const result = substituteTokens('<PREFLIGHT/>', {
      PREFLIGHT: 'line one\n\nline two',
    })
    expect(result.resolved).toBe('line one\n\nline two')
  })

  test('substitution is single-pass: tokens in values are not re-substituted', () => {
    const result = substituteTokens('<PREFLIGHT/>', {
      PREFLIGHT: '<PREFLIGHT/>',
    })
    expect(result.resolved).toBe('<PREFLIGHT/>')
    expect(result.nonEmptyCount).toBe(1)
  })

  test('empty value is substituted but does not count as non-empty', () => {
    const result = substituteTokens('A<PREFLIGHT/>B', { PREFLIGHT: '' })
    expect(result.resolved).toBe('AB')
    expect(result.nonEmptyCount).toBe(0)
  })

  test('whitespace-only value trims to empty and does not count as non-empty', () => {
    const result = substituteTokens('A<PREFLIGHT/>B', {
      PREFLIGHT: '   \n  ',
    })
    expect(result.resolved).toBe('AB')
    expect(result.nonEmptyCount).toBe(0)
  })

  test('token absent from values map is left untouched', () => {
    const result = substituteTokens('<PREFLIGHT/>', {})
    expect(result.resolved).toBe('<PREFLIGHT/>')
    expect(result.nonEmptyCount).toBe(0)
  })

  test('substitutes tokens inside fenced code blocks', () => {
    const body = '```\n<PREFLIGHT/>\n```'
    const result = substituteTokens(body, { PREFLIGHT: 'data' })
    expect(result.resolved).toBe('```\ndata\n```')
    expect(result.nonEmptyCount).toBe(1)
  })

  test('substitutes tokens inside HTML comments', () => {
    const body = '<!-- <PREFLIGHT/> -->'
    const result = substituteTokens(body, { PREFLIGHT: 'data' })
    expect(result.resolved).toBe('<!-- data -->')
    expect(result.nonEmptyCount).toBe(1)
  })

  test('returns body unchanged when no tokens are present', () => {
    const result = substituteTokens('Plain prompt body', { PREFLIGHT: 'X' })
    expect(result.resolved).toBe('Plain prompt body')
    expect(result.nonEmptyCount).toBe(0)
  })
})

describe('findTokens', () => {
  test('returns the set of token names present in the body', () => {
    expect(findTokens('a <PREFLIGHT/> b').has('PREFLIGHT')).toBe(true)
  })

  test('returns empty set when no tokens present', () => {
    const tokens = findTokens('plain body without tokens')
    expect(tokens.size).toBe(0)
  })

  test('does not include tokens that fail strict matching', () => {
    expect(findTokens('<preflight/>').has('PREFLIGHT')).toBe(false)
    expect(findTokens('<PREFLIGHT>').size).toBe(0)
  })

  test('detects token across multiple occurrences as a single set entry', () => {
    const tokens = findTokens('<PREFLIGHT/> and <PREFLIGHT/>')
    expect(tokens.size).toBe(1)
    expect(tokens.has('PREFLIGHT')).toBe(true)
  })
})
