---
id: spec.candidate-slot-controller-v0
type: spec
title: Candidate Slot Controller — V0
status: draft
trust: draft
summary: "Smallest reliable control plane for manually requested pre-merge candidate flight: one slot, one lease file, deploy-branch updates, and one aggregate flight status"
read_when: Designing the candidate-flight control plane, wiring pre-merge deploy validation, or implementing lease and status logic for candidate slots
owner: cogni-dev
created: 2026-04-08
verified: 2026-04-08
tags: [ci-cd, gitops, candidate-flight]
---

# Candidate Slot Controller — V0

> This spec defines the smallest reliable control plane for pre-merge candidate validation.
> It is intentionally narrower than the top-level CI/CD specs: one slot first, no merge queue, no standalone controller service.

## Goal

Provide the minimum reliable mechanism for:

1. manually selecting a PR for candidate flight
2. assigning a pre-merge candidate slot to that PR build
3. updating the matching `deploy/candidate-*` branch with the PR artifact digest
4. exposing a stable candidate URL for validation
5. preventing stale or conflicting slot usage
6. reporting one authoritative flight result back to the PR

## Non-Goals

- no merge queue in v0
- no dynamic per-PR ephemeral environments
- no separate long-running controller service
- no AI ownership requirement for slot control
- no preview or production changes in this spec
- no attempt to optimize multi-slot fairness before one-slot flight works reliably
- no automatic arbitration across a pile of green PRs

## Core Axioms

- The authoritative v0 artifact is the PR head SHA image digest.
- Unknown code proves safety in a candidate slot before merge.
- `deploy/candidate-*` branches are long-lived, bot-written environment refs.
- Slot control is part of the CI control plane, not app logic.
- Simpler beats clever: use scripts and Git state first, not a new service.
- V0 does not auto-flight every green PR; a human explicitly chooses which PR to flight next.

## Prototype Recommendation

### Start With One Slot

The prototype target is one slot only:

- environment: `candidate-a`
- deploy branch: `deploy/candidate-a`
- namespace and app grouping: `cogni-candidate-a`
- one stable external URL set

Only add `candidate-b` after `candidate-a` is proven stable.

This cuts the initial problem in half:

- no slot-selection race
- no multi-slot arbitration bugs
- no fake concurrency promises before the basic path works

## Runtime Model

### Flight Initiation

V0 candidate flight is manual, not automatic.

All PRs still run normal CI and build steps. A PR only enters candidate flight when a human explicitly requests it, for example by:

- adding a label such as `flight-now`
- invoking a manual `workflow_dispatch`

With 20 PRs, the system should not guess which one to deploy next. The operator chooses.

### Candidate Slot Resources

Each slot has:

- one deploy branch, for example `deploy/candidate-a`
- one Argo ApplicationSet or equivalent app grouping targeting that branch
- one stable URL per node in that slot
- one lease file stored on the deploy branch

### Lease File

Store the lease file on the deploy branch at:

`infra/control/candidate-lease.json`

Example shape:

```json
{
  "slot": "candidate-a",
  "state": "leased",
  "pr_number": 123,
  "head_sha": "abc123def456",
  "run_id": "1234567890",
  "owner": "github-actions",
  "acquired_at": "2026-04-09T17:00:00Z",
  "expires_at": "2026-04-09T18:00:00Z",
  "status_url": "https://github.com/org/repo/actions/runs/1234567890"
}
```

### Why The Lease Lives On The Deploy Branch

The deploy branch is already the machine-written source of truth for that environment.
Keeping the lease there means:

- Argo and CI already share the same git surface
- the environment state and slot ownership are auditable together
- no external lock service is needed in v0

## Control Logic

### Acquire

After a PR is explicitly sent to flight and its normal CI and build are already green:

1. read `infra/control/candidate-lease.json` from `deploy/candidate-a`
2. if the file is missing or expired, acquire the slot by writing a new lease
3. if the lease is already held by the same PR, refresh it
4. if the lease is held by another active PR and still valid, report that `candidate-a` is busy and stop

For the one-slot prototype, this logic stays intentionally trivial.

### Promote To Candidate

Once the slot is acquired:

1. `promote-and-deploy.yml` updates image digests in `deploy/candidate-a`
2. the same workflow may update lease metadata if needed
3. the bot pushes directly to `deploy/candidate-a`
4. Argo auto-syncs from that branch

`scripts/ci/promote-k8s-image.sh` remains the deploy-state mutation primitive.

### Validate

Validation runs against the stable candidate URL after Argo reports healthy sync or readiness is confirmed.

Required prototype checks:

- pods healthy
- readiness passes
- `/readyz` returns `200` on operator, poly, and resy
- `/livez` returns structured JSON on operator, poly, and resy

Optional but advisory in v0:

- auth or session sanity paths
- chat or completion probes
- scheduler or worker sanity probes
- one or two node-critical API probes
- AI probes
- broader exploratory E2E suites

