---
# tm-we5m
title: Taskmaster v1.0
status: completed
type: epic
priority: normal
created_at: 2026-04-06T08:36:41Z
updated_at: 2026-04-07T12:31:40Z
---

# Taskmaster — Product Requirements Document

**CLI binary:** `tm`  
**Bundle ID:** `com.47ng.taskmaster`  
**Runtime:** Bun  
**Version:** 1.0  
**Date:** 2026-04-04

---

## 1. Overview

Taskmaster (tm) is a CLI tool for macOS and Linux that manages recurring tasks powered by Claude Code. At its core, each task is a markdown file containing a prompt and scheduling metadata. A per-minute heartbeat evaluates which tasks are due and dispatches them, piping the prompt to Claude Code in print mode.

**Primary users:** Developers and AI agents operating on their behalf. The CLI is designed to be both human-readable and agent-friendly.

**Non-goals:** Taskmaster is not a general-purpose cron replacement. It does not manage secrets or authentication. It does not provide sub-minute scheduling.

---

## 2. Architecture

### 2.1 Directory Structure

```
~/.config/taskmaster/
  tasks/                    Task definition files (*.md)
  history/                  Per-task run history directories
    <task-name>/            <timestamp>.meta.json + <timestamp>.stdout.txt + <timestamp>.stderr.txt (when non-empty)
  locks/                    Per-task lock files
  runs/                     Preserved temp dirs from failed runs
    <task-name>/<ts>/       Contains prompt, stdout, stderr from failure
  .env                      Global environment variables (optional)
  heartbeat                 Timestamp of last tick invocation
```

Timestamps in filenames use UTC in the format `2026-04-04T08.00.00Z` (dots instead of colons for filesystem safety). Tick-initiated runs use minute-precision (floored); manual runs use second-precision.

### 2.2 Task File Format

Each task is a single markdown file in the `tasks/` directory. The filename (minus `.md`) is the task name and must match the pattern `[a-z0-9-]+`. The file consists of YAML frontmatter followed by the prompt body.

**Frontmatter fields:**

- `schedule` (required): Classic 5-field cron expression string (minute, hour, day-of-month, month, day-of-week). No extensions like `@daily` or 6-field seconds
- `timezone` (optional): IANA timezone string. Defaults to system local time
- `cwd` (optional): Working directory for Claude. If omitted, a temp dir is created
- `args` (optional): Array of CLI flags passed to claude. Defaults to `[]`
- `env` (optional): Dictionary of environment variables merged on top of global `.env`
- `enabled` (optional): Boolean. Defaults to `true`. Controls scheduling only, not manual execution

**Example:**

```markdown
---
schedule: '0 8 * * 1-5'
timezone: 'Europe/Paris'
cwd: '~/projects/saas-app'
args: ['--model', 'sonnet']
env:
  GITHUB_TOKEN_SCOPE: 'read'
---

Review package.json and look for:

- Dependencies with known CVEs (run `npm audit`)
- Dependencies more than 2 major versions behind
- Unused dependencies (cross-reference with imports in src/)

Output a short markdown summary. If anything is critical, create a GitHub issue using `gh issue create`.
```

### 2.3 Scheduling Model

A single system-level scheduler entry invokes `tm tick` every 60 seconds, aligned to minute boundaries. On macOS, this is a launchd plist using `StartCalendarInterval`; on Linux, a crontab entry. The tick process floors the current wall-clock time to the current minute (safe because both launchd and cron guarantee firing at or after the minute boundary, never before), evaluates each enabled task's cron expression against that floored time, and dispatches `tm run` for each match. Deduplication against the most recent run timestamp prevents double-firing.

### 2.4 Execution Model

`tm run` acquires a per-task file lock via `flock(2)` (called through `bun:ffi` on libc — auto-releases on process exit or crash), prepares the environment (global `.env` merged with per-task `env`), resolves `cwd` (expanding `~` to `$HOME`; failing early if the directory does not exist), creates a temp directory if no `cwd` is specified, strips the YAML frontmatter from the task file, writes the prompt body to a temp file, and redirects it to `claude -p` via stdin. The `claude` binary is expected to be on `PATH`. On completion, it records metadata, stdout, and stderr (when non-empty) to the history directory. On failure with a temp dir, the temp dir is preserved for debugging.

### 2.5 Environment Variable Layering

Variables are resolved in order: system environment (minimal under cron/launchd) → `~/.config/taskmaster/.env` → per-task `env` frontmatter. Last definition wins.

The `.env` file uses classic format: `KEY=VALUE` lines, `#` comments, optional quoting for values with spaces. No interpolation, no `export` prefixes, no multiline values.

