---
description: "Workspace state and dev setup"
user-invocable: true
---

Your workspace has several directories with different lifetimes and mutability. Understand them before developing.

## Environment Variables

- `COGNI_REPO_URL` — Git remote URL
- `GITHUB_TOKEN` — GitHub API access
- `HOME=/workspace` — Writable home directory

## Persistent vs Volatile

| Path                  | Lifetime                         | Mutable? |
| --------------------- | -------------------------------- | -------- |
| `/workspace/gateway/` | Bind-mount (updated on deploy)   | ❌ No    |
| `/workspace/repo/`    | Persistent volume                | ✅ Yes   |
| `/workspace/dev-*`    | Persistent volume                | ✅ Yes   |
| `/repo/current/`      | Git-sync (replaced every deploy) | ❌ No    |
| `/workspace/memory/`  | Ephemeral (lost on reset)        | ✅ Yes   |

## Dev Setup

If `/workspace/repo/` doesn't exist:

```bash
git clone --single-branch -b main "$COGNI_REPO_URL" /workspace/repo
cd /workspace/repo && pnpm install --offline --frozen-lockfile
```

Create a worktree:

```bash
git -C /workspace/repo worktree add /workspace/dev-feature-branch -b feature-branch origin/main
cd /workspace/dev-feature-branch
pnpm install --offline --frozen-lockfile
```
