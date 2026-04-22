# Taskmaster

Schedule recurring AI agent tasks from markdown files.

Each task is a `.md` file with YAML frontmatter (`on`, executor, options) and a markdown prompt body. A per-minute heartbeat evaluates which scheduled tasks are due and dispatches them.

## Install

Requires [Bun](https://bun.sh) and at least one supported agent on PATH (e.g. [Claude Code](https://docs.anthropic.com/en/docs/claude-code)).

```sh
bun install
bun run build   # compiles to ./tm
```

## Quick Start

```sh
# Install the per-minute scheduler (launchd on macOS, crontab on Linux)
tm setup

# Create a task
mkdir -p ~/.config/taskmaster/tasks
cat > ~/.config/taskmaster/tasks/daily-audit.md << 'EOF'
---
on:
  schedule: '0 8 * * 1-5'
agent: claude
timezone: 'Europe/Paris'
cwd: '~/projects/saas-app'
---

Review package.json for dependencies with known CVEs.
Run `npm audit` and output a short markdown summary.
EOF

# Validate, run, and monitor
tm validate
tm run daily-audit
tm status
tm history daily-audit
tm doctor
```

## Task File Format

Tasks live in `~/.config/taskmaster/tasks/` as markdown files.
The filename (minus `.md`) is the task ID and must match `[a-z0-9-]+`.

### Frontmatter Fields

| Field | Required | Default | Description |
|---|---|---|---|
| `on` | **yes** | | Trigger definition. Exactly one of `schedule` or `event` must be set inside it |
| `agent` | one of `agent` or `run` | | Agent name (built-in: `claude`, `codex`, `opencode`, `pi`; or custom from `agents.yml`) |
| `run` | one of `agent` or `run` | | Custom shell command (must reference `$TM_PROMPT_FILE`) |
| `args` | no | `''` | Extra CLI flags appended to the agent command (only with `agent`) |
| `cwd` | no | temp dir | Working directory (`~` is expanded) |
| `timezone` | no | system local | IANA timezone for cron evaluation |
| `env` | no | `{}` | Environment variables (string key-value pairs) |
| `timeout` | no | scheduled: `min(interval, 1h)`; event: `1h` | Max runtime as duration string (`30s`, `5m`). For scheduled tasks it must be shorter than the schedule interval |
| `enabled` | no | `true` | Lifecycle switch. `false` = never auto-scheduled. `true` = eligible to run (subject to `requires`) |
| `requires` | no | `['network']` | Runtime requirements that must be satisfied for the task to run. Empty array `[]` means no requirements |

**Constraints:**

- `on` must contain exactly one of `schedule` or `event`.
- Exactly one of `agent` or `run` must be set.
- `args` can only be used with `agent`, not `run`.
- `run` must contain `$TM_PROMPT_FILE`.
- `timeout` minimum is `1s`.
- For scheduled tasks, `timeout` must be shorter than the schedule interval. When omitted it defaults to `min(interval, 1h)`.
- For event tasks, `timeout` defaults to `1h` when omitted.

### Trigger Shapes

Scheduled task:

```yaml
on:
  schedule: '*/5 * * * *'
```

Event-driven task:

```yaml
on:
  event: deploy
```

### Minimal Example

```markdown
---
on:
  schedule: '*/5 * * * *'
agent: claude
---

Check disk usage and report if any partition exceeds 90%.
```

### Full Example

```markdown
---
on:
  schedule: '*/30 9-17 * * 1-5'
timezone: 'America/New_York'
agent: claude
args: '--model sonnet'
cwd: '~/projects/api'
timeout: '5m'
requires: []
env:
  GITHUB_TOKEN_SCOPE: 'read'
---

Check for open PRs that have been idle for more than 48 hours.
Post a summary as a comment on each one using `gh`.
```

### Custom Run Command

Use `run` instead of `agent` for arbitrary commands:

```markdown
---
on:
  schedule: '0 8 * * 1-5'
run: 'my-tool --prompt $TM_PROMPT_FILE'
---

Generate the weekly status report.
```

### Event Task Example

Use `tm dispatch <event>` to trigger tasks subscribed to an event:

```markdown
---
on:
  event: deploy
agent: claude
requires: []
---

Summarize the deployment payload and post release notes.
```

## CLI Reference

All commands except `doctor` support `--json` for structured output.

```
tm run <name>                    Execute a task immediately (bypasses enabled and requires)
tm list                          One line per task: name, trigger, executor, enabled status
tm status                        Rich view with last run, next scheduled time
tm history <name>                Show run history (--failures, --last <n>)
tm dispatch <event>              Dispatch all tasks subscribed to an event
tm validate                      Check all task files for errors
tm doctor                        Run diagnostics (--since <iso8601>, default: 7 days)
tm setup                         Install system scheduler (launchd/crontab)
tm teardown                      Remove system scheduler
tm tick                          Scheduler heartbeat (called by system scheduler)
```

### `tm doctor`

Checks system health and reports findings by severity:

- **Heartbeat staleness** — scheduler not firing (critical if > 5 min)
- **Scheduler installation** — launchd/crontab missing
- **Task validation errors** — malformed task files
- **Consecutive failures** — 3+ failures = critical
- **Consecutive timeouts** — 3+ timeouts = critical
- **Never-ran tasks** — enabled tasks with no history
- **Lock contention** — concurrent execution attempts
- **Offline skips** — tasks skipped due to connectivity
- **Timeout/schedule mismatch** — timeout >= schedule interval

## Agents

Built-in agents and their dispatch commands:

| Agent | Command |
|---|---|
| `claude` | `claude -p < $TM_PROMPT_FILE` |
| `codex` | `codex exec - < $TM_PROMPT_FILE` |
| `opencode` | `opencode run -f $TM_PROMPT_FILE` |
| `pi` | `pi -p @$TM_PROMPT_FILE` |

`$TM_PROMPT_FILE` is set at runtime to a temp file containing the prompt (frontmatter stripped).

### Custom Agents

Override built-in agents or add new ones in `~/.config/taskmaster/agents.yml`:

```yaml
claude: claude --model sonnet -p < $TM_PROMPT_FILE
my-agent: my-agent --prompt-file $TM_PROMPT_FILE
```

Custom entries merge on top of the built-in registry.

## Environment Variables

Variables resolve in order (last wins):

1. System environment
2. `~/.config/taskmaster/.env` (global, `KEY=VALUE` format)
3. Per-task `env` frontmatter

## Directory Structure

```
~/.config/taskmaster/
  tasks/              Task markdown files (*.md)
  history/            Per-task run history
    <task>/           <timestamp>.meta.json + .output.txt
  locks/              Per-task lock files (runtime)
  runs/               Preserved temp dirs from failed runs
  log.jsonl           Structured event log
  .env                Global environment variables (optional)
  agents.yml          Custom agent definitions (optional)
  heartbeat           Timestamp of last tick
```

## Runtime Requirements

Tasks declare what the environment must provide via `requires`. Each token has a matching probe; the scheduler probes each referenced requirement at most once per tick, in parallel, and only when at least one ready task references it.

**Valid tokens:**

| Token | Meaning | Probe |
|---|---|---|
| `network` | Internet reachable | DNS lookup against Cloudflare (`1.1.1.1`) and Google (`8.8.8.8`), 2s timeout |

Defaults and semantics:

- Omitting `requires` defaults to `['network']` — preserves today's behavior.
- Explicit `requires: []` means "no runtime requirements — always runs" (still subject to `enabled`).
- Unknown tokens fail validation at parse time.
- Entries are deduplicated automatically.
- Tasks with unmet requirements are skipped for the tick and logged as `{ event: 'skipped', reason: 'requirement-unmet', requirement: [...] }`.
- `tm run <name>` bypasses both `enabled` and `requires`.

Event-driven tasks dispatched with `tm dispatch` honor `requires` identically to scheduled tasks.

## Development

```sh
bun test              # run tests
bun run check         # fmt + lint + typecheck + test
bun run lint          # oxlint
bun run fmt           # oxfmt
bun run typecheck     # tsgo
```

## License

MIT
