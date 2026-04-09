import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  CwdAccessError,
  CwdNotDirectoryError,
  CwdNotFoundError,
  expandTilde,
  resolveCwd,
} from './cwd'

describe('expandTilde', () => {
  test('expands ~ to $HOME', () => {
    expect(expandTilde('~')).toBe(os.homedir())
  })

  test('expands ~/subdir to $HOME/subdir', () => {
    expect(expandTilde('~/foo/bar')).toBe(path.join(os.homedir(), 'foo/bar'))
  })

  test('leaves absolute paths unchanged', () => {
    expect(expandTilde('/usr/local/bin')).toBe('/usr/local/bin')
  })

  test('leaves relative paths unchanged', () => {
    expect(expandTilde('relative/path')).toBe('relative/path')
  })
})

describe('resolveCwd', () => {
  test('returns existing directory path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-cwd-'))
    const result = await resolveCwd(dir)
    expect(result).toEqual({ path: dir, is_temp: false })
  })

  test('returns CwdNotFoundError for non-existent directory', async () => {
    const result = await resolveCwd('/nonexistent/path/xyz')
    expect(result).toBeInstanceOf(CwdNotFoundError)
  })

  test('expands tilde in cwd', async () => {
    const result = await resolveCwd('~')
    expect(result).toEqual({ path: os.homedir(), is_temp: false })
  })

  test('returns CwdNotDirectoryError when path is a file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-cwd-'))
    const file = path.join(dir, 'not-a-dir.txt')
    await fs.writeFile(file, 'hello')
    const result = await resolveCwd(file)
    expect(result).toBeInstanceOf(CwdNotDirectoryError)
  })

  test('returns CwdAccessError for non-ENOENT fs errors', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-cwd-'))
    const file = path.join(dir, 'a-file')
    await fs.writeFile(file, 'hello')
    // path/to/a-file/subdir → ENOTDIR (not a directory in path component)
    const badPath = path.join(file, 'subdir')
    const result = await resolveCwd(badPath)
    expect(result).toBeInstanceOf(CwdAccessError)
    if (result instanceof CwdAccessError) {
      expect(result.message).toContain(badPath)
      expect(result.message).not.toContain('does not exist')
    }
  })

  test('creates temp dir when cwd is undefined', async () => {
    const result = await resolveCwd(undefined)
    if (result instanceof Error) throw result
    expect(result.is_temp).toBe(true)
    expect(result.path).toBeTruthy()
    const stat = await fs.stat(result.path)
    expect(stat.isDirectory()).toBe(true)
  })
})
