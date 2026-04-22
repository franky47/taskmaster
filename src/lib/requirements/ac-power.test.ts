import { describe, expect, test } from 'bun:test'

import { isOnAcPower } from './ac-power'

const PMSET_AC = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=12345)\t100%; charged; 0:00 remaining present: true
`

const PMSET_BATTERY = `Now drawing from 'Battery Power'
 -InternalBattery-0 (id=12345)\t85%; discharging; 3:21 remaining present: true
`

const PMSET_UNEXPECTED = `garbage output no drawing line`

describe('isOnAcPower', () => {
  describe('darwin', () => {
    test('returns true when pmset reports AC Power', async () => {
      const result = await isOnAcPower({
        platform: 'darwin',
        execPmset: async () => PMSET_AC,
      })
      expect(result).toBe(true)
    })

    test('returns false when pmset reports Battery Power', async () => {
      const result = await isOnAcPower({
        platform: 'darwin',
        execPmset: async () => PMSET_BATTERY,
      })
      expect(result).toBe(false)
    })

    test('fails open on unexpected pmset output', async () => {
      const result = await isOnAcPower({
        platform: 'darwin',
        execPmset: async () => PMSET_UNEXPECTED,
      })
      expect(result).toBe(true)
    })

    test('fails open when pmset exec throws', async () => {
      const result = await isOnAcPower({
        platform: 'darwin',
        execPmset: async () => {
          throw new Error('command not found')
        },
      })
      expect(result).toBe(true)
    })
  })

  describe('linux', () => {
    test('returns true when a Mains source reports online=1', async () => {
      const files: Record<string, Record<'type' | 'online', string>> = {
        AC: { type: 'Mains\n', online: '1\n' },
        BAT0: { type: 'Battery\n', online: '0\n' },
      }
      const result = await isOnAcPower({
        platform: 'linux',
        listPowerSupplies: async () => Object.keys(files),
        readPowerSupplyFile: async (name, field) => files[name]![field],
      })
      expect(result).toBe(true)
    })

    test('returns false when all Mains sources report online=0', async () => {
      const files: Record<string, Record<'type' | 'online', string>> = {
        AC: { type: 'Mains\n', online: '0\n' },
        BAT0: { type: 'Battery\n', online: '0\n' },
      }
      const result = await isOnAcPower({
        platform: 'linux',
        listPowerSupplies: async () => Object.keys(files),
        readPowerSupplyFile: async (name, field) => files[name]![field],
      })
      expect(result).toBe(false)
    })

    test('fails open when no Mains source is present (desktops)', async () => {
      const files: Record<string, Record<'type' | 'online', string>> = {
        BAT0: { type: 'Battery\n', online: '0\n' },
      }
      const result = await isOnAcPower({
        platform: 'linux',
        listPowerSupplies: async () => Object.keys(files),
        readPowerSupplyFile: async (name, field) => files[name]![field],
      })
      expect(result).toBe(true)
    })

    test('fails open when the power_supply root is unreadable', async () => {
      const result = await isOnAcPower({
        platform: 'linux',
        listPowerSupplies: async () => {
          throw new Error('ENOENT')
        },
        readPowerSupplyFile: async () => '',
      })
      expect(result).toBe(true)
    })

    test('fails open when a type file is unreadable', async () => {
      const result = await isOnAcPower({
        platform: 'linux',
        listPowerSupplies: async () => ['AC'],
        readPowerSupplyFile: async () => {
          throw new Error('EIO')
        },
      })
      expect(result).toBe(true)
    })

    test('fails open when a Mains online file is unreadable', async () => {
      const result = await isOnAcPower({
        platform: 'linux',
        listPowerSupplies: async () => ['AC'],
        readPowerSupplyFile: async (_name, field) => {
          if (field === 'type') return 'Mains\n'
          throw new Error('EIO')
        },
      })
      expect(result).toBe(true)
    })

    test('returns true if any Mains source is online, even when another fails', async () => {
      const result = await isOnAcPower({
        platform: 'linux',
        listPowerSupplies: async () => ['AC', 'AC1'],
        readPowerSupplyFile: async (name, field) => {
          if (field === 'type') return 'Mains\n'
          if (name === 'AC') throw new Error('EIO')
          return '1\n'
        },
      })
      expect(result).toBe(true)
    })
  })

  describe('other platforms', () => {
    test('fails open on win32', async () => {
      const result = await isOnAcPower({
        platform: 'win32',
        execPmset: async () => {
          throw new Error('should not be called')
        },
      })
      expect(result).toBe(true)
    })
  })
})
