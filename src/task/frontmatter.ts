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
  key: keyof Frontmatter
  message: string
}

export class FrontmatterParseError extends errore.createTaggedError({
  name: 'FrontmatterParseError',
  message: 'Invalid frontmatter format',
}) {}

export class FrontmatterValidationError extends errore.createTaggedError({
  name: 'FrontmatterValidationError',
  message: 'Failed to validate frontmatter contents',
}) {
  readonly errors: FrontmatterError[]
  constructor(args: { errors: FrontmatterError[]; cause?: unknown }) {
    super(args)
    this.errors = args.errors
  }
}

// --

function isFrontmatterField(key: string): key is keyof Frontmatter {
  return frontmatterSchema.shape.hasOwnProperty(key)
}

export function parseMarkdown(
  content: string,
): FrontmatterParseError | FrontmatterValidationError | TaskDefinition {
  const fm = errore.try({
    try: () => matter(content),
    catch: (cause) => new FrontmatterParseError({ cause }),
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

const frontmatterSchema = z.object({
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

  args: z
    .array(z.string({ error: 'All args values must be strings' }), {
      error: 'args must be an array',
    })
    .optional()
    .default([]),

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
