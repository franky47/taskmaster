import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { readHeartbeat, writeHeartbeat } from './heartbeat'

async function tmpHeartbeatPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-heartbeat-'))
  return path.join(dir, 'heartbeat')
}

describe('heartbeat', () => {
  test('write then read returns the same instant', async () => {
    const heartbeatPath = await tmpHeartbeatPath()
    const now = new Date('2026-04-24T10:15:30.000Z')

    const writeResult = await writeHeartbeat(heartbeatPath, now)
    expect(writeResult).toBeUndefined()

    const readResult = await readHeartbeat(heartbeatPath)
    expect(readResult).toEqual(now)
  })

  test('read returns null when file does not exist', async () => {
    const heartbeatPath = await tmpHeartbeatPath()
    // never write

    const result = await readHeartbeat(heartbeatPath)
    expect(result).toBeNull()
  })

  test('read returns null for empty or whitespace-only content', async () => {
    const emptyPath = await tmpHeartbeatPath()
    await fs.writeFile(emptyPath, '')
    expect(await readHeartbeat(emptyPath)).toBeNull()

    const wsPath = await tmpHeartbeatPath()
    await fs.writeFile(wsPath, '   \n\t  ')
    expect(await readHeartbeat(wsPath)).toBeNull()
  })

  test('read returns null when content is not an ISO datetime', async () => {
    const cases = [
      'not a date',
      '2026-04-24', // date only, no time
      '2026-04-24T10:15:30', // missing Z
      '1745486130', // unix timestamp
    ]
    for (const content of cases) {
      const p = await tmpHeartbeatPath()
      await fs.writeFile(p, content)
      expect(await readHeartbeat(p)).toBeNull()
    }
  })

  test('write returns Error when target is unwritable', async () => {
    // Parent dir does not exist → fs.writeFile rejects
    const bogusPath = path.join(
      os.tmpdir(),
      'tm-heartbeat-missing-dir',
      'deep',
      'heartbeat',
    )
    const result = await writeHeartbeat(bogusPath, new Date())
    expect(result).toBeInstanceOf(Error)
  })
})
