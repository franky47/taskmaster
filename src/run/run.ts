import type { SpawnOptions } from 'node:child_process'
import { spawn as nodeSpawn } from 'node:child_process'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'

import * as errore from 'errore'

import {
  type AgentNotFoundError,
  type AgentsFileReadError,
  type AgentsFileValidationError,
  resolveAgent,
} from '#lib/agent'
import {
  agentsFilePath as defaultAgentsFilePath,
  historyDir as defaultHistoryDir,
  locksDir as defaultLocksDir,
  envFilePath,
  taskFilePath,
} from '#lib/config'
import type { EnvFileParseError, EnvFileReadError } from '#lib/env'
import { buildEnv, loadEnvFile } from '#lib/env'
import {
  type LockAcquireError,
  TaskContentionError,
  acquireTaskLock,
} from '#lib/lock'
import { clearRunningMarker, writeRunningMarker } from '#lib/lock/marker'
import type {
  FrontmatterParseError,
  FrontmatterValidationError,
  TaskDefinition,
  TaskFileNameError,
  TaskFileReadError,
  TaskNotFoundError,
} from '#lib/task'
import { parseTaskFile } from '#lib/task'
import type { RunId } from '#src/history'
import type { PreflightErrorReason } from '#src/history/schema'

import type {
  CwdAccessError,
  CwdNotDirectoryError,
  CwdNotFoundError,
  ResolvedCwd,
} from './cwd'
import { resolveCwd } from './cwd'
import type { PromptFileWriteError } from './prompt'
import { cleanupPromptFile, writePromptFile } from './prompt'

// Types --

type PreflightOutcome = {
  exit_code: number
  duration_ms: number
  stdout: string
  stderr: string
  timed_out: boolean
  signaled: boolean
  error_reason?: PreflightErrorReason
}

type AgentRunResult = {
  kind: 'agent'
  exitCode: number
  output: string
  timedOut: boolean
  cwd: ResolvedCwd
  prompt: string
  startedAt: Date
  finishedAt: Date
  preflight?: PreflightOutcome
}

type PreflightSkipResult = {
  kind: 'skipped-preflight'
  cwd: ResolvedCwd
  prompt: string
  startedAt: Date
  finishedAt: Date
  preflight: PreflightOutcome
}

type PreflightErrorResult = {
  kind: 'preflight-error'
  cwd: ResolvedCwd
  prompt: string
  startedAt: Date
  finishedAt: Date
  preflight: PreflightOutcome
}

type RunResult = AgentRunResult | PreflightSkipResult | PreflightErrorResult

type SpawnAgentOpts = {
  command: string
  cwd: string
  env: Record<string, string>
  timeoutMs?: number
  outputPath?: string
}

type SpawnAgentResult = {
  exitCode: number
  output: string
  timedOut: boolean
}

export type SpawnPreflightOpts = {
  command: string
  cwd: string
  env: Record<string, string>
  timeoutMs: number
}

export type SpawnPreflightResult = {
  exit_code: number
  duration_ms: number
  stdout: string
  stderr: string
  timed_out: boolean
  signaled: boolean
}

type SpawnedChild = {
  pid: number | undefined
  exitCode: number | null
  stdout: Readable | null
  stderr: Readable | null
  on(event: 'close', listener: (code: number | null) => void): unknown
}

export type SpawnAgentDeps = {
  spawn: (cmd: string, args: string[], opts: SpawnOptions) => SpawnedChild
  killProcessGroup: (pid: number, signal: NodeJS.Signals) => void
}

export type ExecuteDeps = {
  spawnAgent: (opts: SpawnAgentOpts) => Promise<SpawnAgentResult>
  spawnPreflight: (opts: SpawnPreflightOpts) => Promise<SpawnPreflightResult>
}

type ExecuteOptions = {
  configDir?: string
  timestamp?: RunId
  trigger?: 'manual' | 'tick' | 'dispatch'
  event?: string
  payloadFile?: string
  lock?: boolean
  payload?: string
  deps?: Partial<ExecuteDeps>
}

// Command building --

type BuildCommandError =
  | AgentNotFoundError
  | AgentsFileReadError
  | AgentsFileValidationError

async function buildCommand(
  task: TaskDefinition,
  agentsConfigPath: string,
): Promise<string | BuildCommandError> {
  if ('agent' in task) {
    const template = await resolveAgent(task.agent, {
      configPath: agentsConfigPath,
    })
    if (template instanceof Error) return template
    return task.args ? `${template} ${task.args}` : template
  }
  return task.run
}

// Default implementation --

export const KILL_GRACE_MS = 10_000

function defaultKillProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch (e: unknown) {
    if (e instanceof Error && 'code' in e && e.code === 'ESRCH') {
      return // Process already dead — expected
    }
    const msg = e instanceof Error ? e.message : String(e)
    process.stderr.write(
      `tm: failed to kill process group ${pid}: ${msg} — process may still be running\n`,
    )
  }
}

const PREFLIGHT_TIMEOUT_MS = 60_000