### Report Status

Post one aggregate GitHub status for the flight attempt, for example:

- `candidate-flight`

This status is:

- `pending` while the slot is leased or sync and validation are running
- `success` when candidate validation passes
- `failure` when acquire, deploy, sync, or validation fails

In v0, `candidate-flight` is authoritative for PRs explicitly sent to flight, but it is not the universal branch-protection gate for every PR. Standard CI and build checks remain the universal merge gate until multi-slot capacity exists.

Secondary statuses may exist, but the lease file remains the only slot truth.

### Release

Release the slot when any of these happen:

- candidate validation succeeds and the workflow ends
- candidate validation fails and the workflow ends
- the PR is closed
- a newer push for the same PR supersedes the old run
- lease TTL expires

Release means:

- mark the lease free, expired, or replaced by a newer owner
- leave the candidate environment running the last deployed artifact until the next acquire

## Concurrency Rules

### PR-Level Workflow Concurrency

Use GitHub Actions concurrency by PR number:

- one active candidate-flight run per PR
- a newer push cancels the older in-progress run for that PR

That gives superseding-push behavior almost for free.

### Slot Concurrency

For v0 with one slot:

- only one PR can own `candidate-a` at a time
- other PRs do not enter an automatic queue
- if someone requests flight while the slot is occupied, the workflow returns a clear busy message and exits

Do not build a queue service in v0.

## TTL Policy

Default lease TTL:

- 60 minutes

Refresh the lease at key transitions:

- after acquire
- after deploy-branch update
- before long-running validation

TTL is a safety valve for abandoned runs, not the normal release path.

## Superseding Push Behavior

If PR `#123` gets a new commit:

1. the older run is cancelled by PR-level concurrency
2. the new run becomes the only active candidate owner for that PR
3. the new run reacquires or refreshes the slot lease
4. the deploy branch updates to the new digest
5. validation restarts on the new candidate artifact

The cancelled run must not be allowed to post a final success.

## Merge Integrity Rule

The "same digest" claim only holds if the tested tree is the tree that gets merged.

For v0:

- the PR must be up to date with `main` before flight starts
- after a successful flight, merge should happen promptly
- do not rewrite the tested tree after flight success
- if the PR head changes after a successful flight, rerun flight on the new head SHA

## URL Model

Each candidate slot exposes stable URLs, for example:

- `candidate-a.cognidao.org`
- `poly.candidate-a.cognidao.org`
- `resy.candidate-a.cognidao.org`

The PR status payload or PR comment should include the candidate URL once deployment is ready.

## Ownership Boundary

### V0 Owner

Use plain workflows and scripts:

- slot control lives in `candidate-flight.yml` — workflows and scripts, not a long-running service
- git-manager agent is not required but can dispatch flight via `core__vcs_flight_candidate` (task.0297)
- the agent dispatches only; lease acquisition and slot state remain workflow-owned

Git-manager does not own the slot. It calls `workflow_dispatch` and observes `candidate-flight` status via `core__vcs_get_ci_status`. The lease file is written exclusively by workflow scripts.

### Script API

Add these scripts:

- `scripts/ci/acquire-candidate-slot.sh`
- `scripts/ci/release-candidate-slot.sh`
- `scripts/ci/report-candidate-status.sh`

Keep `scripts/ci/promote-k8s-image.sh` as the deploy-state mutation primitive.

## Failure Modes

### Slot Busy

- post a clear busy message or non-authoritative check result
- do not create a hidden queue
- retry only when a human requests flight again

### Argo Sync Fails

- aggregate status fails
- lease is released on best effort

### Validation Fails

- aggregate status fails
- lease is released on best effort

### Workflow Cancelled

- best-effort release step runs
- TTL clears stragglers if cleanup misses

## Acceptance Criteria

The v0 candidate-slot controller is done when:

1. a PR build can acquire `candidate-a`
2. the PR image digest is written to `deploy/candidate-a`
3. Argo syncs the slot automatically
4. a stable candidate URL becomes reachable
5. one aggregate `candidate-flight` status is posted to the PR
6. a new push cancels and replaces the old candidate attempt
7. a stuck run is eventually cleared by TTL
8. a second PR cannot silently queue itself behind the first; flight remains explicit

## Follow-On After The Prototype

Only after the one-slot prototype works:

1. add `candidate-b`
2. generalize slot selection across two slots
3. decide whether busy PRs wait longer or fail fast
4. revisit merge queue later if concurrency pain is real
5. revisit whether git-manager should become the slot coordinator

## Blunt Recommendation

Do not start with:

- two slots
- a queue service
- merge queue
- agent ownership
- a standalone controller process

Start with:

- one manual `flight-now` action
- one slot
- one lease file
- one aggregate status
- one stable URL set
- one bot pushing `deploy/candidate-a`

That is the fastest path to a real PR → build → candidate deploy prototype.
