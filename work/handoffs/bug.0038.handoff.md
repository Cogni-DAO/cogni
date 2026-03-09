---
id: bug.0038.handoff
type: handoff
work_item_id: bug.0038
status: complete
created: 2026-02-12
updated: 2026-02-12
branch: fix/deploy-targeted-pull-ssh-keepalive
last_commit: fd107d73
---

# Handoff: Deploy targeted pulls + SSH keepalive

## Context

- Production deploy timed out with `client_loop: send disconnect: Broken pipe` after 25+ minutes pulling images over SSH
- Root cause: `deploy.sh` ran a blanket `docker compose pull` of ALL 15+ services (including pinned-digest images that never change), AND the SSH connection had no keepalive settings
- The SSH test connection in the GH Actions workflow had `ServerAliveInterval` but the actual deploy SSH did not
- Follow-on from bug.0015 (disk cleanup ordering), which fixed WHEN cleanup runs but left the blanket pull in place
- Failed run: https://github.com/Cogni-DAO/node-template/actions/runs/21936705892/job/63354600251

## Final State

Branch pushed with 2 commits:

1. **f775a84e** — Core fix:
   - SSH keepalive added to both `SSH_OPTS` paths (`deploy.sh:153,166`)
   - Blanket `compose pull` replaced with 4 targeted `docker pull` commands (app, migrator, scheduler-worker, openclaw-gateway)
   - Removed useless `--dry-run` validation step (checked compose syntax, not registry)
   - Removed SourceCred explicit pull (immutable pinned tag, `compose up -d` handles cache)
   - Pinned `busybox:1.37` in `docker-compose.yml`

2. **fd107d73** — Refinement:
   - Added `PNPM_STORE_IMAGE` pull to main pull block (5th targeted pull)
   - `seed-pnpm-store.sh` changed from self-contained pull to `${PNPM_STORE_IMAGE:?}` (requires caller)
   - `platform/ci/AGENTS.md` updated with targeted-pull and SSH keepalive notes

## Decisions Made

- Targeted pulls over blanket compose pull — only images that change per deploy are explicitly pulled
- Static/pinned images rely on `compose up -d` default `--pull missing` behavior
- `:latest` tags (openclaw-gateway, pnpm-store) are explicitly pulled to pick up updates (manifest check ~2s if unchanged)
- Pinned tags/digests (postgres, litellm, alloy, temporal, autoheal, nginx, git-sync, busybox, sourcecred) use local cache
- `busybox` pinned to tag `1.37` (not digest — sufficient for a chown-only init container)

## Remaining / Deferred

- Post-deploy `docker image prune -f` after health checks (listed in plan, deferred — low priority)
- Post-prune deploy path not tested in CI (relies on `compose up -d` pulling missing static images)

## Risks / Gotchas

- **Post-prune `compose up -d` is untested in CI**: If a static image pull fails during `compose up` (rate limit, transient error), the error surfaces at Step 10 instead of a dedicated pull step
- **`seed-pnpm-store.sh` coupling**: Now depends on `$PNPM_STORE_IMAGE` being set by caller. deploy-remote.sh is the only caller.
- **SourceCred first deploy after prune**: `$SOURCECRED_COMPOSE up -d` must pull the image if missing. Standard compose behavior.

## Pointers

| File / Resource                                          | Why it matters                                                |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `platform/ci/scripts/deploy.sh:643-671`                  | Targeted pull block + pnpm seed (the core change)             |
| `platform/ci/scripts/deploy.sh:153-166`                  | SSH_OPTS with keepalive (both code paths)                     |
| `platform/ci/scripts/deploy.sh:5-18`                     | Header invariants (TARGETED_PULL, SSH_KEEPALIVE)              |
| `platform/ci/scripts/seed-pnpm-store.sh`                 | Changed from self-contained to caller-dependent               |
| `platform/infra/services/runtime/docker-compose.yml:200` | busybox pinned to 1.37                                        |
| `work/items/bug.0038.deploy-blanket-pull-ssh-timeout.md` | Full investigation, image inventory table, reproduction steps |
| `.github/workflows/deploy-production.yml`                | GH Actions workflow that calls deploy.sh                      |
