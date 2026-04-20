---
id: spec.rust-node-platform
type: spec
title: Rust Node Platform Migration
status: draft
spec_state: proposed
trust: draft
summary: Fastest-path plan for porting the extracted node core and contract surfaces to Rust, proving parity with generated fixtures, and standing up a minimal Argo-deployable runtime shell.
read_when: Planning Rust migration work, reviewing Rust parity PRs, or deciding how to phase a Rust node alongside the current TypeScript platform.
owner: derekg1729
created: 2026-04-20
verified: 2026-04-20
tags: [rust, nodes, contracts, graph-execution, argo-cd]
---

# Rust Node Platform Migration

## Design

The migration path is deliberately staged:

1. generate TypeScript-backed fixtures for contracts and pure logic,
2. port those pure slices to Rust with parity tests,
3. expose the proven Rust behavior through a narrow internal runtime shell,
4. ship that runtime through the existing Argo/CD candidate-flight lane.

### Context

The multi-node split already did the expensive architectural work for us:

- PR #693 extracted `@cogni/node-core` from duplicated app-local core files.
- PR #694 extracted `@cogni/node-shared`, isolating pure utilities from env-bound code.
- PR #698 extracted `@cogni/graph-execution-host`, isolating pure execution decorators from runtime wiring.
- PR #695 established catalog-driven Argo CD deploys, so a new runtime can land as an additional catalog entry without inventing a second deploy plane.
- PR #696 confirmed the "thin shell + extracted capabilities" direction for nodes.

That means the fastest Rust path is **not** "rewrite a whole Next.js node from scratch." The fastest path is:

1. Freeze the extracted TypeScript surfaces as executable fixtures.
2. Port the pure business logic to Rust behind those fixtures.
3. Stand up a minimal Rust runtime that speaks the existing internal contracts.
4. Deploy that runtime through the same Argo CD lane the rest of the platform already uses.

## Goal

Create a Rust migration runway that lets us replace selected TypeScript node responsibilities incrementally while keeping the TypeScript packages as the source of truth until parity is proven.

## Non-Goals

- Replacing all node apps in one PR.
- Re-implementing the full Next.js dashboard/frontend in Rust.
- Retiring the existing TypeScript runtime before parity tests exist.
- Worker-local graph execution in this first runway PR.

## Core Invariants

1. **TS_CONTRACTS_STAY_AUTHORITATIVE_UNTIL_CUTOVER**: `@cogni/node-contracts` and `@cogni/node-core` remain the source of truth until Rust parity is proven and reviewed.
2. **PORT_DONT_REWRITE**: Rust parity starts from generated fixtures derived from the current TypeScript implementation, not hand-transcribed expectations.
3. **PURE_LOGIC_FIRST**: Port extracted pure domains before env-coupled runtime wiring.
4. **RUST_PARITY_IS_EXECUTABLE**: Every Rust ported module must pass fixture-driven parity tests against TypeScript-generated expectations.
5. **RUNTIME_SPEAKS_EXISTING_INTERNAL_CONTRACTS**: The first Rust runtime must use the existing `node-contracts` shapes for health and scheduler-facing graph execution endpoints.
6. **ARGO_REUSES_EXISTING_DEPLOY_PLANE**: The Rust runtime deploys through `infra/catalog` + `infra/k8s/overlays/*`, not a bespoke side channel.
7. **CHECKS_RUN_WITHOUT_HOST_RUST_INSTALL**: Local and CI validation must run through a repo-owned Dockerized cargo path so the migration does not depend on developers pre-installing Rust.

## Fastest-Path Sequence

### Phase 1 — Contract fixtures

Generate committed fixtures from the current TypeScript sources:

- Pure logic fixtures from `@cogni/node-core`.
- Normalized contract-schema fixtures from selected `@cogni/node-contracts` operations.

This gives us a durable lock on behavior before any Rust code becomes authoritative.

### Phase 2 — Pure Rust core

Port the highest-leverage extracted domains first:

- accounts
- billing
- chat
- payments

These modules are already pure and are the lowest-risk place to prove parity.

### Phase 3 — Minimal runtime shell

Stand up a small Rust HTTP runtime that implements the scheduler-facing shell only:

- `GET /livez`
- `GET /readyz`
- `POST /api/internal/grants/{grantId}/validate`
- `POST /api/internal/graph-runs`
- `PATCH /api/internal/graph-runs/{runId}`
- `POST /api/internal/graphs/{graphId}/runs`

The first runtime is intentionally narrow: health, idempotent graph-run bookkeeping, and graph execution with simple account tracking.

### Phase 4 — Argo deployment lane

Add the Rust runtime as a catalog-driven in-cluster deployment so candidate flight can promote and verify it like the existing services.

## Runtime Scope for the First Rust Node

The first Rust runtime is a **terminal-grade internal node shell**, not a full user-facing product node:

- Health endpoints match the existing readiness/liveness contracts.
- Internal scheduler-facing endpoints match the current HTTP contracts, including grant validation.
- Account tracking is in-process and deterministic for the first slice.
- Graph execution is intentionally minimal: consume the request contract, apply account checks, emit a typed terminal artifact, and prove the Temporal graph-run call order against the same HTTP shell.

This is enough to prove the core claim: a Rust node can speak the existing scheduler/runtime contracts and enforce account-aware execution rules.

## Why this is faster than direct service replacement

A direct rewrite of an existing Next.js node would force us to solve, at once:

- frontend/UI replacement,
- auth/session parity,
- database adapters,
- scheduler compatibility,
- deployment wiring,
- and observability.

The extracted-package PRs already told us where the stable seams are. The fastest Rust path is to exploit those seams, not ignore them.

## Acceptance Checks

- TypeScript-generated fixtures exist for selected `node-core` and `node-contracts` surfaces.
- Rust crates pass parity tests against committed fixtures.
- The Rust runtime passes integration tests for health, grant validation, idempotent graph execution, and a Temporal-compatible graph-run flow with account balance tracking.
- Local validation runs via Dockerized cargo scripts.
- CI runs the Rust parity/runtime checks.
- Argo can deploy the Rust runtime through the existing catalog/overlay flow.

## Phase Mapping for task.0336

This first PR is successful when it lands:

1. fixture generation,
2. pure Rust ports for the initial core modules,
3. a minimal Rust runtime shell,
4. CI + candidate-flight wiring for the new service.

Follow-up PRs can then decide whether to:

- move more `node-core`/`node-contracts` surface area into Rust,
- back the Rust runtime with real persistent adapters,
- or point the scheduler worker at the Rust runtime for a true end-to-end lane.
