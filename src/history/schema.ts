import { z } from 'zod'

export const historyMetaSchema = z.object({
  timestamp: z.string(),
  started_at: z.string(),
  finished_at: z.string(),
  duration_ms: z.number(),
  exit_code: z.number(),
  success: z.boolean(),
  timed_out: z.boolean().default(false),
})

export type HistoryMeta = z.infer<typeof historyMetaSchema>
