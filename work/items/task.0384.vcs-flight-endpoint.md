---
id: task.0384
type: task
title: "POST /api/v1/vcs/flight — CI-gated candidate-a flight endpoint + vcs/pr cleanup"
status: done
priority: 1
rank: 1
estimate: 3
summary: "Remove the wrongly-merged vcs/pr endpoint and replace with POST /api/v1/vcs/flight: CI gate check, workflow dispatch, return GitHub workflow metadata. No lease logic in the HTTP layer."
outcome: "External AI agents can programmatically request a candidate-a flight for a CI-green PR via one authenticated REST call. The candidate slot lease is owned by the flight workflow, not the endpoint."
spec_refs:
  - ci-cd-spec
  - spec.candidate-slot-controller-v0
  - agentic-contribution-loop
assignees: [derekg1729]
credit:
owner: derekg1729
created: 2026-04-23
updated: 2026-04-24
branch: feat/vcs-flight-endpoint
pr: https://github.com/Cogni-DAO/node-template/pull/1021
tags: [operator, vcs, cicd, agent-api]
project: proj.agentic-interop
---

# task.0361 — POST /api/v1/vcs/flight + vcs/pr cleanup

## Context

`POST /api/v1/vcs/pr` was merged to main (PR #1004) but the design was wrong — agents already
have git push access and can use `gh pr create` directly. The endpoint was redundant and
duplicated standard OSS tooling.

The remaining gap: an agent with a CI-green PR has no deterministic REST path to request a
candidate-a flight without going through the LLM-mediated `pr-manager` graph.

`pr-manager` remains right for agents that want judgment (when to flight, what to monitor).
This endpoint is for agents that already know the answer: "CI is green on PR #N, deploy it now."

## Goal

1. Remove `POST /api/v1/vcs/pr` and all related `createPr` code.
2. Add `POST /api/v1/vcs/flight { prNumber }` — authenticated, verifies CI green for exact head SHA,
   dispatches `candidate-flight.yml`, returns GitHub workflow metadata.
3. Update docs: `agentic-contribution-loop.md` spec + `CONTRIBUTING.md` agent loop section.

## Acceptance Criteria

- [x] All `createPr` / `vcs/pr` remnants removed from codebase
- [x] `/.well-known/agent.json` has `"flight"` key, not `"contribute"`
- [x] Verifies CI is green for PR head SHA via `getCiStatus`; rejects 422 if not
- [x] Dispatches `candidate-flight.yml` via `dispatchCandidateFlight`
- [x] Returns `{ slot, prNumber, headSha, workflowUrl, dispatched, message }` with 202
- [x] No Postgres lease table — slot lease lives on deploy branch (candidate-slot-controller)
- [x] `docs/spec/agentic-contribution-loop.md` created with correct loop design
- [x] `CONTRIBUTING.md` updated: `gh pr create` for PRs, `/vcs/flight` for deployment

## Out of Scope

- Multi-slot support (v0: candidate-a only, hardcoded)
- Post-dispatch GitHub run ID polling (GitHub returns 204; agent observes via getCiStatus)
- Postgres lease table (would duplicate deploy-branch canonical lease — split-brain risk)

## Validation

```
exercise: |
  Register agent, identify a CI-green PR, POST /api/v1/vcs/flight { prNumber },
  confirm 202 with slot=candidate-a and workflowUrl pointing to the GitHub Actions workflow.
  Confirm 422 if CI is not green (test against a PR with a failing check).
observability: |
  Loki: {namespace="cogni-candidate-a"} |= "vcs.flight" | json
  Expect: routeId="vcs.flight", prNumber, slot=candidate-a, dispatched=true
```

## Design

### Outcome

External AI agents can request a candidate-a flight for a CI-green PR via one authenticated REST
call. The slot lease (deploy-branch file) remains owned by the `candidate-flight.yml` workflow —
no competing lease in the HTTP layer.

### Approach

**Solution**: Auth → `getCiStatus` (CI gate) → `dispatchCandidateFlight` → return dispatch result.
No new tables. No lease logic. The candidate-slot-controller workflow handles atomicity.

**Reuses**:

- `VcsCapability.getCiStatus` (already exists — reads PR head SHA + check statuses)
- `VcsCapability.dispatchCandidateFlight` (already exists — fires `candidate-flight.yml`)
- `wrapRouteHandlerWithLogging` + `auth: { mode: "required", getSessionUser }` (Bearer + session)
- `getGithubRepo()` (reads owner/repo from repo-spec.yaml)
- `flightOperation` Zod contract (new, in `packages/node-contracts`)

**Why no Postgres lease?** The `candidate-slot-controller.md` spec explicitly defines the lease
as a file on the `deploy/candidate-a` branch. Writing a parallel Postgres lease would create
split-brain between the HTTP layer and the workflow. The workflow already handles concurrency
via GitHub Actions queuing + the deploy-branch lease file.

**Rejected**:

- _Postgres `candidate_flight_leases` table_ — split-brain with deploy-branch canonical lease
- _Post-dispatch GitHub run ID polling_ — GitHub returns 204; bounded polling is racey and adds
  latency for no real benefit (agent can observe via `getCiStatus` for the `candidate-flight` check)

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [x] `CONTRACTS_FIRST`: Route input/output validated through `vcs.flight.v1.contract.ts` Zod schemas
- [x] `CAPABILITY_BOUNDARY`: Route calls `VcsCapability` only — no direct Octokit in the route
- [x] `AUTH_REQUIRED`: Route uses `auth: { mode: "required", getSessionUser }` — Bearer and session
- [x] `CI_GATE`: Returns 422 if `allGreen=false` or `pending=true` for the PR head SHA
- [x] `NO_LEASE_SPLIT_BRAIN`: Route does not write any lease — workflow owns the deploy-branch lease
- [x] `AGENT_JSON_UPDATED`: `/.well-known/agent.json` has `"flight"` not `"contribute"`

### Files

- **Deleted**: `nodes/operator/app/src/app/api/v1/vcs/pr/route.ts`
- **Deleted**: `packages/node-contracts/src/vcs.create-pr.v1.contract.ts`
- **Removed**: `createPr?:` from `packages/ai-tools/src/capabilities/vcs.ts`
- **Removed**: `CreatePrResult` type from `packages/ai-tools`
- **Removed**: `createPr` impl from `nodes/operator/app/src/adapters/server/vcs/github-vcs.adapter.ts`
- **Removed**: `createPr` stub from `nodes/operator/app/src/bootstrap/capabilities/vcs.ts`
- **Create**: `packages/node-contracts/src/vcs.flight.v1.contract.ts` — Zod contract
- **Create**: `nodes/operator/app/src/app/api/v1/vcs/flight/route.ts` — POST handler
- **Modified**: `nodes/operator/app/src/app/.well-known/agent.json/route.ts` — `flight` replaces `contribute`
- **Create**: `docs/spec/agentic-contribution-loop.md` — as-built spec for the full agentic loop
- **Modified**: `CONTRIBUTING.md` — agent loop section with `gh pr create` + `/vcs/flight`

## PR / Links

- PR: https://github.com/Cogni-DAO/node-template/pull/1021
- Handoff: [handoff](../handoffs/task.0370.handoff.md)
