import { isOnline } from '#lib/network'

import type { Probes } from './filter'

export const defaultProbes: Required<Probes> = {
  network: () => isOnline(),
}
