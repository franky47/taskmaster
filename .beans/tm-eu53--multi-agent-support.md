---
# tm-eu53
title: Multi-agent support
status: completed
type: epic
priority: high
created_at: 2026-04-05T22:40:56Z
updated_at: 2026-04-07T12:31:29Z
blocked_by:
    - tm-n9i7
    - tm-ho6e
---

## Problem Statement

Taskmaster is currently hardcoded to invoke Claude Code (`claude -p`). The binary name, the `-p` flag, and the stdin piping convention are all baked into the executor. Users who want to run scheduled tasks against other coding agents — OpenCode, Codex CLI, Pi, or any future tool — cannot do so without forking the codebase.

## Solution

Make taskmaster agent-agnostic. A task declares which agent to use and how via frontmatter. Taskmaster resolves the agent's invocation template (from a built-in registry or user config), writes the prompt body to a temp file, exposes its path as `$TM_PROMPT_FILE`, builds the final shell command, and executes it via `sh -c`. The prompt never touches the shell as a string — only as a file path — eliminating escaping issues.

Four agents ship as built-in defaults (Claude Code, OpenCode, Codex CLI, Pi). Users can override these or add custom agents in a single config file. A `run:` escape hatch allows fully custom invocations without any registry lookup.

## User Stories

1. As a user, I want to specify `agent: claude` in my task frontmatter, so that taskmaster knows how to invoke Claude Code without me spelling out the full command.
2. As a user, I want to specify `agent: codex` in my task frontmatter, so that I can run tasks against OpenAI's Codex CLI.
3. As a user, I want to specify `agent: opencode` in my task frontmatter, so that I can run tasks against OpenCode.
4. As a user, I want to specify `agent: pi` in my task frontmatter, so that I can run tasks against Pi.
5. As a user, I want to pass agent-specific flags via `args: --model sonnet-4.6 --verbose`, so that I can customize each task's invocation without changing the agent profile.
6. As a user, I want `args` to be a plain string (not an array), so that the frontmatter is easy to read and write.
7. As a user, I want to use `run: my-custom-agent < $TM_PROMPT_FILE --flag` for agents that taskmaster doesn't know about, so that I'm not limited to the built-in registry.
8. As a user, I want `agent:` and `run:` to be mutually exclusive with a clear validation error, so that I don't accidentally specify both.
9. As a user, I want `args:` to be rejected when used with `run:`, so that there's no ambiguity about where flags go.
10. As a user, I want `tm validate` to catch a `run:` field that doesn't reference `$TM_PROMPT_FILE`, so that I don't accidentally create a task that ignores its prompt.
11. As a user, I want to override a built-in agent template by adding an entry to `~/.config/taskmaster/agents.yml`, so that I can customize how a known agent is invoked globally.
12. As a user, I want to define entirely new agents in `agents.yml`, so that I can support any coding agent without waiting for a taskmaster release.
13. As a user, I want the prompt body written to a temp file at `/tmp/tm-<timestamp>-<task-name>.prompt.md`, so that the path is deterministic and debuggable.
14. As a user, I want the temp prompt file cleaned up after the agent exits (success or failure), so that `/tmp` doesn't accumulate stale files.
15. As a user, I want the temp prompt file created with restrictive permissions (0700 parent or 0600 file), so that other users on the system can't read my prompts.
16. As a user, I want agent resolution to check `agents.yml` first, then built-ins, so that my overrides always take precedence.
17. As a user, I want a clear error when `agent:` references an unknown name that isn't in built-ins or `agents.yml`, so that I know exactly what went wrong.
18. As a user, I want `tm list` and `tm status` to reflect the new `agent`/`run` fields, so that I can see which agent each task uses.
19. As a user, I want `tm history` to continue working unchanged, since it only cares about exit codes, stdout, and stderr — not how the agent was invoked.

## Implementation Decisions

- **Agent registry**: A single module that is the ONLY place in the codebase referencing specific agent names. Contains a `Record<string, string>` mapping agent names to their invocation templates (e.g. `claude` → `claude -p < $TM_PROMPT_FILE`). Loads user overrides from `~/.config/taskmaster/agents.yml`. Resolution order: user file > built-in map > error.
- **Built-in agents** (invocation templates):
  - `claude`: `claude -p < $TM_PROMPT_FILE`
  - `opencode`: `opencode run -f $TM_PROMPT_FILE`
  - `codex`: `codex exec - < $TM_PROMPT_FILE`
  - `pi`: `pi -p @$TM_PROMPT_FILE`
