---
id: task.0363
type: task
title: "Operator dashboard: Active Pull Requests + CI/flight/deploy_verified loop"
status: needs_closeout
priority: 1
rank: 1
estimate: 2
summary: "Mount an Active Pull Requests card on /dashboard — the operator's PR → CI → flight → deploy_verified loop, which is the real core of the operator home view. Types import `PrSummary` + `CiStatusResult` from `@cogni/ai-tools` (the contracts established by PR #1021); CI-vs-flight grouping lives in a client-side presenter, not the wire shape. Phase 1: frontend + typed mock fetcher. Phase 2: operator route composing `VcsCapability.listPrs` + `getCiStatus` + flight state."
outcome: "On /dashboard, above the existing Runs/Work grid, an Active Pull Requests card lists open PRs with an overall status dot (passing/running/failed/pending), labels, and an expand chevron. Expanded row shows a CI Pipeline check group and, when flighted, a Flight (candidate-a) group derived from the flat `CiStatusResult.checks[]` by naming convention. Flighted rows surface `deploy_verified`. All colors use semantic tokens (success/destructive/info/muted) — no per-label hue."
spec_refs:
  - ci-cd
assignees: []
project:
pr:
created: 2026-04-24
updated: 2026-04-24
labels: [frontend, operator, dashboard]
external_refs:
  - PR #1021 feat(vcs) add vcs/flight endpoint — CI-gated candidate-a flight
  - PR #849 feat(streams) recover vcs webhook stream publish
  - PR #850 feat(dashboard) recover grouped ci dashboard
  - PR #811 merged — feat(dashboard) live VCS activity feed from node stream
---

# task.0363 — Operator dashboard PR loop

Built on top of PR #1021 (vcs/flight endpoint). Two phases; Phase 1 ships in this PR, Phase 2 is the backend wire-up.

## Phase 1 — Frontend + mock (this PR)

**Scope**

- Panel mounted on `/dashboard` (no new route, no new nav entry). The operator home IS the GitOps view.
- Types **import** `PrSummary` + `CiStatusResult` + `CheckInfo` from `@cogni/ai-tools` — no redeclaration. Operator-side extension is a thin `PrPanelEntry = { pr, ci, flight?, htmlUrl }`.
- CI-vs-flight grouping is a client-side presenter (`group-checks.ts`) over the flat `CiStatusResult.checks[]`. The wire shape stays flat.
- `overallStatus()` folds CI + flight + `deploy_verified` into the row's outer status dot, so merged-and-flighted-but-not-yet-verified is visibly distinct from verified ("receiving credit").
- Mock fetcher returns data shaped after the real contracts so Phase 2 is a pure server-side swap.

**Files**

```
nodes/operator/app/src/app/(app)/dashboard/
  _api/fetchActivePrs.ts                 — mock; returns PrPanelListResponse
  _components/pr-panel/
    pr-panel.types.ts                    — PrPanelEntry/FlightInfo (extends @cogni/ai-tools)
    group-checks.ts                      — groupChecks() + overallStatus() presenter
    StatusDot.tsx
    CheckPill.tsx
    CheckGroupCard.tsx
    PrPanelRow.tsx                       — expandable row
    ActivePullRequestsPanel.tsx          — card with summary counts
  view.tsx                               — mounts the panel above the Runs/Work grid
```

**Visual standards**

- Semantic tokens only: `success` / `destructive` / `info` / `muted-foreground`. Labels render as `Badge intent="outline"`.
- Check-name → group classification: prefixes `candidate-flight`, `flight-`, `verify-buildsha`, `argo`, `deploy-` → Flight group; everything else → CI group.

## Phase 2 — Real data (followup, NOT in this PR)

1. Operator route `GET /api/v1/vcs/active-prs` that composes:
   - `VcsCapability.listPrs({ state: "open" })`
   - For each PR: `VcsCapability.getCiStatus({ prNumber })`
   - Flight state: last `DispatchCandidateFlightResult` per PR + `/version.buildSha` match signal for `deploy_verified`
2. Zod contract for the response shape in `packages/node-contracts` (`vcs.active-prs.v1.contract`)
3. Live updates: subscribe to the node-stream `vcs.*` events already recovered by PR #849/#811
4. Replace `fetchActivePrs()` body; signature unchanged.

## Validation

- exercise: visit `/dashboard` on candidate-a; the Active Pull Requests panel renders above the Runs/Work grid. Expand a row; CI Pipeline and (when present) Flight (candidate-a) group cards render with correct semantic dot colors. A row with `deploy_verified: true` shows the success checkmark + "Deploy Verified" badge.
- observability: Loki query `{app="operator"} |= "dashboard-active-prs"` at the deployed SHA (React Query cache key appears in request telemetry).
