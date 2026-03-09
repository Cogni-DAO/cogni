---
id: task.0031
type: task
title: "Build unified cogni-sandbox-openclaw devtools image + pnpm cache volumes"
status: done
priority: 0
estimate: 3
summary: Multi-stage cogni-sandbox-openclaw image — node:22-bookworm + GHCR OpenClaw base (header-forwarding) + devtools (pnpm, git, socat). Parameterized via ARG OPENCLAW_BASE. pnpm_store named volume for fast installs. One image for both gateway and ephemeral.
outcome: Single image with OpenClaw on node:22 + Cogni devtools. First pnpm install populates store volume; subsequent runs are fast relink/verify. Both dev and prod compose use same image (COMPOSE_IMAGE_PARITY). Multi-arch manifest published to GHCR.
spec_refs: openclaw-sandbox-spec, sandboxed-agents-spec
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch: feat/openclaw-devtools-image
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-12
labels: [openclaw, sandbox, docker, p1]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 17
---

# Build unified cogni-sandbox-openclaw devtools image + pnpm cache volumes

## Context

Today `cogni-sandbox-openclaw` is a thin layer over `openclaw:local` (node:22-bookworm) — adds socat + sandboxer user. The agent gets the Cogni repo via read-only volume mount (`repo_data:/repo:ro`) with no `node_modules`. To run `pnpm check`, `pnpm test`, or any Node tooling, the agent needs `pnpm install` at runtime (~2-5 min cold). That's unacceptable.

**Node version conflict (resolved by task.0032)**: OpenClaw has a **hard runtime guard** (`assertSupportedRuntime`) that calls `process.exit(1)` on node < 22. Cogni currently pins `node:20.x` but this is convention inertia, not a real constraint — see [task.0032](task.0032.node-22-upgrade.md) for full analysis. Next.js 16 requires `>=20.9.0`; Node 22 is fully compatible. Once Cogni is on node:22, the devtools image can use `node:22-bookworm` directly, matching OpenClaw's ABI — no native module rebuild step needed.

**Why not bake node_modules?** Cogni's dependency tree changes frequently. Baking `node_modules` into the image forces a full rebuild on every `pnpm-lock.yaml` change, makes the image huge, and still requires brittle runtime wiring (symlinking into RO mounts). Instead: ship devtools + a warm pnpm store volume. First run populates the cache; subsequent runs are fast.

## Requirements

