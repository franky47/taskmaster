---
# tm-w7gs
title: Merge stdout+stderr into single output
status: completed
type: task
priority: normal
created_at: 2026-04-09T10:37:26Z
updated_at: 2026-04-09T10:49:59Z
parent: tm-zaph
---

## What to build

Refactor the entire output pipeline from dual stdout/stderr streams to a single merged `output` string. This is a pure refactor — no new features, no streaming, no running state. It changes the data model that all subsequent slices build on.

End-to-end: `defaultSpawnAgent` returns `output` instead of `stdout`+`stderr` → `executeTask`/`RunResult` carries `output` → `recordHistory` writes `<ts>.output.txt` instead of separate `.stdout.txt`/`.stderr.txt` → `queryHistory` reads `.output.txt` (with `.stdout.txt` fallback for old entries) → `main.ts` CLI writes `result.output` to stdout.

See parent PRD (tm-zaph) for full context on the merged output model and backward compatibility decisions.

## Acceptance criteria

- [ ] `SpawnAgentResult` has `output: string` field (no `stdout`/`stderr`)
- [ ] `RunResult` has `output: string` field (no `stdout`/`stderr`)
- [ ] `defaultSpawnAgent` concatenates both streams into the single `output` buffer
- [ ] `recordHistory` writes `<ts>.output.txt` instead of `<ts>.stdout.txt` and `<ts>.stderr.txt`
- [ ] `RecordArtifacts` has `output: string` (no `stdout`/`stderr`)
- [ ] `queryHistory` reads `.output.txt`, falls back to `.stdout.txt` for old entries
- [ ] `HistoryEntry` replaces `stderr_path` with `output_path`
- [ ] `main.ts` run command writes `result.output` to process.stdout
- [ ] `main.ts` run command passes `output` to `recordHistory`
- [ ] All existing tests updated and passing
- [ ] Runs dir preservation on failure writes `output.txt` (not separate stdout/stderr)

## User stories addressed

- User story 5 (interleaved stdout+stderr in correct order)
- User story 14 (simplified single .output.txt format)
- User story 15 (backward compat with old .stdout.txt/.stderr.txt)
