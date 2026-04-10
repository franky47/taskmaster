import { z } from 'zod'

const isoDatetimeToDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
})

const triggerField = z.enum(['manual', 'tick', 'dispatch']).optional()

export const historyMetaSchema = z
  .object({
    timestamp: z.string(),
    started_at: isoDatetimeToDate,
    finished_at: isoDatetimeToDate,
    duration_ms: z.number(),
    exit_code: z.number(),
    success: z.boolean(),
    timed_out: z.boolean().default(false),
    trigger: triggerField,
    event: z.string().optional(),
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

export type HistoryMeta = z.output<typeof historyMetaSchema>

export type HistoryMetaInput = Omit<HistoryMeta, 'success' | 'duration_ms'>
