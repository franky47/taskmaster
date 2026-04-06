---
# tm-35tg
title: Agent registry
status: todo
type: task
priority: high
created_at: 2026-04-05T22:41:25Z
updated_at: 2026-04-05T22:41:25Z
parent: tm-eu53
---

## What to build

A new module (`src/agent/`) that resolves agent names to invocation templates. This is the ONLY place in the codebase that mentions specific agent names.

### Built-in registry

A `Record<string, string>` constant:

```
claude   → claude -p < $TM_PROMPT_FILE
opencode → opencode run -f $TM_PROMPT_FILE
codex    → codex exec - < $TM_PROMPT_FILE
pi       → pi -p @$TM_PROMPT_FILE
```

### User overrides

Load `~/.config/taskmaster/agents.yml` (simple YAML: name → template string). Parse with `gray-matter` or raw YAML parser + Zod validation (`z.record(z.string(), z.string())`).

Resolution order: user file > built-in map > error.

### Interface

- `resolveAgent(name: string, opts?: { configDir?: string })` → `string | AgentNotFoundError | AgentsFileReadError | AgentsFileValidationError`
- `AgentNotFoundError` — includes the unknown name and lists available agents (built-in + user-defined)
- Config path: add `agentsFilePath` to `src/config.ts`

### Error types

- `AgentNotFoundError`: agent name not in builtins or user config
- `AgentsFileReadError`: agents.yml exists but can't be read
- `AgentsFileValidationError`: agents.yml is malformed (not a string→string map)

## Acceptance criteria

- [ ] `resolveAgent('claude')` returns `claude -p < $TM_PROMPT_FILE`
- [ ] `resolveAgent('pi')` returns `pi -p @$TM_PROMPT_FILE`
- [ ] `resolveAgent('unknown')` returns `AgentNotFoundError` listing available agents
- [ ] User agents.yml override takes precedence over built-in
- [ ] Custom agent in agents.yml resolves correctly
- [ ] Missing agents.yml falls back to built-ins (no error)
- [ ] Malformed agents.yml returns `AgentsFileValidationError`
- [ ] Unreadable agents.yml returns `AgentsFileReadError`
- [ ] `agentsFilePath` added to config module
