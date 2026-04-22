import { describe, expect, test } from 'bun:test'

import type { Requirement } from '#lib/task'

import { filterByRequirements } from './filter'

type Task = { name: string; requires: Requirement[] }

function probe(value: boolean | (() => Promise<boolean>)) {
  return typeof value === 'function' ? value : async () => value
}

describe('filterByRequirements', () => {
  test('returns empty results for empty input without probing', async () => {
    let called = 0
    const result = await filterByRequirements<Task>([], {
      network: async () => {
        called++
        return true
      },
    })

    expect(result.ready).toEqual([])
    expect(result.skipped).toEqual([])
    expect(called).toBe(0)
  })

  test('passes all tasks through when no task declares any requirement', async () => {
    const tasks: Task[] = [
      { name: 'a', requires: [] },
      { name: 'b', requires: [] },
    ]
    let called = 0
    const result = await filterByRequirements(tasks, {
      network: async () => {
        called++
        return true
      },
    })

    expect(result.ready).toEqual(tasks)
    expect(result.skipped).toEqual([])
    expect(called).toBe(0)
  })

  test('passes single-requirement task when probe returns true', async () => {
    const tasks: Task[] = [{ name: 'cloud', requires: ['network'] }]
    const result = await filterByRequirements(tasks, { network: probe(true) })

    expect(result.ready).toEqual(tasks)
    expect(result.skipped).toEqual([])
  })

  test('skips single-requirement task when probe returns false', async () => {
    const tasks: Task[] = [{ name: 'cloud', requires: ['network'] }]
    const result = await filterByRequirements(tasks, { network: probe(false) })

    expect(result.ready).toEqual([])
    expect(result.skipped).toEqual([{ task: tasks[0]!, unmet: ['network'] }])
  })

  test('probes each referenced requirement at most once per call', async () => {
    const tasks: Task[] = [
      { name: 'a', requires: ['network'] },
      { name: 'b', requires: ['network'] },
      { name: 'c', requires: ['network'] },
    ]
    let count = 0
    await filterByRequirements(tasks, {
      network: async () => {
        count++
        return true
      },
    })

    expect(count).toBe(1)
  })

  test('does not probe a requirement that no task references', async () => {
    const tasks: Task[] = [{ name: 'local', requires: [] }]
    let called = false
    await filterByRequirements(tasks, {
      network: async () => {
        called = true
        return false
      },
    })

    expect(called).toBe(false)
  })

  test('reports unmet requirement in skip entry', async () => {
    const tasks: Task[] = [
      { name: 'cloud', requires: ['network'] },
      { name: 'local', requires: [] },
    ]
    const result = await filterByRequirements(tasks, {
      network: probe(false),
    })

    expect(result.ready).toEqual([tasks[1]!])
    expect(result.skipped).toEqual([{ task: tasks[0]!, unmet: ['network'] }])
  })
})
