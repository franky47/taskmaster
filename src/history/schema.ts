import { z } from 'zod'

import { runIdSchema } from './timestamp'

const isoDatetimeToDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
})

const triggerField = z.enum(['manual', 'tick', 'dispatch']).optional()

export const PREFLIGHT_ERROR_REASONS = [
  'nonzero',
  'signal',
  'timeout',
  'invalid-utf8',
  'oversize-stdout',
] as const
export type PreflightErrorReason = (typeof PREFLIGHT_ERROR_REASONS)[number]

const preflightBlockSchema = z.object({
  exit_code: z.number().int(),
  duration_ms: z.number().int().nonnegative(),
  stdout_bytes: z.number().int().nonnegative(),
  stderr_bytes: z.number().int().nonnegative(),
  error_reason: z.enum(PREFLIGHT_ERROR_REASONS).optional(),
})

const baseFields = {
  timestamp: runIdSchema,
  started_at: isoDatetimeToDate,
  finished_at: isoDatetimeToDate,
  duration_ms: z.number(),
  trigger: triggerField,
  event: z.string().optional(),
}

const agentRanMeta = z
  .object({
    ...baseFields,
    exit_code: z.number(),
    success: z.boolean(),
    timed_out: z.boolean().default(false),
    preflight: preflightBlockSchema.optional(),
  })
  .refine(
    (m) => m.success === (m.exit_code === 0),
    'success must match exit_code === 0',
  )
  .refine(
    (m) => m.duration_ms === m.finished_at.getTime() - m.started_at.getTime(),
    'duration_ms must match finished_at - started_at',
  )
  .refine(
    (m) => m.event === undefined || m.trigger === 'dispatch',
    'event is only valid when trigger is dispatch',
  )

const skippedPreflightMeta = z
  .object({
    ...baseFields,
    status: z.literal('skipped-preflight'),
    preflight: preflightBlockSchema,
  })
  .refine(
    (m) => m.duration_ms === m.finished_at.getTime() - m.started_at.getTime(),
    'duration_ms must match finished_at - started_at',
  )
  .refine(
    (m) => m.event === undefined || m.trigger === 'dispatch',
    'event is only valid when trigger is dispatch',
  )

const preflightErrorMeta = z
  .object({
    ...baseFields,
    status: z.literal('preflight-error'),
    preflight: preflightBlockSchema,
  })
  .refine(
    (m) => m.duration_ms === m.finished_at.getTime() - m.started_at.getTime(),
    'duration_ms must match finished_at - started_at',
  )
  .refine(
    (m) => m.event === undefined || m.trigger === 'dispatch',
    'event is only valid when trigger is dispatch',
  )

export const historyMetaSchema = z.union([
  agentRanMeta,
  skippedPreflightMeta,
  preflightErrorMeta,
])

export type HistoryMeta = z.output<typeof historyMetaSchema>

type AgentRanMeta = z.output<typeof agentRanMeta>
type SkippedPreflightMeta = z.output<typeof skippedPreflightMeta>
type PreflightErrorMeta = z.output<typeof preflightErrorMeta>

export function isAgentRanMeta<T extends HistoryMeta>(
  meta: T,
): meta is T & AgentRanMeta {
  return !('status' in meta)
}

export type HistoryMetaInput =
  | Omit<AgentRanMeta, 'success' | 'duration_ms'>
  | Omit<SkippedPreflightMeta, 'duration_ms'>
  | Omit<PreflightErrorMeta, 'duration_ms'>
