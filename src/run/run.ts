import type { SpawnOptions } from 'node:child_process'
import { spawn as nodeSpawn } from 'node:child_process'
import path from 'node:path'
import type { Readable } from 'node:stream'

import * as errore from 'errore'

import {
  type AgentNotFoundError,
  type AgentsFileReadError,
  type AgentsFileValidationError,
  resolveAgent,
} from '#src/agent'
import {
  agentsFilePath as defaultAgentsFilePath,
  locksDir as defaultLocksDir,
  envFilePath,
  taskFilePath,
} from '#src/config'
import type { EnvFileParseError, EnvFileReadError } from '#src/env'
import { buildEnv, loadEnvFile } from '#src/env'
import {
  LockAcquireError,
  TaskContentionError,
  acquireTaskLock,
  releaseLock,
} from '#src/lock'
import type {
  FrontmatterParseError,
  FrontmatterValidationError,
  TaskDefinition,
  TaskFileNameError,
  TaskFileReadError,
  TaskNotFoundError,
} from '#src/task'
import { parseTaskFile } from '#src/task'

import type { CwdNotDirectoryError, CwdNotFoundError, ResolvedCwd } from './cwd'
import { resolveCwd } from './cwd'
import type { PromptFileWriteError } from './prompt'
import { cleanupPromptFile, writePromptFile } from './prompt'

// Types --

type RunResult = {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  cwd: ResolvedCwd
  prompt: string
  startedAt: Date
  finishedAt: Date
}

type SpawnAgentOpts = {
  command: string
  cwd: string
  env: Record<string, string>
  timeoutMs?: number
}

type SpawnAgentResult = {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
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
}

type ExecuteOptions = {
  configDir?: string
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
  } catch {
    // Process may already be dead
  }
}

export async function defaultSpawnAgent(
  opts: SpawnAgentOpts,
  deps?: Partial<SpawnAgentDeps>,
): Promise<SpawnAgentResult> {
  const spawnFn = deps?.spawn ?? nodeSpawn
  const killGroup = deps?.killProcessGroup ?? defaultKillProcessGroup

  return new Promise((resolve) => {
    const child = spawnFn('sh', ['-c', opts.command], {
      cwd: opts.cwd,
      env: opts.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const pid = child.pid
    if (pid === undefined) {
      resolve({ exitCode: 1, stdout: '', stderr: '', timedOut: false })
      return
    }

    let timedOut = false
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    let graceTimer: ReturnType<typeof setTimeout> | undefined

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

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
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
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
  | AgentNotFoundError
  | AgentsFileReadError
  | AgentsFileValidationError
  | PromptFileWriteError
  | EnvFileReadError
  | EnvFileParseError

type RunError = ExecuteError | LockAcquireError | TaskContentionError

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

  const promptPath = writePromptFile(name, startedAt, task.prompt)
  if (promptPath instanceof Error) return promptPath

  const spawnAgent = options?.deps?.spawnAgent ?? defaultSpawnAgent

  try {
    const result = await spawnAgent({
      command,
      cwd: cwd.path,
      env: { ...env, TM_PROMPT_FILE: promptPath },
      timeoutMs: task.timeout,
    })
    const finishedAt = new Date()

    return {
      ...result,
      cwd,
      prompt: task.prompt,
      startedAt,
      finishedAt,
    }
  } finally {
    cleanupPromptFile(promptPath)
  }
}

export async function runTask(
  name: string,
  options?: ExecuteOptions,
): Promise<RunError | RunResult> {
  const configRoot = options?.configDir
  const lockDir = configRoot ? path.join(configRoot, 'locks') : defaultLocksDir

  const lock = acquireTaskLock(name, lockDir)
  if (lock instanceof Error) return lock
  if ('contended' in lock) return new TaskContentionError({ taskName: name })

  using cleanup = new errore.DisposableStack()
  cleanup.defer(() => releaseLock(lock.fd))

  return await executeTask(name, options)
}
