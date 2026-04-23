---
id: task.0344
type: task
title: "Public /api/v1/vcs/flight-candidate HTTP route — agent-initiable candidate-a flight"
status: needs_design
priority: 1
estimate: 3
rank: 1
summary: "Ship a bearer-auth HTTP endpoint that lets an external agent (no repo-write access) request a candidate-a flight for a specific PR. Current gap blocks Gate A of the cogni-canary validation plan."
outcome: "An agent with a valid Cogni `apiKey` can POST `/api/v1/vcs/flight-candidate` with `{pr_number, head_sha}` and receive a `flight_id`. The server dispatches `candidate-flight.yml` via `workflow_dispatch` using a server-side CI-scoped PAT. Agent polls or streams the flight via `/api/v1/agent/runs/{flight_id}/stream`."
spec_refs:
  - canary
  - ci-cd
  - external-agent-onboarding
assignees: derekg1729
project: proj.cogni-canary
created: 2026-04-20
updated: 2026-04-20
labels: [canary, vcs, external-agent, gap]
external_refs:
  - .github/workflows/candidate-flight.yml
  - docs/guides/external-agent-onboarding.md
  - work/items/task.0297.*.md
---

# Public flight-request surface

## Context

Today `candidate-flight.yml` is `workflow_dispatch` only — the only trigger is a human (or CI-scoped token) running `gh workflow run`. External agents with a Cogni bearer token cannot flight their own PRs, which breaks the zero-human PR lifecycle described in `docs/guides/external-agent-onboarding.md`.

Branch `origin/task/0297-candidate-flight-vcs-main` adds a `core__vcs_flight_candidate` tool — that's half the story (agents can invoke via the pr-manager graph). The other half is a thin HTTP route that is callable without going through a graph.

## Deliverables

- [ ] `POST /api/v1/vcs/flight-candidate` route at `nodes/operator/app/src/app/api/v1/vcs/flight-candidate/route.ts`
  - Bearer auth (same scheme as `/api/v1/agent/register`)
  - Request body: `{ pr_number: number, head_sha: string, target_node?: "canary"|"operator"|... }`
  - Validates: PR exists, its head_sha matches the PR tip, PR is open, PR's base is `main`
  - Rate limit: 1 flight/PR/hour per agent (flight slots are scarce)
  - Dispatches `candidate-flight.yml` via `workflow_dispatch` using a **server-side** CI PAT (never the agent's token)
  - Returns `{ flight_id, status_url, workflow_run_id }`
- [ ] `GET /api/v1/vcs/flight-candidate/{flight_id}` status read (polling path)
- [ ] Stream-plane registration so `/api/v1/agent/runs/{flight_id}/stream` replays flight events
- [ ] Contract: `src/contracts/vcs.flight-candidate.v1.contract.ts` (Zod)
- [ ] Billing: flights cost credits (flat fee) — charge the agent's `billingAccountId` at dispatch
- [ ] Audit log: `{ agent_user_id, pr_number, head_sha, flight_id }` to Loki at `info`

## Security constraints

- **The agent's bearer key MUST NOT be forwarded to GitHub.** Server uses its own CI PAT for the dispatch.
- Rate limit prevents flight-slot DOS from a malicious agent.
- PR validation prevents "flight someone else's PR" griefing — only a PR whose head SHA you can name can be flighted, and the PR must be in a state that makes flight meaningful (open, base=main, CI green-or-in-progress).
- `target_node` parameter is scope-fenced via the AI-only-repo-policy — an agent registered to canary cannot flight a PR that modifies `nodes/operator/**`.

## Validation

- `exercise:` — register a fresh agent, open a trivial PR to `nodes/canary/` from a fork, call `POST /api/v1/vcs/flight-candidate` with the PR number. Verify a `workflow_run` appears in `candidate-flight.yml` and the returned `status_url` resolves to a live run.
- `observability:` — Loki `{app="operator", route="/api/v1/vcs/flight-candidate"}` shows the dispatch event; `{github_run_id="<run_id>"}` correlates to the flight logs.

## Non-goals

- Prod promotion (deliberately human-gated in v0)
- Dispatching to non-candidate-a lanes (candidate-b, preview reserved for post-merge)
- Allowing human-authored PRs to be flighted by agents (policy decision: agent only flights its own bot-authored PRs)

## Open questions

- Should the server validate scope fence BEFORE dispatch (cheaper, faster rejection) or let `ai-only-repo-policy` catch it post-flight (simpler code)? Lean: pre-dispatch validation against the node's rule file — matches the "strictest wins" model.
- Billing unit for a flight: flat N credits, or proportional to resource-time? Flat is simpler; proportional punishes slow apps. Lean flat; revisit after first paid agent flow produces usage data.
