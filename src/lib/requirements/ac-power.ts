import fs from 'node:fs/promises'
import path from 'node:path'

type AcPowerDeps = {
  platform?: NodeJS.Platform
  execPmset?: () => Promise<string>
  listPowerSupplies?: () => Promise<string[]>
  readPowerSupplyFile?: (
    name: string,
    field: 'type' | 'online',
  ) => Promise<string>
}

const LINUX_POWER_SUPPLY_ROOT = '/sys/class/power_supply'

async function defaultExecPmset(): Promise<string> {
  const proc = Bun.spawn(['pmset', '-g', 'ps'], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  return stdout
}

async function defaultListPowerSupplies(): Promise<string[]> {
  return fs.readdir(LINUX_POWER_SUPPLY_ROOT)
}

async function defaultReadPowerSupplyFile(
  name: string,
  field: 'type' | 'online',
): Promise<string> {
  return fs.readFile(path.join(LINUX_POWER_SUPPLY_ROOT, name, field), 'utf8')
}

async function probeDarwin(
  execPmset: NonNullable<AcPowerDeps['execPmset']>,
): Promise<boolean> {
  try {
    const output = await execPmset()
    return !/Now drawing from ['"]?Battery Power['"]?/.test(output)
  } catch {
    return true
  }
}

async function probeLinux(
  listPowerSupplies: NonNullable<AcPowerDeps['listPowerSupplies']>,
  readPowerSupplyFile: NonNullable<AcPowerDeps['readPowerSupplyFile']>,
): Promise<boolean> {
  let names: string[]
  try {
    names = await listPowerSupplies()
  } catch {
    return true
  }

  let foundMains = false
  let anyOnline = false
  for (const name of names) {
    let type: string
    try {
      type = await readPowerSupplyFile(name, 'type')
    } catch {
      return true
    }
    if (type.trim() !== 'Mains') continue

    foundMains = true
    let online: string
    try {
      online = await readPowerSupplyFile(name, 'online')
    } catch {
      return true
    }
    if (online.trim() === '1') {
      anyOnline = true
    }
  }

  if (!foundMains) return true
  return anyOnline
}

export async function isOnAcPower(deps: AcPowerDeps = {}): Promise<boolean> {
  const platform = deps.platform ?? process.platform
  if (platform === 'darwin') {
    return probeDarwin(deps.execPmset ?? defaultExecPmset)
  }
  if (platform === 'linux') {
    return probeLinux(
      deps.listPowerSupplies ?? defaultListPowerSupplies,
      deps.readPowerSupplyFile ?? defaultReadPowerSupplyFile,
    )
  }
  return true
}