async function defaultSpawnPreflight(
  opts: SpawnPreflightOpts,
  deps?: Partial<SpawnAgentDeps>,
): Promise<SpawnPreflightResult> {
  const spawnFn = deps?.spawn ?? nodeSpawn
  const killGroup = deps?.killProcessGroup ?? defaultKillProcessGroup

  return new Promise((resolve) => {
    const startedAt = Date.now()
    const child = spawnFn('sh', ['-c', opts.command], {
      cwd: opts.cwd,
      env: opts.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const pid = child.pid
    if (pid === undefined) {
      resolve({
        exit_code: 127,
        duration_ms: Date.now() - startedAt,
        stdout: '',
        stderr: `Failed to spawn process: ${opts.command}`,
        timed_out: false,
        signaled: false,
      })
      return
    }

    let timedOut = false
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    timeoutTimer = setTimeout(() => {
      if (child.exitCode !== null) return
      timedOut = true
      killGroup(pid, 'SIGTERM')
      graceTimer = setTimeout(() => {
        killGroup(pid, 'SIGKILL')
      }, KILL_GRACE_MS)
    }, opts.timeoutMs)

    child.on('close', (code: number | null) => {
      clearTimeout(timeoutTimer)
      clearTimeout(graceTimer)
      resolve({
        exit_code: code ?? 1,
        duration_ms: Date.now() - startedAt,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
        timed_out: timedOut,
        signaled: code === null && !timedOut,
      })
    })
  })
}

export async function defaultSpawnAgent(
  opts: SpawnAgentOpts,
  deps?: Partial<SpawnAgentDeps>,
): Promise<SpawnAgentResult> {
  const spawnFn = deps?.spawn ?? nodeSpawn
  const killGroup = deps?.killProcessGroup ?? defaultKillProcessGroup

  // fd passthrough: open output file and pass fd for both stdout and stderr
  const { outputPath } = opts
  const outputFd =
    outputPath !== undefined ? fs.openSync(outputPath, 'w') : undefined

  return new Promise((resolve) => {
    const child = spawnFn('sh', ['-c', opts.command], {
      cwd: opts.cwd,
      env: opts.env,
      detached: true,
      stdio:
        outputFd !== undefined
          ? ['ignore', outputFd, outputFd]
          : ['ignore', 'pipe', 'pipe'],
    })

    const pid = child.pid
    if (pid === undefined) {
      if (outputFd !== undefined) fs.closeSync(outputFd)
      resolve({
        exitCode: 127,
        output: `Failed to spawn process: ${opts.command}`,
        timedOut: false,
      })
      return
    }

    let timedOut = false
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    let graceTimer: ReturnType<typeof setTimeout> | undefined

    // Pipe-based collection (when no outputPath)
    const outputChunks: Buffer[] = []
    if (outputFd === undefined) {
      child.stdout?.on('data', (chunk: Buffer) => outputChunks.push(chunk))
      child.stderr?.on('data', (chunk: Buffer) => outputChunks.push(chunk))
    }

    if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (child.exitCode !== null) return
        timedOut = true
        killGroup(pid, 'SIGTERM')
        graceTimer = setTimeout(() => {
          killGroup(pid, 'SIGKILL')
        }, KILL_GRACE_MS)
      }, opts.timeoutMs)
    }

    child.on('close', (code: number | null) => {
      clearTimeout(timeoutTimer)
      clearTimeout(graceTimer)

      let output: string
      if (outputPath !== undefined) {
        if (outputFd !== undefined) fs.closeSync(outputFd)
        output = fs.readFileSync(outputPath, 'utf-8')
      } else {
        output = Buffer.concat(outputChunks).toString()
      }

      resolve({
        exitCode: code ?? 1,
        output,
        timedOut,
      })
    })
  })
}

// Public API --

type ExecuteError =
  | TaskFileNameError
  | TaskNotFoundError
  | TaskFileReadError
  | FrontmatterParseError
  | FrontmatterValidationError
  | CwdNotFoundError
  | CwdNotDirectoryError
  | CwdAccessError
  | AgentNotFoundError
  | AgentsFileReadError
  | AgentsFileValidationError
  | PromptFileWriteError
  | EnvFileReadError
  | EnvFileParseError

