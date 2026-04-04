---
schedule: "30 9 * * *"
timezone: "Europe/Paris"
cwd: "~/projects/saas-app"
claude_args: ["--model", "sonnet"]
env:
  GITHUB_TOKEN_SCOPE: "read"
  LOG_LEVEL: "debug"
enabled: false
---

Run npm audit and report vulnerabilities.
