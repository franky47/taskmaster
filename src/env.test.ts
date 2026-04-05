import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { EnvFileReadError, buildEnv, loadEnvFile } from './env'

describe('loadEnvFile', () => {
  test('parses KEY=VALUE lines', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-env-'))
    const envPath = path.join(dir, '.env')
    await fs.writeFile(envPath, 'FOO=bar\nBAZ=qux\n')
    const result = await loadEnvFile(envPath)
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  test('handles quoted values', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-env-'))
    const envPath = path.join(dir, '.env')
    await fs.writeFile(envPath, 'A="hello world"\nB=\'single\'\n')
    const result = await loadEnvFile(envPath)
    expect(result).toEqual({ A: 'hello world', B: 'single' })
  })

  test('skips comments and blank lines', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-env-'))
    const envPath = path.join(dir, '.env')
    await fs.writeFile(envPath, '# comment\n\nKEY=val\n')
    const result = await loadEnvFile(envPath)
    expect(result).toEqual({ KEY: 'val' })
  })

  test('returns empty record when file does not exist', async () => {
    const result = await loadEnvFile('/nonexistent/.env')
    expect(result).toEqual({})
  })

  test('returns error on read failure (directory instead of file)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-env-'))
    const result = await loadEnvFile(dir)
    expect(result).toBeInstanceOf(EnvFileReadError)
  })
})

describe('buildEnv', () => {
  test('layers process.env -> global -> task (last wins)', () => {
    const original = process.env.PATH
    const result = buildEnv(
      { GLOBAL: 'g', SHARED: 'from-global' },
      { TASK: 't', SHARED: 'from-task' },
    )
    expect(result.GLOBAL).toBe('g')
    expect(result.TASK).toBe('t')
    expect(result.SHARED).toBe('from-task')
    // process.env is the base layer
    expect(result.PATH).toBe(original)
  })

  test('empty overrides preserve lower layers', () => {
    const result = buildEnv({}, {})
    expect(result.PATH).toBe(process.env.PATH)
  })

  test('task env overrides global env', () => {
    const result = buildEnv({ KEY: 'global' }, { KEY: 'task' })
    expect(result.KEY).toBe('task')
  })
})
