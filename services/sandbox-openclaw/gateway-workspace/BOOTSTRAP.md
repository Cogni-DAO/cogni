# Bootstrap

Run once on first session to initialize all agent runtime state.

## Filesystem Layout

- `/workspace/gateway/` — main agent workspace root (CWD)
- `/workspace/gateway/memory/` — ephemeral governance state (heartbeats, EDOs, budget gate)
- `/repo/current/` — codebase (read-only): `docs/`, `work/`, `src/`, `.openclaw/skills/`
- `/workspace/repo/` — writable repo clone (parent of all worktrees)
- `/workspace/ideas-repo/` — worktree on `gov/ideas` (used by ideas agent)
- `/workspace/dev-repo/` — worktree on `gov/development` (used by development agent)

When skills reference `memory/`, that's `/workspace/gateway/memory/`.
When skills reference `work/` or `docs/`, that's `/repo/current/work/` and `/repo/current/docs/`.

## Initialize Governance Memory

```bash
mkdir -p memory/COMMUNITY memory/ENGINEERING memory/SUSTAINABILITY memory/GOVERN memory/EDO
cp memory-templates/_budget_header.md memory/_budget_header.md
cp memory-templates/edo_index.md memory/edo_index.md
cp memory-templates/EDO.template.md memory/EDO/_template.md
cp memory-templates/COMMUNITY.heartbeat.md memory/COMMUNITY/heartbeat.md
cp memory-templates/ENGINEERING.heartbeat.md memory/ENGINEERING/heartbeat.md
cp memory-templates/SUSTAINABILITY.heartbeat.md memory/SUSTAINABILITY/heartbeat.md
cp memory-templates/GOVERN.heartbeat.md memory/GOVERN/heartbeat.md
```

## Initialize Repo Clone & Agent Worktrees

`staging` is the source of truth. Never branch from `main`.

```bash
git clone /repo/current /workspace/repo 2>/dev/null || true
cd /workspace/repo
git remote set-url origin https://x-access-token:${GITHUB_TOKEN}@github.com/${COGNI_REPO_URL#*github.com/}
git fetch origin

# Ideas agent worktree
git worktree add /workspace/ideas-repo gov/ideas 2>/dev/null || git worktree add -b gov/ideas /workspace/ideas-repo origin/staging
cd /workspace/ideas-repo && git config user.name "Cogni Ideas Agent" && git config user.email "ideas@cogni.dev"

# Development agent worktree
cd /workspace/repo
git worktree add /workspace/dev-repo gov/development 2>/dev/null || git worktree add -b gov/development /workspace/dev-repo origin/staging
cd /workspace/dev-repo && git config user.name "Cogni Development Agent" && git config user.email "dev@cogni.dev"
```

After running, all agent worktrees are ready.