This mechanism is for non-sensitive configuration only. API keys and secrets should be managed through Claude Code's own `settings.json` or system keychain.

---

## 3. CLI Commands

All commands support a `--json` flag for structured output. Without it, output is human-friendly and minimal: no tables, no headers, space-separated, greppable.

**`tm list`** — One line per task: name, schedule, enabled/disabled, space-separated. Minimal output to conserve tokens for agent consumption and wrap cleanly on narrow terminals.

**`tm status`** — Richer view using indented blocks per task. Each block shows the task name as a header, followed by indented key-value fields: schedule, enabled/disabled, last run timestamp with result, next scheduled time. Fields with no value are omitted (e.g., no `last_run` line if the task has never run; no `next` line if disabled).

**`tm run <name> [--timestamp <ISO8601>]`** — Executes a task immediately regardless of schedule or enabled flag. When invoked by `tm tick`, `--timestamp` passes the floored minute timestamp which becomes the run's identity (hidden from `--help`; internal interface between tick and run). When invoked manually without `--timestamp`, uses current UTC time at second precision.

**`tm history <name> [--failures] [--last N] [--json]`** — Displays run history from the task's history directory. Supports filtering by failure status and limiting to the N most recent runs.

**`tm validate`** — Checks all task files for valid frontmatter: cron expression syntax, IANA timezone validity, task name pattern compliance, and structural correctness. Reports errors with filenames.

**`tm tick`** — The heartbeat. Not typically invoked by users. Reads all tasks, floors current time to the minute, evaluates schedules, skips disabled tasks, dispatches `tm run` for each due task as a detached process. Purges old history. Writes timestamp to heartbeat file.

**`tm setup`** — Installs the system scheduler entry. On macOS: creates `~/Library/LaunchAgents/com.47ng.taskmaster.tick.plist` with `StartCalendarInterval` firing every minute (aligned to `:00` boundaries) and `RunAtLoad` true. On Linux: adds a crontab entry. Idempotent.

**`tm teardown`** — Removes the system scheduler entry installed by `tm setup`. Reverse of setup for each platform.

---

## 4. Vertical Slices

The implementation is divided into vertical slices, each independently testable and delivering incremental value.

---

### Slice 0: Project Scaffolding

Bootstrap the Bun project, establish directory conventions, define the task file schema, and implement parsing/validation of task markdown files with YAML frontmatter.

**User Stories:**

- As a developer, I can clone the repo, run `bun install`, and have a working project structure.
- As a user, I create a `.md` file in `~/.config/taskmaster/tasks/` with valid frontmatter and it can be parsed by the system.
- As a user, I get a clear error if my task file has a malformed cron expression, invalid timezone, or non-conforming filename.

**Dependencies:** None

**Acceptance Criteria:**

| ID   | Criterion                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------- |
| S0.1 | Bun project initialised with TypeScript, linting, and test runner configured                                            |
| S0.2 | Task file parser reads YAML frontmatter (schedule, timezone, cwd, args, env, enabled) and markdown body from a .md file |
| S0.3 | Parser validates schedule as a syntactically correct cron expression                                                    |
| S0.4 | Parser validates timezone as a valid IANA identifier when present                                                       |
| S0.5 | Parser validates task name (derived from filename) matches `[a-z0-9-]+`                                                 |
| S0.6 | Parser returns typed `TaskDefinition` object on success, structured error on failure                                    |
| S0.7 | Unit tests cover valid files, missing required fields, malformed cron, invalid timezone, bad filenames                  |

---

### Slice 1: tm validate

CLI entry point with the validate subcommand. Scans all task files and reports errors.

**User Stories:**

- As a user, I run `tm validate` and see which task files are valid and which have errors, with filenames and descriptions.
- As an agent, I run `tm validate --json` and get a structured array of validation results.

**Dependencies:** Slice 0

**Acceptance Criteria:**

| ID   | Criterion                                                                             |
| ---- | ------------------------------------------------------------------------------------- |
| S1.1 | `tm validate` scans `~/.config/taskmaster/tasks/*.md` and runs the parser on each     |
| S1.2 | Valid files produce a success line; invalid files produce error details with filename |
| S1.3 | Exit code 0 if all valid, exit code 1 if any invalid                                  |
| S1.4 | `--json` flag outputs a JSON array of `{name, valid, errors?}` objects                |
| S1.5 | Gracefully handles empty `tasks/` directory and missing `tasks/` directory            |

---

### Slice 2: tm list

Lists all tasks with minimal output.

**User Stories:**

