import { describe, expect, test } from 'bun:test'

import { isOnline } from './network'
import type { ResolverFactory } from './network'

describe('isOnline', () => {
  test('returns true when both probes succeed', async () => {
    const factory: ResolverFactory = () => ({
      resolve: async () => {},
    })
    expect(await isOnline(factory)).toBe(true)
  })

  test('returns true when first probe fails and second succeeds', async () => {
    const factory: ResolverFactory = (servers) => ({
      resolve: async () => {
        if (servers.includes('1.1.1.1')) throw new Error('DNS timeout')
      },
    })
    expect(await isOnline(factory)).toBe(true)
  })

  test('returns true when second probe fails and first succeeds', async () => {
    const factory: ResolverFactory = (servers) => ({
      resolve: async () => {
        if (servers.includes('8.8.8.8')) throw new Error('DNS timeout')
      },
    })
    expect(await isOnline(factory)).toBe(true)
  })

  test('times out slow probes and returns false', async () => {
    const factory: ResolverFactory = () => ({
      resolve: () => new Promise(() => {}), // never resolves
    })
    expect(await isOnline(factory, 50)).toBe(false)
  })

  test('returns false when both probes fail', async () => {
    const factory: ResolverFactory = () => ({
      resolve: async () => {
        throw new Error('DNS timeout')
      },
    })
    expect(await isOnline(factory)).toBe(false)
  })
})
