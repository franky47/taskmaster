---
# tm-04gk
title: Default timeout to min(interval, 1h) when omitted
status: completed
type: task
priority: normal
created_at: 2026-04-08T19:36:13Z
updated_at: 2026-04-08T19:36:26Z
---

Changed timeout from optional (undefined when omitted) to always-present with a computed default of min(minCronIntervalMs(schedule), 1h). Explicit timeouts are validated to be >= 1s and < schedule interval (no hard cap). This ensures tasks always have a bounded runtime without requiring users to set timeout manually.

## Acceptance Criteria

- [x] When `timeout` is omitted, default to `min(minCronIntervalMs(schedule), 1h)`
- [x] Explicit `timeout` validated: >= 1s and < schedule interval (no 1h cap)
- [x] `timeout` is always present in parsed output (`Frontmatter`, `TaskListEntry`, `TaskStatus`)
- [x] `TaskStatus.timeout` is now required (string, e.g. `"1h"`)
- [x] README updated with new default and constraint
- [x] All tests pass (409 across 24 files)

## Summary of Changes

- `src/task/frontmatter.ts` — compute default timeout in transform; removed hard 1h cap from validation
- `src/list/list.ts` — `timeout` always assigned unconditionally
- `src/status/status.ts` — `timeout` required on `TaskStatus`, always set
- `README.md` — documents default and constraint
- Tests updated across frontmatter, list, doctor, status, run modules
