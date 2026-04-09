---
id: task.0297
type: task
title: "Add candidate-flight tool to VCS capability / git manager agent"
status: needs_implement
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

Git manager agent calls `core__vcs_flight_candidate(owner, repo, prNumber)` to dispatch the `candidate-flight.yml` workflow; the existing `core__vcs_get_ci_status` returns the `candidate-flight` check result — no new status-polling tool needed.

### Approach

**Solution**: One new tool (`core__vcs_flight_candidate`) + one new graph (`git-manager`).

The tool dispatches `candidate-flight.yml` via Octokit's workflow dispatch API. GitHub returns HTTP 204 (no body) on dispatch — the tool returns `{ dispatched: true, workflowUrl, message }`. The agent uses `core__vcs_get_ci_status` to read the resulting `candidate-flight` commit status.

**Reuses**:
- `VcsCapability` interface — add one method (`flightCandidate`)
- `GitHubVcsAdapter` — add one method using the same `getOctokit()` helper
- `createBrainGraph` pattern — git-manager graph is identical shape
- `pr-manager/tools.ts` pattern — git-manager tools.ts is same structure

**Rejected**:
- `getCandidateLease()` tool — not needed in V0; lease state is visible as a `candidate-flight` commit status entry in `getCiStatus` output. Lease reads add another GitHub contents API call for no new information the agent needs right now.
- `getCandidateFlightStatus()` tool — fully redundant with `getCiStatus`; that tool already returns all commit statuses including `candidate-flight`.
- Separate `CandidateFlightCapability` interface — unnecessary complexity; one more method on `VcsCapability` is consistent with the existing pattern.

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
packages/ai-tools/
  Modify: src/capabilities/vcs.ts          — add CandidateFlightResult type + flightCandidate() to VcsCapability
  Create: src/tools/vcs-flight-candidate.ts — schema, contract, impl factory, stub, bound tool
  Modify: src/catalog.ts                   — register vcsFlightCandidateBoundTool
  Modify: src/index.ts                     — export all new symbols

nodes/operator/app/src/
  Modify: adapters/server/vcs/github-vcs.adapter.ts  — implement flightCandidate via Octokit workflow dispatch
  Modify: bootstrap/capabilities/vcs.ts               — add flightCandidate to stubVcsCapability
  Modify: bootstrap/ai/tool-bindings.ts               — wire VCS_FLIGHT_CANDIDATE_NAME

nodes/node-template/app/src/
  Modify: bootstrap/capabilities/vcs.ts               — add flightCandidate stub (interface compliance)

nodes/resy/app/src/
  Modify: bootstrap/capabilities/vcs.ts               — add flightCandidate stub (interface compliance)

packages/langgraph-graphs/src/
  Create: graphs/git-manager/tools.ts      — GIT_MANAGER_TOOL_IDS (VCS flight + list + CI status + create branch + work item)
  Create: graphs/git-manager/prompts.ts    — GIT_MANAGER_GRAPH_NAME + GIT_MANAGER_SYSTEM_PROMPT with candidate-flight section
  Create: graphs/git-manager/graph.ts      — createGitManagerGraph (identical shape to brain/graph.ts)
  Modify: graphs/index.ts                  — export GIT_MANAGER_GRAPH_NAME + createGitManagerGraph
```

### Key implementation notes

**`flightCandidate` in GitHubVcsAdapter**:
```typescript
// POST /repos/{owner}/{repo}/actions/workflows/candidate-flight.yml/dispatches
// ref: "main" (workflow runs from default branch)
// inputs: { pr_number: String(prNumber), head_sha: headSha ?? "" }
// Returns HTTP 204. Build return value from inputs:
// { dispatched: true, workflowUrl: "https://github.com/{owner}/{repo}/actions/workflows/candidate-flight.yml", message: "Flight dispatched for PR #N" }
```

**git-manager tool set** (minimal for V0):
```
VCS_FLIGHT_CANDIDATE_NAME   — dispatch flight
VCS_LIST_PRS_NAME           — survey open PRs
VCS_GET_CI_STATUS_NAME      — check CI + candidate-flight status
VCS_CREATE_BRANCH_NAME      — integration branch management
WORK_ITEM_QUERY_NAME        — link PR to task
REPO_OPEN_NAME              — read playbooks
```

**git-manager prompt**: Focused section:
> Before flighting: verify PR is green on core__vcs_get_ci_status. If `candidate-flight` check is already `pending`, the slot is busy — report and stop. To flight: call `core__vcs_flight_candidate`. After dispatch: call `core__vcs_get_ci_status` again to observe the `candidate-flight` status as it resolves. Do NOT queue, auto-retry, or flight more than one PR per run.

## Validation

- `flightCandidate(846)` dispatches the workflow via Octokit and returns `{ dispatched: true, workflowUrl, message }`
- Slot busy → `getCiStatus` shows `candidate-flight` as `pending`; agent reports and stops, does not dispatch
- `getCiStatus(846)` returns `candidate-flight` check in `checks[]` after workflow posts status
- TypeScript compiles across all three nodes (no interface mismatch on stub)
