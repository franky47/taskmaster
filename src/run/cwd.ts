import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import * as errore from 'errore'

export class CwdNotFoundError extends errore.createTaggedError({
  name: 'CwdNotFoundError',
  message: 'Working directory "$path" does not exist',
}) {}

export class CwdNotDirectoryError extends errore.createTaggedError({
  name: 'CwdNotDirectoryError',
  message: 'Working directory "$path" is not a directory',
}) {}

export function expandTilde(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

export type ResolvedCwd = {
  path: string
  is_temp: boolean
}

export async function resolveCwd(
  cwd: string | undefined,
): Promise<CwdNotFoundError | CwdNotDirectoryError | ResolvedCwd> {
  if (cwd === undefined) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmaster-'))
    return { path: tmpDir, is_temp: true }
  }

  const resolved = expandTilde(cwd)
  try {
    const stat = await fs.stat(resolved)
    if (!stat.isDirectory()) {
      return new CwdNotDirectoryError({ path: resolved })
    }
    return { path: resolved, is_temp: false }
  } catch {
    return new CwdNotFoundError({ path: resolved })
  }
}
