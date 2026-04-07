---
# tm-yzw0
title: Validate timeout < schedule interval at parse time
status: todo
type: task
created_at: 2026-04-07T19:27:47Z
updated_at: 2026-04-07T19:27:47Z
blocked_by:
    - tm-sp8w
---

Add a Zod refinement to the frontmatter schema that rejects timeout values >= the minimum schedule interval. Currently this is only caught at runtime by tm doctor's checkTimeoutContention. Moving it to parse-time validation catches the misconfiguration earlier (tm validate, tm run, etc).