export async function executeTask(
  name: string,
  options?: ExecuteOptions,
): Promise<ExecuteError | RunResult> {
  const configRoot = options?.configDir
  const filePath = configRoot
    ? path.join(configRoot, 'tasks', `${name}.md`)
    : taskFilePath(name)

  const task = await parseTaskFile(filePath)
  if (task instanceof Error) return task

  const envPath = configRoot ? path.join(configRoot, '.env') : envFilePath
  const globalEnv = await loadEnvFile(envPath)
  if (globalEnv instanceof Error) return globalEnv
  const env = buildEnv(globalEnv, task.env)

  const cwd = await resolveCwd(task.cwd)
  if (cwd instanceof Error) return cwd

  const agentsConfigPath = configRoot
    ? path.join(configRoot, 'agents.yml')
    : defaultAgentsFilePath

  const command = await buildCommand(task, agentsConfigPath)
  if (command instanceof Error) return command

  const startedAt = new Date()

  const prompt = options?.payload
    ? `${task.prompt}\n---\n${options.payload}`
    : task.prompt

  // Build TM_* env additions
  const trigger = options?.trigger
  const tmEnv: Record<string, string> = { TM_TASK_NAME: name }
  if (trigger) tmEnv['TM_TRIGGER'] = trigger
  if (options?.timestamp) tmEnv['TM_RUN_TIMESTAMP'] = options.timestamp
  if (trigger === 'dispatch' && options?.event)
    tmEnv['TM_EVENT_NAME'] = options.event
  if (trigger === 'dispatch' && options?.payloadFile)
    tmEnv['TM_EVENT_PAYLOAD_FILE'] = options.payloadFile

  // Preflight stage
  let preflightOutcome: PreflightOutcome | undefined
  if (task.preflight) {
    const spawnPreflight =
      options?.deps?.spawnPreflight ?? defaultSpawnPreflight
    const pf = await spawnPreflight({
      command: task.preflight,
      cwd: cwd.path,
      env: { ...env, ...tmEnv },
      timeoutMs: PREFLIGHT_TIMEOUT_MS,
    })

    // timed_out / signaled win over exit_code: a process killed by SIGTERM
    // can still have its exit code reported as 0 by the kernel.
    const error_reason: PreflightErrorReason | undefined = pf.timed_out
      ? 'timeout'
      : pf.signaled
        ? 'signal'
        : pf.exit_code === 0 || pf.exit_code === 1
          ? undefined
          : 'nonzero'

    preflightOutcome = {
      exit_code: pf.exit_code,
      duration_ms: pf.duration_ms,
      stdout: pf.stdout,
      stderr: pf.stderr,
      timed_out: pf.timed_out,
      signaled: pf.signaled,
      ...(error_reason ? { error_reason } : {}),
    }

    // Persist <ts>.preflight.txt when timestamp is provided
    if (options?.timestamp) {
      const histDir = path.join(
        configRoot ? path.join(configRoot, 'history') : defaultHistoryDir,
        name,
      )
      await fsPromises.mkdir(histDir, { recursive: true })
      const body = `[stdout]\n${pf.stdout}\n[stderr]\n${pf.stderr}\n`
      await fsPromises.writeFile(
        path.join(histDir, `${options.timestamp}.preflight.txt`),
        body,
      )
    }

    if (pf.exit_code !== 0 || pf.timed_out || pf.signaled) {
      const finishedAt = new Date()
      const kind: 'skipped-preflight' | 'preflight-error' =
        pf.exit_code === 1 && !pf.timed_out && !pf.signaled
          ? 'skipped-preflight'
          : 'preflight-error'

      return {
        kind,
        cwd,
        prompt,
        startedAt,
        finishedAt,
        preflight: preflightOutcome,
      }
    }
  }

  const promptPath = writePromptFile(name, startedAt, prompt)
  if (promptPath instanceof Error) return promptPath

  // When timestamp is available, stream output to history dir via fd passthrough
  let outputPath: string | undefined
  if (options?.timestamp) {
    const histDir = path.join(
      configRoot ? path.join(configRoot, 'history') : defaultHistoryDir,
      name,
    )
    await fsPromises.mkdir(histDir, { recursive: true })
    outputPath = path.join(histDir, `${options.timestamp}.output.txt`)
  }

  const spawnAgent = options?.deps?.spawnAgent ?? defaultSpawnAgent

  try {
    const result = await spawnAgent({
      command,
      cwd: cwd.path,
      env: { ...env, ...tmEnv, TM_PROMPT_FILE: promptPath },
      timeoutMs: task.timeout,
      outputPath,
    })
    const finishedAt = new Date()

    return {
      kind: 'agent',
      ...result,
      cwd,
      prompt,
      startedAt,
      finishedAt,
      ...(typeof preflightOutcome !== 'undefined'
        ? { preflight: preflightOutcome }
        : {}),
    }
  } finally {
    cleanupPromptFile(promptPath)
  }
}

type RunError = ExecuteError | LockAcquireError | TaskContentionError

export async function runTask(
  name: string,
  options?: ExecuteOptions,
): Promise<RunError | RunResult> {
  if (!options?.lock) {
    return await executeTask(name, options)
  }

  const configRoot = options.configDir
  const lockDir = configRoot ? path.join(configRoot, 'locks') : defaultLocksDir

  const lockResult = acquireTaskLock(name, lockDir)
  if (lockResult instanceof Error) return lockResult
  if ('contended' in lockResult)
    return new TaskContentionError({ taskName: name })

  using lock = lockResult
  using cleanup = new errore.DisposableStack()

  if (options.timestamp) {
    writeRunningMarker(lock.fd, {
      pid: process.pid,
      started_at: new Date().toISOString(),
      timestamp: options.timestamp,
    })
    cleanup.defer(() => clearRunningMarker(lock.fd))
  }

  return await executeTask(name, options)
}
