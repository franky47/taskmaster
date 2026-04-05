import { describe, expect, test } from 'bun:test'

import { filenameSchema } from './file-name.ts'

describe('filenameSchema', () => {
  test('accepts lowercase with hyphens and digits', () => {
    expect(filenameSchema.safeParse('my-task-123').success).toBe(true)
  })

  test('rejects uppercase letters', () => {
    const result = filenameSchema.safeParse('Bad-Name')
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]!.message).toContain('must match [a-z0-9-]+')
  })

  test('rejects underscores', () => {
    expect(filenameSchema.safeParse('bad_name').success).toBe(false)
  })

  test('rejects spaces', () => {
    expect(filenameSchema.safeParse('bad name').success).toBe(false)
  })
})
