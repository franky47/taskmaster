import { describe, expect, test } from 'bun:test'

import {
  PREFLIGHT_STDOUT_MAX_BYTES,
  decodePreflightStdout,
} from './preflight-output'

describe('decodePreflightStdout', () => {
  test('decodes valid UTF-8 bytes to a string and reports byte length', () => {
    const buf = Buffer.from('hello world', 'utf-8')
    const result = decodePreflightStdout(buf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe('hello world')
    expect(result.bytes).toBe(11)
  })

  test('decodes multi-byte UTF-8 (emoji + accented characters)', () => {
    const text = 'café 🚀'
    const buf = Buffer.from(text, 'utf-8')
    const result = decodePreflightStdout(buf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(text)
    expect(result.bytes).toBe(buf.length)
  })

  test('reports oversize when bytes exceed 1 MB cap', () => {
    const buf = Buffer.alloc(PREFLIGHT_STDOUT_MAX_BYTES + 1, 'a')
    const result = decodePreflightStdout(buf)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('oversize-stdout')
    expect(result.bytes).toBe(PREFLIGHT_STDOUT_MAX_BYTES + 1)
  })

  test('accepts payload exactly at the 1 MB boundary', () => {
    const buf = Buffer.alloc(PREFLIGHT_STDOUT_MAX_BYTES, 'a')
    const result = decodePreflightStdout(buf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bytes).toBe(PREFLIGHT_STDOUT_MAX_BYTES)
  })

  test('reports invalid-utf8 for malformed byte sequences', () => {
    // 0xC3 starts a 2-byte sequence; 0x28 is not a valid continuation byte
    const buf = Buffer.from([0xc3, 0x28])
    const result = decodePreflightStdout(buf)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid-utf8')
  })

  test('oversize takes precedence over invalid-utf8', () => {
    const buf = Buffer.alloc(PREFLIGHT_STDOUT_MAX_BYTES + 1)
    buf[0] = 0xc3
    buf[1] = 0x28
    const result = decodePreflightStdout(buf)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('oversize-stdout')
  })

  test('decodes empty buffer to empty string', () => {
    const result = decodePreflightStdout(Buffer.alloc(0))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe('')
    expect(result.bytes).toBe(0)
  })
})
