---
id: story.0128
type: story
title: "Governance ops: manual workflow triggers, run history, and admin role gating"
status: needs_design
priority: 2
rank: 3
estimate: 3
summary: "Extend existing governance pages with manual workflow triggers (collection, epoch close), run history on the schedules page, and admin-only access gating for operational controls."
outcome: "Admins can manually trigger a collection pass or force-close an epoch from the existing governance UI. The schedules page shows actual run history (not 'No runs yet'). Non-admin users can view epoch lifecycle and projections but cannot access operational triggers."
spec_refs:
assignees:
  - derekg1729
credit:
project: proj.system-tenant-governance
branch:
pr:
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-03-02
updated: 2026-03-02
labels: [governance, admin, dashboard, attribution, temporal]
external_refs:
---

# Governance Ops: Manual Triggers, Run History, Admin Gating

## Context

The governance UI already covers the core epoch lifecycle:

- **`/gov`** — system dashboard with credit balance, upcoming runs countdown, usage charts, recent runs
- **`/gov/epoch`** — epoch list with status badges (Active/Review/Finalized), pie charts, contributor tables, countdown timer
- **`/gov/review`** — admin review with per-receipt weight overrides, EIP-712 sign & finalize flow (approver-gated)
- **`/gov/holdings`** — cumulative ownership distribution
- **`/schedules`** — schedule CRUD (create/enable/disable/delete) with cron presets
- **`/activity`** — per-user activity charts

What's missing is **operational control** — the ability to intervene when something goes wrong or needs manual advancement.

## Problem Statement

- No way to manually trigger a collection pass (e.g., after fixing a GitHub token issue or to test a new epoch)
- No way to manually advance an epoch to review status (auto-close has a 24h grace period — sometimes you want to close early)
- The `/schedules` page "Latest Trace" column always shows "No runs yet" — no actual workflow execution history
- No admin role definition — the review page checks SIWE wallet against approver list, but there's no general "governance admin" permission for operational controls

## Requirements

### Must Have (Crawl)

1. **Manual collection trigger** — admin-only button on `/gov/epoch` to start an ad-hoc `CollectEpochWorkflow` run for the current open epoch. Similar pattern to the existing finalize HTTP trigger.
2. **Schedule run history** — wire the "Latest Trace" column on `/schedules` to actual Temporal workflow execution data (last run time, success/failure status). Use `ScheduleClient.describe()` for recent actions.
3. **Admin role gate** — define a `governance_admin` permission (or extend existing approver wallet check) to gate manual triggers. Non-admins see epoch data but not operational controls.

### Should Have (Walk)

4. **Manual epoch close** — admin button to force-transition an open epoch to review, bypassing the auto-close grace period
5. **Collection result feedback** — after triggering a manual collection, show whether it collected new data vs. skipped (ENRICHER_SKIP_UNCHANGED). Could be a toast or inline status update.
6. **Run history detail** — expandable row on schedules page showing recent execution summaries (started, completed, failed, skipped) with timestamps

### Nice to Have (Run)

7. **Alerting integration** — surface failed workflow runs as in-app notifications
8. **Self-service grace period** — let admins extend or shorten the auto-close grace period for a specific epoch

## Open Questions

- **Admin role definition**: The review page already gates on approver wallet. Should manual triggers use the same approver set, or do we need a separate `governance_admin` role? The RBAC spec covers tenant-level roles but not governance operations.
- **API pattern**: Should manual triggers go through HTTP routes (like `/api/v1/attribution/epochs/[id]/finalize`) or Temporal signals?
- **Multi-tenant scope**: When operator manages external nodes (task.0122), does each node's admin see only their schedules?

## Technical Notes

- Finalization already has an HTTP trigger → Temporal workflow pattern (`/api/v1/attribution/epochs/[id]/finalize`). Manual collection would follow the same approach.
- Schedule metadata lives in Temporal — `ScheduleClient.describe()` returns `recentActions` with workflow run IDs and timestamps for the "Latest Trace" column.
- `CollectEpochWorkflow` now skips unchanged enrichers/allocations (ENRICHER_SKIP_UNCHANGED) — the result feedback should surface this distinction.

## Validation

- [ ] Manual collection trigger starts a `CollectEpochWorkflow` and shows result feedback
- [ ] Schedules page "Latest Trace" column shows actual last run time and status
- [ ] Non-admin users cannot see or access manual trigger controls
- [ ] Admin gating is consistent with existing review page approver check
