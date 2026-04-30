import { describe, expect, test } from 'bun:test'
import os from 'node:os'
import path from 'node:path'

import { resolveConfigBase } from './config'

describe('resolveConfigBase', () => {
  test('returns TM_CONFIG_DIR when NODE_ENV=test and TM_CONFIG_DIR is set', () => {
    const result = resolveConfigBase({
      NODE_ENV: 'test',
      TM_CONFIG_DIR: '/tmp/tm-test-config',
    })
    expect(result).toBe('/tmp/tm-test-config')
  })

  test('falls back to home dir when NODE_ENV=test but TM_CONFIG_DIR unset', () => {
    const result = resolveConfigBase({ NODE_ENV: 'test' })
    expect(result).toBe(path.join(os.homedir(), '.config', 'taskmaster'))
  })

  test('ignores TM_CONFIG_DIR when NODE_ENV is not "test"', () => {
    const result = resolveConfigBase({
      NODE_ENV: 'production',
      TM_CONFIG_DIR: '/tmp/should-be-ignored',
    })
    expect(result).toBe(path.join(os.homedir(), '.config', 'taskmaster'))
  })

  test('ignores TM_CONFIG_DIR when NODE_ENV is undefined', () => {
    const result = resolveConfigBase({
      TM_CONFIG_DIR: '/tmp/should-be-ignored',
    })
    expect(result).toBe(path.join(os.homedir(), '.config', 'taskmaster'))
  })
})
