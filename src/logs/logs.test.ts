import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { getTaskLogs, NoLogsError } from './logs'

async function makeConfigDir(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-logs-'))
  await fs.mkdir(path.join(tmp, 'tasks'), { recursive: true })
  return tmp
}

async function writeTask(configDir: string, name: string): Promise<void> {
  await fs.writeFile(
    path.join(configDir, 'tasks', `${name}.md`),
    '---\nschedule: "0 * * * *"\nagent: opencode\n---\ndo stuff\n',
  )
}

async function writeHistory(
  configDir: string,
  taskName: string,
  timestamp: string,
  output: string,
): Promise<void> {
  const histDir = path.join(configDir, 'history', taskName)
  await fs.mkdir(histDir, { recursive: true })

  const started_at = timestamp.replace(/\./g, ':').replace(/Z$/, '.000Z')
  const meta = {
    timestamp,
    started_at,
    finished_at: started_at,
    duration_ms: 0,
    exit_code: 0,
    success: true,
  }
  await fs.writeFile(
    path.join(histDir, `${timestamp}.meta.json`),
    JSON.stringify(meta),
  )
  await fs.writeFile(path.join(histDir, `${timestamp}.output.txt`), output)
}

describe('getTaskLogs', () => {
  test('completed task returns print mode with output content', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task')
    await writeHistory(
      configDir,
      'my-task',
      '2026-04-05T12.00.00Z',
      'hello world\n',
    )

    const result = await getTaskLogs('my-task', { configDir })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.mode).toBe('print')
    if (result.mode !== 'print') return
    expect(result.content).toBe('hello world\n')
  })

  test('returns NoLogsError when not running and no history', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task')

    const result = await getTaskLogs('my-task', { configDir })
    expect(result).toBeInstanceOf(Error)
    if (!(result instanceof Error)) return
    expect(result.message).toContain('No logs available')
  })

  test('running task returns follow mode with output path', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task')

    // Write a running marker
    const locksDir = path.join(configDir, 'locks')
    await fs.mkdir(locksDir, { recursive: true })
    await fs.writeFile(
      path.join(locksDir, 'my-task.lock'),
      JSON.stringify({
        pid: process.pid,
        started_at: '2026-04-05T12:00:00.000Z',
        timestamp: '2026-04-05T12.00.00Z',
      }),
    )

    const result = await getTaskLogs('my-task', {
      configDir,
      markerDeps: { isProcessAlive: () => true },
    })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.mode).toBe('follow')
    if (result.mode !== 'follow') return
    expect(result.outputPath).toBe(
      path.join(
        configDir,
        'history',
        'my-task',
        '2026-04-05T12.00.00Z.output.txt',
      ),
    )
  })

  test('returns TaskNotFoundError for nonexistent task', async () => {
    const configDir = await makeConfigDir()

    const result = await getTaskLogs('no-such-task', { configDir })
    expect(result).toBeInstanceOf(Error)
    if (!(result instanceof Error)) return
    expect(result.message).toContain('no-such-task')
  })

  test('running task takes priority over completed history', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task')
    await writeHistory(
      configDir,
      'my-task',
      '2026-04-04T12.00.00Z',
      'old output',
    )

    // Write a running marker
    const locksDir = path.join(configDir, 'locks')
    await fs.mkdir(locksDir, { recursive: true })
    await fs.writeFile(
      path.join(locksDir, 'my-task.lock'),
      JSON.stringify({
        pid: process.pid,
        started_at: '2026-04-05T12:00:00.000Z',
        timestamp: '2026-04-05T12.00.00Z',
      }),
    )

    const result = await getTaskLogs('my-task', {
      configDir,
      markerDeps: { isProcessAlive: () => true },
    })
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.mode).toBe('follow')
  })

  test('returns NoLogsError when history has no output file', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task')

    // Write meta only, no output file
    const histDir = path.join(configDir, 'history', 'my-task')
    await fs.mkdir(histDir, { recursive: true })
    const meta = {
      timestamp: '2026-04-05T12.00.00Z',
      started_at: '2026-04-05T12:00:00.000Z',
      finished_at: '2026-04-05T12:00:00.000Z',
      duration_ms: 0,
      exit_code: 0,
      success: true,
    }
    await fs.writeFile(
      path.join(histDir, '2026-04-05T12.00.00Z.meta.json'),
      JSON.stringify(meta),
    )

    const result = await getTaskLogs('my-task', { configDir })
    expect(result).toBeInstanceOf(NoLogsError)
  })
})
