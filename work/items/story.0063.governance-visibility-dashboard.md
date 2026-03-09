---
id: story.0063
type: story
title: Governance visibility dashboard — real-time AI council activity
status: needs_triage
priority: 1
estimate: 3
summary: Users can see when the next governance run happens, what the AI council is doing right now, and recent governance decisions across all charters
outcome: System tenant has a dedicated governance dashboard showing countdown timer, live activity stream, and recent heartbeats/EDOs
spec_refs: openclaw-govern-distributed, docs-work-system-spec
assignees: []
credit:
project: proj.system-tenant-governance
branch:
pr:
reviewer:
created: 2026-02-15
updated: 2026-02-16
labels: [governance, ui, observability]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 23
---

# Governance visibility dashboard — real-time AI council activity

## Problem

Users have no visibility into when governance runs happen or what decisions the AI council is making. The governance system operates as a black box.

**Critical incident (2026-02-15):** All 4 governance schedules failed silently for hours due to 0 credit balance in the governance billing account. The system appeared healthy (schedules triggering on time) but every run was rejected before execution with `insufficient_credits` error. No monitoring detected the outage.

People need to see:

- When the next governance run will trigger (countdown timer)
- What the governance AI is doing right now (live activity)
- What decisions were made recently (past few hours)
- Status of each charter's latest heartbeat
- **Credit balance and health status (prevent silent failures)**
- **Failed runs with error details (detect outages immediately)**
- Budget gate status (allow_runs, burn_rate, token limits)

This addresses the observability ideal from MEMORY.md: "Cogni AI should be able to monitor its own stats (self-aware system health)".

## User Benefit

**System operators** can monitor governance health and respond to blocked runs or budget issues.

**Contributors** can see governance decisions being made in real-time, building trust and understanding.

**Future DAO members** get transparency into how the AI council operates.

## Success Criteria

1. **Home page countdown**: Shows "Next governance run in: XX:XX" based on scheduler config
2. **Governance dashboard** (e.g., `/governance` or system tenant page):
   - **Credit health indicator** (balance + runway with color-coded status)
   - **Failed run list** with error details
   - Live activity stream from gateway (scrolling log of current run)
   - Latest heartbeat from each charter (COMMUNITY, ENGINEERING, SUSTAINABILITY, GOVERN)
   - Budget gate status from `memory/_budget_header.md`
   - Recent EDOs from `memory/edo_index.md` (past 24-48h)
3. **Real-time updates**: Dashboard refreshes as governance runs execute (WebSocket or polling)

## Requirements

### Must Have

**Credit Health (Prevent 2026-02-15 Incident):**

- **Current credit balance** for governance billing account with health indicator:
  - 🟢 Green: > 24 hours runway remaining
  - 🟡 Yellow: 6-24 hours remaining
  - 🔴 Red: < 6 hours or 0 balance
- **Runway estimate**: "XX hours of governance remaining" (balance ÷ burn rate)
- **Failed run visibility**: Show failed runs with timestamp, charter, error code
- **Last successful run** timestamp per charter

**Core Dashboard:**

- Display countdown timer to next scheduled governance run
- Show latest heartbeat for each charter (run_at, focus, decision, no_op_reason)
- Show budget gate status (allow_runs, max_tokens_per_charter_run, budget_status, burn_rate_trend)
- Display recent EDOs (index + details)
- Live activity stream when a governance run is in progress

### Nice to Have

- Historical view (last N runs across all charters)
- Drill-down into individual EDO details
- Alerts/notifications when governance runs are blocked
- Chart showing governance cost over time

### Out of Scope (for MVP)

- Editing governance config through UI
- Manual triggering of governance runs
- Chat interface with governance agents

## Open Questions

1. **Where to host the dashboard?**
   - Dedicated `/governance` route for all tenants?
   - System tenant-only page?
   - Component on home page for system tenant only?

2. **How to stream live activity from gateway?**
   - Gateway already streams chat messages via WebSocket
   - Need to expose governance run output similarly?
   - Or poll for heartbeat changes + gate updates?

3. **How to get scheduler timing?**
   - Scheduler service knows next run time
   - Need API endpoint to expose schedule config?
   - Or read from scheduler database/config?

4. **Access control?**
   - Should all users see governance activity?
   - Or restrict to system tenant members only?

5. **How to get credit balance efficiently?**
   - Query billing account on page load?
   - Cache with TTL?
   - Real-time subscription?

6. **Revenue share visibility?**
   - Show last distribution timestamp?
   - Expected vs actual distribution rate?

## Allowed Changes

- New UI routes/pages (e.g., `src/app/governance/`)
- New API endpoints for governance state (heartbeats, gate, EDOs, scheduler timing)
- Gateway modifications to stream governance activity
- Schema additions if storing governance run history
- Integration with Fumadocs docs site (if governance docs rendered there)

## Plan

High-level only — detailed planning happens in `/task`.

- [ ] Define API contract for governance state endpoints
- [ ] Create gateway streaming endpoint for governance runs
- [ ] Build scheduler timing API (or expose config)
- [ ] Design governance dashboard UI mockup
- [ ] Implement dashboard components (countdown, heartbeats, gate, EDOs, activity)
- [ ] Wire real-time updates (WebSocket or polling)
- [ ] Add access control (if restricted to system tenant)
- [ ] Test with real governance runs

## Validation

**Manual:**

1. Start dev stack with governance enabled
2. Navigate to governance dashboard
3. Verify countdown shows time to next run
4. Wait for governance run to trigger
5. Verify live activity appears during run
6. Verify heartbeats update after run completes
7. Verify EDOs appear in recent decisions list
8. **Verify credit balance displays** with correct color coding
9. **Verify runway calculation** is accurate (balance ÷ burn rate)
10. **Simulate low credits** — verify yellow/red warnings trigger
11. **Verify failed runs appear** in dashboard with error details

**Automated:**

- E2E test: Load dashboard, verify countdown visible
- E2E test: Trigger governance run, verify activity stream updates
- Contract test: Governance API returns expected shape

## Review Checklist

- [ ] **Work Item:** `story.0063` linked in PR body
- [ ] **Spec:** [openclaw-govern-distributed](../../docs/spec/governance-council.md) runtime state model upheld
- [ ] **Tests:** E2E tests cover dashboard loading + live updates
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Referenced specs: [governance-council.md](../../docs/spec/governance-council.md)
- Related work: [task.0043 Fumadocs docs site](./task.0043.fumadocs-docs-site.md)
- Research: [governance-visibility-dashboard.md](../../docs/research/governance-visibility-dashboard.md)
- Implementation: [task.0070 Governance credit health dashboard](./task.0070.governance-credit-health-dashboard.md)

## Attribution

- Idea: derekg1729
- Research: Claude (Sonnet 4.5)
