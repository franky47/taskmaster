---
# tm-ymal
title: 'Deepen logger: Zod schema + readLog + log error check'
status: todo
type: task
priority: high
created_at: 2026-04-07T12:13:19Z
updated_at: 2026-04-07T12:13:19Z
parent: tm-py4h
---

## What to build

Refactor the existing `logger.ts` into a deep module that owns both reading and writing of the JSONL event log. This is the first vertical slice of the doctor feature (see parent PRD tm-py4h).

**Write path (refactor):** Replace the hand-written `LogEntry` type union with a Zod schema for the serialized on-disk format (including the `ts` ISO 8601 timestamp field). The schema is a discriminated union on the `event` field with three variants: `started`, `skipped`, and `error`. Infer the `LogEntry` type from the schema. The existing `log()` write function continues to work as before.

**Read path (new):** Add a `readLog(since, path?)` function that reads `log.jsonl`, parses each line, validates against the Zod schema, filters entries to those with `ts >= since`, and returns typed `LogEntry[]`. Malformed lines are silently skipped (same resilience pattern as history query).

**Log error check (new):** Add a `checkLogErrors(logEntries)` pure function in `doctor/checks.ts` that takes `LogEntry[]` and returns findings of `info` severity for any `error` events. This is the first check function and establishes the `Finding` discriminated union type that subsequent slices will extend.

Use the `typescript-advanced-types` skill for the Zod schema design.

## Acceptance criteria

- [ ] Zod schema is the single source of truth for the serialized log entry format
- [ ] `LogEntry` type is inferred from the Zod schema (no hand-written type)
- [ ] Existing `log()` write function still works (serialization unchanged)
- [ ] `readLog(since, path?)` parses JSONL, validates with Zod, filters by time window
- [ ] Malformed lines in the JSONL are silently skipped
- [ ] `checkLogErrors` returns info-severity findings for error events
- [ ] Finding type is a discriminated union on a `kind` field
- [ ] Tests cover: valid entries, malformed lines, time filtering, empty file, mixed entry types
- [ ] Tests for `checkLogErrors` with synthetic LogEntry arrays

## User stories addressed

- User story 14: Recent errors in event log visible to AI agent
