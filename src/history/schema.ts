import { z } from 'zod'

const isoDatetimeToDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
})

export const historyMetaSchema = z
  .object({
    timestamp: z.string(),
    started_at: isoDatetimeToDate,
    finished_at: isoDatetimeToDate,
    duration_ms: z.number(),
    exit_code: z.number(),
    success: z.boolean(),
    timed_out: z.boolean().default(false),
  })
  .refine(
    (m) => m.success === (m.exit_code === 0),
    'success must match exit_code === 0',
  )
  .refine(
    (m) => m.duration_ms === m.finished_at.getTime() - m.started_at.getTime(),
    'duration_ms must match finished_at - started_at',
  )

export type HistoryMeta = z.output<typeof historyMetaSchema>

export type HistoryMetaInput = Omit<HistoryMeta, 'success' | 'duration_ms'>
