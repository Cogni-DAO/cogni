---
description: "Promote gov/ideas to staging and reset the branch"
user-invocable: true
---

# Ideas Sync

`gov/ideas` is a **disposable inbox branch**. The AI agent commits ideas, work items, and specs there. Periodically, a human promotes the batch to staging and resets the branch.

## How gov/ideas works

```
Agent commits ideas to gov/ideas
        ↓
Heartbeat merges staging into gov/ideas (hourly, keeps it current)
        ↓
Human triggers /ideas-sync to promote + reset
```

## Promotion procedure

### 1. Check what's unique to gov/ideas

```bash
git fetch --all --prune
git diff --stat origin/staging...origin/gov/ideas
git log --oneline --no-merges origin/staging..origin/gov/ideas
```

If there's nothing unique, stop — nothing to promote.

### 2. Create PR

```bash
gh pr create --base staging --head gov/ideas \
  --title "feat(work): ideas batch — <brief summary>" \
  --body "<list of work items and docs being promoted>"
```

### 3. Squash-merge the PR

Merge via GitHub (squash). Wait for CI.

### 4. Reset gov/ideas to staging

**After the PR is merged**, reset the branch so it's clean:

```bash
git fetch origin
git checkout gov/ideas
git reset --hard origin/staging
git push --force-with-lease origin gov/ideas
```

This is safe because:

- All content was just squash-merged to staging
- The agent is not writing during promotion (pause writes first if needed)
- `--force-with-lease` protects against races

### 5. Verify

```bash
git rev-list --count origin/staging..origin/gov/ideas
# Should be 0
```

## Rules

- **Pause agent writes** while the PR is open and during reset. The agent should not commit to gov/ideas between steps 2–4.
- **Never skip the reset.** Without it, gov/ideas accumulates permanent divergence noise (120+ merge commits that are content-identical to staging).
- **Squash-merge only.** Regular merge would pollute staging with the agent's incremental commits.
