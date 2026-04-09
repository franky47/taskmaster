import { describe, expect, test } from 'bun:test'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { defaultSpawnAgent } from './run'

describe('defaultSpawnAgent fd passthrough', () => {
  test('output file is populated during execution, not just at the end', async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tm-fd-'))
    const outputPath = path.join(dir, 'output.txt')

    // Script: write "first", create marker, sleep, write "second"
    const markerPath = path.join(dir, 'marker')
    const command = [
      'echo first',
      `touch ${markerPath}`,
      'sleep 0.3',
      'echo second',
    ].join(' && ')

    const promise = defaultSpawnAgent({
      command,
      cwd: '/tmp',
      env: { PATH: process.env['PATH'] ?? '' },
      outputPath,
    })

    // Poll for marker file (indicates "first" has been written)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      try {
        await fsPromises.access(markerPath)
        break
      } catch {
        await new Promise((r) => setTimeout(r, 10))
      }
    }

    // Output file should already contain "first" while process is still running
    const partial = await fsPromises.readFile(outputPath, 'utf-8')
    expect(partial).toContain('first')

    const result = await promise
    expect(result.output).toContain('first')
    expect(result.output).toContain('second')
  })

  test('read-back string matches file on disk', async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tm-fd-'))
    const outputPath = path.join(dir, 'output.txt')

    const result = await defaultSpawnAgent({
      command: 'echo line1 && echo line2 >&2 && echo line3',
      cwd: '/tmp',
      env: { PATH: process.env['PATH'] ?? '' },
      outputPath,
    })

    const onDisk = await fsPromises.readFile(outputPath, 'utf-8')
    expect(result.output).toBe(onDisk)
  })
})

describe('defaultSpawnAgent (integration)', () => {
  test('kills entire process group including child processes', async () => {
    const result = await defaultSpawnAgent({
      command: 'sleep 60 & echo $!; wait',
      cwd: '/tmp',
      env: { PATH: process.env['PATH'] ?? '' },
      timeoutMs: 1000,
    })

    expect(result.timedOut).toBe(true)

    // Extract grandchild PID from stdout
    const grandchildPid = parseInt(result.output.trim())
    expect(grandchildPid).toBeGreaterThan(0)

    // Grandchild should be dead (killed with the process group)
    expect(() => process.kill(grandchildPid, 0)).toThrow()
  })
})
