import path from 'node:path'

import * as errore from 'errore'

import { envFilePath, taskFilePath } from '../config'
import type { EnvFileParseError, EnvFileReadError } from '../env'
import { buildEnv, loadEnvFile } from '../env'
import type {
  FrontmatterParseError,
  FrontmatterValidationError,
  TaskFileNameError,
  TaskFileReadError,
} from '../task'
import { parseTaskFile } from '../task'
import type { CwdNotDirectoryError, CwdNotFoundError } from './cwd'
import { resolveCwd } from './cwd'

// Errors --

export class ClaudeNotFoundError extends errore.createTaggedError({
  name: 'ClaudeNotFoundError',
  message: 'claude binary not found on PATH',
}) {}

// Types --

export type RunResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type SpawnClaudeOpts = {
  prompt: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

export type RunDeps = {
  spawnClaude: (
    opts: SpawnClaudeOpts,
  ) => Promise<ClaudeNotFoundError | RunResult>
}

type RunOptions = {
  configDir?: string
  deps?: Partial<RunDeps>
}

// Default implementation --

async function defaultSpawnClaude(
  opts: SpawnClaudeOpts,
): Promise<ClaudeNotFoundError | RunResult> {
  const claudePath = Bun.which('claude')
  if (!claudePath) {
    return new ClaudeNotFoundError()
  }

  const proc = Bun.spawn(['claude', '-p', ...opts.args], {
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

export type RunError =
  | TaskFileNameError
  | TaskFileReadError
  | FrontmatterParseError
  | FrontmatterValidationError
  | CwdNotFoundError
  | CwdNotDirectoryError
  | ClaudeNotFoundError
  | EnvFileReadError
  | EnvFileParseError

export async function runTask(
  name: string,
  options?: RunOptions,
): Promise<RunError | RunResult> {
  const configRoot = options?.configDir
  const filePath = configRoot
    ? path.join(configRoot, 'tasks', `${name}.md`)
    : taskFilePath(name)

  // S3.1: Parse task file
  const task = await parseTaskFile(filePath)
  if (task instanceof Error) return task

  // S3.6: Load and merge environment
  const envPath = configRoot ? path.join(configRoot, '.env') : envFilePath
  const globalEnv = await loadEnvFile(envPath)
  if (globalEnv instanceof Error) return globalEnv
  const env = buildEnv(globalEnv, task.env)

  // S3.4, S3.5: Resolve working directory
  const cwd = await resolveCwd(task.cwd)
  if (cwd instanceof Error) return cwd

  // S3.2, S3.3: Spawn claude
  const spawnClaude = options?.deps?.spawnClaude ?? defaultSpawnClaude
  const result = await spawnClaude({
    prompt: task.prompt,
    args: task.args,
    cwd: cwd.path,
    env,
  })
  if (result instanceof Error) return result

  return result
}
