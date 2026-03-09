---
id: governance-status-api
type: spec
title: Governance Status API
status: active
spec_state: active
trust: reviewed
summary: User-facing governance transparency API showing system tenant credit balance, scheduled runs, and recent execution history
read_when: Building governance dashboards, system health monitoring, or DAO transparency features
implements: proj.system-tenant-governance
owner: derekg1729
created: 2026-02-16
verified: 2026-02-17
tags: [governance, api, transparency]
---

# Governance Status API

> User-facing API for DAO governance transparency — shows credit balance, upcoming runs, and recent activity

### Key References

|             |                                                                                       |                                    |
| ----------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| **Project** | [proj.system-tenant-governance](../../work/projects/proj.system-tenant-governance.md) | Roadmap and planning               |
| **Spec**    | [activity-metrics](./activity-metrics.md)                                             | Related: user activity dashboard   |
| **Spec**    | [governance-council](./governance-council.md)                                         | Runtime state model for governance |

## Goal

Enable DAO members to see governance system status through the website: financial health (credit balance), operational status (scheduled runs), and recent activity (execution history).

## Non-Goals

- Real-time streaming updates (polling is sufficient for MVP)
- Historical analytics / trend analysis (defer to future)
- Governance control/management APIs (this is read-only status)
- Internal ops monitoring / alerting (this is user-facing transparency)

## Design

### Architecture

Governance status follows strict hexagonal architecture with proper port abstraction:

```
┌─────────────────────────────────────────────────────────────────┐
│ /gov page (user-facing)                                          │
└──────────┬──────────────────────────┬───────────────────────────┘
           │                          │
           ▼                          ▼
┌────────────────────────┐  ┌──────────────────────────────────┐
│ GET /api/v1/governance │  │ GET /api/v1/governance/activity   │
│ /status (route)        │  │ (reuses getActivity facade)      │
│ governance.status.v1   │  │ ai.activity.v1 contract          │
└──────────┬─────────────┘  └──────────────────────────────────┘
           │
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ getGovernanceStatus (feature service)                            │
│ ────────────────────────────────────────                         │
│ Orchestrates: AccountService + GovernanceStatusPort              │
└────────────────────┬────────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
┌─────────────────┐  ┌────────────────────────┐
│ AccountService  │  │ GovernanceStatusPort   │
│ (port)          │  │ (port)                 │
│                 │  │                        │
│ getBalance()    │  │ getUpcomingRuns()      │
│                 │  │ getRecentRuns()        │
└─────────────────┘  └────────┬───────────────┘
                              │
                              ▼
                     ┌────────────────────────┐
                     │ DrizzleGovernanceStatus│
                     │ (adapter)              │
                     │                        │
                     │ Query schedules table  │
                     │ Query ai_threads table │
                     └────────────────────────┘
```

**Layering:**

- **Route** (app layer): Validates contract, calls feature service, returns JSON
- **Feature service** (features layer): Orchestrates ports (AccountService + GovernanceStatusPort)
- **Ports** (ports layer): Interface contracts for data access
- **Adapters** (adapters/server): Drizzle implementations of ports

**Why create a port for single caller?**

1. **Architecture compliance**: Features must never import adapters directly
2. **Testability**: Feature service can be unit tested with mocked ports
3. **Boundaries**: Clear separation between orchestration and data access
4. **Future-proof**: Easy to swap implementations without touching features

## Invariants