- As a user, I run `tm list` and see a compact, greppable list of all tasks.
- As an agent, I run `tm list --json` to check whether a task already exists before creating one.

**Dependencies:** Slice 0

**Acceptance Criteria:**

| ID   | Criterion                                                                              |
| ---- | -------------------------------------------------------------------------------------- |
| S2.1 | `tm list` outputs one line per task: name, schedule, enabled/disabled, space-separated |
| S2.2 | Output has no headers, no borders, no decoration                                       |
| S2.3 | `--json` flag outputs a JSON array of `{name, schedule, timezone?, enabled}` objects   |
| S2.4 | Tasks are sorted alphabetically by name                                                |

---

### Slice 3: tm run (Core Execution)

Execute a single task: parse the file, set up the environment, invoke Claude Code, capture output. This is the critical path.

**User Stories:**

- As a user, I run `tm run daily-audit` and Claude processes the prompt from the task file, and I see Claude's output.
- As a user, when my task specifies `cwd`, Claude runs in that directory.
- As a user, when my task omits `cwd`, a temp directory is created and used.
- As a user, `tm run` works even when the task has `enabled: false`, since I'm explicitly invoking it.

**Dependencies:** Slice 0

**Acceptance Criteria:**

| ID    | Criterion                                                                                                                                                                                     |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3.1  | `tm run <name>` reads the task file, strips YAML frontmatter, extracts the prompt body                                                                                                        |
| S3.2  | Prompt body is written to a temp file and redirected to `claude -p` via stdin. `claude` binary must be on PATH; fail with a clear error if not found                                          |
| S3.3  | `args` from frontmatter are appended to the claude invocation (no validation)                                                                                                                 |
| S3.4  | When `cwd` is specified, `~` is expanded to `$HOME`. If the resolved directory does not exist, `tm run` fails with a clear error before invoking Claude (recorded as a failed run in history) |
| S3.5  | When `cwd` is omitted, a temp directory is created and used as cwd                                                                                                                            |
| S3.6  | Global `.env` is loaded, then per-task `env` is merged on top; result is passed to the claude process                                                                                         |
| S3.7  | Claude's stdout is captured and printed to tm's stdout                                                                                                                                        |
| S3.8  | Claude's stderr and exit code are captured                                                                                                                                                    |
| S3.9  | `tm run` ignores the `enabled` flag entirely                                                                                                                                                  |
| S3.10 | Exit code reflects claude's exit code                                                                                                                                                         |

---

### Slice 4: History Recording

After `tm run` completes, persist run metadata and output for later querying.

**User Stories:**

- As a user, after a task runs, I can find its output and metadata in the history directory.
- As a user, when a task fails and used a temp dir, the temp dir is preserved at a predictable location for debugging.
- As a user, successful run history older than 30 days is automatically purged.

**Dependencies:** Slice 3

**Acceptance Criteria:**

| ID    | Criterion                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S4.1  | On completion, `tm run` writes `<timestamp>.meta.json` to `~/.config/taskmaster/history/<task-name>/`                                                                                            |
| S4.2  | meta.json contains: `timestamp`, `started_at`, `finished_at`, `duration_ms`, `exit_code`, `success`                                                                                              |
| S4.3  | On completion, `tm run` writes `<timestamp>.stdout.txt` with raw claude output                                                                                                                   |
| S4.3a | On completion, `tm run` writes `<timestamp>.stderr.txt` with claude's stderr, only when non-empty                                                                                                |
| S4.4  | The timestamp used in filenames is UTC in `YYYY-MM-DDTHH.MM.SSZ` format. Tick-initiated runs use the floored minute (passed via `--timestamp`); manual runs use current time at second precision |
| S4.5  | On success with a temp dir: temp dir is deleted                                                                                                                                                  |
| S4.6  | On failure with a temp dir: temp dir is moved to `~/.config/taskmaster/runs/<task-name>/<timestamp>/` with prompt, stdout, stderr preserved                                                      |
| S4.7  | On success or failure with explicit cwd: no directory operations beyond history writes                                                                                                           |
| S4.8  | A purge routine (run inside `tm tick` on every invocation) deletes successful history entries (`.meta.json`, `.stdout.txt`, `.stderr.txt`) older than 30 days                                    |
| S4.9  | Failed run entries in `history/` are never auto-purged                                                                                                                                           |

---

### Slice 5: Lock Files (Overlap Prevention)

Prevent concurrent execution of the same task using per-task lock files.

**User Stories:**

- As the scheduler, when a task is already running, a second invocation is skipped gracefully.
- As a user, I see a warning when a task is skipped due to lock contention.

**Dependencies:** Slice 3

**Acceptance Criteria:**

