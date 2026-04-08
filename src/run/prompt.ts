import fs from 'node:fs'

import * as errore from 'errore'

import { formatTimestamp } from '#src/history'

// Errors --

export class PromptFileWriteError extends errore.createTaggedError({
  name: 'PromptFileWriteError',
  message: 'Failed to write prompt file "$path"',
}) {}

// Public API --

export function writePromptFile(
  taskName: string,
  timestamp: Date,
  content: string,
): PromptFileWriteError | string {
  const ts = formatTimestamp(timestamp)
  const filePath = `/tmp/tm-${ts}-${taskName}.prompt.md`
  const result = errore.try({
    try: () => fs.writeFileSync(filePath, content, { mode: 0o600 }),
    catch: (cause) => new PromptFileWriteError({ path: filePath, cause }),
  })
  if (result instanceof Error) return result
  return filePath
}

export function cleanupPromptFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath)
  } catch {
    // best-effort: cleanup failure should not disrupt the task result
  }
}
