---
# tm-5nbg
title: 'Executor refactor: agent-agnostic sh -c runner'
status: completed
type: task
priority: high
created_at: 2026-04-05T22:41:49Z
updated_at: 2026-04-06T22:28:54Z
parent: tm-eu53
blocked_by:
    - tm-g3gd
    - tm-35tg
    - tm-mw4j
---

## What to build

Refactor the executor (`src/run/run.ts`) from Claude-specific to agent-agnostic. This is the integration slice — it wires together the agent registry, prompt file, and command building.

### Command building

Two paths:

1. **`agent:` path**: Resolve the agent name via the registry → get template string. Append `args` (space-separated). Final command: `<template> <args>`.
2. **`run:` path**: Use the `run` value as-is. No args appending.

### Execution

- Write prompt body to temp file (via prompt file module)
- Set `TM_PROMPT_FILE=<path>` in the process environment
- Execute via `Bun.spawn(['sh', '-c', command], { env, cwd, stdout: 'pipe', stderr: 'pipe' })`
- Capture stdout, stderr, exit code
- Clean up prompt file (success or failure)

### Renames

- `defaultSpawnClaude` → `defaultSpawnAgent`
- `ClaudeNotFoundError` → `AgentNotFoundError` (imported from agent registry module)
- `SpawnClaudeOpts` → `SpawnAgentOpts` — fields change:
  - Remove `prompt` (now handled via temp file)
  - Remove `args` (now baked into command string)
  - Add `command: string` (the fully resolved shell command)
  - Keep `cwd`, `env`
- `ExecuteDeps.spawnClaude` → `ExecuteDeps.spawnAgent`

### DI seam

Preserve the dependency injection pattern for testing. The `spawnAgent` function in `ExecuteDeps` receives the fully built command string + env (including `TM_PROMPT_FILE`), so tests can assert on the final command without needing a real agent binary.

## Acceptance criteria

- [x] `agent: claude` + `args: --model sonnet` produces the correct `sh -c` command
- [x] `run: my-agent $TM_PROMPT_FILE` produces the correct `sh -c` command (no args appended)
- [x] `TM_PROMPT_FILE` is set in the spawned process environment
- [x] Prompt file is written before agent spawns and cleaned up after it exits
- [x] Prompt file is cleaned up even when the agent fails (non-zero exit)
- [x] Agent registry errors (unknown agent, bad agents.yml) propagate correctly
- [x] All existing run tests updated and passing
- [x] `RunResult` and `RunError` types updated
- [x] History recording continues to work (it consumes `RunResult`, which still has stdout/stderr/exitCode)


## Summary of Changes

Refactored executor from Claude-specific to agent-agnostic. Command building
resolves agent templates via the registry or uses raw `run` values. Prompt files
are written to /tmp with TM_PROMPT_FILE in the spawned env, cleaned up in a
finally block. Execution uses `sh -c` instead of direct binary spawn.
ClaudeNotFoundError removed; agent/prompt errors now surface through ExecuteError.
24 tests (6 new for AC1-6, 18 updated renames).
