import type { SpawnOptions } from 'node:child_process'
import { spawn as nodeSpawn } from 'node:child_process'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'

import {
  type AgentNotFoundError,
  type AgentsFileReadError,
  type AgentsFileValidationError,
  resolveAgent,
} from '#src/agent'
import {
  agentsFilePath as defaultAgentsFilePath,
  historyDir as defaultHistoryDir,
  envFilePath,
  taskFilePath,
} from '#src/config'
import type { EnvFileParseError, EnvFileReadError } from '#src/env'
import { buildEnv, loadEnvFile } from '#src/env'
import type {
  FrontmatterParseError,
  FrontmatterValidationError,
  TaskDefinition,
  TaskFileNameError,
  TaskFileReadError,
  TaskNotFoundError,
} from '#src/task'
import { parseTaskFile } from '#src/task'

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

type RunResult = {
  exitCode: number
  output: string
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
  outputPath?: string
}

type SpawnAgentResult = {
  exitCode: number
  output: string
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
  timestamp?: string
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

  const promptPath = writePromptFile(name, startedAt, task.prompt)
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
      env: { ...env, TM_PROMPT_FILE: promptPath },
      timeoutMs: task.timeout,
      outputPath,
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
): Promise<ExecuteError | RunResult> {
  return await executeTask(name, options)
}
