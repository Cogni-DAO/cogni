---
id: task.0297
type: task
title: "Add candidate-flight tool to VCS capability / git manager agent"
status: needs_merge
priority: 1
rank: 2
estimate: 2
created: 2026-04-09
updated: 2026-04-09
summary: "Add core__vcs_flight_candidate tool to packages/ai-tools and wire it into the git manager graph so the agent can dispatch candidate flights with a single call."
outcome: "Git manager agent can call core__vcs_flight_candidate(pr_number) to dispatch candidate-a flight; existing core__vcs_get_ci_status returns the candidate-flight check result."
spec_refs:
  - docs/guides/candidate-flight-v0.md
  - docs/spec/candidate-slot-controller.md
  - docs/spec/ci-cd.md
assignees: []
credit:
project: proj.cicd-services-gitops
initiative: ini.cicd-trunk-based
branch: task/0297-candidate-flight-vcs
---

# task.0297 — Add candidate-flight tool to VCS capability

## Key Pointers

### What exists today (read these first)

- **Workflow**: `.github/workflows/candidate-flight.yml` — `workflow_dispatch` with `pr_number` + optional `head_sha` inputs
- **Dispatch command**: `gh workflow run candidate-flight.yml --repo Cogni-DAO/node-template --field pr_number=N`
- **Lease file**: `deploy/candidate-a:infra/control/candidate-lease.json` — slot state truth (`free` / `occupied` / `failed`)
- **Slot spec**: `docs/spec/candidate-slot-controller.md` — lease TTL, superseding-push, busy behavior
- **Operator guide**: `docs/guides/candidate-flight-v0.md` — full operator flow + hard boundaries
- **CI spec**: `docs/spec/ci-cd.md` — where candidate-a fits in the pipeline

### What exists in VCS tooling (extend, don't duplicate)

- `packages/ai-tools/src/capabilities/vcs.ts` — `VcsCapability` interface (listPrs, getCiStatus, mergePr, createBranch)
- `nodes/operator/app/src/adapters/server/vcs/github-vcs.adapter.ts` — `GitHubVcsAdapter` implements VcsCapability via Octokit
- `nodes/operator/app/src/bootstrap/ai/tool-bindings.ts` — wires VCS tool implementations
- `packages/langgraph-graphs/src/graphs/pr-manager/` — pattern for graph tools.ts + prompts.ts + graph.ts

### Hard boundaries (from spec — do not violate)

- No auto-flight of every green PR — human or agent must explicitly choose
- No queuing — if slot busy, report and stop
- No rebuild — flight only PRs with existing `pr-{N}-{sha}` GHCR images from PR Build
- Slot truth lives in the lease file only — no second state plane

## Design

### Outcome

Git manager agent calls `core__vcs_flight_candidate(owner, repo, sha)` to dispatch the `candidate-flight.yml` workflow for a specific build artifact. SHA is the primary identifier — the tool resolves the associated PR number. The existing `core__vcs_get_ci_status` returns the `candidate-flight` check result after dispatch.

### Approach

**Solution**: One new tool (`core__vcs_flight_candidate`) + cherry-pick PR #794 for git-manager graph + add flight tool to its tool set.

**SHA-first design**: The command operates on a build SHA (the artifact), not a PR number. A PR may have multiple builds (push 1 → sha-A, push 2 → sha-B, push 3 → sha-C). You want to fly a specific SHA, not "the current head of PR N". If you dispatch while push 4 is still building, its image doesn't exist yet and the flight fails. SHA-first forces the agent to reason about which build to fly.

Tool input: `{ owner, repo, sha, prNumber? }` — SHA required, PR number optional. If `prNumber` not supplied, the adapter resolves it via `GET /repos/{owner}/{repo}/commits/{sha}/pulls`. The workflow requires `pr_number` for posting status and lease tracking, so it is always resolved before dispatch.

The tool dispatches via `POST .../actions/workflows/candidate-flight.yml/dispatches` with `ref: "main"` (where the workflow file lives — not `staging` which is the PR target; the workflow YAML was merged to `main` via PR #851). Returns `{ dispatched: true, sha, prNumber, workflowUrl, message }`.

**Cherry-pick strategy for git-manager**: PR #794 (`feat/git-manager`, merged to canary 2026-04-06, commit `c5743653`) has the complete graph source. Cherry-pick applies clean with zero conflicts. Implementation cherry-picks this commit, then adds `VCS_FLIGHT_CANDIDATE_NAME` to `GIT_MANAGER_TOOL_IDS`.

**Reuses**:

- `VcsCapability` interface — add one method (`flightCandidate`)
- `GitHubVcsAdapter` — add one method using the same `getOctokit()` helper
- PR #794 cherry-pick — provides git-manager graph, prompt, catalog entry
- GitHub commits/pulls API — resolve PR from SHA (already using Octokit throughout)

**Rejected**:

- `getCandidateLease()` tool — V0 relies on the workflow's own busy check. Dispatch fires; if slot is occupied the workflow fails fast and posts `candidate-flight: failure` on the SHA. Agent reads the failure from `getCiStatus` after dispatch — no pre-check needed.
- `getCandidateFlightStatus()` tool — fully redundant with `getCiStatus`; that already returns all commit statuses including `candidate-flight`.
- Separate `CandidateFlightCapability` interface — unnecessary complexity; one more method on `VcsCapability` is consistent with the existing pattern.
- PR-number-first interface — a PR has many builds; the build (SHA) is the unit being flighted. Agent must reason about which SHA, not just "the PR".

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] NO_AUTO_FLIGHT: Tool only dispatches on explicit agent call. No automation, no trigger-on-green logic. (spec: candidate-slot-controller.md)
- [ ] NO_QUEUE: If slot is busy the workflow fails; agent must report and stop, never retry silently. (spec: candidate-slot-controller.md)
- [ ] NO_REBUILD: Tool dispatches only; workflow fails if `pr-{N}-{sha}` GHCR image is absent. No image build in this tool. (spec: candidate-slot-controller.md)
- [ ] SLOT_TRUTH_IN_LEASE: Tool only dispatches the workflow. Lease file is written exclusively by workflow scripts. Tool never reads or writes the lease. (spec: candidate-slot-controller.md)
- [ ] CAPABILITY_INJECTION: `flightCandidate` implementation injected at bootstrap via `VcsCapability`, not hardcoded in the tool.
- [ ] TOOL_ID_NAMESPACED: New tool ID is `core__vcs_flight_candidate`.
- [ ] SIMPLE_SOLUTION: One new tool, one new graph — no new ports, no new packages, no new services.
- [ ] ARCHITECTURE_ALIGNMENT: New tool follows established packages/ai-tools pattern exactly. New graph follows brain/pr-manager graph pattern.

