# Environment Tools

## Git

`GITHUB_TOKEN` and `COGNI_REPO_URL` are set in your environment.

`/repo/current/` is a **volatile** git-sync mirror — replaced on every deploy. Do not create worktrees from it. Instead, clone to `/workspace/repo/` (see AGENTS.md § Development Workflow) and create worktrees from there.

## GitHub API

`gh` CLI is installed. Authenticate if needed:

```bash
echo "$GITHUB_TOKEN" | gh auth login --with-token
```

Use `gh` for PRs, issues, and API calls:

```bash
gh pr create --title "..." --body "..."
gh issue list
gh api repos/OWNER/REPO/pulls/123
```

## Package Management

```bash
pnpm install --offline --frozen-lockfile   # Fast — uses cached pnpm store
```

The pnpm store is pre-seeded at `/pnpm-store`. Offline installs are fast (~250ms).

## LLM

All LLM calls route through the proxy at `llm-proxy-openclaw:8080`. Do not call external LLM APIs directly — the proxy handles auth and billing.

## Limitations

- No browser/Chromium — `browser` tool is disabled
- No cron scheduling — use Temporal (the platform scheduler)
- Read-only rootfs — write to `/workspace/` or `/tmp/` only
- `/repo/current/` is volatile (replaced on deploy) — clone to `/workspace/repo/` for dev work
