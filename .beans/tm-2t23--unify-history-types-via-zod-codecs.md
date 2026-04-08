---
# tm-2t23
title: Unify history types via Zod codecs
status: completed
type: task
priority: normal
created_at: 2026-04-08T13:21:17Z
updated_at: 2026-04-08T13:37:35Z
---

Use Zod 4 codecs to make historyMetaSchema the single source of truth for history entry types. Replace the manually-defined RecordHistoryInput with schema-derived types.

## Acceptance Criteria

- [x] Add isoDatetimeToDate codec for started_at / finished_at (bidirectional ISO string ↔ Date)
- [x] Add .refine() invariants: success === (exit_code === 0), duration_ms === finished_at - started_at
- [x] Delete RecordHistoryInput, derive write input as Omit<z.output<typeof historyMetaSchema>, 'success' | 'duration_ms'>
- [x] recordHistory takes (meta, artifacts) — computes success and duration_ms internally
- [x] queryHistory uses historyMetaSchema.decode() — consumers get Date objects, no re-wrapping
- [x] HistoryEntry = z.output<typeof historyMetaSchema> & { stderr_path: string | undefined }
- [x] Normalise to snake_case everywhere (field names in types, variables at call sites)
- [x] Update all callers (main.ts, doctor/checks.ts, status.ts, tick.ts)
- [x] All existing tests pass with updated signatures/assertions

## Design Decisions

- Schema is single source of truth; all types derived via z.input / z.output
- Zod codecs for Date fields; .refine() for derived field invariants
- snake_case everywhere (FS, schema, in-memory)
- Artifacts (stdout, stderr, prompt, cwd) stay as plain type — write-only, for human debugging
- stderr_path on query result is a plain type intersection, not schema-governed (derived from FS at query time)
- Module boundary unchanged: free functions behind index.ts, no class
- No backward compat concerns (greenfield)

Ref: https://github.com/franky47/taskmaster/issues/1