- **Frontmatter schema changes**:
  - Add `agent` (string, optional) — name of a registered agent
  - Add `run` (string, optional) — raw shell command with `$TM_PROMPT_FILE`
  - Change `args` from `z.array(z.string())` to `z.string()` — plain string appended to the resolved template
  - Cross-field validation via Zod `.superRefine`: exactly one of `agent`/`run` required; `args` only valid with `agent`; `run` must contain the literal string `TM_PROMPT_FILE`
  - Remove any Claude-specific assumptions from the schema
- **Prompt file management**: New module that writes the stripped prompt body (markdown after frontmatter) to `/tmp/tm-<timestamp>-<task-name>.prompt.md` with `0700` parent directory permissions. Cleanup is guaranteed via `try/finally` or `using` (disposable pattern already used for locks).
- **Command building**: When using `agent:`, the final command is `<resolved-template> <args>` (string concatenation). When using `run:`, the command is used as-is. Both are executed via `sh -c` with `TM_PROMPT_FILE` set in the process environment.
- **Executor refactor**: `defaultSpawnClaude` becomes `defaultSpawnAgent`. The function runs `sh -c <command>` with the merged environment (system + global .env + task env + `TM_PROMPT_FILE`). `ClaudeNotFoundError` becomes `AgentNotFoundError`. The `SpawnClaudeOpts` type becomes `SpawnAgentOpts`. The DI seam (`ExecuteDeps`) is preserved for testing.
- **Config**: Add `agentsFilePath` to the config module pointing to `~/.config/taskmaster/agents.yml`.
- **agents.yml format**: Simple YAML mapping of name to command template string. Parsed and validated with Zod. Example:
  ```yaml
  claude: claude -p < $TM_PROMPT_FILE
  my-agent: my-agent --prompt-file $TM_PROMPT_FILE
  ```
- **Security model**: The prompt body never appears in the shell command string — only the file path does, via `$TM_PROMPT_FILE` env var. The `run` and `args` fields are user-authored (same trust model as crontab). Temp files use restrictive permissions and are cleaned up after execution.

## Testing Decisions

Good tests verify external behavior (inputs → outputs/effects) without coupling to implementation details. The existing test suite follows this pattern well — parsing tests feed fixture files and assert on discriminated union results; executor tests use DI to inject a mock spawn function.

**Agent registry** — test in isolation:
- Resolves a built-in agent name to its template
- Returns error for unknown agent name
- User override in agents.yml takes precedence over built-in
- User-defined custom agent in agents.yml resolves correctly
- Malformed agents.yml returns a validation error
- Missing agents.yml file falls back to built-ins only

**Frontmatter schema** — extend existing tests:
- `agent:` field accepted, `run:` field accepted
- Mutual exclusivity: both `agent` and `run` → validation error
- Neither `agent` nor `run` → validation error
- `args` with `run:` → validation error
- `args` as string accepted (not array)
- `run:` without `TM_PROMPT_FILE` reference → validation error

**Prompt file** — test in isolation:
- Writes content to expected path pattern
- File has restrictive permissions
- Cleanup removes the file
- Path contains timestamp and task name

**Executor** — extend existing DI-based tests:
- Builds correct command from agent template + args
- Builds correct command from raw run field
- Sets `TM_PROMPT_FILE` in the process environment
- Prompt file is cleaned up after success
- Prompt file is cleaned up after failure

**Prior art**: `src/task/frontmatter.test.ts` (schema validation), `src/run/run.test.ts` (DI-based executor tests), `src/lock/lock.test.ts` (system-level tests with cleanup).

## Out of Scope

- Migration tooling for existing task files (clean slate, no backwards compatibility)
- Changes to `tm tick`, `tm setup`, or `tm teardown` (not yet implemented, will use the new executor when built)
- Agent-specific model validation (model names are opaque strings passed through)
- Stdin-based prompt passing (all agents receive prompts via temp file + shell mechanisms)
- Blocking or warning on dangerous env var overrides (PATH, LD_PRELOAD, etc.)
- `tm list` and `tm status` display changes (can be done as a follow-up)

## Further Notes

- The `agents.yml` format is intentionally minimal (name → template string) to keep contributions easy. Adding a new built-in agent is a one-line change to the registry map.
- The `$TM_PROMPT_FILE` env var approach means tm has zero custom template syntax — the shell is the template engine.
- The built-in agent templates may need updating as agent CLIs evolve. The user override mechanism ensures this never blocks users.
