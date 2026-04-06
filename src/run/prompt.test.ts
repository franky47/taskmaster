import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'

import { cleanupPromptFile, writePromptFile } from './prompt'

describe('writePromptFile', () => {
  test('writes content to the expected path and returns it', () => {
    const timestamp = new Date('2026-04-06T12:30:45Z')
    const content = 'Review open pull requests and summarize status.'

    const result = writePromptFile('review-prs', timestamp, content)
    if (result instanceof Error) throw result

    try {
      expect(result).toBe('/tmp/tm-2026-04-06T12.30.45Z-review-prs.prompt.md')
      expect(fs.readFileSync(result, 'utf-8')).toBe(content)
    } finally {
      fs.unlinkSync(result)
    }
  })

  test('file has 0600 permissions', () => {
    const result = writePromptFile(
      'perms-check',
      new Date('2026-01-01T00:00:00Z'),
      'test',
    )
    if (result instanceof Error) throw result

    try {
      const stat = fs.statSync(result)
      // 0o100600 is the full mode (regular file + owner rw)
      expect(stat.mode & 0o777).toBe(0o600)
    } finally {
      fs.unlinkSync(result)
    }
  })
})

describe('cleanupPromptFile', () => {
  test('removes the file', () => {
    const result = writePromptFile(
      'cleanup-test',
      new Date('2026-01-01T00:00:00Z'),
      'to be removed',
    )
    if (result instanceof Error) throw result

    cleanupPromptFile(result)
    expect(fs.existsSync(result)).toBe(false)
  })

  test('does not throw for a non-existent file', () => {
    expect(() =>
      cleanupPromptFile('/tmp/tm-does-not-exist.prompt.md'),
    ).not.toThrow()
  })
})
