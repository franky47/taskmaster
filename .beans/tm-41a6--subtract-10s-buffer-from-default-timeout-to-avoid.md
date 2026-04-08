---
# tm-41a6
title: Subtract 10s buffer from default timeout to avoid schedule overlap
status: completed
type: task
priority: normal
created_at: 2026-04-08T22:46:36Z
updated_at: 2026-04-08T22:46:41Z
---

Default timeout was min(interval, 1h), which for '* * * * *' equals the interval exactly (60s), triggering a doctor warning. Changed to min(interval - 10s, 1h) so the default leaves headroom (e.g. 50s for a 1-minute schedule).

## Summary of Changes

- Added `SCHEDULE_BUFFER_MS` (10s) constant in `src/task/frontmatter.ts`
- Default timeout formula changed from `min(interval, 1h)` to `min(interval - 10s, 1h)`
- Updated tests in `frontmatter.test.ts` and `run.test.ts` to match new defaults
