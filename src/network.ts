import { Resolver } from 'node:dns/promises'

export type ResolverLike = {
  resolve(hostname: string): Promise<unknown>
}

export type ResolverFactory = (servers: readonly string[]) => ResolverLike

const PROBES = [
  { servers: ['1.1.1.1'], hostname: 'one.one.one.one' },
  { servers: ['8.8.8.8'], hostname: 'dns.google' },
] as const

const DEFAULT_TIMEOUT_MS = 2000

function defaultResolverFactory(servers: readonly string[]): ResolverLike {
  const resolver = new Resolver()
  resolver.setServers([...servers])
  return resolver
}

export async function isOnline(
  resolverFactory: ResolverFactory = defaultResolverFactory,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  const timers: ReturnType<typeof setTimeout>[] = []
  try {
    await Promise.any(
      PROBES.map(({ servers, hostname }) => {
        const resolver = resolverFactory(servers)
        return Promise.race([
          resolver.resolve(hostname),
          new Promise<never>((_, reject) => {
            timers.push(
              setTimeout(() => reject(new Error('timeout')), timeoutMs),
            )
          }),
        ])
      }),
    )
    return true
  } catch {
    return false
  } finally {
    timers.forEach(clearTimeout)
  }
}
