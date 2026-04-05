---
id: task.0290
type: task
status: needs_implement
priority: 1
rank: 1
estimate: 5
title: "Release Control Plane — Temporal-driven candidate promotion"
summary: "Replace workflow_run chaining with two Temporal state machines (ReleaseCandidate + EnvironmentController), policy-gated preview, and unified SHA+digest candidate objects."
outcome: "Canary handles 1000+ AI commits/day. Preview gets policy-selected snapshots. Production gets human-approved exact-SHA releases. No split-brain between code and images."
project: proj.cicd-services-gitops
assignees: [derekg1729]
branch: design/release-control-plane
spec_refs: [spec.release-control-plane]
created: 2026-04-05
updated: 2026-04-05
labels: [ci-cd, temporal, deployment, architecture]
---

# Release Control Plane

## Design

See [Release Control Plane spec](../../docs/spec/release-control-plane.md) for full architecture, state machines, DB schema, workflow definitions, and invariants.

### Outcome

AI agents ship 1000+ commits/day to canary without drowning humans in noise. Preview gets policy-selected snapshots. Production gets human-approved, exact-SHA releases. No split-brain.

### Approach

Two Temporal state machines (`ReleaseCandidateWorkflow` per SHA, `EnvironmentControllerWorkflow` per environment with built-in promotion policy). GH Actions emits facts; Temporal owns all state transitions.

**Reuses:** `@cogni/ingestion-core` webhook pattern, `@cogni/temporal-workflows` activity tiers, `@cogni/db-schema` append-only audit patterns, `scripts/ci/promote-k8s-image.sh`, existing operator webhook receiver.

**Rejected:** Three-branch code promotion (split-brain), GH Actions as state machine (3-level chain limit), auto-promote every green SHA (noise at scale), PR-per-canary-promotion (100+ PRs/day).

## Prerequisite: Pipeline Must Be Green First

**Do not build this until the existing canary→preview flow works end-to-end.** See task.0291 (v0 path to green) for the prerequisite work. This task picks up after the pipeline is proven.

## Migration Phases

### Phase 1: State machine + webhook receiver (1-2 PRs)

- Create: `packages/db-schema/src/release.ts` — 4 tables (release_candidates, candidate_transitions, environment_state, promotion_decisions)
- Create: `packages/temporal-workflows/src/workflows/release-candidate.workflow.ts`
- Create: `packages/temporal-workflows/src/workflows/environment-controller.workflow.ts`
- Modify: `packages/temporal-workflows/src/activity-types.ts` — add ReleaseActivities
- Create: `services/scheduler-worker/src/activities/release/` — activity implementations
- Create: `nodes/operator/app/src/app/api/v1/release/build-complete/route.ts` — webhook endpoint
- Create: `nodes/operator/app/src/features/release/` — feature slice

### Phase 2: GH Actions simplification (1 PR)

- Create: `.github/workflows/orchestrator.yml` — single entry on canary push
- Create: `.github/workflows/_build-node.yml` — reusable build
- Modify: `.github/workflows/e2e.yml` — strip to workflow_dispatch test runner
- Delete: `.github/workflows/staging-preview.yml`
- Delete: `.github/workflows/promote-and-deploy.yml` relay chain

### Phase 3: Branch model migration (separate task)

- Make `canary` the default branch — **high blast radius, own task + checklist**
- See spec "Staging Decommission Checklist" for full scope

### Phase 4: Visualization (1 PR)

- Create: `nodes/operator/app/src/contracts/release.status.v1.contract.ts`
- Create: `nodes/operator/app/src/app/(authenticated)/release/` — swimlane dashboard

## Validation

- [ ] Spec reviewed and approved: `docs/spec/release-control-plane.md`
- [ ] Phase 1: Workflows registered in Temporal, webhook → signal works end-to-end
- [ ] Phase 2: `orchestrator.yml` replaces relay chain, canary deploy-branch uses direct commits
- [ ] Phase 3: Decommission staging (separate task with own checklist)
- [ ] Phase 4: Swimlane dashboard renders environment state and candidate queue
