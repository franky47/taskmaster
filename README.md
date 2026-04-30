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
tm logs daily-audit
tm doctor
```

## Task File Format

Tasks live in `~/.config/taskmaster/tasks/` as markdown files.
The filename (minus `.md`) is the task ID and must match `[a-z0-9-]+`.

### Frontmatter Fields

| Field       | Required                | Default                                     | Description                                                                                                                                           |
| ----------- | ----------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `on`        | **yes**                 |                                             | Trigger definition. Exactly one of `schedule` or `event` must be set inside it                                                                        |
| `agent`     | one of `agent` or `run` |                                             | Agent name (built-in: `claude`, `codex`, `opencode`, `pi`; or custom from `agents.yml`)                                                               |
| `run`       | one of `agent` or `run` |                                             | Custom shell command (must reference `$TM_PROMPT_FILE`)                                                                                               |
| `args`      | no                      | `''`                                        | Extra CLI flags appended to the agent command (only with `agent`)                                                                                     |
| `cwd`       | no                      | temp dir                                    | Working directory (`~` is expanded)                                                                                                                   |
| `timezone`  | no                      | system local                                | IANA timezone for cron evaluation                                                                                                                     |
| `env`       | no                      | `{}`                                        | Environment variables (string key-value pairs)                                                                                                        |
| `timeout`   | no                      | scheduled: `min(interval, 1h)`; event: `1h` | Max runtime as duration string (`30s`, `5m`). For scheduled tasks it must be shorter than the schedule interval                                       |
| `enabled`   | no                      | `true`                                      | Lifecycle switch. `false` = never auto-scheduled. `true` = eligible to run (subject to `requires`)                                                    |
| `requires`  | no                      | `['network']`                               | Runtime requirements that must be satisfied for the task to run. Empty array `[]` means no requirements                                               |
| `preflight` | no                      |                                             | Shell command run before the agent. Stdout substitutes into the `<PREFLIGHT/>` token. Exit `1` skips the run; any other non-zero is a preflight error |

**Constraints:**

- `on` must contain exactly one of `schedule` or `event`.
- Exactly one of `agent` or `run` must be set.
- `args` can only be used with `agent`, not `run`.
- `run` must contain `$TM_PROMPT_FILE`.
- `timeout` minimum is `1s`.
- For scheduled tasks, `timeout` must be shorter than the schedule interval. When omitted it defaults to `min(interval, 1h)`.
- For event tasks, `timeout` defaults to `1h` when omitted.
- A `<PREFLIGHT/>` token in the body requires a `preflight` field.
- A `<PAYLOAD/>` token in the body is only valid on event tasks.

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

### Power-Aware Example

Gate a power-hungry local-model task on wall power so it does not drain the battery:

```markdown
---
on:
  schedule: '0 */2 * * *'
agent: opencode
requires: ['ac-power']
---

Run the expensive local embedding pass over the inbox.
```

### Event Task Example

Use `tm dispatch <event>` to trigger tasks subscribed to an event. Stdin piped to `tm dispatch` becomes the event payload, available to the task via the `<PAYLOAD/>` token (or, for `run` commands, the `$TM_EVENT_PAYLOAD_FILE` env variable):

```markdown
---
on:
  event: deploy
agent: claude
requires: []
---

Summarize this deployment payload and post release notes:

<PAYLOAD/>
```

```sh
echo '{"version":"1.2.3","commit":"abc123"}' | tm dispatch deploy
```

### Preflight Example

A `preflight` command runs before the agent. Its stdout (UTF-8, ≤ 1 MiB) is substituted into the `<PREFLIGHT/>` token in the prompt body. The agent is only spawned when preflight exits `0`.

| Preflight outcome                                                     | Result                                  |
| --------------------------------------------------------------------- | --------------------------------------- |
| Exit `0`                                                              | Agent runs; stdout fills `<PREFLIGHT/>` |
| Exit `1` (clean)                                                      | Run skipped (`skipped-preflight`)       |
| Other non-zero / signal / timeout (60s) / non-UTF-8 / oversize stdout | Run aborted (`preflight-error`)         |

```markdown
---
on:
  schedule: '*/15 * * * *'
agent: claude
preflight: 'gh pr list --json number,title,updatedAt --search "is:open updated:<$(date -v-2d -u +%Y-%m-%dT%H:%M:%SZ)"'
---

Review these idle PRs and suggest follow-ups:

