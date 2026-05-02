import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import { TaskNameError, normalizeTaskName, toDisplayForm } from './name.ts'

const TASKS_DIR = '/tmp/tasks'

describe('normalizeTaskName', () => {
  describe('three CLI input forms collapse to the same canonical', () => {
    test('slash form with .md', () => {
      const r = normalizeTaskName('foo/bar.md', TASKS_DIR)
      expect(r).not.toBeInstanceOf(Error)
      if (r instanceof Error) return
      expect(r.canonical).toBe('foo_bar')
      expect(r.filePath).toBe(path.join(TASKS_DIR, 'foo', 'bar.md'))
      expect(r.segments).toEqual(['foo', 'bar'])
    })

    test('slash form without .md', () => {
      const r = normalizeTaskName('foo/bar', TASKS_DIR)
      if (r instanceof Error) throw r
      expect(r.canonical).toBe('foo_bar')
      expect(r.filePath).toBe(path.join(TASKS_DIR, 'foo', 'bar.md'))
      expect(r.segments).toEqual(['foo', 'bar'])
    })

    test('underscore form', () => {
      const r = normalizeTaskName('foo_bar', TASKS_DIR)
      if (r instanceof Error) throw r
      expect(r.canonical).toBe('foo_bar')
      expect(r.filePath).toBe(path.join(TASKS_DIR, 'foo', 'bar.md'))
      expect(r.segments).toEqual(['foo', 'bar'])
    })
  })

  describe('flat (single segment) names', () => {
    test('plain name', () => {
      const r = normalizeTaskName('foo', TASKS_DIR)
      if (r instanceof Error) throw r
      expect(r.canonical).toBe('foo')
      expect(r.filePath).toBe(path.join(TASKS_DIR, 'foo.md'))
      expect(r.segments).toEqual(['foo'])
    })

    test('plain name with .md', () => {
      const r = normalizeTaskName('foo.md', TASKS_DIR)
      if (r instanceof Error) throw r
      expect(r.canonical).toBe('foo')
    })

    test('hyphenated single segment', () => {
      const r = normalizeTaskName('foo-bar-baz', TASKS_DIR)
      if (r instanceof Error) throw r
      expect(r.canonical).toBe('foo-bar-baz')
      expect(r.segments).toEqual(['foo-bar-baz'])
    })
  })

  describe('deeper nesting', () => {
    test('three segments via slashes', () => {
      const r = normalizeTaskName('a/b/c.md', TASKS_DIR)
      if (r instanceof Error) throw r
      expect(r.canonical).toBe('a_b_c')
      expect(r.filePath).toBe(path.join(TASKS_DIR, 'a', 'b', 'c.md'))
    })

    test('three segments via underscores', () => {
      const r = normalizeTaskName('a_b_c', TASKS_DIR)
      if (r instanceof Error) throw r
      expect(r.canonical).toBe('a_b_c')
      expect(r.filePath).toBe(path.join(TASKS_DIR, 'a', 'b', 'c.md'))
    })
  })

  describe('errors', () => {
    test('uppercase rejected', () => {
      const r = normalizeTaskName('Foo', TASKS_DIR)
      expect(r).toBeInstanceOf(TaskNameError)
    })

    test('space in segment rejected', () => {
      const r = normalizeTaskName('foo bar', TASKS_DIR)
      expect(r).toBeInstanceOf(TaskNameError)
    })

    test('dot in segment rejected', () => {
      const r = normalizeTaskName('foo.bar', TASKS_DIR)
      expect(r).toBeInstanceOf(TaskNameError)
    })

    test('empty segment from leading slash rejected', () => {
      const r = normalizeTaskName('/foo', TASKS_DIR)
      expect(r).toBeInstanceOf(TaskNameError)
    })

    test('empty segment from trailing slash rejected', () => {
      const r = normalizeTaskName('foo/', TASKS_DIR)
      expect(r).toBeInstanceOf(TaskNameError)
    })

    test('double slash rejected', () => {
      const r = normalizeTaskName('foo//bar', TASKS_DIR)
      expect(r).toBeInstanceOf(TaskNameError)
    })

    test('double underscore rejected', () => {
      const r = normalizeTaskName('foo__bar', TASKS_DIR)
      expect(r).toBeInstanceOf(TaskNameError)
    })

    test('leading underscore rejected', () => {
      const r = normalizeTaskName('_foo', TASKS_DIR)
      expect(r).toBeInstanceOf(TaskNameError)
    })

    test('trailing underscore rejected', () => {
      const r = normalizeTaskName('foo_', TASKS_DIR)
      expect(r).toBeInstanceOf(TaskNameError)
    })

    test('empty input rejected', () => {
      const r = normalizeTaskName('', TASKS_DIR)
      expect(r).toBeInstanceOf(TaskNameError)
    })

    test('just .md rejected', () => {
      const r = normalizeTaskName('.md', TASKS_DIR)
      expect(r).toBeInstanceOf(TaskNameError)
    })

    test('mixed slash and underscore (separator ambiguity) rejected', () => {
      const r = normalizeTaskName('foo/bar_baz', TASKS_DIR)
      expect(r).toBeInstanceOf(TaskNameError)
    })
  })
})

describe('toDisplayForm', () => {
  test('underscore canonical converts to slash', () => {
    expect(toDisplayForm('foo_bar')).toBe('foo/bar')
  })

  test('flat canonical unchanged', () => {
    expect(toDisplayForm('foo')).toBe('foo')
  })

  test('multi-level canonical converts every underscore', () => {
    expect(toDisplayForm('a_b_c')).toBe('a/b/c')
  })
})