- **Prerequisite**: Upgrade Cogni to node:22 (see prerequisite section below) — unblocks unified image
- Single Dockerfile produces one image for **both** gateway (long-running) and ephemeral (one-shot) modes
- Image based on `node:22-bookworm` (aligned with OpenClaw's hard `>=22` runtime guard)
- OpenClaw `/app` copied from GHCR header-forwarding base (`ARG OPENCLAW_BASE`) — same node major, no ABI rebuild needed
- System tools installed: `socat`, `git`, `jq`, `curl`
- `pnpm@9.12.2` installed (Cogni's pinned version, matches `packageManager` field)
- `sandboxer` user (uid 1001, gid 1001) preserved for sandbox adapter compatibility
- Existing `entrypoint.sh` (socat bridge) preserved — same entrypoint for both modes
- **No Cogni node_modules baked in** — deps installed at runtime via `pnpm install` using cache volume
- Compose updated: named volume `pnpm_store` mounted at `/pnpm-store`, `PNPM_STORE_DIR=/pnpm-store` set in env
- Gateway compose service updated to use new image
- Build script: `pnpm sandbox:openclaw:docker:build` builds the unified image
- No secrets in image (SECRETS_HOST_ONLY upheld)

## Design

### Image Layout

```
/app/                          ← OpenClaw runtime (COPY from GHCR base, same node:22)
/app/dist/                     ← Compiled OpenClaw JS
/app/node_modules/             ← OpenClaw deps (native, no ABI rebuild needed)
/app/package.json              ← OpenClaw manifest
/usr/local/bin/sandbox-entrypoint.sh  ← socat bridge entrypoint
/pnpm-store/                   ← mount point for pnpm CAS volume
/workspace/                    ← Agent working directory (empty at build)
```

No `/opt/cogni/`. No baked Cogni deps. The image is a **devtools runtime** — node:22 + pnpm + git + OpenClaw.

### Dockerfile Strategy (Multi-Stage)

```
ARG OPENCLAW_BASE=ghcr.io/cogni-dao/openclaw-outbound-headers:latest

Stage 1 — FROM ${OPENCLAW_BASE} AS openclaw
  (source of /app — dist, node_modules, package.json)
  Per-arch override via --build-arg (arm64: default, amd64: node-template:openclaw-gateway-latest)

Stage 2 — FROM node:22-bookworm
  Install system deps: socat, git, jq, curl
  ENV COREPACK_HOME=/usr/local/share/corepack  (shared, accessible by sandboxer)
  Enable corepack, prepare pnpm@9.12.2
  ENV HOME=/workspace, PNPM_STORE_DIR=/pnpm-store
  COPY --from=openclaw /app /app
  Create sandboxer user (1001:1001)
  RUN mkdir -p /pnpm-store /workspace && chown sandboxer:sandbox
  COPY services/sandbox-openclaw/entrypoint.sh  (build context = repo root)
  WORKDIR /workspace
  ENTRYPOINT sandbox-entrypoint.sh
```

### Runtime Workspace Contract

The image is **orchestration-agnostic** — it does not assume how the workspace is populated. That's the provider's job (task.0022 for git relay, gateway runner for chat mode). The image provides:

1. **`/workspace/`** — empty writable working directory (populated at runtime by provider)
2. **`/pnpm-store/`** — mount point for pnpm store named volume (`PNPM_STORE_DIR=/pnpm-store`)
3. **Devtools** — `pnpm`, `git`, `node`, `socat` available on PATH

The provider (not the image) is responsible for cloning/copying source into `/workspace/` and running `pnpm install`. The pnpm store volume ensures first install populates the cache; subsequent installs are fast relink/verify with minimal downloads.

### Compose Changes

```yaml
openclaw-gateway:
  image: cogni-sandbox-openclaw:latest # was: openclaw-outbound-headers:latest
  entrypoint: ["node", "/app/dist/index.js", "gateway"]
  environment:
    - PNPM_STORE_DIR=/pnpm-store
  volumes:
    - pnpm_store:/pnpm-store # persistent pnpm content-addressable store
    - cogni_workspace:/workspace # RW volume (replaces tmpfs — pnpm hardlinks need same fs)
    # ... existing volumes unchanged
```

New named volumes:

```yaml
volumes:
  pnpm_store:
    name: pnpm_store
  cogni_workspace:
    name: cogni_workspace
```

## Allowed Changes

- `services/sandbox-openclaw/Dockerfile` — rewrite as multi-stage (GHCR base + node:22-bookworm)
- `services/sandbox-openclaw/AGENTS.md` — update for new image model
- `platform/infra/services/runtime/docker-compose.dev.yml` — update `openclaw-gateway` image + add `pnpm_store` volume
- `platform/infra/services/runtime/docker-compose.yml` — update production gateway image reference (COMPOSE_IMAGE_PARITY)
- `package.json` — add `sandbox:openclaw:docker:build` script
- `docs/spec/openclaw-sandbox-spec.md` — add invariants 26-27, update Container Images section

## Plan

### Image + Compose (done)

- [x] **Prerequisite: Upgrade Cogni to node:22** — completed in task.0032 (PR #379, merged)
- [x] Rewrite `services/sandbox-openclaw/Dockerfile` as multi-stage:
  - `ARG OPENCLAW_BASE=ghcr.io/cogni-dao/openclaw-outbound-headers:latest` (parameterized, per-arch override)
  - Stage 2: `node:22-bookworm` + socat/git/jq/curl + pnpm@9.12.2 + `COREPACK_HOME` + sandboxer user + pnpm store
- [x] Add `sandbox:openclaw:docker:build` script to root `package.json` (build context = repo root)
- [x] Update `docker-compose.dev.yml`: gateway image → `cogni-sandbox-openclaw:latest`, `pnpm_store` volume, `PNPM_STORE_DIR` env
- [x] Update `docker-compose.yml` (prod): gateway image → `ghcr.io/cogni-dao/cogni-sandbox-openclaw:latest`, same volume/env (COMPOSE_IMAGE_PARITY)
- [x] Update `openclaw-sandbox-spec.md`: invariants 26 (IMAGE_FROM_PUBLISHED_BASE), 27 (COMPOSE_IMAGE_PARITY), Container Image section, OQ-9
- [x] Update `services/sandbox-openclaw/AGENTS.md` for new image model

### Verification (done)

- [x] arm64 image builds from GHCR base
- [x] Devtools present: pnpm 9.12.2, git 2.39.5, socat, jq, curl, node v22.22.0
- [x] OpenClaw runtime present: v2026.2.6-3 at `/app/dist/index.js`
- [x] No baked Cogni deps (`/opt/cogni` absent)
- [x] pnpm cache volume: cold 1.2s → warm 244ms relink
- [x] `pnpm check` passes

### GHCR Publish (done)

- [x] Publish `ghcr.io/cogni-dao/cogni-sandbox-openclaw:arm64` — built from GHCR arm64 base
- [x] Publish `ghcr.io/cogni-dao/cogni-sandbox-openclaw:amd64` — built from GHCR amd64 base (QEMU cross-build)
- [x] Create multi-arch manifest: `ghcr.io/cogni-dao/cogni-sandbox-openclaw:latest`
- [x] Fix `openclaw-outbound-headers` base: consolidated from split repos into single multi-arch `ghcr.io/cogni-dao/openclaw-outbound-headers:latest` (arm64+amd64)
- [x] Fix prod compose paths: `nginx-gateway.conf.template` and `openclaw-gateway.json` volume mounts were broken
- [x] Verify gateway healthcheck with published image: `pnpm dev:infra`

### pnpm Store Seeding (done)

- [x] Build pnpm-store image: `pnpm fetch --frozen-lockfile` with `PNPM_STORE_DIR=/pnpm-store`, tag by lockfile hash
- [x] Seed deployment host: extract pnpm-store image contents into `pnpm_store` Docker volume (deploy.sh Step 7.5)
- [x] Stack test: negative control (missing dep fails offline) added to `sandbox-openclaw-pnpm-smoke.stack.test.ts`
- [ ] Publish `ghcr.io/cogni-dao/node-template:pnpm-store-latest` to GHCR (manual, post-merge)
- [x] Verify offline bootstrap: `pnpm install --offline --frozen-lockfile` succeeds inside container with seeded store (45.5s, biome runs)
- [x] Replace /workspace tmpfs (256MB) with `cogni_workspace` named volume — pnpm hardlinks require same fs as pnpm_store
- [x] Stack test: all 5 tests pass in `sandbox-openclaw-pnpm-smoke.stack.test.ts` (pnpm version, store path, writability, offline install + biome, negative control)
- [ ] **Deferred**: agent CWD is `/repo/current` (RO) — agent cannot `pnpm install` without manual copy to `/workspace/repo`. Fix in git-sync/workspace bootstrap (task.0022 or follow-up)

## Non-Goals

- Baking Cogni node_modules or packages:build output into the image (explicitly rejected — use pnpm store volume)
- Git relay wiring (task.0022)
- Runtime workspace orchestration (clone, worktree, symlink) — that's provider-level, not image-level
- Image size optimization beyond what multi-stage naturally provides
- Rebuilding OpenClaw from source — use pre-built `/app` from GHCR base directly (same node major)
- CI/CD pipeline for automated pnpm-store rebuilds on lockfile change (see task.0036)

## Validation

**Command:**

```bash
# Build the image
pnpm sandbox:openclaw:docker:build

# Verify OpenClaw works
docker run --rm cogni-sandbox-openclaw:latest node /app/dist/index.js --version

# Verify devtools
docker run --rm cogni-sandbox-openclaw:latest pnpm --version
docker run --rm cogni-sandbox-openclaw:latest git --version
docker run --rm cogni-sandbox-openclaw:latest socat -V 2>&1 | head -1

# Verify no Cogni deps baked in
docker run --rm cogni-sandbox-openclaw:latest test -d /opt/cogni && echo "FAIL: baked deps" || echo "PASS"

# Verify pnpm store volume (second install relinks from cache)
docker volume create pnpm_store_test
docker volume create workspace_test
# First run: cold install populates store
docker run --rm \
  -v pnpm_store_test:/pnpm-store \
  -v workspace_test:/workspace \
  -e PNPM_STORE_DIR=/pnpm-store \
  cogni-sandbox-openclaw:latest \
  sh -c "cd /workspace && pnpm init && pnpm add zod && echo 'first install done'"
# Second run: same workspace + store — should be fast relink
docker run --rm \
  -v pnpm_store_test:/pnpm-store \
  -v workspace_test:/workspace \
  -e PNPM_STORE_DIR=/pnpm-store \
  cogni-sandbox-openclaw:latest \
  sh -c "cd /workspace && pnpm install && echo 'second install done (fast relink)'"
docker volume rm pnpm_store_test workspace_test

# Gateway starts with healthcheck
pnpm sandbox:openclaw:docker:build && pnpm dev:infra

# Lint/type check pass
pnpm check
```

**Expected:** Image builds on node:22. OpenClaw reports version. pnpm, git, socat present. No baked Cogni deps. Second pnpm install is fast relink from store. Gateway healthcheck passes.

## Review Checklist

- [ ] **Work Item:** task.0031 linked in PR body
- [ ] **Spec:** OPENCLAW_SANDBOX_OFF, COGNI_IS_MODEL_ROUTER, SECRETS_HOST_ONLY upheld — no secrets baked into image
- [ ] **Tests:** gateway healthcheck passes with new image, `pnpm check` passes
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0031.handoff.md)

## Attribution

-
