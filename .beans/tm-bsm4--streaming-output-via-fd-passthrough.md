---
# tm-bsm4
title: Streaming output via fd passthrough
status: todo
type: task
created_at: 2026-04-09T10:37:52Z
updated_at: 2026-04-09T10:37:52Z
parent: tm-zaph
blocked_by:
    - tm-w7gs
---

## What to build

Replace the in-memory buffer collection in `defaultSpawnAgent` with fd passthrough: open the output file before spawning the agent, pass the fd for both stdout and stderr stdio slots, and read the file back after the process exits.

End-to-end: `executeTask` computes `history/<name>/<ts>.output.txt` path from the (now-available) timestamp → opens fd → `defaultSpawnAgent` uses `stdio: ['ignore', fd, fd]` → kernel streams output to file in real-time → on process close, close fd, read file back into `output` string → `recordHistory` skips writing output (it's already on disk via `outputPrewritten` flag).

This slice depends on the merged output model from tm-w7gs being in place, and on the timestamp being threaded into executeTask options from tm-fu5m.

See parent PRD (tm-zaph) for full context on the fd passthrough approach and `outputPrewritten` flag.

## Acceptance criteria

- [ ] `SpawnAgentOpts` gains `outputPath?: string`
- [ ] When `outputPath` provided: `defaultSpawnAgent` opens fd, passes as `stdio: ['ignore', fd, fd]`, closes on exit, reads file back
- [ ] When `outputPath` not provided: falls back to current pipe-based collection (backward compat for tests)
- [ ] `executeTask` computes output path from timestamp + config dir, creates history dir, passes to spawnAgent
- [ ] `recordHistory` accepts `outputPrewritten?: boolean` — when true, skips writing `.output.txt` to history dir
- [ ] `main.ts` sets `outputPrewritten: true` when calling `recordHistory` (since executeTask already streamed the file)
- [ ] Integration test: spawn a real child process, verify output file is populated during execution (not just at the end)
- [ ] Integration test: read-back string matches what the child process wrote

## User stories addressed

- User story 4 (output streams to disk in real-time)
- User story 5 (correct stdout+stderr interleaving via shared fd)