### Files

```
Step 1 — cherry-pick c5743653 (PR #794, git-manager graph from canary):
  Creates: packages/langgraph-graphs/src/graphs/git-manager/{tools,prompts,graph,server,cogni-exec}.ts
  Modifies: packages/langgraph-graphs/src/catalog.ts (registers git-manager)
  Modifies: packages/langgraph-graphs/src/graphs/index.ts
  Also brings: docs/guides/git-management-playbook.md

Step 2 — add VCS flight tool (packages/ai-tools):
  Modify: src/capabilities/vcs.ts          — add CandidateFlightResult type + flightCandidate(sha, prNumber?) to VcsCapability
  Create: src/tools/vcs-flight-candidate.ts — schema (sha required, prNumber optional), contract, impl factory, stub, bound tool
  Modify: src/catalog.ts                   — register vcsFlightCandidateBoundTool
  Modify: src/index.ts                     — export all new symbols

Step 3 — adapter + wiring (nodes/operator):
  Modify: adapters/server/vcs/github-vcs.adapter.ts  — implement flightCandidate: resolve prNumber from SHA if absent, dispatch workflow
  Modify: bootstrap/capabilities/vcs.ts               — add flightCandidate to stubVcsCapability
  Modify: bootstrap/ai/tool-bindings.ts               — wire VCS_FLIGHT_CANDIDATE_NAME

Step 4 — stub compliance (other nodes):
  Modify: nodes/node-template/app/src/bootstrap/capabilities/vcs.ts — add flightCandidate stub
  Modify: nodes/resy/app/src/bootstrap/capabilities/vcs.ts          — add flightCandidate stub

Step 5 — wire flight tool into git-manager:
  Modify: packages/langgraph-graphs/src/graphs/git-manager/tools.ts — add VCS_FLIGHT_CANDIDATE_NAME to GIT_MANAGER_TOOL_IDS
```

### Key implementation notes

**`flightCandidate` signature**:

```typescript
flightCandidate(params: {
  owner: string;
  repo: string;
  sha: string;         // required — the specific build artifact to fly
  prNumber?: number;   // optional — resolved from SHA if not supplied
}): Promise<CandidateFlightResult>
// CandidateFlightResult: { dispatched: boolean; sha: string; prNumber: number; workflowUrl: string; message: string }
```

**SHA → PR resolution** (when `prNumber` not supplied):

```typescript
// GET /repos/{owner}/{repo}/commits/{sha}/pulls
// Returns PRs associated with this commit. Take first open PR's number.
// Error if none found — SHA has no associated open PR.
```

**Workflow dispatch**:

```typescript
// POST /repos/{owner}/{repo}/actions/workflows/candidate-flight.yml/dispatches
// ref: "main"  ← workflow YAML lives on main (merged via PR #851), not staging
// inputs: { pr_number: String(resolvedPrNumber), head_sha: sha }
// HTTP 204 — build return from resolved inputs
```

**git-manager flight prompt addition** (patch onto cherry-picked prompt):

> **Candidate Flight**: To flight a build, you need the commit SHA — not just a PR number. A PR may have many builds; you are flying a specific artifact. Verify the build is complete (`getCiStatus` shows all checks green including `build`) before flighting. Call `core__vcs_flight_candidate({ sha })`. After dispatch, poll `getCiStatus` to watch `candidate-flight` resolve. If it fails immediately, the slot was busy — report and stop. Do NOT queue or auto-retry.

## Validation

- `flightCandidate({ sha: "abc123", owner, repo })` resolves PR number from SHA, dispatches workflow, returns `{ dispatched: true, sha, prNumber, workflowUrl, message }`
- `flightCandidate({ sha, prNumber: 846, owner, repo })` skips PR lookup, dispatches directly
- Slot busy → dispatch succeeds (HTTP 204), workflow fails fast, `getCiStatus` shows `candidate-flight: failure`; agent reports and stops
- `getCiStatus(846)` returns `candidate-flight` check in `checks[]` after workflow posts status
- TypeScript compiles across all three nodes (no interface mismatch on stub)
