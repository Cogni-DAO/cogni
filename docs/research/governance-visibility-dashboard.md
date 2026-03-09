---
id: governance-visibility-dashboard
type: research
title: "Research: Governance Visibility Dashboard"
status: active
trust: reviewed
summary: Technical research for governance observability dashboard - credit health monitoring, failed run visibility, and real-time updates
read_when: Implementing governance monitoring features or dashboard UI
spike: story.0063
owner: derekg1729
created: 2026-02-16
verified: 2026-02-16
tags: [governance, research, observability, dashboard]
---

# Research: Governance Visibility Dashboard

> spike: story.0063 | date: 2026-02-16

## Question

How do we build a governance visibility dashboard that shows credit health, real-time activity, failed runs, and upcoming schedules to prevent silent governance outages like the 2026-02-15 incident?

## Context

**2026-02-15 Incident:** All 4 governance schedules failed silently for hours due to 0 credit balance in the governance billing account (`cogni_system`). The system appeared healthy (schedules triggering on time via Temporal) but every run was rejected before execution with `insufficient_credits` error. No monitoring detected the outage.

**Current State:**

- Governance schedules exist in Temporal and DB (`schedules` table)
- Execution history tracked in `schedule_runs` table (status, error messages, timestamps)
- Credit balance queryable via existing `/api/v1/payments/credits/summary` endpoint
- No UI visibility into governance health or activity

**Requirements:**

- Credit health indicator (🟢/🟡/🔴 based on runway)
- Failed run visibility with error details
- Next run countdown timer
- Real-time activity stream (optional for MVP)
- Latest heartbeats from governance charters (from gateway workspace `memory/` files)

## Findings

### Option A: Server-Component Dashboard with Polling

**What**: Traditional Next.js server component page that fetches governance data on page load, with client-side React Query polling for updates.

**Pros:**

- Simple implementation - reuses existing patterns (activity/credits pages)
- No new infrastructure (no WebSocket server, no SSE)
- React Query handles caching and background refetch
- Auth is straightforward (`getServerSessionUser()`)

**Cons:**

- Polling adds latency (5-10s typical polling interval)
- Not truly "real-time" for live governance runs
- Multiple API calls (credits, schedules, runs, gateway data)

**OSS tools:**

- `@tanstack/react-query` (already used in codebase)
- Next.js App Router server components

**Fit with our system:**

- Perfect match - this is how activity/credits pages work today
- `/api/v1/payments/credits/summary` already exists
- Can query `schedules` and `schedule_runs` tables directly

**Implementation:**

1. New route: `src/app/(app)/governance/page.tsx` (server component)
2. New API endpoints:
   - `GET /api/v1/governance/summary` (credits + next run + failed runs)
   - `GET /api/v1/governance/runs?limit=10` (recent schedule_runs)
3. Client component with React Query polling (5s interval)

### Option B: Server-Sent Events (SSE) for Real-Time Updates

**What**: SSE endpoint streams governance events (run start/end, credit changes) to dashboard.

**Pros:**

- True real-time updates without polling overhead
- One-way server→client (simpler than WebSocket)
- Built-in browser reconnection

**Cons:**

- Requires event pub/sub infrastructure (not implemented)
- More complex server setup (long-lived connections)
- Overkill for governance monitoring (runs every 15-60 min, not milliseconds)

**OSS tools:**

- Native browser EventSource API
- Redis pub/sub or Postgres LISTEN/NOTIFY for events

**Fit with our system:**

- Would require new event infrastructure
- Current system doesn't emit real-time events
- Governance runs are infrequent (not high-frequency trading)

**Verdict:** Overkill for governance use case. Defer to future.

### Option C: WebSocket for Live Activity Stream

**What**: WebSocket connection streams gateway agent output in real-time during governance runs.

**Pros:**

- Could show live agent reasoning/decisions
- Bi-directional (could allow manual triggers)

**Cons:**

