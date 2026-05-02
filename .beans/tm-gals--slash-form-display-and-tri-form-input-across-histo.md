---
# tm-gals
title: Slash-form display and tri-form input across history, logs, status, doctor, crontab
status: completed
type: feature
priority: normal
created_at: 2026-05-02T18:13:04Z
updated_at: 2026-05-02T19:29:55Z
parent: tm-rrzs
blocked_by:
    - tm-gegb
---

## What to build

Apply the canonical-vs-display split to the remaining read-side commands
and to crontab generation:

- `tm history`, `tm logs`, `tm status <name>`, and `tm doctor` route their
  CLI name argument through the normalizer at the argv boundary.
- Human-readable output (history headers, doctor report markdown, status
  text mode, error message bodies shown to users) uses the slash display
  form — implemented as a small helper that converts canonical underscore
  names to slash form at print time.
- Machine-readable output (`--json` payloads, JSONL fields) keeps the
  canonical underscore form.
- Crontab lines emitted by `schedule.ts` use the canonical underscore form
  for parser-stability and shell-quoting safety.

See parent PRD `tm-rrzs` for the full canonical-vs-display contract.

## Acceptance criteria

- [x] `tm history` and `tm logs` accept the three input forms via the
      normalizer. (`tm status` has no `<name>` arg in the current CLI;
      see Known follow-ups.)
- [x] `tm history` headers and `tm doctor` report markdown render task
      names in slash form.
- [x] `tm status` text mode renders task names in slash form; `--json`
      output keeps canonical underscore form.
- [x] N/A: `schedule.ts` only computes `minCronIntervalMs`; this codebase
      has no per-task crontab emission. Setup installs a single global
      `* * * * * tm tick` line. See Known follow-ups.
- [x] Existing tests are extended to cover at least one nested-task case
      for each affected command.

## User stories addressed

- User story 16
- User story 17

## Summary of Changes

- `src/main.ts` `tm history [name]` and `tm logs <name>` route argv through `normalizeTaskName(rawName, tasksDir)`. Global `tm history` text headers run task names through `toDisplayForm`. `tm status` text mode prints `toDisplayForm(task.name)` per row; `--json` keeps canonical.
- `src/doctor/report.ts` every finding renderer that carries a task name applies `toDisplayForm` to the header and to the `tm history`/`tm run` command suggestions. Cases switch to block scope to host a per-case `t = toDisplayForm(finding.task)` local for symmetry.
- `src/main.integration-test.ts` adds an end-to-end test: tm history accepts `group/task`, `group/task.md`, `group_task`; tm status text shows `group/task` while `--json` keeps `group_task`; tm history global headers show slash form; tm logs accepts tri-form input.
- `src/doctor/report.test.ts` adds a nested-task test asserting `group_backup` renders as `group/backup` in the header and command suggestions, with the canonical form absent.

## Known follow-ups

- **`tm status <name>`** — the original AC enumerated this entry point, but the current CLI has only `tm status` (lists all tasks). Adding a per-task detail/filter form is a separate behaviour change that needs its own design (filter? detail view?), so this slice deliberately does not add the `<name>` argument.
- **Per-task crontab emission** — `schedule.ts` exists only as `minCronIntervalMs`. There is no per-task crontab line generation anywhere in the tree (setup installs a single global `* * * * * tm tick` entry). Nothing to migrate.
