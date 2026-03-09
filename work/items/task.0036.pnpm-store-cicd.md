---
id: task.0036
type: task
title: "CI/CD pipeline for pnpm-store image rebuild on lockfile change"
status: needs_design
priority: 1
estimate: 2
summary: Automate pnpm-store image builds triggered by pnpm-lock.yaml changes. Tag by lockfile hash. Deploy step syncs image contents into server pnpm_store volume. Enables offline pnpm install inside sandbox containers.
outcome: Push to main with lockfile change triggers pnpm-store image rebuild. Deployment hosts idempotently update pnpm_store volume. Sandbox agents run pnpm install --offline --frozen-lockfile with zero network egress.
spec_refs: openclaw-sandbox-spec
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-12
updated: 2026-02-12
labels: [openclaw, sandbox, docker, cicd, p1]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 15
---

# CI/CD pipeline for pnpm-store image rebuild on lockfile change

## Context

task.0031 ships the `cogni-sandbox-openclaw` devtools image with `PNPM_STORE_DIR=/pnpm-store` and a `pnpm_store` named volume. The P0 seeding is manual (one-off `pnpm fetch` + publish). This task automates it: rebuild the store image when `pnpm-lock.yaml` changes, tag by lockfile hash, and sync to deployment hosts.

## Requirements

- CI workflow triggers on push to main when `pnpm-lock.yaml` changes
- Build a pnpm-store image: run `pnpm fetch --frozen-lockfile` with `PNPM_STORE_DIR=/pnpm-store` inside `cogni-sandbox-openclaw`
- Tag: `ghcr.io/cogni-dao/cogni-pnpm-store:<lockfile_sha256_short>` + `:latest`
- Deploy step: idempotently extract image `/pnpm-store` contents into server `pnpm_store` Docker volume
- Skip rebuild if tag for current lockfile hash already exists in GHCR

## Design

```
┌─────────────────────────────────────────────────────────────┐
│  CI: on push to main (pnpm-lock.yaml changed)              │
│                                                             │
│  1. hash = sha256(pnpm-lock.yaml)[:12]                     │
│  2. if ghcr.io/cogni-dao/cogni-pnpm-store:${hash} exists   │
│     → skip (idempotent)                                     │
│  3. docker run cogni-sandbox-openclaw                       │
│     → COPY pnpm-lock.yaml + package.json                    │
│     → pnpm fetch --frozen-lockfile                          │
│     → /pnpm-store now populated                             │
│  4. docker commit → push to GHCR with :${hash} + :latest   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Deploy: after image publish                                │
│                                                             │
│  1. docker pull ghcr.io/cogni-dao/cogni-pnpm-store:latest   │
│  2. docker run --rm -v pnpm_store:/pnpm-store <image>       │
│     cp -a /pnpm-store/* /target/                            │
│     (or use docker cp from temp container)                   │
│  3. Sandbox agents now do:                                   │
│     pnpm install --offline --frozen-lockfile                 │
│     → instant relink from seeded store                      │
└─────────────────────────────────────────────────────────────┘
```

## Plan

- [ ] Create `.github/workflows/pnpm-store.yml` — trigger on `pnpm-lock.yaml` change to main
- [ ] Add lockfile hash check (skip if GHCR tag exists)
- [ ] Build pnpm-store image from `cogni-sandbox-openclaw` + `pnpm fetch`
- [ ] Push to GHCR with hash tag + `:latest`
- [ ] Add deploy step to `deploy.sh` — sync pnpm-store image into `pnpm_store` volume
- [ ] Verify offline install: `pnpm install --offline --frozen-lockfile` succeeds in sandbox container
- [ ] Add compose bootstrap one-shot service that runs `pnpm install --offline --frozen-lockfile` as part of deploy (replaces P0 agent-first-action pattern)
- [ ] Idempotency: skip if `node_modules` exists AND `.cogni/bootstrap-lock-hash` matches current `pnpm-lock.yaml` hash

## Motivation (2026-02-13)

CI broke because `@assistant-ui/react` was added during AI SDK streaming work but the pnpm-store image was never regenerated. The `sandbox-openclaw-pnpm-smoke` workspace bootstrap tests had to be skipped (`describe.skip`) pending this automation. Until this task lands, every lockfile change requires a manual `pnpm sandbox:pnpm-store:seed` locally and a manual GHCR publish for prod. This is the primary blocker for re-enabling those tests.

## Non-Goals

- Baking node_modules into the sandbox image (use store volume)
- Handling workspace-level package.json changes (store is dep-level only)
- Multi-repo lockfile support (Cogni monorepo only)

## Validation

```bash
# Verify pnpm-store image exists in GHCR after lockfile change push
HASH=$(sha256sum pnpm-lock.yaml | cut -c1-12)
docker pull ghcr.io/cogni-dao/cogni-pnpm-store:${HASH}

# Verify offline install works with seeded store
docker run --rm \
  -v pnpm_store:/pnpm-store \
  -e PNPM_STORE_DIR=/pnpm-store \
  cogni-sandbox-openclaw:latest \
  "cd /workspace && pnpm install --offline --frozen-lockfile && echo PASS"
```

## PR / Links

- Depends on: [task.0031](task.0031.openclaw-cogni-dev-image.md) (devtools image + pnpm_store volume)
- Spec: [openclaw-sandbox-spec](../../docs/spec/openclaw-sandbox-spec.md) — OQ-9 (egress policy)
