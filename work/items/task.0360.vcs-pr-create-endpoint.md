---
id: task.0360
type: task
title: "POST /api/v1/vcs/pr — VCS create-PR endpoint for external agents"
status: needs_implement
priority: 1
rank: 1
estimate: 2
summary: "Add POST /api/v1/vcs/pr so external AI agents can open a GitHub PR from an existing remote branch, closing the autonomous contribution loop."
outcome: "External agents (e.g. OpenClaw/Coco) can push a branch and open a PR via a single authenticated REST call. Combined with pr-manager, this enables the full loop: push → create PR → flight → self-validate."
spec_refs:
  - architecture-spec
assignees: [derekg1729]
credit:
owner: derekg1729
created: 2026-04-23
updated: 2026-04-23
branch: feat/vcs-pr-create
tags: [operator, vcs, agent-api]
project: proj.agentic-interop
---

# task.0360 — POST /api/v1/vcs/pr — VCS create-PR endpoint for external agents

## Context

External AI agents (e.g. OpenClaw/Coco) can currently discover the operator, register for an API key, run graphs, and stream run results. The one missing link in the closed loop is **submitting code**: there is no endpoint for an agent to create a PR.

Without this, external agents can _ask_ the operator to act but cannot _contribute work themselves_. The target loop is:

```
external agent → POST /api/v1/vcs/pr  (create PR)
              → POST /api/v1/chat/completions { graph_name: "pr-manager" }  (request flight)
              → GET  /api/v1/agent/runs/{id}/stream  (subscribe to result)
              → self-validate deployed endpoint
```

The VCS capability framework (task.0242 — needs_merge) already has `VcsCapability.createBranch` and the GitHub App adapter wired. This task adds the HTTP surface on top.

## Goal

`POST /api/v1/vcs/pr` — authenticated (Bearer token), creates a GitHub PR from a supplied branch + diff or branch name, returns PR number + URL. External agents can then reference that PR number in subsequent pr-manager calls.

## Acceptance Criteria

- [ ] `POST /api/v1/vcs/pr` accepts Bearer token (machine agent or session)
- [ ] Input: `{ branch: string, title: string, body: string, base?: string }` — branch must already exist on remote
- [ ] Creates PR via GitHub App (reuses `VcsCapability` / `GithubVcsAdapter`)
- [ ] Returns `{ prNumber: number, url: string, status: "open" }`
- [ ] Contract test passes against the live route
- [ ] `/.well-known/agent.json` updated: add `"contribute": "/api/v1/vcs/pr"`
- [ ] `CONTRIBUTING.md` links to `agent.json` for AI contributor onboarding

## Out of Scope

- Branch creation (already in VcsCapability.createBranch — separate endpoint or add to this one if trivial)
- Diff/patch application on the server (agent pushes its own branch first)
- PR update / close

## Validation

```
exercise: |
  Register a machine agent, push a test branch to the repo, POST /api/v1/vcs/pr with branch+title+body,
  confirm PR appears on GitHub with correct title/body, confirm prNumber returned.
observability: |
  Loki query: {namespace="cogni-candidate-a"} |= "vcs_create_pr" | json
  Expect: contractId=vcs.create_pr.v1, prNumber in log line, no error field
```

## Design

### Outcome

External AI agents can push a branch and open a PR via a single authenticated REST call, closing the autonomous contribution loop: `push branch → POST /api/v1/vcs/pr → pr-manager flights it → agent self-validates`.

### Approach

**Solution**: Add `createPr` to `VcsCapability` + `GithubVcsAdapter`, expose via a thin route in the operator node. No feature service needed — the capability is already the domain boundary.

**Reuses**:

- `GithubVcsAdapter` (Octokit + GitHub App auth already wired, same pattern as `createBranch`)
- `wrapRouteHandlerWithLogging` + `auth: { mode: "required", getSessionUser }` (accepts Bearer or session)
- `packages/node-contracts` contract pattern (Zod in/out, `as const`)
- `stubVcsCapability` (extend with throwing `createPr` stub)

**Rejected**:

- _Feature service layer_ — overkill for a single-adapter delegation; route facade is sufficient and matches the existing `vcs-flight` route pattern
- _AI tool (`core__vcs_create_pr`)_ — task.0278 scope; external agents call HTTP directly, not via graph tool
- _Patch/diff application server-side_ — agents push their own branch first; server only opens the PR

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] `CONTRACTS_FIRST`: Route input/output validated through `vcs.create-pr.v1.contract.ts` Zod schemas; no ad-hoc type declarations
- [ ] `CAPABILITY_BOUNDARY`: Route calls `VcsCapability.createPr` only — no direct Octokit in the route
- [ ] `AUTH_REQUIRED`: Route uses `auth: { mode: "required", getSessionUser }` — Bearer and session both accepted; no `mode: "none"`
- [ ] `STUB_COMPLETE`: `stubVcsCapability` updated with throwing `createPr` so missing-credentials path still type-checks
- [ ] `AGENT_JSON_UPDATED`: `/.well-known/agent.json` includes `"contribute": "/api/v1/vcs/pr"`
- [ ] `ARCHITECTURE_ALIGNMENT`: `packages/ai-tools` holds the interface; operator node holds the route + adapter impl; no `src/` ↔ `packages/` circular imports

### Files

- **Create**: `packages/ai-tools/src/capabilities/vcs.ts` — add `createPr(params): Promise<CreatePrResult>` to interface + result type
- **Modify**: `nodes/operator/app/src/adapters/server/vcs/github-vcs.adapter.ts` — implement `createPr` via Octokit `POST /repos/{owner}/{repo}/pulls`
- **Modify**: `nodes/operator/app/src/adapters/server/vcs/stub-vcs.capability.ts` (or wherever stub lives) — add throwing `createPr` stub
- **Create**: `packages/node-contracts/src/vcs.create-pr.v1.contract.ts` — Zod contract: `{ branch, title, body, base? }` → `{ prNumber, url, status: "open" }`
- **Create**: `nodes/operator/app/src/app/api/v1/vcs/pr/route.ts` — POST handler: parse contract, call `getVcsCapability()`, return output
- **Modify**: `nodes/operator/app/src/app/api/v1/vcs/pr/route.ts` (or `.well-known/agent.json` source) — add `"contribute"` field
- **Modify**: `CONTRIBUTING.md` — add agent contributor quickstart linking to `/.well-known/agent.json`
- **Test**: `tests/contract/vcs.create-pr.contract.ts` — contract test against live route

### Implementation notes

`GithubVcsAdapter.createPr` is a one-shot Octokit call — same shape as `createBranch`:

```ts
const { data } = await this.octokit(owner, repo).request(
  "POST /repos/{owner}/{repo}/pulls",
  { owner, repo, title, body, head: branch, base: base ?? "main" }
);
return { prNumber: data.number, url: data.html_url, status: "open" as const };
```

Bootstrap container already has `getVcsCapability()` — route just imports it, no new wiring needed.

## Related

- task.0242 — VCS tool plane (GithubVcsAdapter, VcsCapability) — must merge first
- task.0278 — Git manager skill (branch+PR+merge — deeper agentic authoring)
- bug.0297 — agent register is open factory (secure registration before wide external rollout)
- docs/guides/agent-api-validation.md — reference interaction flow