<PREFLIGHT/>
```

## CLI Reference

All commands except `doctor` and `logs` support `--json` for structured output.

```
tm run <name>                    Execute a task immediately (bypasses enabled and requires)
tm list                          One line per task: name, trigger, executor, enabled status, [preflight]
tm status                        Rich view with last run, next scheduled time, running marker
tm history [name]                Show run history for a task, or across all tasks (--failures, --last <n>)
tm logs <name>                   Live-tail output if running, otherwise print last completed output
tm dispatch <event>              Dispatch all tasks subscribed to an event (stdin → payload)
tm validate                      Check all task files for errors
tm doctor                        Run diagnostics (--since <iso8601>, default: 7 days)
tm setup                         Install system scheduler (launchd/crontab)
tm teardown                      Remove system scheduler
tm tick                          Scheduler heartbeat (--dry-run to preview without executing)
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
- **Chronically blocked tasks** — 3+ consecutive skips for the same unmet requirement
- **Timeout/schedule mismatch** — timeout >= schedule interval
- **Chronic preflight errors** — 3+ consecutive `preflight-error` outcomes (critical)
- **Stale preflight success** — preflight task has not had a successful agent run in 14+ days (info)

## Agents

Built-in agents and their dispatch commands:

| Agent      | Command                           |
| ---------- | --------------------------------- |
| `claude`   | `claude -p < $TM_PROMPT_FILE`     |
| `codex`    | `codex exec - < $TM_PROMPT_FILE`  |
| `opencode` | `opencode run -f $TM_PROMPT_FILE` |
| `pi`       | `pi -p @$TM_PROMPT_FILE`          |

`$TM_PROMPT_FILE` is set at runtime to a temp file containing the resolved prompt body (frontmatter stripped, tokens substituted).

### Custom Agents

Override built-in agents or add new ones in `~/.config/taskmaster/agents.yml`:

```yaml
claude: claude --model sonnet -p < $TM_PROMPT_FILE
my-agent: my-agent --prompt-file $TM_PROMPT_FILE
```

Custom entries merge on top of the built-in registry. Every template must reference `$TM_PROMPT_FILE`.

## Prompt Body Tokens

The prompt body supports two self-closing tokens that get substituted just before the agent runs:

| Token          | Source                               | Notes                                                                       |
| -------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| `<PREFLIGHT/>` | Stdout of the `preflight` command    | Trimmed; UTF-8, ≤ 1 MiB                                                     |
| `<PAYLOAD/>`   | Stdin piped to `tm dispatch <event>` | Trimmed; UTF-8, ≤ 1 MiB; event tasks only. Empty if no payload was provided |

Substitution is single-pass (replacement strings are not re-scanned). When at least one token resolves to non-empty content, the resolved prompt is persisted to history as `<timestamp>.prompt.txt`.

## Environment Variables

Variables resolve in order (last wins):

1. System environment
2. `~/.config/taskmaster/.env` (global, `KEY=VALUE` format)
3. Per-task `env` frontmatter
4. Runtime `TM_*` variables (set by Taskmaster, see below)

### Runtime `TM_*` Variables

Set in the agent and preflight environment:

| Variable                | When set                    | Description                                      |
| ----------------------- | --------------------------- | ------------------------------------------------ |
| `TM_TASK_NAME`          | always                      | Task name                                        |
| `TM_PROMPT_FILE`        | agent only                  | Path to temp file containing the resolved prompt |
| `TM_TRIGGER`            | when known                  | `manual`, `tick`, or `dispatch`                  |
| `TM_RUN_TIMESTAMP`      | scheduled / dispatched runs | UTC timestamp identifying the run                |
| `TM_EVENT_NAME`         | dispatch only               | Event name                                       |
| `TM_EVENT_PAYLOAD_FILE` | dispatch with payload       | Path to the per-task payload file                |

## Directory Structure

```
~/.config/taskmaster/
  tasks/              Task markdown files (*.md)
  history/            Per-task run history
    <task>/
      <timestamp>.meta.json       Run metadata (status, durations, exit code, preflight block)
      <timestamp>.output.txt      Agent stdout/stderr
      <timestamp>.prompt.txt      Resolved prompt (only when a token produced content)
      <timestamp>.preflight.txt   Preflight stdout + stderr (only when preflight ran)
  locks/              Per-task lock + running-marker files (runtime)
  runs/               Preserved temp dirs from failed runs
  log.jsonl           Structured event log
  .env                Global environment variables (optional)
  agents.yml          Custom agent definitions (optional)
  heartbeat           Timestamp of last tick
```

## Runtime Requirements

Tasks declare what the environment must provide via `requires`. Each token has a matching probe; the scheduler probes each referenced requirement at most once per tick, in parallel, and only when at least one ready task references it.

**Valid tokens:**

| Token      | Meaning                             | Probe                                                                                                                                                                                                                           |
| ---------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `network`  | Internet reachable                  | DNS lookup against Cloudflare (`1.1.1.1`) and Google (`8.8.8.8`), 2s timeout                                                                                                                                                    |
| `ac-power` | Running on wall power (not battery) | macOS: `pmset -g ps`; Linux: `/sys/class/power_supply/*/online` for `type=Mains`. Fails open: probe errors, unexpected output, or absent Mains source (desktops) all count as satisfied. Windows is not supported — fails open. |

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
bun run check         # fmt + lint + typecheck + test + knip + deprecated check
bun run lint          # oxlint
bun run fmt           # oxfmt
bun run typecheck     # tsgo
bun run test:integration  # *.integration-test.ts only
```

## License

MIT
