import type { Requirement } from '#lib/task'

export type Probe = () => Promise<boolean>
export type Probes = Partial<Record<Requirement, Probe>>

type HasRequirements = { requires: Requirement[] }

type SkippedEntry<T extends HasRequirements> = {
  task: T
  unmet: Requirement[]
}

type FilterResult<T extends HasRequirements> = {
  ready: T[]
  skipped: SkippedEntry<T>[]
}

export async function filterByRequirements<T extends HasRequirements>(
  tasks: readonly T[],
  probes: Probes,
): Promise<FilterResult<T>> {
  const referenced = new Set<Requirement>()
  for (const task of tasks) {
    for (const req of task.requires) {
      referenced.add(req)
    }
  }

  if (referenced.size === 0) {
    return { ready: [...tasks], skipped: [] }
  }

  const reqs = [...referenced]
  const results = await Promise.all(
    reqs.map(async (req) => {
      const probe = probes[req]
      const ok = probe ? await probe() : false
      return [req, ok] as const
    }),
  )
  const satisfied = new Map<Requirement, boolean>(results)

  const ready: T[] = []
  const skipped: SkippedEntry<T>[] = []
  for (const task of tasks) {
    const unmet = task.requires.filter((r) => satisfied.get(r) === false)
    if (unmet.length === 0) {
      ready.push(task)
    } else {
      skipped.push({ task, unmet })
    }
  }
  return { ready, skipped }
}
