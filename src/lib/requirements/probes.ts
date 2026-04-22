import { isOnline } from '#lib/network'

import { isOnAcPower } from './ac-power'
import type { Probes } from './filter'

export const defaultProbes: Required<Probes> = {
  network: () => isOnline(),
  'ac-power': () => isOnAcPower(),
}
