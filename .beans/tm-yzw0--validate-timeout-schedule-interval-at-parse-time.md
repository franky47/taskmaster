---
# tm-yzw0
title: Validate timeout < schedule interval at parse time
status: completed
type: task
priority: normal
created_at: 2026-04-07T19:27:47Z
updated_at: 2026-04-07T19:46:54Z
blocked_by:
    - tm-sp8w
---

Add a Zod refinement to the frontmatter schema that rejects timeout values >= the minimum schedule interval. Currently this is only caught at runtime by tm doctor's checkTimeoutContention. Moving it to parse-time validation catches the misconfiguration earlier (tm validate, tm run, etc).


## Acceptance criteria

- [x] Frontmatter schema rejects timeout >= minimum schedule interval
- [x] Error message is clear and includes both the timeout and interval values
- [x] Tests: valid timeout < interval passes
- [x] Tests: timeout >= interval rejected with descriptive error
- [x] Tests: non-uniform cron schedules use minimum gap
- [x] `tm validate` catches the issue (existing wiring, no CLI changes needed)
