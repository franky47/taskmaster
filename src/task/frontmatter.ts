import { CronExpressionParser } from 'cron-parser'
import * as errore from 'errore'
import matter from 'gray-matter'
import { z } from 'zod'

const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'))

export type Frontmatter = z.output<typeof frontmatterSchema>

export type TaskDefinition = Frontmatter & {
  prompt: string
}

// Errors --

type FrontmatterError = {
  key: keyof z.input<typeof rawFrontmatter>
  message: string
}

export class FrontmatterParseError extends errore.createTaggedError({
  name: 'FrontmatterParseError',
  message: 'Invalid frontmatter: $reason',
}) {}

export class FrontmatterValidationError extends errore.createTaggedError({
  name: 'FrontmatterValidationError',
  message: '$summary',
}) {
  readonly errors: FrontmatterError[]
  constructor(args: { errors: FrontmatterError[]; cause?: unknown }) {
    const lines = args.errors.map((e) => `  - ${e.key}: ${e.message}`)
    super({
      ...args,
      summary: `Invalid frontmatter:\n${lines.join('\n')}`,
    })
    this.errors = args.errors
  }
}

// --

const UNQUOTED_STAR_RE = /^schedule:\s*[^"']*\*/m

function hasUnquotedStar(content: string): boolean {
  return UNQUOTED_STAR_RE.test(content)
}

function isFrontmatterField(
  key: string,
): key is keyof z.input<typeof rawFrontmatter> {
  return key in rawFrontmatter.shape
}

export function parseMarkdown(
  content: string,
): FrontmatterParseError | FrontmatterValidationError | TaskDefinition {
  const fm = errore.try({
    try: () => matter(content),
    catch: (cause) => {
      if (hasUnquotedStar(content)) {
        return new FrontmatterParseError({
          reason:
            'Cron expressions containing * must be quoted in YAML, e.g. schedule: "0 * * * *"',
          cause,
        })
      }
      return new FrontmatterParseError({
        reason: cause instanceof Error ? cause.message : String(cause),
        cause,
      })
    },
  })
  if (fm instanceof Error) return fm

  const result = frontmatterSchema.safeParse(fm.data)
  if (result.success) {
    return {
      ...result.data,
      prompt: fm.content.trim(),
    }
  }

  const flat = z.flattenError(result.error)
  const errors: FrontmatterError[] = []
  for (const [key, messages] of Object.entries(flat.fieldErrors)) {
    if (!isFrontmatterField(key)) {
      continue
    }
    for (const message of messages ?? []) {
      errors.push({ key, message })
    }
  }
  return new FrontmatterValidationError({ errors })
}

// --

const rawFrontmatter = z.object({
  schedule: z
    .string({
      error: (issue) =>
        issue.input === undefined || issue.input === null
          ? 'schedule is required'
          : 'schedule must be a string',
    })
    .superRefine((v, ctx) => {
      const fields = v.trim().split(/\s+/)
      if (fields.length !== 5) {
        ctx.addIssue({
          code: 'custom',
          message: `schedule must be a 5-field cron expression, got ${fields.length} fields`,
        })
        return
      }
      try {
        CronExpressionParser.parse(v)
      } catch (e) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid cron expression: ${e instanceof Error ? e.message : String(e)}`,
        })
      }
    }),

  timezone: z
    .string({ error: 'timezone must be a string' })
    .refine((v) => VALID_TIMEZONES.has(v), {
      error: (issue) => `"${String(issue.input)}" is not a valid IANA timezone`,
    })
    .optional(),

  cwd: z.string({ error: 'cwd must be a string' }).optional(),

  agent: z.string({ error: 'agent must be a string' }).optional(),

  run: z.string({ error: 'run must be a string' }).optional(),

  args: z.string({ error: 'args must be a string' }).optional().default(''),

  env: z
    .record(z.string(), z.string({ error: 'All env values must be strings' }), {
      error: 'env must be an object',
    })
    .optional()
    .default({}),

  enabled: z
    .boolean({ error: 'enabled must be a boolean' })
    .optional()
    .default(true),
})

const frontmatterSchema = rawFrontmatter
  .superRefine((data, ctx) => {
    const hasAgent = data.agent !== undefined
    const hasRun = data.run !== undefined

    if (hasAgent && hasRun) {
      ctx.addIssue({
        code: 'custom',
        path: ['agent'],
        message: 'exactly one of "agent" or "run" must be set, not both',
      })
      return
    }

    if (!hasAgent && !hasRun) {
      ctx.addIssue({
        code: 'custom',
        path: ['agent'],
        message: 'exactly one of "agent" or "run" must be set',
      })
      return
    }

    if (hasRun && data.args !== '') {
      ctx.addIssue({
        code: 'custom',
        path: ['args'],
        message: '"args" can only be used with "agent", not "run"',
      })
    }

    if (data.run !== undefined && !data.run.includes('TM_PROMPT_FILE')) {
      ctx.addIssue({
        code: 'custom',
        path: ['run'],
        message: '"run" must reference $TM_PROMPT_FILE',
      })
    }
  })
  .transform((data) => {
    const { agent, run, args, ...common } = data
    if (agent !== undefined) {
      return { ...common, agent, args }
    }
    if (run === undefined) {
      throw new Error(
        'invariant: superRefine guarantees exactly one of agent/run',
      )
    }
    return { ...common, run }
  })