| ID   | Criterion                                                                                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S5.1 | `tm run` acquires a file lock at `~/.config/taskmaster/locks/<task-name>.lock` before execution                                                                                                                              |
| S5.2 | If the lock is already held, `tm run` exits with code 0 and prints a skip warning to stderr                                                                                                                                  |
| S5.3 | The lock is released after execution completes, whether success or failure                                                                                                                                                   |
| S5.4 | If `tm run` crashes, the OS-level lock is released. Implementation: `flock(2)` called through `bun:ffi` on libc (not PID files). The kernel releases the lock when the file descriptor closes, including on crash or SIGKILL |
| S5.5 | `--json` output includes a `"skipped": true` field when lock contention occurs                                                                                                                                               |

---

### Slice 6: tm history

Query and display run history for a task.

**User Stories:**

- As a user, I run `tm history daily-audit` and see recent runs with timestamps, duration, and pass/fail.
- As an agent, I run `tm history daily-audit --json --failures` to find failed runs for debugging.

**Dependencies:** Slice 4

**Acceptance Criteria:**

| ID   | Criterion                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S6.1 | `tm history <name>` lists runs from history directory, most recent first                                                                                      |
| S6.2 | Each run is displayed as an indented block: timestamp as header, followed by indented duration, exit code, status (ok/err), and stderr file path when present |
| S6.3 | `--failures` flag filters to only failed runs                                                                                                                 |
| S6.4 | `--last N` limits output to the N most recent entries                                                                                                         |
| S6.5 | `--json` outputs a JSON array of meta.json objects                                                                                                            |
| S6.6 | Exit code 1 if the task name does not exist                                                                                                                   |

---

### Slice 7: tm status

Rich status view combining task metadata with history data and next-run computation.

**User Stories:**

- As a user, I run `tm status` and see at a glance which tasks are healthy, which failed last, and when each will next fire.
- As an agent, I run `tm status --json` to get a complete system overview.

**Dependencies:** Slices 2 (shared task enumeration logic) and 4

**Acceptance Criteria:**

| ID   | Criterion                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S7.1 | `tm status` outputs an indented block per task: task name as header, followed by indented key-value fields (schedule, enabled, last run with ok/err, next scheduled time) |
| S7.2 | Fields with no value are omitted (e.g., no `last_run` line if the task has never run)                                                                                     |
| S7.3 | Disabled tasks omit the `next` field                                                                                                                                      |
| S7.4 | Next scheduled time is computed from the cron expression relative to now, respecting the task's timezone                                                                  |
| S7.5 | `--json` outputs a JSON array with all fields including `last_run` and `next_run` as ISO8601 strings                                                                      |

---

### Slice 8: tm tick (Scheduler)

The heartbeat that ties scheduling to execution. Evaluates which tasks are due and dispatches `tm run`.

**User Stories:**

- As the system scheduler (cron/launchd), I invoke `tm tick` every 60 seconds and it runs whatever is due.
- As a user, I can check the heartbeat file to verify the system is alive.

**Dependencies:** Slices 4 and 5

**Acceptance Criteria:**

| ID   | Criterion                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| S8.1 | `tm tick` reads all task files and filters to enabled tasks                                                                        |
| S8.2 | Current wall-clock time is floored to the current minute                                                                           |
| S8.3 | Each enabled task's cron expression is evaluated against the floored time, in the task's timezone (or system local)                |
| S8.4 | For each matching task, `tm tick` checks the most recent history entry to prevent double-firing for the same floored minute        |
| S8.5 | For each due, non-duplicate task, `tm tick` spawns `tm run <name> --timestamp <floored-ISO8601>` as a fully detached child process |
| S8.6 | Locked tasks (already running) are skipped by `tm run`'s own lock mechanism; tick does not pre-check                               |
| S8.7 | `tm tick` writes the current ISO8601 timestamp to `~/.config/taskmaster/heartbeat`                                                 |
| S8.8 | `tm tick` completes quickly (dispatched runs are fully detached; tick does not wait for them)                                      |
| S8.9 | `tm tick` runs the history purge routine (defined in S4.8) on every invocation                                                     |

---

### Slice 9: tm setup / tm teardown

Install and remove the system-level scheduler entry that powers the heartbeat.

**User Stories:**

- As a user on macOS, I run `tm setup` and a launchd plist is installed that fires `tm tick` every minute, surviving restarts.
- As a user on Linux, I run `tm setup` and a crontab entry is added.
- As a user, I run `tm teardown` and the scheduler entry is removed.

**Dependencies:** Slice 8

**Acceptance Criteria:**

