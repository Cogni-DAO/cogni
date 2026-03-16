---
work_item_id: task.0031
work_item_type: handoff
title: "Handoff: cogni-sandbox-openclaw devtools image"
status: In Progress
branch: feat/openclaw-devtools-image
last_commit: 6fcd35ab
state: active
created: 2026-02-11
updated: 2026-02-13
assignees: []
---

# Handoff: cogni-sandbox-openclaw devtools image

## What's Done

Multi-stage `cogni-sandbox-openclaw` Docker image ships node:22 + OpenClaw + devtools (pnpm, git, socat). PR #383 is open against staging.

**Image + Compose:**

- `services/sandbox-openclaw/Dockerfile` — parameterized `ARG OPENCLAW_BASE` for multi-arch
- Dev + prod compose: gateway uses new image, `pnpm_store` + `cogni_workspace` named volumes (replaces 256MB tmpfs)
- GHCR published: `ghcr.io/cogni-dao/cogni-sandbox-openclaw:latest` (arm64+amd64 manifest)

**pnpm Store Seeding:**

- `Dockerfile.pnpm-store` + `seed-pnpm-store.sh` — builds store image from lockfile, seeds volume
- `deploy.sh` Step 7.5 seeds pnpm_store before compose up
- Scripts: `pnpm sandbox:pnpm-store:build`, `pnpm sandbox:pnpm-store:seed`

**Stack Tests:** `tests/stack/sandbox/sandbox-openclaw-pnpm-smoke.stack.test.ts` — 5 tests all pass locally:
pnpm version, store path, writability, offline install + biome (45s), negative control

**Spec:** Invariants 26 (IMAGE_FROM_PUBLISHED_BASE), 27 (COMPOSE_IMAGE_PARITY) in `docs/spec/openclaw-sandbox-spec.md`

## What's Remaining

### P0: CI failure (blocking merge)

PR #383 CI fails because dev compose references `cogni-sandbox-openclaw:latest` (local image name). CI doesn't have it and tries Docker Hub pull → denied. Fix: add `pnpm sandbox:openclaw:docker:build` step in CI workflow before `docker compose up`, or pull from GHCR.

### P1: Agent RW workspace (deferred to task.0022 / follow-up)

Agent CWD is `/repo/current` (RO git-sync volume). Agent cannot `pnpm install` because it can't create `node_modules` on a read-only mount. The infra provides:

- `/repo` — RO git-sync volume (bare repo + worktrees)
- `/workspace` — RW `cogni_workspace` volume (empty on first boot)
- `/pnpm-store` — RW seeded pnpm store

Missing: a boot-time step that populates `/workspace/repo` as a writable checkout and sets agent CWD there. Config is in `services/sandbox-openclaw/openclaw-gateway.json` line 166: `"workspace": "/repo/current"`.

### P2: GHCR store image publish

`pnpm sandbox:pnpm-store:seed:from-ghcr` script exists but the store image hasn't been pushed to GHCR yet.

## Key Files

| File                                                            | Purpose                        |
| --------------------------------------------------------------- | ------------------------------ |
| `services/sandbox-openclaw/Dockerfile`                          | Multi-stage devtools image     |
| `services/sandbox-openclaw/Dockerfile.pnpm-store`               | Store builder (pnpm fetch)     |
| `services/sandbox-openclaw/seed-pnpm-store.sh`                  | Seeds pnpm_store Docker volume |
| `services/sandbox-openclaw/openclaw-gateway.json`               | Agent config (workspace CWD)   |
| `infra/compose/docker-compose.dev.yml`                          | Dev compose (gateway service)  |
| `infra/compose/docker-compose.yml`                              | Prod compose (GHCR image)      |
| `tests/stack/sandbox/sandbox-openclaw-pnpm-smoke.stack.test.ts` | pnpm store smoke tests         |
| `tests/_fixtures/sandbox/fixtures.ts`                           | `execInContainer()` helper     |
| `docs/spec/openclaw-sandbox-spec.md`                            | Invariants 26-27, OQ-9         |
| `work/items/task.0031.openclaw-cogni-dev-image.md`              | Full task spec + plan          |

## Gotchas

- **pnpm hardlinks require same filesystem**: `/pnpm-store` and `/workspace` must both be Docker volumes (not tmpfs). That's why we replaced `/workspace` tmpfs with `cogni_workspace` volume.
- **`/repo/current` is a symlink**: git-sync uses worktrees. `cp -a` preserves dangling symlinks. Use `cp -rL` to dereference.
- **`execInContainer` timeout**: Default 5s is too short for pnpm install (~45s). Pass `timeoutMs` parameter.
- **COREPACK_HOME**: Must be `/usr/local/share/corepack` (shared location) so sandboxer user can access pnpm prepared by root.

## Decisions Made

1. **One image for both modes** — gateway overrides entrypoint; ephemeral uses sandbox entrypoint. No separate images.
2. **No baked node_modules** — pnpm store volume + offline install. Deps change too often for baked images.
3. **cogni_workspace volume over tmpfs** — pnpm can't hardlink across filesystem boundaries. Full monorepo install (~1.8GB) exceeds any reasonable tmpfs size.
4. **Agent workspace bootstrap deferred** — Correct fix requires gateway entrypoint wrapper or compose init container. Too invasive for this PR; tracked as follow-up.

## PR

- PR #383: https://github.com/Cogni-DAO/node-template/pull/383
- Branch: `feat/openclaw-devtools-image` (20 commits from staging)
