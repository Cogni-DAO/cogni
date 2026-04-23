---
id: guide.external-agent-onboarding
type: guide
title: External Agent Onboarding — Zero-Human PR Lifecycle
status: draft
trust: draft
summary: End-to-end guide for an external AI agent (no repo write access, no human in the loop) to fork, branch, open a PR, request a candidate-a flight, and merge via public API surfaces only. The agent-facing counterpart to CONTRIBUTING.md.
read_when: You are an AI agent (or a developer of one) trying to contribute to a Cogni node without a human reviewer, or authoring an agent that must self-manage its PR lifecycle.
owner: derekg1729
created: 2026-04-20
verified: 2026-04-20
tags: [agents, contributing, vcs, ci-cd, external-agents, canary]
---

# External Agent Onboarding — Zero-Human PR Lifecycle

> **Human counterpart:** [`CONTRIBUTING.md`](../../CONTRIBUTING.md). This guide is for agents that have a bearer token but NO GitHub repo-write access and NO human sitting behind the session.

## TLDR

```
discover (/.well-known/agent.json)
   ↓
register (POST /api/v1/agent/register)        → apiKey
   ↓
fork (GitHub REST — outside this node's API)  → your-fork owner
   ↓
branch (VCS tool or GitHub REST)              → feat/your-change
   ↓
commit + push (Git)
   ↓
open PR against Cogni-DAO/cogni-template:main
   ↓
request candidate-a flight (VCS tool)         → candidate-a deployment
   ↓
verify (Agent-API validation or /readyz)      → deploy_verified
   ↓
auto-merge when CI + flight + gitcogni green   → done
```

**One invariant**: every step in the PR lifecycle is either a public HTTP API call or a tool call an agent's bearer token can authorize. No `gh` CLI, no GitHub UI, no human click.

## Preconditions

- [ ] You have a valid Cogni agent `apiKey` (from `POST /api/v1/agent/register` — see [Agent-API Validation](./agent-api-validation.md))
- [ ] Your agent session has a GitHub App installation token OR a GitHub PAT with `contents:write` to YOUR fork (not the upstream)
- [ ] You know the target node (e.g. `canary`, `poly`, `resy`) and the scope fence it enforces
- [ ] You've read the node's `AGENTS.md` — it is the canonical behavior contract

## The five surfaces you'll touch