| ID   | Criterion                                                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S9.1 | `tm setup` on macOS creates `~/Library/LaunchAgents/com.47ng.taskmaster.tick.plist` with `StartCalendarInterval` firing every minute (aligned to `:00` boundaries) and `RunAtLoad=true` |
| S9.2 | `tm setup` on macOS loads the plist via `launchctl`                                                                                                                                     |
| S9.3 | `tm setup` on Linux adds a `* * * * * <path-to-tm> tick` crontab entry                                                                                                                  |
| S9.4 | `tm setup` is idempotent: running twice does not duplicate entries                                                                                                                      |
| S9.5 | `tm teardown` on macOS unloads and removes the plist                                                                                                                                    |
| S9.6 | `tm teardown` on Linux removes the crontab entry                                                                                                                                        |
| S9.7 | `tm teardown` is idempotent: running on an already-removed setup is a no-op                                                                                                             |
| S9.8 | `tm setup` resolves the absolute path to the tm binary for the scheduler entry                                                                                                          |

---

## 5. Dependency Graph

```
Slice 0: Project Scaffolding
  ├── Slice 1: tm validate
  ├── Slice 2: tm list
  └── Slice 3: tm run (core execution)
        ├── Slice 4: History Recording
        │     ├── Slice 6: tm history
        │     └── Slice 7: tm status  (also depends on Slice 2)
        └── Slice 5: Lock Files
              └── Slice 8: tm tick  (also depends on Slice 4)
                    └── Slice 9: tm setup / tm teardown
```

**Parallelizable groups:**

- After Slice 0: Slices 1, 2, and 3 can all proceed in parallel
- After Slice 3: Slices 4 and 5 can proceed in parallel
- After Slice 4: Slices 6 and 7 can proceed in parallel (7 also needs Slice 2)

---

## 6. Cross-Cutting Concerns

### 6.1 --json Flag

Commands that produce structured output support `--json`: `tm list`, `tm status`, `tm history`, `tm validate`, and `tm run`. Without it, output is human-friendly: `tm list` uses one-line-per-task space-separated format; `tm status` and `tm history` use indented blocks with key-value fields (omitting fields with no value). With `--json`, output is a JSON array of objects, always an array even for single results. `tm run --json` outputs a single-element array with run metadata (same shape as a history entry, plus `"skipped": true` on lock contention). `tm tick`, `tm setup`, and `tm teardown` do not support `--json`. This is implemented once as a shared output formatter.

### 6.2 Clock Flooring

`tm tick` floors the current wall-clock time to the current minute. This is safe because both launchd (`StartCalendarInterval`) and cron fire at or after the minute boundary, never before. If system load causes tick to fire more than 60 seconds late, the scheduled minute is missed. This is a documented, accepted limitation.

### 6.3 Task Name Conventions

Task names are derived from filenames: `daily-summary.md` becomes task name `daily-summary`. Names must match `[a-z0-9-]+`. This is enforced at parse time (Slice 0) and governs lock file names, history directory names, and CLI arguments.

### 6.4 Error Handling

Exit codes: 0 for success (including skip-due-to-lock), 1 for task/config errors, 2 for usage errors. All errors are written to stderr. Successful output goes to stdout.

### 6.5 History Retention

Successful runs: 30 days of `.meta.json`, `.stdout.txt`, and `.stderr.txt` files. Failed runs in `history/`: never auto-purged. Failed temp dirs in `runs/`: never auto-purged. Purge runs inside `tm tick` on every invocation.

---

## 7. Future Work (Out of Scope)

The following are explicitly deferred and not part of this specification:

- **Pre-scripts:** Bun scripts that transform the prompt before passing to Claude (stdin in, stdout out)
- **Post-scripts:** Bun scripts that process Claude's output
- **Secret management:** Integration with system keychain or 1Password CLI for env vars
- **Notifications:** Alerting on task failure via email, Slack, or ntfy
- **Daemon mode:** Long-running process replacing the cron/launchd heartbeat
- **Web UI:** Browser-based dashboard for task management and history viewing
- **Context documents:** Attaching reference files or context to a task that get passed to Claude alongside the prompt
- **Multi-directory task scanning:** Loading tasks from multiple directories (e.g., per-project `.taskmaster/` dirs) in addition to the global `~/.config/taskmaster/tasks/`
- **Catch-up scheduling:** Running missed tasks after sleep/wake or downtime
- **`tm enable` / `tm disable`:** CLI commands to toggle the `enabled` frontmatter field in-place (trivial to do manually or via agents for now)
- **`tm history` (global):** Running `tm history` with no arguments to show N latest history entries per task across all tasks
