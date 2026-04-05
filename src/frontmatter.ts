import { CronExpressionParser } from 'cron-parser'
import { z } from 'zod'

import type { ParseErrorField } from './types.ts'

const TASK_NAME_RE = /^[a-z0-9-]+$/

const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'))

export const filenameSchema = z.string().refine((v) => TASK_NAME_RE.test(v), {
  error: (issue) => `Task name "${String(issue.input)}" must match [a-z0-9-]+`,
})

export const frontmatterSchema = z.object({
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

  claude_args: z
    .array(z.string({ error: 'All claude_args values must be strings' }), {
      error: 'claude_args must be an array',
    })
    .optional(),

  env: z
    .record(z.string(), z.string({ error: 'All env values must be strings' }), {
      error: 'env must be an object',
    })
    .optional(),

  enabled: z.boolean({ error: 'enabled must be a boolean' }).optional(),
})

export type FrontmatterField = keyof z.output<typeof frontmatterSchema>

// Compile-time proof: every schema key is a valid ParseErrorField.
// If someone adds a schema field not in ParseErrorField, this line errors.
type _AssertFieldsValid = FrontmatterField extends ParseErrorField
  ? true
  : never
const _assertFieldsValid: _AssertFieldsValid = true
