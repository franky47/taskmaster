---
# tm-gals
title: Slash-form display and tri-form input across history, logs, status, doctor, crontab
status: todo
type: feature
created_at: 2026-05-02T18:13:04Z
updated_at: 2026-05-02T18:13:04Z
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

- [ ] `tm history`, `tm logs`, and `tm status <name>` accept the three
      input forms via the normalizer.
- [ ] `tm history` headers and `tm doctor` report markdown render task
      names in slash form.
- [ ] `tm status` text mode renders task names in slash form; `--json`
      output keeps canonical underscore form.
- [ ] Crontab generation in `schedule.ts` emits canonical underscore form.
- [ ] Existing tests are extended to cover at least one nested-task case
      for each affected command.

## User stories addressed

- User story 16
- User story 17
