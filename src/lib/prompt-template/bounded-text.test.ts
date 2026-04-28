import { describe, expect, test } from 'bun:test'

import { decodeBoundedUtf8 } from './bounded-text'

const ONE_MB = 1024 * 1024

describe('decodeBoundedUtf8', () => {
  test('decodes valid UTF-8 bytes to a string and reports byte length', () => {
    const buf = Buffer.from('hello world', 'utf-8')
    const result = decodeBoundedUtf8(buf, ONE_MB)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe('hello world')
    expect(result.bytes).toBe(11)
  })

  test('decodes multi-byte UTF-8 (emoji + accented characters)', () => {
    const text = 'café 🚀'
    const buf = Buffer.from(text, 'utf-8')
    const result = decodeBoundedUtf8(buf, ONE_MB)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(text)
    expect(result.bytes).toBe(buf.length)
  })

  test('reports oversize when bytes exceed the supplied cap', () => {
    const buf = Buffer.alloc(ONE_MB + 1, 'a')
    const result = decodeBoundedUtf8(buf, ONE_MB)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('oversize')
    expect(result.bytes).toBe(ONE_MB + 1)
  })

  test('accepts payload exactly at the cap', () => {
    const buf = Buffer.alloc(ONE_MB, 'a')
    const result = decodeBoundedUtf8(buf, ONE_MB)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bytes).toBe(ONE_MB)
  })

  test('reports invalid-utf8 for malformed byte sequences', () => {
    const buf = Buffer.from([0xc3, 0x28])
    const result = decodeBoundedUtf8(buf, ONE_MB)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid-utf8')
  })

  test('oversize takes precedence over invalid-utf8', () => {
    const buf = Buffer.alloc(ONE_MB + 1)
    buf[0] = 0xc3
    buf[1] = 0x28
    const result = decodeBoundedUtf8(buf, ONE_MB)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('oversize')
  })

  test('decodes empty buffer to empty string', () => {
    const result = decodeBoundedUtf8(Buffer.alloc(0), ONE_MB)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe('')
    expect(result.bytes).toBe(0)
  })

  test('honors a smaller maxBytes argument', () => {
    const buf = Buffer.from('hello world', 'utf-8')
    const result = decodeBoundedUtf8(buf, 5)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('oversize')
    expect(result.bytes).toBe(11)
  })
})
