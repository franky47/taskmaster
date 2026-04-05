import { z } from 'zod'

const TASK_NAME_RE = /^[a-z0-9-]+$/

export const filenameSchema = z.string().refine((v) => TASK_NAME_RE.test(v), {
  error: (issue) => `Task name "${String(issue.input)}" must match [a-z0-9-]+`,
})
