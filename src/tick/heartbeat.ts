import fs from 'node:fs/promises'

import { z } from 'zod'

const heartbeatSchema = z.iso.datetime().transform((s) => new Date(s))

export async function writeHeartbeat(
  heartbeatPath: string,
  now: Date,
): Promise<void | Error> {
  try {
    await fs.writeFile(heartbeatPath, now.toISOString())
  } catch (e: unknown) {
    return e instanceof Error ? e : new Error(String(e))
  }
}

export async function readHeartbeat(
  heartbeatPath: string,
): Promise<Date | null> {
  let content: string
  try {
    content = await fs.readFile(heartbeatPath, 'utf-8')
  } catch {
    return null
  }
  const parsed = heartbeatSchema.safeParse(content.trim())
  return parsed.success ? parsed.data : null
}
