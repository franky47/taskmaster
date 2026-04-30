import { logFilePath as defaultLogFilePath } from '#lib/config'
import { log as defaultLog } from '#lib/logger'

import type { HistoryWriteError } from './record'

type Deps = {
  log?: typeof defaultLog
  logFilePath?: string
  stderr?: (msg: string) => void
}

export function notifyHistoryWriteFailure(
  err: HistoryWriteError,
  taskName: string,
  deps?: Deps,
): void {
  const log = deps?.log ?? defaultLog
  const logFilePath = deps?.logFilePath ?? defaultLogFilePath
  const stderr = deps?.stderr ?? ((msg: string) => console.error(msg))

  log({ event: 'error', task: taskName, error: err }, logFilePath)
  stderr(err.message)
}
