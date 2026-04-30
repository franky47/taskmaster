import { describe, expect, test } from 'bun:test'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { HistoryArtifactWriteError, writeHistoryArtifact } from './artifact'
import { runIdSchema } from './timestamp'

async function makeConfigDir(): Promise<string> {
  return await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tm-artifact-'))
}

const ts = runIdSchema.parse('2026-04-30T10.00.00Z')

describe('writeHistoryArtifact', () => {
  test('preflight stage: writes file and returns history dir', async () => {
    const configRoot = await makeConfigDir()
    const result = await writeHistoryArtifact({
      stage: 'preflight',
      taskName: 'my-task',
      configRoot,
      timestamp: ts,
      body: '[stdout]\nhi\n[stderr]\n\n',
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result).toBe(path.join(configRoot, 'history', 'my-task'))
    const written = await fsPromises.readFile(
      path.join(result, `${ts}.preflight.txt`),
      'utf-8',
    )
    expect(written).toBe('[stdout]\nhi\n[stderr]\n\n')
  })

  test('prompt stage: writes file and returns history dir', async () => {
    const configRoot = await makeConfigDir()
    const result = await writeHistoryArtifact({
      stage: 'prompt',
      taskName: 'my-task',
      configRoot,
      timestamp: ts,
      body: 'resolved prompt body',
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result).toBe(path.join(configRoot, 'history', 'my-task'))
    const written = await fsPromises.readFile(
      path.join(result, `${ts}.prompt.txt`),
      'utf-8',
    )
    expect(written).toBe('resolved prompt body')
  })

  test('output-dir stage: creates dir and returns its path', async () => {
    const configRoot = await makeConfigDir()
    const result = await writeHistoryArtifact({
      stage: 'output-dir',
      taskName: 'my-task',
      configRoot,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result).toBe(path.join(configRoot, 'history', 'my-task'))
    const stat = await fsPromises.stat(result)
    expect(stat.isDirectory()).toBe(true)
  })

  test('preflight stage failure returns tagged error with stage=preflight', async () => {
    const configRoot = await makeConfigDir()
    // Make `<configRoot>/history` a file so mkdir of any subdir fails (ENOTDIR)
    await fsPromises.writeFile(path.join(configRoot, 'history'), 'block')

    const result = await writeHistoryArtifact({
      stage: 'preflight',
      taskName: 'my-task',
      configRoot,
      timestamp: ts,
      body: 'x',
    })

    expect(result).toBeInstanceOf(HistoryArtifactWriteError)
    if (!(result instanceof HistoryArtifactWriteError)) return
    expect(result.stage).toBe('preflight')
    expect(result.path).toContain('my-task')
    expect(result.message).toContain('preflight')
    expect(result.message).toContain('my-task')
  })

  test('prompt stage failure returns tagged error with stage=prompt', async () => {
    const configRoot = await makeConfigDir()
    // mkdir succeeds, but pre-create the prompt-file path as a directory
    // so writeFile fails with EISDIR.
    const histDir = path.join(configRoot, 'history', 'my-task')
    await fsPromises.mkdir(histDir, { recursive: true })
    await fsPromises.mkdir(path.join(histDir, `${ts}.prompt.txt`))

    const result = await writeHistoryArtifact({
      stage: 'prompt',
      taskName: 'my-task',
      configRoot,
      timestamp: ts,
      body: 'x',
    })

    expect(result).toBeInstanceOf(HistoryArtifactWriteError)
    if (!(result instanceof HistoryArtifactWriteError)) return
    expect(result.stage).toBe('prompt')
    expect(result.path).toContain(`${ts}.prompt.txt`)
  })

  test('output-dir stage failure returns tagged error with stage=output-dir', async () => {
    const configRoot = await makeConfigDir()
    await fsPromises.writeFile(path.join(configRoot, 'history'), 'block')

    const result = await writeHistoryArtifact({
      stage: 'output-dir',
      taskName: 'my-task',
      configRoot,
    })

    expect(result).toBeInstanceOf(HistoryArtifactWriteError)
    if (!(result instanceof HistoryArtifactWriteError)) return
    expect(result.stage).toBe('output-dir')
    expect(result.path).toContain('my-task')
  })

  test('error type is assignable to plain Error (handled by `instanceof Error` branch)', async () => {
    const configRoot = await makeConfigDir()
    await fsPromises.writeFile(path.join(configRoot, 'history'), 'block')

    const result = await writeHistoryArtifact({
      stage: 'output-dir',
      taskName: 'my-task',
      configRoot,
    })

    expect(result instanceof Error).toBe(true)
  })
})