| Rule                   | Constraint                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| SYSTEM_TENANT_SCOPE    | All queries filter by `COGNI_SYSTEM_PRINCIPAL_USER_ID` — never accepts userId parameter                              |
| RLS_VIA_TENANT_SCOPE   | Adapter wraps queries in `withTenantScope(db, systemActorId)` — no BYPASSRLS, standard RLS path                      |
| CONTRACT_FIRST         | API shape defined via Zod contract before implementation                                                             |
| BIGINT_SERIALIZATION   | Balance returned as string (BigInt cannot be JSON.stringify'd)                                                       |
| AUTH_REQUIRED          | Endpoint requires authenticated user (public read for DAO transparency)                                              |
| NO_PAGINATION_MVP      | Recent runs limited to 10 (hard cap) — pagination deferred                                                           |
| HEXAGONAL_ARCHITECTURE | Feature service calls ports only; never imports adapters or database clients directly                                |
| FEATURE_SERVICE_LAYER  | Route delegates to feature service; route never queries database directly                                            |
| PORT_ABSTRACTION       | GovernanceStatusPort provides clean interface; adapter handles Drizzle queries                                       |
| UPCOMING_RUNS_LIVE     | `getUpcomingRuns()` computes next occurrence from cron expression at query time — never returns stale DB-cached time |

### API Contract

```typescript
// src/contracts/governance.status.v1.contract.ts
export const governanceStatusOperation = {
  id: "governance.status.v1",
  input: z.object({}),
  output: z.object({
    systemCredits: z
      .string()
      .describe("System tenant balance (BigInt as string)"),
    upcomingRuns: z
      .array(
        z.object({
          name: z.string().describe("Schedule display name (e.g. 'Community')"),
          nextRunAt: z
            .string()
            .datetime()
            .describe(
              "Next occurrence computed live from cron (always future)"
            ),
        })
      )
      .describe("Next scheduled governance runs sorted by soonest first"),
    recentRuns: z.array(
      z.object({
        id: z.string().describe("Thread state key"),
        title: z.string().nullable().describe("Run title from metadata"),
        startedAt: z.string().datetime(),
        lastActivity: z.string().datetime(),
      })
    ),
  }),
};
```

### Data Sources

| Field         | Port Method                                          | Adapter Implementation                                                                                     |
| ------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| systemCredits | `AccountService.getBalance()`                        | Query `billing_accounts` table via `withTenantScope`                                                       |
| upcomingRuns  | `GovernanceStatusPort.getUpcomingRuns({ limit: 3 })` | Query `cron+timezone+temporal_schedule_id`; compute next occurrence live via `cron-parser`; sort ascending |
| recentRuns    | `GovernanceStatusPort.getRecentRuns()`               | `WHERE owner_user_id = SYSTEM_PRINCIPAL AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 10`          |

### Query Optimization

**Index usage:**

- `ai_threads_owner_updated_idx` on `(owner_user_id, updated_at)` — O(log n) lookup for recent runs
- `schedules` needs index on `(owner_user_id, enabled, next_run_at)` if not already present

**Performance:**

- All queries filter by constant system tenant ID
- LIMIT 10 on recent runs (bounded)
- Single next run query (LIMIT 1)

### Port Interface

```typescript
// src/ports/governance-status.port.ts

export interface GovernanceRun {
  id: string;
  title: string | null;
  startedAt: Date;
  lastActivity: Date;
}

export interface UpcomingRun {
  name: string; // display name derived from temporal_schedule_id
  nextRunAt: Date; // computed live from cron — always in the future
}

export interface GovernanceStatusPort {
  /** Get next N scheduled runs, computed live from cron. Always future times. */
  getUpcomingRuns(params: { limit: number }): Promise<UpcomingRun[]>;

  /** Get recent governance runs for system tenant, most recent first. */
  getRecentRuns(params: { limit: number }): Promise<GovernanceRun[]>;
}
```

### Future Extensions

When additional governance data is needed:

- Add methods to `GovernanceStatusPort` (e.g., `getRunDetails()`, `getRunMetrics()`)
- Adapter implementation grows but port interface stays focused
- Feature services remain decoupled from database schema

## File Pointers

| File                                                                  | Purpose                                     |
| --------------------------------------------------------------------- | ------------------------------------------- |
| `src/contracts/governance.status.v1.contract.ts`                      | Zod contract for status endpoint            |
| `src/ports/governance-status.port.ts`                                 | Port interface for governance queries       |
| `src/adapters/server/governance/drizzle-governance-status.adapter.ts` | Drizzle implementation of port              |
| `src/features/governance/services/get-governance-status.ts`           | Feature service (orchestrates ports)        |
| `src/app/api/v1/governance/status/route.ts`                           | Route handler (calls feature service)       |
| `src/app/api/v1/governance/activity/route.ts`                         | Activity metrics route (system-scoped)      |
| `src/app/(app)/gov/page.tsx`                                          | Server component (auth check)               |
| `src/app/(app)/gov/view.tsx`                                          | Client component with charts + status       |
| `src/app/(app)/gov/_api/fetchGovernanceActivity.ts`                   | Client fetch wrapper for activity endpoint  |
| `src/features/governance/hooks/useGovernanceStatus.ts`                | React Query hook (30s polling)              |
| `src/features/governance/AGENTS.md`                                   | Feature slice documentation                 |
| `src/shared/constants/system-tenant.ts`                               | System tenant constants (already exists)    |
| `packages/db-schema/src/ai-threads.ts`                                | ai_threads schema with RLS (already exists) |
| `packages/db-schema/src/scheduling.ts`                                | schedules schema (already exists)           |

## Open Questions

None (ready for implementation).

## Related

- [System Tenant Design](./system-tenant.md) — System tenant foundation
- [Activity Metrics](./activity-metrics.md) — User activity dashboard (similar pattern)
- [Governance Council](./governance-council.md) — Runtime state model
- [Thread Persistence](./thread-persistence.md) — ai_threads table schema
- [Scheduler](./scheduler.md) — schedules table schema
