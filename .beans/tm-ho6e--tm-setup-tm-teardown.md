---
# tm-ho6e
title: tm setup / tm teardown
status: completed
type: feature
priority: normal
created_at: 2026-04-04T19:54:42Z
updated_at: 2026-04-06T08:36:48Z
parent: tm-we5m
blocked_by:
    - tm-n9i7
---

## What to build

Install and remove the system-level scheduler entry that powers the heartbeat. On macOS: launchd plist with StartCalendarInterval firing every minute. On Linux: crontab entry. Both idempotent.

See PRD Slice 9 for full specification.

## Acceptance criteria

- [x] tm setup on macOS creates ~/Library/LaunchAgents/com.47ng.taskmaster.tick.plist with StartCalendarInterval firing every minute and RunAtLoad=true (S9.1)
- [x] tm setup on macOS loads the plist via launchctl (S9.2)
- [x] tm setup on Linux adds a * * * * * <path-to-tm> tick crontab entry (S9.3)
- [x] tm setup is idempotent: running twice does not duplicate entries (S9.4)
- [x] tm teardown on macOS unloads and removes the plist (S9.5)
- [x] tm teardown on Linux removes the crontab entry (S9.6)
- [x] tm teardown is idempotent: running on already-removed setup is a no-op (S9.7)
- [x] tm setup resolves the absolute path to the tm binary for the scheduler entry (S9.8)

## User stories addressed

- As a user on macOS, I run tm setup and a launchd plist is installed that fires tm tick every minute
- As a user on Linux, I run tm setup and a crontab entry is added
- As a user, I run tm teardown and the scheduler entry is removed


## Summary of Changes

Implemented `tm setup` and `tm teardown` as a new `src/setup/` module:
- `setup.ts`: macOS launchd plist generation + `launchctl load`, Linux crontab read/write, both idempotent
- Dependency injection for platform, exec, and paths enables full test coverage without touching the real system
- XML escaping for plist paths, shell quoting for crontab paths with special characters
- Binary resolution detects compiled single-file executable vs dev mode (`bun src/main.ts`)
- CLI wired as `tm setup` and `tm teardown` with `--json` flag
- 20 tests covering all acceptance criteria S9.1–S9.8
