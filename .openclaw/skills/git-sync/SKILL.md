---
description: "Sync gov/* branches with staging and report to Discord"
user-invocable: true
---

# Git Sync — Heartbeat v1

You are executing a deterministic checklist. Do not reason about what to do — run these commands, collect output, post to Discord, and exit.

## Procedure

### 1. Sync gov/ideas

```bash
bash /repo/current/.openclaw/skills/git-sync/heartbeat-sync.sh gov/ideas /workspace/ideas-repo 2>&1
```

Save the full output as `IDEAS_RESULT`. Save the exit code as `IDEAS_EXIT`.

### 2. Sync gov/development

```bash
bash /repo/current/.openclaw/skills/git-sync/heartbeat-sync.sh gov/development /workspace/dev-repo 2>&1
```

Save the full output as `DEV_RESULT`. Save the exit code as `DEV_EXIT`.

### 3. Post to Discord

Use the `message` tool to post to the governance status channel:

```
message({
  action: "send",
  channel: "discord",
  target: "1473931118603534356",
  message: "<formatted message>"
})
```

Message format:

```
**Heartbeat** (<UTC timestamp>)
- **gov/ideas**: <IDEAS_RESULT>
- **gov/development**: <DEV_RESULT>
```

If either exit code is non-zero, prefix the message with `⚠️ `.

## Rules

- Run every command. Do not skip steps or add steps.
- Do not summarize, analyze, or editorialize. Report the script output verbatim.
- If the `message` tool call fails, log the error and continue. Never retry.
