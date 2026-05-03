---
id: agentic-contribution-loop
type: spec
title: Agentic Contribution Loop
status: draft
spec_state: as-built
trust: draft
summary: As-built spec for how external AI agents discover the operator, authenticate, contribute code via standard git tools, and request a candidate-a flight — the full closed loop without human involvement.
read_when: Building an agent that contributes to this repo, wiring the git manager to an external agent, or designing the next agentic workflow step.
owner: derekg1729
created: 2026-04-23
verified: 2026-04-23
tags: [agent-api, vcs, contribution, flight, agentic]
---

# Agentic Contribution Loop

> Single source of truth for the as-built, machine-executable contribution lifecycle.
> Human-focused development lifecycle lives in [development-lifecycle.md](./development-lifecycle.md).
> Validation flow detail lives in [docs/guides/agent-api-validation.md](../guides/agent-api-validation.md).
> Post-flight PR proof lives in [`.claude/skills/validate-candidate`](../../.claude/skills/validate-candidate/SKILL.md); do not hand-roll the scorecard/Loki step.

## Goal

Define the complete, as-built lifecycle for an external AI agent to discover the operator, authenticate, push code, open a PR via standard tools, request a candidate-a flight, and self-validate — with no human in the loop.

## Non-Goals

- Internal agent graph design (see [langgraph-patterns.md](./langgraph-patterns.md))
- Human developer workflow (see [development-lifecycle.md](./development-lifecycle.md))
- PR merge or close (pr-manager handles post-flight lifecycle)
- Multi-slot support (v0: candidate-a only)

## Design

### Architecture

```
external agent
  │
  ├─ GET  /.well-known/agent.json          ← discover all endpoints
  ├─ POST /api/v1/agent/register           ← get Bearer token
  ├─ POST /api/v1/work/items/:id/claims    ← claim active execution
  ├─ git push origin feat/my-branch        ← push branch (standard git)
  ├─ gh pr create ...                      ← open PR (standard GitHub CLI)
  ├─ POST /api/v1/work/items/:id/pr        ← link branch/PR to work item
  ├─ POST /api/v1/vcs/flight { prNumber }  ← CI-gated flight request → workflowUrl
  └─ GET  /api/v1/agent/runs/{id}/stream   ← optional: stream pr-manager result
```

`POST /api/v1/vcs/flight` is a **primitive gate** (verifies CI green + dispatches `candidate-flight.yml`).
`pr-manager` is the **policy layer** (decides when to flight, monitors rollout, verifies SHA).
These are not interchangeable — do not add policy logic to the REST endpoint.

The candidate slot lease is owned by the `candidate-flight.yml` workflow (see [candidate-slot-controller.md](./candidate-slot-controller.md)). The flight endpoint does not replicate lease logic.

### The Loop — As Built

**Step 1 — Discover**

```bash
BASE=https://test.cognidao.org
curl $BASE/.well-known/agent.json | jq .endpoints
```

Returns endpoints including `flight: ".../api/v1/vcs/flight"`.

**Step 2 — Auth**

```bash
API_KEY=$(curl -s -X POST $BASE/api/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}' | jq -r .apiKey)
```

**Step 3 — Adopt and claim one work item**

Adopt exactly one work item before coding. While active, claim it through the operator coordination API:

```bash
curl -s -X POST $BASE/api/v1/work/items/$ID/claims \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"lastCommand":"/implement"}'
```

Heartbeat long-running sessions through `/api/v1/work/items/$ID/heartbeat`.

**Step 4 — Push branch (standard git)**

```bash
git push origin feat/my-change
```

The operator does not accept patches or diffs. The agent pushes its own branch via standard git.

**Step 5 — Open PR (standard GitHub CLI)**

```bash
gh pr create --title "feat: my change" --body "Opened by my-agent." --base main
PR_NUMBER=<number from gh output>
```

Agents use `gh pr create` directly. The operator does not proxy PR creation — agents already have git push access to the repo and can use standard OSS tools.

Link the code artifact back to the work item once the PR exists:

```bash
curl -s -X POST $BASE/api/v1/work/items/$ID/pr \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"branch\":\"feat/my-change\",\"prNumber\":$PR_NUMBER}"
```

**Step 6 — Wait for CI to pass**

Poll `GET /api/v1/agent/runs` or watch the PR on GitHub until all required CI checks are green.

**Step 7 — Request flight**

```bash
curl -s -X POST $BASE/api/v1/vcs/flight \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"prNumber\": $PR_NUMBER}"
```

Returns:

```json
{
  "dispatched": true,
  "slot": "candidate-a",
  "prNumber": 1042,
  "headSha": "abc123...",
  "workflowUrl": "https://github.com/.../actions/workflows/candidate-flight.yml",
  "message": "Flight dispatched for PR #1042 @ abc123. Observe via core__vcs_get_ci_status."
}
```

The endpoint rejects with `422` if CI is not green. The candidate-flight workflow handles slot lease acquisition.

**Step 8 — Self-validate on candidate-a**

