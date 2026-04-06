import path from 'node:path'

import * as errore from 'errore'

import {
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
  TaskFileNameError,
  TaskFileReadError,
  TaskNotFoundError,
} from '../task'
import { parseTaskFile } from '../task'
import type { CwdNotDirectoryError, CwdNotFoundError, ResolvedCwd } from './cwd'
import { resolveCwd } from './cwd'

// Errors --

export class ClaudeNotFoundError extends errore.createTaggedError({
  name: 'ClaudeNotFoundError',
  message: 'claude binary not found on PATH',
}) {}

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

// AGENT(tm-5nbg): SpawnClaudeOpts is temporary; the executor refactor
// will replace this with agent-resolved command dispatch.
export type SpawnClaudeOpts = {
  prompt: string
  args: string
  cwd: string
  env: Record<string, string>
}

type SpawnClaudeResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type ExecuteDeps = {
  spawnClaude: (
    opts: SpawnClaudeOpts,
  ) => Promise<ClaudeNotFoundError | SpawnClaudeResult>
}

type ExecuteOptions = {
  configDir?: string
  deps?: Partial<ExecuteDeps>
}

// Default implementation --

async function defaultSpawnClaude(
  opts: SpawnClaudeOpts,
): Promise<ClaudeNotFoundError | SpawnClaudeResult> {
  const claudePath = Bun.which('claude')
  if (!claudePath) {
    return new ClaudeNotFoundError()
  }

  // AGENT(tm-5nbg): split args string for spawn; executor refactor will
  // replace this with agent-resolved command construction.
  const extraArgs = opts.args ? opts.args.split(/\s+/).filter(Boolean) : []
  const proc = Bun.spawn([claudePath, '-p', ...extraArgs], {
    stdin: new Response(opts.prompt),
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
  | ClaudeNotFoundError
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

  // AGENT(tm-5nbg): executor always calls Claude for now; the executor
  // refactor will dispatch to the resolved agent command instead.
  const spawnClaude = options?.deps?.spawnClaude ?? defaultSpawnClaude
  const startedAt = new Date()
  const result = await spawnClaude({
    prompt: task.prompt,
    args: 'agent' in task ? task.args : '',
    cwd: cwd.path,
    env,
  })
  const finishedAt = new Date()
  if (result instanceof Error) return result

  return {
    ...result,
    cwd,
    prompt: task.prompt,
    startedAt,
    finishedAt,
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
