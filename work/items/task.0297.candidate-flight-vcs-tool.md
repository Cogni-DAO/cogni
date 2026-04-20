---
id: task.0297
type: task
title: "Add candidate-flight tool to VCS capability"
status: needs_merge
priority: 1
rank: 2
estimate: 2
created: 2026-04-09
updated: 2026-04-20
summary: "Expose candidate-flight dispatch as a typed VCS tool so PR Manager (and any bearer-auth agent) can flight PRs without a GitHub-scoped PAT in hand. Thin wrapper over workflow_dispatch — slot lease + CI prerequisites remain workflow-owned."
outcome: "`core__vcs_flight_candidate(owner, repo, prNumber, headSha?)` dispatches `candidate-flight.yml` via the node's GitHub App installation. Agents observe the resulting `candidate-flight` check via `core__vcs_get_ci_status`. No run-id correlation (API returns 204 with no body — attempting correlation is racey)."
spec_refs:
  - docs/guides/candidate-flight-v0.md
  - docs/spec/candidate-slot-controller.md
  - docs/spec/ci-cd.md
assignees: [derekg1729]
credit:
project: proj.cicd-services-gitops
initiative: ini.cicd-trunk-based
branch: feat/task-0297-flight-candidate-tool
revision: 2
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

- `task.0242` / `packages/vcs-tool-plane` — existing `VcsCapability` (listPrs, getCiStatus, mergePr)
- `task.0278` — git manager skill permissions model
- Git manager agent graph — location TBD from task.0242 branch

### What this task adds

- `flightCandidate(pr_number, head_sha?)` — dispatches the workflow via Octokit or `gh` CLI wrapper
- `getCandidateLease()` — reads `deploy/candidate-a:infra/control/candidate-lease.json` via GitHub contents API
- `getCandidateFlightStatus(pr_number)` — reads the `candidate-flight` commit status on the PR head SHA

### Hard boundaries (from spec — do not violate)

- No auto-flight of every green PR — human or agent must explicitly choose
- No queuing — if slot busy, report and stop
- No rebuild — flight only PRs with existing `pr-{N}-{sha}` GHCR images from PR Build
- Slot truth lives in the lease file only — no second state plane

## Validation

- `flightCandidate(846)` dispatches the workflow and returns the run URL
- `getCandidateLease()` reads slot state from `deploy/candidate-a` correctly
- `getCandidateFlightStatus(846)` returns pass/fail from the PR commit status
- Slot busy → agent reports and stops, does not queue
