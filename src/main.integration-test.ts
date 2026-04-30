import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

const MAIN_PATH = path.join(import.meta.dir, 'main.ts')
const TM_CMD = [process.execPath, MAIN_PATH] as const

const findingSchema = z.looseObject({ kind: z.string() })
const findingsSchema = z.array(findingSchema)

const agentEnvelopeSchema = z.object({
  skipped: z.literal(false),
  exitCode: z.number(),
  timedOut: z.boolean(),
  duration_ms: z.number(),
})

const payloadErrorEnvelopeSchema = z.object({
  payload_error: z.literal(true),
  error_reason: z.string(),
  taskName: z.string(),
})

const preflightOutcomeEnvelopeSchema = z.object({
  skipped: z.boolean(),
  preflight_error: z.boolean(),
  taskName: z.string(),
})

type CliResult = {
  stdout: string
  stderr: string
  exitCode: number
}

async function runCli(
  args: readonly string[],
  configDir: string,
  options: { home?: string } = {},
): Promise<CliResult> {
  const home = options.home ?? path.join(configDir, '.home')
  await fsPromises.mkdir(home, { recursive: true })
  const proc = Bun.spawn([...TM_CMD, ...args], {
    env: {
      PATH: process.env['PATH'],
      NODE_ENV: 'test',
      TM_CONFIG_DIR: configDir,
      HOME: home,
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

async function setupConfigDir(): Promise<string> {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tm-cli-'))
  await fsPromises.mkdir(path.join(dir, 'tasks'), { recursive: true })
  return dir
}

async function writeTask(
  configDir: string,
  name: string,
  body: string,
): Promise<void> {
  await fsPromises.writeFile(path.join(configDir, 'tasks', `${name}.md`), body)
}

const cleanupDirs: string[] = []

beforeEach(async () => {
  cleanupDirs.length = 0
})

afterEach(async () => {
  for (const dir of cleanupDirs) {
    await fsPromises.rm(dir, { recursive: true, force: true })
  }
})

async function makeIsolatedConfig(): Promise<string> {
  const dir = await setupConfigDir()
  cleanupDirs.push(dir)
  return dir
}

describe('tm doctor --json', () => {
  test('exits 0 with empty findings on a clean config', async () => {
    const configDir = await makeIsolatedConfig()
    // Fresh heartbeat avoids the heartbeat-missing finding
    await fsPromises.writeFile(
      path.join(configDir, 'heartbeat'),
      new Date().toISOString(),
    )
    // Fake-install scheduler under HOME/Library/LaunchAgents so the darwin
    // pathExists check passes. On linux we can't easily fake crontab -l, so
    // we filter scheduler-not-installed below to honour the "equivalent
    // empty-findings shape" carve-out in the AC.
    const home = path.join(configDir, '.home')
    await fsPromises.mkdir(home, { recursive: true })
    const launchAgents = path.join(home, 'Library', 'LaunchAgents')
    await fsPromises.mkdir(launchAgents, { recursive: true })
    await fsPromises.writeFile(
      path.join(launchAgents, 'com.47ng.taskmaster.tick.plist'),
      '<plist/>',
    )

    const result = await runCli(['doctor', '--json'], configDir, { home })

    expect(result.exitCode).toBe(0)
    const findings = findingsSchema.parse(JSON.parse(result.stdout))
    const filtered = findings.filter(
      (f) => f.kind !== 'scheduler-not-installed',
    )
    expect(filtered).toEqual([])
  })

  test('exits 1 with task-validation finding when a task is broken', async () => {
    const configDir = await makeIsolatedConfig()
    await fsPromises.writeFile(
      path.join(configDir, 'heartbeat'),
      new Date().toISOString(),
    )
    await writeTask(
      configDir,
      'broken',
      '---\non:\n  schedule: "not a cron"\nagent: opencode\n---\nHi',
    )

    const result = await runCli(['doctor', '--json'], configDir)

    expect(result.exitCode).toBe(1)
    const findings = findingsSchema.parse(JSON.parse(result.stdout))
    const validationFinding = findings.find((f) => f.kind === 'task-validation')
    expect(validationFinding).toBeDefined()
    expect(validationFinding?.['task']).toBe('broken')
  })
})

describe('tm run --json', () => {
  test('agent result emits envelope and exits with the agent exit code', async () => {
    const configDir = await makeIsolatedConfig()
    await writeTask(
      configDir,
      'agent-ok',
      [
        '---',
        'on:',
        '  schedule: "0 8 * * 1-5"',
        'run: "cat $TM_PROMPT_FILE > /dev/null"',
        '---',
        'Body.',
      ].join('\n'),
    )

    const result = await runCli(['run', 'agent-ok', '--json'], configDir)

    expect(result.exitCode).toBe(0)
    const envelope = agentEnvelopeSchema.parse(JSON.parse(result.stdout))
    expect(envelope.skipped).toBe(false)
    expect(envelope.exitCode).toBe(0)
    expect(envelope.timedOut).toBe(false)
  })

  test('agent result propagates non-zero exit code', async () => {
    const configDir = await makeIsolatedConfig()
    await writeTask(
      configDir,
      'agent-fail',
      [
        '---',
        'on:',
        '  schedule: "0 8 * * 1-5"',
        'run: "cat $TM_PROMPT_FILE > /dev/null; exit 42"',
        '---',
        'Body.',
      ].join('\n'),
    )

    const result = await runCli(['run', 'agent-fail', '--json'], configDir)

    expect(result.exitCode).toBe(42)
    const envelope = agentEnvelopeSchema.parse(JSON.parse(result.stdout))
    expect(envelope.skipped).toBe(false)
    expect(envelope.exitCode).toBe(42)
  })

  test('payload-error envelope on oversize payload', async () => {
    const configDir = await makeIsolatedConfig()
    await writeTask(
      configDir,
      'pay-task',
      [
        '---',
        'on:',
        '  event: deploy',
        'run: "cat $TM_PROMPT_FILE > /dev/null"',
        '---',
        'Body. <PAYLOAD/>',
      ].join('\n'),
    )

    const payloadPath = path.join(configDir, 'oversize.payload')
    await fsPromises.writeFile(payloadPath, 'a'.repeat(1024 * 1024 + 1))

    const result = await runCli(
      [
        'run',
        'pay-task',
        '--json',
        '--payload-file',
        payloadPath,
        '--trigger',
        'dispatch',
        '--event',
        'deploy',
      ],
      configDir,
    )

    expect(result.exitCode).toBe(0)
    const envelope = payloadErrorEnvelopeSchema.parse(JSON.parse(result.stdout))
    expect(envelope.payload_error).toBe(true)
    expect(envelope.error_reason).toBe('oversize')
    expect(envelope.taskName).toBe('pay-task')
  })

  test('skipped-preflight envelope when preflight exits 1', async () => {
    const configDir = await makeIsolatedConfig()
    await writeTask(
      configDir,
      'pf-skip',
      [
        '---',
        'on:',
        '  schedule: "0 8 * * 1-5"',
        'run: "cat $TM_PROMPT_FILE > /dev/null"',
        "preflight: 'exit 1'",
        '---',
        'Body.',
      ].join('\n'),
    )

    const result = await runCli(['run', 'pf-skip', '--json'], configDir)

    expect(result.exitCode).toBe(0)
    const envelope = preflightOutcomeEnvelopeSchema.parse(
      JSON.parse(result.stdout),
    )
    expect(envelope.skipped).toBe(true)
    expect(envelope.preflight_error).toBe(false)
    expect(envelope.taskName).toBe('pf-skip')
  })

  test('preflight-error envelope when preflight exits 2', async () => {
    const configDir = await makeIsolatedConfig()
    await writeTask(
      configDir,
      'pf-err',
      [
        '---',
        'on:',
        '  schedule: "0 8 * * 1-5"',
        'run: "cat $TM_PROMPT_FILE > /dev/null"',
        "preflight: 'exit 2'",
        '---',
        'Body.',
      ].join('\n'),
    )

    const result = await runCli(['run', 'pf-err', '--json'], configDir)

    expect(result.exitCode).toBe(0)
    const envelope = preflightOutcomeEnvelopeSchema.parse(
      JSON.parse(result.stdout),
    )
    expect(envelope.skipped).toBe(false)
    expect(envelope.preflight_error).toBe(true)
    expect(envelope.taskName).toBe('pf-err')
  })
})