After a successful flight, hit your own feature endpoint on `test.cognidao.org` and confirm behavior. Post the result as a PR comment — this is the real validation gate. The `/validate-candidate` skill is the canonical procedure (agent or human). It must find a feature-specific Loki marker from the same exercise window; generic pod traffic is not sufficient proof.

**Step 9 — Request merge**

When validation passes, request merge. GitHub Merge Queue is enabled on `main` (see `infra/github/`):

- Marking the PR for merge (UI "Merge when ready", `gh pr merge --auto --squash`, or `core__vcs_merge_pr`) enqueues it.
- The queue rebases the PR onto current `main` and re-runs the required status checks on the rebased candidate (`unit`, `component`, `static`, `manifest`). All four are produced by workflows that fire on both `pull_request:` and `merge_group:` events — a hard requirement (see [`merge-queue-config.md`](./merge-queue-config.md), invariant `REPORT_OR_DON'T_REQUIRE`). PR-only checks like `CodeQL` and `Validate PR title` run on PRs as advisory signal but cannot be required, because GH's queue waits forever for required checks whose workflows lack a `merge_group:` trigger. Queue merges in order on green.
- The agent does not rebase. The vendor primitive owns rebase + retest + merge, deterministically.
- The agentic contribution loop terminates here. Post-merge, `push:main` triggers `flight-preview`, which auto-promotes the merged SHA to the preview environment for human review.

The merge queue's load-bearing guarantee in our pipeline is **anchoring preview-environment content to the merged tree**. Mechanism: `pr-build.yml` accepts `merge_group:` events and overwrites the `pr-{N}-{X}` image tag with the rebased-tree content. The `manifest` job is required-on-merge_group, so the queue cannot squash-merge until the rebased image is in GHCR. `flight-preview.yml` then re-tags `pr-{N}-{X}` → `preview-{mainSHA}` on `push:main` — the existing re-tag path, but now sourcing correct content. Without this, flight-preview would re-tag pre-rebase content (the bug class observed in PR #924 and PR #1033).

### Responsibility Table

| Responsibility            | `POST /api/v1/vcs/flight` | `pr-manager` graph    |
| ------------------------- | ------------------------- | --------------------- |
| Verify CI green           | ✅                        | ✅ (also checks)      |
| Dispatch candidate-flight | ✅                        | ✅                    |
| Acquire slot lease        | ❌ (workflow owns it)     | ❌ (workflow owns)    |
| Monitor Argo rollout      | ❌                        | ✅                    |
| Verify deployed SHA       | ❌                        | ✅                    |
| Exercise feature + Loki   | ❌                        | ✅ via validate step  |
| Request merge (enqueue)   | ❌                        | ✅                    |
| Rebase + retest + merge   | ❌ (merge queue owns)     | ❌ (merge queue owns) |

Use `/api/v1/vcs/flight` for deterministic dispatch (agent knows CI is green, wants to fly now).
Use `pr-manager` for judgment-based flight (agent wants the system to decide when to fly, monitor, and merge).

### Auth Model

| Method       | Source                        | Scope                                      |
| ------------ | ----------------------------- | ------------------------------------------ |
| Bearer token | `POST /api/v1/agent/register` | Machine agent; read/write to own resources |
| SIWE session | Browser wallet sign-in        | Human operator; same route access          |

All `POST /api/v1/vcs/flight` calls require auth.

### Contracts

| Contract                  | Location                                                    |
| ------------------------- | ----------------------------------------------------------- |
| `POST /api/v1/vcs/flight` | `packages/node-contracts/src/vcs.flight.v1.contract.ts`     |
| Agent registration        | `packages/node-contracts/src/agent-register.v1.contract.ts` |
| Chat completions          | `packages/node-contracts/src/ai.chat.v1.contract.ts`        |

## Invariants

- `MACHINE_READABLE_ENTRY` — all endpoints discoverable via `/.well-known/agent.json`; no hardcoded URLs in agent code
- `AUTH_REQUIRED` — no contribution endpoint is publicly writable
- `CI_GATE` — `/api/v1/vcs/flight` verifies CI is green for the exact PR head SHA before dispatching
- `NO_LEASE_SPLIT_BRAIN` — slot lease lives on the deploy branch (candidate-slot-controller); the flight endpoint does not write a competing lease
- `PRIMITIVE_OVER_POLICY` — `/api/v1/vcs/flight` is a primitive action; pr-manager is the policy layer; do not add flight logic to the REST endpoint
- `OSS_FOR_CODE_WORK` — agents use standard git + `gh pr create` for code contribution; the operator provides only the flight gate
- `SELF_VALIDATE` — agents are expected to validate their own changes on candidate-a; `deploy_verified: true` is the real gate, not `status: done`
- `FEATURE_LOG_PROOF` — post-flight validation must tie Loki evidence to the exercised feature route/tool/graph, not ambient pod traffic
- `MERGE_QUEUE_DETERMINISM` — the rebase + retest + merge step is owned by GitHub Merge Queue (a deterministic vendor primitive), not by an agent or operator code path; agents only request merge, never rebase
- `NO_AGENTIC_REBASE` — no LLM is in the merge path; rebase logic must remain a vendor primitive (GH Merge Queue, GitLab Merge Trains) so the merge sequence is auditable and reproducible
