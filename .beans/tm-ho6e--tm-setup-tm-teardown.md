---
# tm-ho6e
title: tm setup / tm teardown
status: todo
type: feature
priority: normal
created_at: 2026-04-04T19:54:42Z
updated_at: 2026-04-04T19:54:42Z
blocked_by:
    - tm-n9i7
---

## What to build

Install and remove the system-level scheduler entry that powers the heartbeat. On macOS: launchd plist with StartCalendarInterval firing every minute. On Linux: crontab entry. Both idempotent.

See PRD Slice 9 for full specification.

## Acceptance criteria

- [ ] tm setup on macOS creates ~/Library/LaunchAgents/com.47ng.taskmaster.tick.plist with StartCalendarInterval firing every minute and RunAtLoad=true (S9.1)
- [ ] tm setup on macOS loads the plist via launchctl (S9.2)
- [ ] tm setup on Linux adds a * * * * * <path-to-tm> tick crontab entry (S9.3)
- [ ] tm setup is idempotent: running twice does not duplicate entries (S9.4)
- [ ] tm teardown on macOS unloads and removes the plist (S9.5)
- [ ] tm teardown on Linux removes the crontab entry (S9.6)
- [ ] tm teardown is idempotent: running on already-removed setup is a no-op (S9.7)
- [ ] tm setup resolves the absolute path to the tm binary for the scheduler entry (S9.8)

## User stories addressed

- As a user on macOS, I run tm setup and a launchd plist is installed that fires tm tick every minute
- As a user on Linux, I run tm setup and a crontab entry is added
- As a user, I run tm teardown and the scheduler entry is removed
