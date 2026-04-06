import fs from 'node:fs/promises'

import * as errore from 'errore'
import matter from 'gray-matter'
import { z } from 'zod'

// Built-in agent registry --

const BUILTIN_AGENTS: Record<string, string> = {
  claude: 'claude -p < $TM_PROMPT_FILE',
  codex: 'codex exec - < $TM_PROMPT_FILE',
  opencode: 'opencode run -f $TM_PROMPT_FILE',
  pi: 'pi -p @$TM_PROMPT_FILE',
}

// Errors --

export class AgentNotFoundError extends errore.createTaggedError({
  name: 'AgentNotFoundError',
  message: 'Agent "$agentName" not found. Available agents: $availableList',
}) {
  readonly available: string[]
  constructor(args: {
    agentName: string
    available: string[]
    cause?: unknown
  }) {
    super({
      ...args,
      availableList: args.available.join(', '),
    })
    this.available = args.available
  }
}

export class AgentsFileReadError extends errore.createTaggedError({
  name: 'AgentsFileReadError',
  message: 'Failed to read agents file $path',
}) {}

export class AgentsFileValidationError extends errore.createTaggedError({
  name: 'AgentsFileValidationError',
  message: 'Invalid agents file $path: $reason',
}) {}

// Schema --

const agentsFileSchema = z.record(z.string(), z.string())

// --

type ResolveAgentOpts = {
  configPath?: string
}

export async function resolveAgent(
  name: string,
  opts?: ResolveAgentOpts,
): Promise<
  string | AgentNotFoundError | AgentsFileReadError | AgentsFileValidationError
> {
  const userAgents = opts?.configPath
    ? await loadAgentsFile(opts.configPath)
    : undefined

  if (userAgents instanceof Error) return userAgents

  const merged = { ...BUILTIN_AGENTS, ...userAgents }
  const template = merged[name]

  if (template !== undefined) return template

  const available = Object.keys(merged).sort()
  return new AgentNotFoundError({ agentName: name, available })
}

async function loadAgentsFile(
  filePath: string,
): Promise<
  | Record<string, string>
  | AgentsFileReadError
  | AgentsFileValidationError
  | undefined
> {
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return undefined
    }
    return new AgentsFileReadError({ path: filePath, cause: err })
  }

  let data: unknown
  try {
    // Reusing gray-matter to parse frontmatter-style YAML key-value pairs
    const parsed = matter(`---\n${content}\n---`)
    data = parsed.data
  } catch (err) {
    return new AgentsFileValidationError({
      path: filePath,
      reason: err instanceof Error ? err.message : String(err),
      cause: err,
    })
  }

  const result = agentsFileSchema.safeParse(data)
  if (!result.success) {
    const flat = z.flattenError(result.error)
    const messages = Object.entries(flat.fieldErrors)
      .map(([key, msgs]) => `${key}: ${(msgs ?? []).join(', ')}`)
      .join('; ')
    return new AgentsFileValidationError({
      path: filePath,
      reason: messages || 'values must be strings',
    })
  }

  const missingRef = Object.entries(result.data)
    .filter(([, template]) => !template.includes('TM_PROMPT_FILE'))
    .map(([name]) => name)
  if (missingRef.length > 0) {
    return new AgentsFileValidationError({
      path: filePath,
      reason: `agent template for ${missingRef.join(', ')} must reference $TM_PROMPT_FILE so the prompt can be passed to the agent`,
    })
  }

  return result.data
}
