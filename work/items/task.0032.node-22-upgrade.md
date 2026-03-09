---
id: task.0032
type: task
title: "Upgrade Cogni from Node 20 to Node 22 LTS"
status: done
priority: 0
estimate: 1
summary: "Mechanical upgrade: replace all node:20 pins with node:22 across 9 surfaces. The node:20 pin is convention inertia from repo scaffolding (Nov 2025) — no dependency requires it. Next.js 16.0.1 requires >=20.9.0; Node 22 is fully compatible. Unblocks task.0031 (devtools image can share OpenClaw's node:22 ABI)."
outcome: "All node version pins reference 22.x. CI, Docker, Volta, and local dev all run Node 22. No ABI mismatch between Cogni and OpenClaw."
spec_refs:
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch: feat/openclaw-devtools-image
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-12
labels: [infra, node, upgrade]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Upgrade Cogni from Node 20 to Node 22 LTS

## Context

The repo pins Node 20.x across 9 surfaces, but there is **no hard technical reason**. The pin was set when the repo was scaffolded (Nov 2025, commit `ce657c4b`) and propagated by convention to every subsequent surface.

### Compatibility verification

- **Next.js 16.0.1** — `engines.node: ">=20.9.0"` — Node 22 is within range
- **@types/node** — currently `"^20"`, update to `"^22"` for Node 22 API types
- **tsup targets** — `"node20"` → `"node22"` (controls output syntax level)
- **No dependency** in pnpm-lock.yaml has an upper-bound constraint excluding Node 22
- **OpenClaw** — already runs `node:22-bookworm`. Aligning eliminates the ABI mismatch that task.0031 was designed to work around

### Why now

task.0031 (devtools image) currently plans a multi-stage build that copies OpenClaw's `/app` from node:22 and reinstalls deps on node:20 to match ABI. If Cogni moves to node:22, the devtools image can use `node:22-bookworm` directly — no native module rebuild needed, simpler Dockerfile, faster builds.

## Upgrade Checklist

All changes are find-and-replace. No behavioral changes expected.

### package.json

- [ ] `volta.node`: `"20.19.0"` → latest Node 22 LTS (e.g. `"22.x.y"`)
- [ ] `engines.node`: `"20.x"` → `"22.x"`

### .nvmrc

- [ ] `.nvmrc`: `20` → `22`

### Bootstrap / setup

- [ ] `platform/bootstrap/setup.sh` line 127: `"$NODE_VERSION" != "20"` → `!= "22"`

### Dockerfiles

- [ ] `Dockerfile` line 6: `node:20-alpine` → `node:22-alpine` (base stage)
- [ ] `Dockerfile` line 66: `node:20-alpine` → `node:22-alpine` (runner stage)
- [ ] `services/sandbox-runtime/Dockerfile` line 8: `node:20-slim` → `node:22-slim`
- [ ] `services/scheduler-worker/Dockerfile` line 10: `node:20-bookworm-slim` → `node:22-bookworm-slim` (builder)
- [ ] `services/scheduler-worker/Dockerfile` line 58: `node:20-bookworm-slim` → `node:22-bookworm-slim` (runner)

### Build targets

- [ ] `services/scheduler-worker/tsup.config.ts` line 25: `target: "node20"` → `"node22"`
- [ ] Any other tsup configs referencing `node20` (check `docs/guides/create-service.md` examples too)

### Dev dependencies

- [ ] `@types/node`: `"^20"` → `"^22"`

### Documentation (update references, not create new docs)

- [ ] `docs/guides/developer-setup.md`: "Node.js 20+" → "Node.js 22+"
- [ ] `docs/guides/create-service.md`: update `node:20-bookworm-slim` examples to `node:22-bookworm-slim`
- [ ] `services/sandbox-runtime/AGENTS.md`: "node:20-slim" references → "node:22-slim"
- [ ] `README.md`: "Node 20" → "Node 22" in setup.sh description

## Validation

```bash
# Verify local toolchain
node -v  # should report v22.x.y

# Verify package.json constraints accept current node
pnpm install

# Fast gate
pnpm check

# Build all Docker images
docker build -t cogni-template:test .
docker build -t sandbox-runtime:test services/sandbox-runtime/
docker build -t scheduler-worker:test services/scheduler-worker/

# Full CI parity (optional but recommended)
pnpm check:full
```

## Non-Goals

- Upgrading to Node 23+ (odd = non-LTS, not suitable for production)
- Changing any runtime behavior — this is a pin update only
- Updating OpenClaw (already on Node 22)

## PR / Links

- PR: https://github.com/Cogni-DAO/node-template/pull/379
- Handoff: [handoff](../handoffs/task.0032.handoff.md)

## Review Checklist

- [ ] **Work Item:** task.0032 linked in PR body
- [ ] **Tests:** `pnpm check` passes, Docker images build
- [ ] **Reviewer:** assigned and approved
