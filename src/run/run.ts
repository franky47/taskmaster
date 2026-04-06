import path from 'node:path'

import * as errore from 'errore'

import {
  type AgentNotFoundError,
  type AgentsFileReadError,
  type AgentsFileValidationError,
  resolveAgent,
} from '../agent'
import {
  agentsFilePath as defaultAgentsFilePath,
  locksDir as defaultLocksDir,
  envFilePath,
  taskFilePath,
} from '../config'
import type { EnvFileParseError, EnvFileReadError } from '../env'
import { buildEnv, loadEnvFile } from '../env'
import {
  LockAcquireError,
  TaskContentionError,
  acquireTaskLock,
  releaseLock,
} from '../lock'
import type {
  FrontmatterParseError,
  FrontmatterValidationError,
  TaskDefinition,
  TaskFileNameError,
  TaskFileReadError,
  TaskNotFoundError,
} from '../task'
import { parseTaskFile } from '../task'
import type { CwdNotDirectoryError, CwdNotFoundError, ResolvedCwd } from './cwd'
import { resolveCwd } from './cwd'
import type { PromptFileWriteError } from './prompt'
import { cleanupPromptFile, writePromptFile } from './prompt'

// Types --

export type { ResolvedCwd }

export type RunResult = {
  exitCode: number
  stdout: string
  stderr: string
  cwd: ResolvedCwd
  prompt: string
  startedAt: Date
  finishedAt: Date
}

export type SpawnAgentOpts = {
  command: string
  cwd: string
  env: Record<string, string>
}

type SpawnAgentResult = {
  exitCode: number
  stdout: string
  stderr: string
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

async function defaultSpawnAgent(
  opts: SpawnAgentOpts,
): Promise<SpawnAgentResult> {
  const proc = Bun.spawn(['sh', '-c', opts.command], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: opts.cwd,
    env: opts.env,
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  const exitCode = await proc.exited

  return { exitCode, stdout, stderr }
}

// Public API --

export type ExecuteError =
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

export type RunError = ExecuteError | LockAcquireError | TaskContentionError

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
