---
# tm-48a2
title: tm run accepts tri-form names and uses canonical for lockfile, history, runs, logs
status: todo
type: feature
created_at: 2026-05-02T18:13:04Z
updated_at: 2026-05-02T18:13:04Z
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

- [ ] `tm run foo/bar`, `tm run foo/bar.md`, and `tm run foo_bar` all
      resolve to the same task and produce the same canonical name in
      logs and artifacts.
- [ ] Lock file, history dir, runs dir, prompt tempfile, and dispatch
      payload tempfile all use the canonical underscore name.
- [ ] JSONL log `task` field and history `task_name` field use canonical
      underscore form.
- [ ] An integration test covers the tri-form input claim against a
      nested fixture task, asserting identical lockfile path, history
      directory, and JSONL log entries across the three input forms.
- [ ] Existing flat-task `tm run` behavior is unchanged.

## User stories addressed

- User story 7
- User story 15
