---
id: task.0296
type: task
title: "Candidate slot controller v0 — one-slot PR flight control plane"
status: needs_design
priority: 0
rank: 1
estimate: 3
summary: "Design the smallest reliable manual candidate-flight controller: one explicitly chosen PR, one slot, one lease file, one aggregate flight status, bot-written deploy branch updates, and no merge queue."
outcome: "Repo has an approved v0 design for manual candidate flight: PR-head artifact authority, `candidate-a` prototype scope, explicit flight initiation, lease/TTL rules, superseding-push behavior, stable candidate URL, merge-integrity rule, and one `candidate-flight` status for flown PRs."
spec_refs: [ci-cd-spec, spec.cd-pipeline-e2e, spec.candidate-slot-controller-v0]
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-08
updated: 2026-04-08
labels: [ci-cd, gitops, candidate-flight, design]
external_refs:
---

# Candidate Slot Controller V0 — One-Slot PR Flight Control Plane

## Requirements

- Freeze the v0 control model around one manually operated candidate slot first: `candidate-a`
- Use the PR head SHA artifact as the authoritative pre-merge artifact
- Define how a human explicitly requests flight for one PR at a time
- Define lease acquisition, refresh, release, and TTL behavior
- Define superseding-push behavior so newer PR commits replace older candidate attempts safely
- Define one aggregate GitHub status, `candidate-flight`, for PRs explicitly sent to flight
- Keep `deploy/candidate-a` as a long-lived, bot-written GitOps ref with no routine PR noise
- Avoid merge queue, dynamic per-PR environments, or a standalone controller service in v0
- Avoid building an automatic queue or PR scheduler in v0

## Allowed Changes

- `docs/spec/candidate-slot-controller.md`
- `docs/spec/ci-cd.md`
- `docs/spec/cd-pipeline-e2e.md`
- `.github/workflows/` docs or markdown references that need to align to the new controller design
- `work/items/task.0296.candidate-slot-controller-v0.md`

## Plan

- [ ] Lock the one-slot prototype scope and record why `candidate-b` is deferred
- [ ] Define manual flight initiation, such as `flight-now` label or `workflow_dispatch`
- [ ] Define the lease-file shape and storage location on `deploy/candidate-a`
- [ ] Define acquire, refresh, release, busy, timeout, and cancellation behavior without building a hidden queue
- [ ] Define the aggregate `candidate-flight` status contract and who owns status reporting
- [ ] Define the merge-integrity rule so the tested tree is the tree that gets merged
- [ ] Map the design to the workflow and script surfaces that will later implement it
- [ ] Review the spec for overengineering pressure and cut anything that is not needed for the first working prototype

## Validation

**Command:**

```bash
pnpm check:docs
```

**Expected:** Docs metadata, headers, and work index checks pass with the new spec and work item present.

## Review Checklist

- [ ] **Work Item:** `task.0296` linked in PR body
- [ ] **Spec:** `spec.candidate-slot-controller-v0` aligns with `ci-cd-spec` and `spec.cd-pipeline-e2e`
- [ ] **Scope:** v0 stays one-slot, manual-flight, no-merge-queue, no-service
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: `docs/spec/ci-cd.md`
- Related: `docs/spec/cd-pipeline-e2e.md`
- Related: `docs/spec/candidate-slot-controller.md`

## Attribution

- Drafted from the CI/CD trunk-alignment review and candidate-flight prototype discussion
