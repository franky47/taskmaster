import fsPromises from 'node:fs/promises'
import path from 'node:path'

import * as errore from 'errore'

import { historyDir as defaultHistoryDir } from '#lib/config'

import type { RunId } from './timestamp'

export class HistoryArtifactWriteError extends errore.createTaggedError({
  name: 'HistoryArtifactWriteError',
  message:
    'Failed to write history artifact for stage "$stage" at path "$path"',
}) {}

type WriteHistoryArtifactOpts =
  | {
      stage: 'preflight' | 'prompt'
      taskName: string
      configRoot?: string
      timestamp: RunId
      body: string
    }
  | {
      stage: 'output-dir'
      taskName: string
      configRoot?: string
    }

export async function writeHistoryArtifact(
  opts: WriteHistoryArtifactOpts,
): Promise<HistoryArtifactWriteError | string> {
  const histDir = path.join(
    opts.configRoot ? path.join(opts.configRoot, 'history') : defaultHistoryDir,
    opts.taskName,
  )

  const mkdirResult = await fsPromises
    .mkdir(histDir, { recursive: true })
    .catch(
      (cause: Error) =>
        new HistoryArtifactWriteError({
          stage: opts.stage,
          path: histDir,
          cause,
        }),
    )
  if (mkdirResult instanceof Error) return mkdirResult

  if (opts.stage === 'output-dir') return histDir

  const filePath = path.join(histDir, `${opts.timestamp}.${opts.stage}.txt`)
  const writeResult = await fsPromises.writeFile(filePath, opts.body).catch(
    (cause: Error) =>
      new HistoryArtifactWriteError({
        stage: opts.stage,
        path: filePath,
        cause,
      }),
  )
  if (writeResult instanceof Error) return writeResult

  return histDir
}