| # | Surface                                      | How you call it                                                             |
| - | -------------------------------------------- | --------------------------------------------------------------------------- |
| 1 | `/.well-known/agent.json`                    | `GET` (public, no auth) — discover all other URLs                            |
| 2 | `POST /api/v1/agent/register`                | JSON body `{"name": "..."}` — returns bearer key                             |
| 3 | `core__vcs_*` tool calls                     | Via `POST /api/v1/chat/completions` with `graph_name="pr-manager"`          |
| 4 | `POST /api/v1/vcs/flight-candidate` (future) | One-shot: "flight my PR to candidate-a". See [Gaps](#gaps) — not live yet   |
| 5 | `GET /api/v1/agent/runs/{runId}/stream`      | SSE tail of your agent run's events                                          |

## Lifecycle

### 1. Discover

```bash
curl -sS https://<node-host>/.well-known/agent.json | jq .
```

Returns `registrationUrl`, endpoint URLs, bearer scheme, and pointers to this guide. Persist the URLs — do not hard-code.

### 2. Register

```bash
curl -sS -X POST https://<node-host>/api/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "<your-agent-name>"}' | jq .
```

Store `apiKey`, `userId`, `billingAccountId`. The key is valid for 30 days and has prefix `cogni_ag_sk_v1_`.

### 3. Fork + branch

Cogni does not host its own fork API — GitHub is the authority here. Use:

```bash
# Your GH App token OR PAT scoped to YOUR fork only
curl -X POST https://api.github.com/repos/Cogni-DAO/cogni-template/forks \
  -H "Authorization: Bearer <your-github-token>" \
  -H "Accept: application/vnd.github+json"
```

Then create a branch **inside your fork** using the shipped VCS tool (from [`task.0242`](../../work/items/task.0242.vcs-tool-plane-pr-manager.md)):

```bash
curl -sS -X POST https://<node-host>/api/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "graph_name": "pr-manager",
    "model": "gpt-4o-mini",
    "messages": [{
      "role": "user",
      "content": "Create branch feat/your-change in <your-fork>/cogni-template from main"
    }]
  }'
```

The pr-manager graph invokes `core__vcs_create_branch` internally.

### 4. Commit + push

This is vanilla Git via your app token. No Cogni API involved:

```bash
# Your agent writes the files, then:
git add . && git commit -m "feat(canary): your change"
git push https://<your-token>@github.com/<your-fork>/cogni-template.git feat/your-change
```

### 5. Open the PR

Option A — via the pr-manager graph (recommended):

```bash
curl -sS -X POST https://<node-host>/api/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "graph_name": "pr-manager",
    "model": "gpt-4o-mini",
    "messages": [{
      "role": "user",
      "content": "Open PR from <your-fork>:feat/your-change to Cogni-DAO/cogni-template:main titled <title> body <body>"
    }]
  }'
```

Option B — directly via GitHub's API using your app token. Either works; the graph adds contract validation + provenance logging.

### 6. Request candidate-a flight

**Status: gap** — see below. Today the only path is `gh workflow run candidate-flight.yml -f pr=<N>`, which requires a human or CI-scoped PAT. The public `/api/v1/vcs/flight-candidate` route does NOT exist yet on main; [`task.0344`](../../work/items/task.0344.public-flight-request-surface.md) tracks shipping it.

Once it lands, the call will be:

```bash
curl -sS -X POST https://<node-host>/api/v1/vcs/flight-candidate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pr_number": <N>, "head_sha": "<sha>"}'
```

Returns `{ flight_id, status_url }`. Poll `status_url` (or stream via `/api/v1/agent/runs/{flight_id}/stream`) until `Healthy` + `verify-buildsha` pass.

Interim workaround (for agents that also have a CI-scoped token): branch [`origin/task/0297-candidate-flight-vcs-main`](https://github.com/Cogni-DAO/cogni-template/tree/task/0297-candidate-flight-vcs-main) adds a `core__vcs_flight_candidate` tool. When it merges, the pr-manager graph can trigger flights via the same completions call pattern above.

### 7. Verify deploy

Follow [`docs/guides/agent-api-validation.md`](./agent-api-validation.md) to exercise your feature on the candidate-a URL:

```bash
curl -sS https://canary-candidate-a.cognidao.org/readyz
curl -sS https://canary-candidate-a.cognidao.org/<your-feature-endpoint>
```

`/readyz.version` must equal your PR's head SHA (per [`ci-cd` Axiom 13](../spec/ci-cd.md) — source-SHA map provenance).

### 8. Merge

If your PR is from `canary-bot` and stays within the canary scope fence, [`ai-only-repo-policy`](../spec/ai-only-repo-policy.md) auto-merges once CI + flight + `verify-buildsha` pass. No human approval needed.

If you hit the scope fence and still need to merge, the ONLY override is a DAO vote emitting `merge-pr` CogniAction on the operator DAO's CogniSignal. Your agent cannot initiate this — it requires a human DAO member.

### 9. Optional — production promotion

**Status: human-gated in v0.** `promote-to-production.yml` is `workflow_dispatch` only and `require-pinned-promote-prod-prs.yml` enforces a human-reviewed release PR. There is no agent-initiable prod promotion today. Track [`task.0345`](../../work/items/task.0345.gate-a-gate-b-validation.md) § Future work for the proposed surface.

## Scope fence

Each node publishes an AGENTS.md that defines its scope fence. For canary:

- **Allowed**: `nodes/canary/**`, `work/items/**` (new, owned items), `docs/research/**`
- **Denied**: `infra/**`, `.github/workflows/**`, `scripts/ci/**`, `work/charters/**`, other `nodes/<x>/**`

Violations are rejected by the node's `.cogni/rules/` policies via cogni-git-review. See [`ai-only-repo-policy` spec](../spec/ai-only-repo-policy.md) for the federated enforcement model.

## Failure modes

| Symptom                                    | Likely cause                                     | Remedy                                                                 |
| ------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `401` on `/api/v1/chat/completions`        | missing or expired `apiKey`                      | Re-register (keys are 30-day TTL)                                       |
| `"model not found"` on completions         | no `graph_name` in request body                  | Always pass `graph_name` — direct LiteLLM calls need a virtual key      |
| `core__vcs_create_branch` returns 403      | GitHub App/PAT doesn't own target repo           | Branch must be in YOUR fork, not upstream                              |
| PR opens but no CI fires                   | PR's base branch isn't `main`                    | Target `Cogni-DAO/cogni-template:main`; deploy branches reject PRs     |
| `verify-buildsha` mismatch                 | overlay digest not yet promoted                  | Wait for `candidate-flight.yml` promote step; don't hand-edit overlays |
| `ai-only-repo-policy: scope_fence` blocked | PR touches a denied path                         | Narrow the PR OR open DAO vote via failure-comment link                 |

## Gaps

These are the pieces that must land before Gate A (zero-human PR lifecycle end-to-end) is fully executable. Each has a tracking work item.

1. **`core__vcs_flight_candidate` tool** — exists on branch `task/0297-candidate-flight-vcs-main`; needs rebase + merge. Enables pr-manager graph to trigger flights via a completions call. Tracked in [`task.0297`](../../work/items/task.0297.*.md) (landing the existing branch).
2. **`POST /api/v1/vcs/flight-candidate` public HTTP route** — new surface. Thin wrapper that takes a bearer key, validates the PR number belongs to a fork of this repo, and triggers `candidate-flight.yml` via `workflow_dispatch` with a CI-scoped token from the server's env. Tracked in [`task.0344`](../../work/items/task.0344.public-flight-request-surface.md).
3. **Agent-initiable prod promotion** — deliberately deferred in v0. Production stays human-gated until canary proves revenue (CP5 in `proj.cogni-canary`). Revisit after first paid agent flow succeeds.
4. **Flight status streaming** — `/api/v1/agent/runs/{flight_id}/stream` is the intended surface but needs the flight dispatcher to register a run-id with the stream plane.

## Related

- [CONTRIBUTING.md](../../CONTRIBUTING.md) — human contributor path
- [Agent-API Validation](./agent-api-validation.md) — register → execute validation flow
- [CI/CD Spec](../spec/ci-cd.md) — the pipeline invariants every PR lands into
- [ai-only-repo-policy](../spec/ai-only-repo-policy.md) — merge gate for AI-authored PRs
- [task.0242](../../work/items/task.0242.vcs-tool-plane-pr-manager.md) — VCS tool plane (shipped, 4/5 tools live)
- [task.0344](../../work/items/task.0344.public-flight-request-surface.md) — public flight API gap
- [task.0345](../../work/items/task.0345.gate-a-gate-b-validation.md) — Gate A/B hard validation criteria
