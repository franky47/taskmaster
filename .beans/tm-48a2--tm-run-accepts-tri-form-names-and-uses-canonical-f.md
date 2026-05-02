---
# tm-48a2
title: tm run accepts tri-form names and uses canonical for lockfile, history, runs, logs
status: completed
type: feature
priority: normal
created_at: 2026-05-02T18:13:04Z
updated_at: 2026-05-02T19:22:45Z
parent: tm-rrzs
blocked_by:
    - tm-gegb
---

## What to build

`tm run <name>` accepts three input forms — `foo/bar.md`, `foo/bar`, and
`foo_bar` — by routing argv through the name normalizer at the boundary.
Once normalized, every downstream artifact is keyed by the canonical
underscore form: lockfile name (`locks/foo_bar.lock`), history directory
(`history/foo_bar/`), runs directory (`runs/foo_bar/<timestamp>/`), prompt
tempfile in `/tmp`, dispatch payload tempfile, JSONL `task` field, history
record `task_name` field, and the lock marker payload.

`taskFilePath` becomes a thin wrapper over the normalizer's `filePath`
output (or is replaced inline). `parseTaskFile` retains its frontmatter
parsing role; segment validation moves to the normalizer.

See parent PRD `tm-rrzs` for the canonical-vs-display split and the
rationale for centralizing argv-boundary normalization.

## Acceptance criteria

- [x] `tm run foo/bar`, `tm run foo/bar.md`, and `tm run foo_bar` all
      resolve to the same task and produce the same canonical name in
      logs and artifacts.
- [x] Lock file, history dir, runs dir, prompt tempfile, and dispatch
      payload tempfile all use the canonical underscore name.
- [x] JSONL log `task` field and history `task_name` field use canonical
      underscore form.
- [x] An integration test covers the tri-form input claim against a
      nested fixture task, asserting identical lockfile path, history
      directory, and JSONL log entries across the three input forms.
- [x] Existing flat-task `tm run` behavior is unchanged.

## User stories addressed

- User story 7
- User story 15

## Summary of Changes

- `src/main.ts` `tm run <rawName>` routes argv through `normalizeTaskName(rawName, tasksDir)`; downstream uses `name = normalized.canonical` so lockfile, history dir, runs dir, prompt tempfile, dispatch payload tempfile, JSONL `task`/history `task_name` fields all key on the canonical underscore form.
- `src/lib/task/name.ts` adds `taskFilePath(canonical, tasksDir)` (the inverse of canonical→path bijection) and `normalizeWalkRelativePath(rel, tasksDir)` (walker-only, splits on `/` only). The CLI `normalizeTaskName` keeps the tri-form `/` or `_` split.
- `src/lib/task/walk.ts` switches to `normalizeWalkRelativePath` so a flat `tasks/foo_bar.md` is correctly rejected as a bijection violation (basename has no `/` to split on, and the segment regex forbids `_`).
- `src/lib/task/parser.ts` drops the filename-validation block and `TaskFileNameError` class — segment validation lives in the normalizer now. Parser only does I/O + frontmatter.
- `src/lib/config.ts` no longer hosts `taskFilePath`; the canonical→path rule lives next to the normalizer in `src/lib/task/name.ts`. Tests moved alongside.
- `src/run/run.ts` uses `taskFilePath` uniformly (default-tasksDir branch and configRoot branch fold into one call).
- `src/history/query.ts` task-existence check uses `taskFilePath` so canonical→nested resolution works for tick-driven calls.
- `src/main.integration-test.ts` adds an end-to-end tri-form test: three runs (`group/task`, `group/task.md`, `group_task`) each with distinct `--timestamp` produce three meta files under `history/group_task/`, the only history directory created. JSONL `task` field is consistently `group_task`.

## Known follow-ups

- `tm history`, `tm logs`, `tm status <name>`, and `tm doctor` still pass raw user argv straight through to `queryHistory`/`getTaskLogs`/`readRunningMarker` without normalizing. Code-review caught that `tm history group/task` accidentally finds the source file (because `taskFilePath(group/task, tasksDir)` re-splits the embedded slash) but reads `history/group/task/` (an empty/missing dir) instead of `history/group_task/`. This is in scope for **tm-gals**, not this slice.
- Symbols in `lib/task` are now multi-purpose (`name.ts` owns the bijection, the CLI normalizer, the walker normalizer, display form, and `taskFilePath`). Consider splitting if it grows further.
