import fs from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { runIdSchema } from '#src/history'

// Schema --

export const RunningMarkerSchema = z.object({
  pid: z.number().int().positive(),
  started_at: z.iso.datetime(),
  timestamp: runIdSchema,
})

export type RunningMarker = z.infer<typeof RunningMarkerSchema>

// Write / clear --

export function writeRunningMarker(fd: number, marker: RunningMarker): void {
  fs.ftruncateSync(fd, 0)
  fs.writeSync(fd, JSON.stringify(marker), 0)
}

export function clearRunningMarker(fd: number): void {
  fs.ftruncateSync(fd, 0)
}

// Read --

export type ReadMarkerDeps = {
  isProcessAlive?: (pid: number) => boolean
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function readRunningMarker(
  taskName: string,
  locksDir: string,
  deps?: ReadMarkerDeps,
): RunningMarker | null {
  const lockPath = path.join(locksDir, `${taskName}.lock`)

  let content: string
  try {
    content = fs.readFileSync(lockPath, 'utf-8')
  } catch {
    return null
  }

  if (!content.trim()) return null

  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    return null
  }

  const result = RunningMarkerSchema.safeParse(json)
  if (!result.success) return null

  const isAlive = deps?.isProcessAlive ?? defaultIsProcessAlive
  if (!isAlive(result.data.pid)) return null

  return result.data
}
