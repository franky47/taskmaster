---
# tm-mw4j
title: Prompt file management
status: todo
type: task
priority: high
created_at: 2026-04-05T22:41:32Z
updated_at: 2026-04-05T22:41:32Z
parent: tm-eu53
---

## What to build

A new module (`src/run/prompt.ts`) that writes the task prompt body to a temp file and cleans it up after execution.

### Writing

- Path pattern: `/tmp/tm-<timestamp>-<task-name>.prompt.md`
  - Timestamp: same format as history timestamps (dot-separated UTC)
  - Task name: the task's filename stem
- File permissions: `0600` (owner read/write only)
- Content: the stripped prompt body (markdown after frontmatter removal — already extracted by the parser)

### Cleanup

- Remove the temp file after the agent process exits
- Must clean up on both success AND failure (use `try/finally` or disposable pattern)
- If cleanup itself fails (file already removed, permissions changed), log but don't error — the task result matters more

### Interface

- `writePromptFile(taskName: string, timestamp: Date, content: string)` → `string` (the file path) or an error
- `cleanupPromptFile(path: string)` → `void`
- Consider using the `using` disposable pattern (already used for locks) to guarantee cleanup

## Acceptance criteria

- [ ] Writes prompt content to `/tmp/tm-<timestamp>-<task-name>.prompt.md`
- [ ] File has `0600` permissions
- [ ] File content matches the prompt body exactly
- [ ] `cleanupPromptFile` removes the file
- [ ] Cleanup of a non-existent file does not throw
- [ ] Path contains the timestamp and task name as specified
