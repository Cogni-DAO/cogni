---
id: task.0336
type: task
title: "Rust node platform runway — fixtures, core parity, runtime shell"
status: needs_closeout
priority: 1
rank: 22
estimate: 5
summary: "Use the extracted TypeScript seams from the multi-node split to create a Rust migration runway: generated fixtures from node-core/node-contracts, parity-tested Rust core modules, and a minimal Argo-deployable runtime shell."
outcome: "Rust parity is executable instead of aspirational: committed TS-generated fixtures, Rust core crates passing parity tests, a scheduler-compatible runtime shell with account tracking, and CI/candidate-flight wiring for the new service."
spec_refs:
  - spec.rust-node-platform
  - spec.unified-graph-launch
  - packages-architecture-spec
  - docs/spec/cd-pipeline-e2e.md
assignees: []
credit:
project: proj.operator-plane
branch: feat/task-0336-rust-node-runway
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-20
updated: 2026-04-20
labels: [rust, nodes, contracts, graph-execution]
external_refs:
---

# task.0336 — Rust node platform runway

## Context

The package extraction sequence already created the stable boundaries a Rust rewrite needs:

- PR #693 — `@cogni/node-core`
- PR #694 — `@cogni/node-shared`
- PR #696 — `@cogni/node-app`
- PR #698 — `@cogni/graph-execution-host`
- PR #695 — catalog-driven Argo deploy flow

This task turns those seams into a concrete Rust runway instead of a future aspiration.

## Design

See `docs/spec/rust-node-platform.md`.

## Plan

### Step 1 — Freeze the TypeScript behavior

- [x] Generate committed parity fixtures from `@cogni/node-core`
- [x] Generate normalized contract fixtures from selected `@cogni/node-contracts` schemas
- [x] Add a check that fails when fixtures drift from TypeScript source

### Step 2 — Port the first pure Rust core slice

- [x] Port accounts domain helpers
- [x] Port billing helpers
- [x] Port chat helpers
- [x] Port payments helpers
- [x] Prove parity against the generated fixtures

### Step 3 — Build the runtime shell

- [x] Add a minimal Rust HTTP runtime service
- [x] Implement `/livez` + `/readyz`
- [x] Implement scheduler-facing grant + graph-run endpoints
- [x] Add deterministic in-process account tracking for the first execution lane

### Step 4 — Wire validation + deployment runway

- [x] Add Dockerized cargo scripts for local validation
- [x] Run Rust checks in CI
- [x] Add build/promotion wiring for the Rust runtime image
- [x] Add Argo catalog + overlay wiring for the service

## Validation

- exercise:
  - `pnpm rust:fixtures:check`
  - `pnpm rust:check`
  - `bash scripts/ci/tests/promote-build-payload.test.sh`
  - Candidate flight the PR to `candidate-a`, then run the Temporal-compatible internal flow against `rust-node`: validate a grant, create a graph run, execute `/api/internal/graphs/rust:terminal/runs`, and confirm `/readyz.version` from the in-cluster service.
- observability:
  - Confirm `rust_node.grant_validated` and `rust_node.graph_run_completed` log lines at the promoted SHA on `candidate-a`.
  - Confirm the charged account key in the log matches the execution grant used in the validation flow.

## Acceptance

- [x] `pnpm rust:fixtures:check`
- [x] `pnpm rust:check`
- [ ] CI passes with Rust parity/runtime checks enabled
- [ ] Candidate flight can promote the Rust runtime through the existing Argo lane
