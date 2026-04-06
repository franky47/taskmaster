import fs from 'node:fs/promises'
import { parseEnv } from 'node:util'

import * as errore from 'errore'

export class EnvFileReadError extends errore.createTaggedError({
  name: 'EnvFileReadError',
  message: 'Failed to read env file $path',
}) {}

export class EnvFileParseError extends errore.createTaggedError({
  name: 'EnvFileParseError',
  message: 'Failed to parse env file $path',
}) {}

export async function loadEnvFile(
  filePath: string,
): Promise<EnvFileReadError | EnvFileParseError | Record<string, string>> {
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return {}
    }
    return new EnvFileReadError({ path: filePath, cause: err })
  }
  try {
    const parsed = parseEnv(content)
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined) {
        result[key] = value
      }
    }
    return result
  } catch (err) {
    return new EnvFileParseError({ path: filePath, cause: err })
  }
}

export function buildEnv(
  globalEnv: Record<string, string>,
  taskEnv: Record<string, string>,
): Record<string, string> {
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      base[key] = value
    }
  }
  return {
    ...base,
    ...globalEnv,
    ...taskEnv,
  }
}