- Requires persistent WebSocket server (Next.js API routes don't support WS well)
- Gateway currently doesn't stream to web clients (only saves to files)
- Complex infrastructure for limited value

**OSS tools:**

- Socket.io or native WebSocket API
- Separate WebSocket server (not Next.js)

**Fit with our system:**

- Chat page uses streaming but via HTTP chunked transfer (not WebSocket)
- Gateway workspace is containerized - would need new API surface
- High complexity, low ROI for governance monitoring

**Verdict:** Defer. Governance runs are async - showing final results is sufficient for MVP.

## Data Sources Identified

### 1. Credit Balance & Runway

**Source:** `billing_accounts` table
**Query:** Filter by `id = COGNI_SYSTEM_BILLING_ACCOUNT_ID`
**Existing endpoint:** `GET /api/v1/payments/credits/summary` (requires auth)

**Runway calculation:**

```typescript
const balanceCredits = accountService.getBalance(
  COGNI_SYSTEM_BILLING_ACCOUNT_ID
);
const recentCharges = await db.query.chargeReceipts.findMany({
  where: eq(chargeReceipts.billingAccountId, COGNI_SYSTEM_BILLING_ACCOUNT_ID),
  orderBy: desc(chargeReceipts.createdAt),
  limit: 100, // Last ~24h of governance runs
});
const totalCreditsLast24h = sumCharges(recentCharges);
const dailyBurnRate = totalCreditsLast24h; // Approximate
const runwayHours = (balanceCredits / dailyBurnRate) * 24;

// Color coding:
// 🟢 Green: runwayHours > 24
// 🟡 Yellow: 6 <= runwayHours <= 24
// 🔴 Red: runwayHours < 6 || balanceCredits <= 0
```

**Note:** Burn rate calculation is approximate. For more accurate runway, could track credits per charter run and multiply by runs/day.

### 2. Failed Runs

**Source:** `schedule_runs` table
**Query:**

```sql
SELECT * FROM schedule_runs sr
JOIN schedules s ON sr.schedule_id = s.id
JOIN execution_grants eg ON s.execution_grant_id = eg.id
WHERE eg.billing_account_id = 'cogni_system'
  AND sr.status = 'error'
  AND sr.scheduled_for >= NOW() - INTERVAL '24 hours'
ORDER BY sr.scheduled_for DESC;
```

**Fields:**

- `runId` - correlation key
- `scheduledFor` - when it was supposed to run
- `status` - 'error'
- `errorMessage` - e.g., "insufficient_credits", "Grant validation failed"
- `graphId` - which charter failed

**New endpoint needed:** `GET /api/v1/governance/failed-runs?hours=24`

### 3. Next Run Timing

**Source:** `schedules` table, `nextRunAt` column
**Query:**

```sql
SELECT MIN(next_run_at) as next_governance_run
FROM schedules s
JOIN execution_grants eg ON s.execution_grant_id = eg.id
WHERE eg.billing_account_id = 'cogni_system'
  AND s.enabled = true
  AND s.next_run_at IS NOT NULL;
```

**Countdown calculation:**

```typescript
const nextRun = new Date(nextRunAt);
const now = new Date();
const msRemaining = nextRun.getTime() - now.getTime();
const minutesRemaining = Math.floor(msRemaining / 60000);
// Display: "Next run in: 12 minutes"
```

**New endpoint needed:** `GET /api/v1/governance/next-run`

### 4. Charter Heartbeats (Gateway Workspace Memory)

**Source:** Gateway container filesystem at `/workspace/memory/{CHARTER}/heartbeat.md`
**Charters:** COMMUNITY, ENGINEERING, SUSTAINABILITY, GOVERN

**Challenge:** Gateway workspace is containerized and ephemeral. Options:

**Option 4A:** New API endpoint reads from gateway container

- Requires Docker exec or volume mount to host
- Complex, slow, couples dashboard to gateway container

**Option 4B:** Gateway publishes heartbeats to DB on each run

- Schema: `governance_heartbeats` table
- Columns: charter, run_at, focus, decision, no_op_reason
- Written by gateway during governance run (before commit)

**Option 4C:** Defer heartbeat display to post-MVP

- MVP shows credit health + failed runs + next run (sufficient to prevent outages)
- Full governance decision visibility comes later

**Recommendation:** Option 4C for MVP. Heartbeats are nice-to-have; credit health prevents incidents.

### 5. Budget Gate Status

**Source:** Gateway container filesystem at `/workspace/memory/_budget_header.md`
**Fields:** allow_runs, max_tokens_per_charter_run, budget_status, burn_rate_trend

**Same challenges as heartbeats.** Options:

**Option 5A:** Read from container filesystem
**Option 5B:** Publish to DB during governance runs
**Option 5C:** Defer to post-MVP

**Recommendation:** Option 5C for MVP. Focus on preventing credit outages first.

## Recommendation

**Build Option A: Server-Component Dashboard with Polling**

**Why:**

- Simplest path to production (< 1 day implementation)
- Reuses existing patterns (React Query, server components, API routes)
- Solves the 2026-02-15 incident root cause (credit visibility)
- Extensible (can add SSE/WebSocket later without rewrite)

**MVP Scope:**

1. **Credit Health Widget** (🟢/🟡/🔴)
   - Current balance for `cogni_system`
   - Runway estimate ("XX hours remaining")
   - Last 24h burn rate
2. **Failed Runs Table**
   - Last 10 failed governance runs
   - Charter name, scheduled time, error message
3. **Next Run Countdown**
   - "Next governance run in: 12 minutes"
   - Shows all 4 charters and their next scheduled times
4. **Last Successful Run Per Charter**
   - Timestamp of last successful run
   - Helps detect "all charters failing" vs "one charter broken"

**Defer to Post-MVP:**

- Live activity stream (WebSocket/SSE)
- Charter heartbeat history
- Budget gate status display
- EDO (Event-Decision-Outcome) index
- Revenue share distribution tracking

**Implementation Time:** ~4-6 hours for MVP (1 PR)

## Open Questions

1. **Access control:** Should all users see governance dashboard, or restrict to system tenant members only?
   - **Proposal:** Start with authenticated users only (same as /activity). Add tenant check later if needed.

2. **Burn rate calculation:** Average last 24h or rolling window?
   - **Proposal:** Sum last 24h charges, divide by 24 to get hourly rate. Simple and good enough for alerts.

3. **Failed run retention:** Keep all failed runs or prune after 7 days?
   - **Proposal:** Display last 24h by default. DB retention is a separate decision (keep indefinitely for audit).

4. **Polling interval:** How often to refresh dashboard?
   - **Proposal:** 10 seconds (frequent enough to catch issues, infrequent enough to avoid load).

5. **Credit alert threshold:** When to show yellow vs red?
   - **Proposal:** Yellow = 6-24h runway, Red = <6h or zero balance (aligns with story requirements).

## Proposed Layout

### Project

Not needed - this fits cleanly within existing `proj.system-tenant-governance`.

### Specs

**New:** `docs/spec/governance-observability-api.md`

**Invariants:**

- `CREDIT_HEALTH_REQUIRES_SYSTEM_TENANT_SCOPE`: Queries restricted to `cogni_system` billing account
- `RUNWAY_BASED_ON_24H_BURN`: Runway = balance ÷ (last 24h credits ÷ 24)
- `COLOR_THRESHOLDS_FIXED`: 🟢 >24h, 🟡 6-24h, 🔴 <6h or ≤0 balance
- `FAILED_RUNS_INCLUDE_ERROR_CODE`: Every failed run shows error message from `schedule_runs.errorMessage`
- `NEXT_RUN_FROM_DB_CACHE`: Use `schedules.nextRunAt` (not recomputed from cron)

**Endpoints:**

- `GET /api/v1/governance/health` → credit balance + runway + color
- `GET /api/v1/governance/failed-runs?hours=24` → failed schedule_runs list
- `GET /api/v1/governance/next-run` → earliest nextRunAt across all governance schedules

### Tasks

**task.XXXX: Governance credit health API**

- Est: 2 hours
- Scope: Create `/api/v1/governance/health` endpoint
- Returns: balance, runway hours, burn rate, color (green/yellow/red)
- Queries: billing_accounts + charge_receipts for cogni_system
- Contract: `governance.health.v1.contract.ts`

**task.YYYY: Governance failed runs API**

- Est: 1 hour
- Scope: Create `/api/v1/governance/failed-runs` endpoint
- Returns: list of schedule_runs with status='error', joined with schedules for graphId
- Filters: cogni_system billing account, last 24h by default
- Contract: `governance.failed-runs.v1.contract.ts`

**task.ZZZZ: Governance dashboard UI**

- Est: 3 hours
- Scope: Create `/governance` page with credit health widget, failed runs table, next run countdown
- Uses: React Query with 10s polling interval
- Layout: Grid with 3 cards (health, failed, next run)
- Access: Authenticated users only (same as /activity)

**Sequence:** XXXX → YYYY → ZZZZ (API contracts first, then UI)

**Total: ~6 hours / 1 PR**
