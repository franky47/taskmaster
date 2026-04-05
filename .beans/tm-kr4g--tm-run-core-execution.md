---
# tm-kr4g
title: tm run (core execution)
status: completed
type: feature
priority: high
created_at: 2026-04-04T19:53:36Z
updated_at: 2026-04-05T12:40:47Z
blocked_by:
    - tm-51fy
---

## What to build

The `tm run <name>` subcommand — the critical execution path. Parses the task file, strips frontmatter, sets up the environment (global .env + per-task env), resolves cwd (expanding ~, creating temp dir if omitted), writes the prompt to a temp file, pipes it to `claude -p` via stdin with args, and captures stdout/stderr/exit code. Ignores the enabled flag entirely.

See PRD Slice 3 for full specification.

## Acceptance criteria

- [x] `tm run <name>` reads the task file, strips YAML frontmatter, extracts the prompt body (S3.1)
- [x] Prompt body is written to a temp file and redirected to claude -p via stdin; fails with clear error if claude not on PATH (S3.2)
- [x] args from frontmatter are appended to the claude invocation (S3.3)
- [x] When cwd is specified, ~ is expanded to $HOME; fail early if directory does not exist (S3.4)
- [x] When cwd is omitted, a temp directory is created and used as cwd (S3.5)
- [x] Global .env is loaded, then per-task env is merged on top; result is passed to the claude process (S3.6)
- [x] Claude's stdout is captured and printed to tm's stdout (S3.7)
- [x] Claude's stderr and exit code are captured (S3.8)
- [x] `tm run` ignores the enabled flag entirely (S3.9)
- [x] Exit code reflects claude's exit code (S3.10)

## User stories addressed

- As a user, I run tm run daily-audit and Claude processes the prompt from the task file
- As a user, when my task specifies cwd, Claude runs in that directory
- As a user, when my task omits cwd, a temp directory is created and used
- As a user, tm run works even when the task has enabled: false


## Summary of Changes

Implemented `tm run <name>` with:
- Task file parsing via existing `parseTaskFile`
- `.env` loading with `node:util` `parseEnv`, layered as process.env → global .env → per-task env
- Working directory resolution with tilde expansion and temp dir creation
- Claude subprocess spawning with DI for testability
- Commander-based CLI entrypoint in `src/main.ts`
- 21 new tests covering env loading, cwd resolution, and the full run pipeline
