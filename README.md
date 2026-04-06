# Taskmaster

A CLI tool for macOS and Linux that manages recurring tasks powered by AI coding agents. Each task is a markdown file containing a prompt and scheduling metadata. A per-minute heartbeat evaluates which tasks are due and dispatches them to an agent.

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
schedule: '0 8 * * 1-5'
timezone: 'Europe/Paris'
cwd: '~/projects/saas-app'
---

Review package.json for dependencies with known CVEs.
Run `npm audit` and output a short markdown summary.
EOF

# Validate task files
tm validate

# Run a task manually
tm run daily-audit

# Check what's configured
tm list
tm status

# View run history
tm history daily-audit
```

## Task File Format

Tasks live in `~/.config/taskmaster/tasks/` as markdown files. The filename (minus `.md`) is the task name and must match `[a-z0-9-]+`.

### Frontmatter Fields

| Field      | Required | Default      | Description                                          |
| ---------- | -------- | ------------ | ---------------------------------------------------- |
| `schedule` | yes      |              | 5-field cron expression (must be quoted in YAML)     |
| `timezone` | no       | system local | IANA timezone string                                 |
| `cwd`      | no       | temp dir     | Working directory for Claude (`~` is expanded)       |
| `args`     | no       | `[]`         | Extra CLI flags passed to `claude`                   |
| `env`      | no       | `{}`         | Environment variables merged on top of global `.env` |
| `enabled`  | no       | `true`       | Controls scheduling only, not manual execution       |

### Example

```markdown
---
schedule: '*/30 9-17 * * 1-5'
timezone: 'America/New_York'
cwd: '~/projects/api'
args: ['--model', 'sonnet']
env:
  GITHUB_TOKEN_SCOPE: 'read'
---

Check for open PRs that have been idle for more than 48 hours.
Post a summary as a comment on each one using `gh`.
```

## CLI Reference

All commands support `--json` for structured output.

```
tm list                          One line per task: name, schedule, enabled/disabled
tm status                        Rich view with last run, next scheduled time
tm run <name>                    Execute a task immediately (ignores enabled flag)
tm history <name>                Show run history (--failures, --last N)
tm validate                      Check all task files for errors
tm tick                          Scheduler heartbeat (not typically invoked manually)
tm setup                         Install system scheduler (launchd/crontab)
tm teardown                      Remove system scheduler
```

## How It Works

`tm setup` installs a system-level scheduler entry that runs `tm tick` every 60 seconds, aligned to minute boundaries. Each tick:

1. Reads all enabled task files
2. Floors the current time to the minute
3. Evaluates each task's cron expression against that time
4. Dispatches `tm run` as a detached process for each due task
5. Purges successful history entries older than 30 days

`tm run` acquires a per-task file lock (via `flock(2)` through FFI), sets up the environment, strips the YAML frontmatter, and dispatches the prompt to the resolved agent (see [Agents](#agents)). On completion, it records metadata, stdout, and stderr to the history directory.

### Environment Variable Layering

Variables resolve in order (last wins):

1. System environment
2. `~/.config/taskmaster/.env` (global)
3. Per-task `env` frontmatter

### Directory Structure

```
~/.config/taskmaster/
  tasks/              Task definition files (*.md)
  history/            Per-task run history
    <task-name>/      <timestamp>.meta.json + .stdout.txt + .stderr.txt
  locks/              Per-task lock files
  runs/               Preserved temp dirs from failed runs
  .env                Global environment variables (optional)
  agents.yml          Custom agent definitions (optional)
  heartbeat           Timestamp of last tick invocation
```

## Agents

Taskmaster ships with built-in support for the following agents:

| Agent      | Command                            |
| ---------- | ---------------------------------- |
| `claude`   | `claude -p < $TM_PROMPT_FILE`     |
| `codex`    | `codex exec - < $TM_PROMPT_FILE`  |
| `opencode` | `opencode run -f $TM_PROMPT_FILE` |
| `pi`       | `pi -p @$TM_PROMPT_FILE`          |

The `$TM_PROMPT_FILE` variable is replaced at runtime with the path to a temporary file containing the task prompt (frontmatter stripped).

### Custom Agents

Define custom agents (or override built-in ones) in `~/.config/taskmaster/agents.yml`. Each entry maps a name to a shell command template that must reference `$TM_PROMPT_FILE`:

```yaml
claude: claude --model sonnet -p < $TM_PROMPT_FILE
my-agent: my-agent --prompt-file $TM_PROMPT_FILE
```

Custom entries are merged on top of the built-in registry, so you can override defaults or add new agents.

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
