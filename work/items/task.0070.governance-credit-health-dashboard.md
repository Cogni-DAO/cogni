---
id: task.0070
type: task
title: DAO governance status page — user-facing transparency
status: done
priority: 0
estimate: 1
summary: Single page showing system tenant credit balance, next governance run time, and recent run history for DAO transparency
outcome: Users can see DAO governance financial status (credits), upcoming runs (next scheduled), and recent activity (last 10 runs)
spec_refs: governance-status-api, governance-scheduling
assignees: []
credit:
project: proj.system-tenant-governance
branch: feat/governance-dashboard
pr:
reviewer:
created: 2026-02-16
updated: 2026-02-17
labels: [governance, ui, observability]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# DAO governance status page — user-facing transparency

## Context

**User Goal:** DAO members want to see governance system status through the website - basic financials (credit balance), deployment health (next run timing), and run history.

**NOT an ops monitoring tool** — this is user-facing transparency, not incident prevention. Absolute MVP.

**Research:** [governance-visibility-dashboard.md](../../docs/research/governance-visibility-dashboard.md)

## Outcome

Users visiting `/governance` see:

1. System tenant credit balance (how much runway the DAO has)
2. Next governance run time (when the AI council runs next)
3. Recent run history (last 10 governance executions)

## Design

### Approach

**Solution**: One page (`/governance`) + one API endpoint (`/api/v1/governance/status`) that queries existing tables.

**Reuses**:

- `AccountService` port (balance queries — already account-agnostic)
- `ai_threads` table (governance runs already persisted here with system tenant ownership)
- `schedules` table (has next_run_at for governance schedules)
- React Query polling pattern (from `/credits` page)
- shadcn/ui Card components

**Rejected**:

- ❌ **New GovernanceStatusPort** — defer until second caller needs it (YAGNI)
- ❌ **Runway calculations with burn rate** — over-engineered, defer to later
- ❌ **Health color coding (🟢/🟡/🔴)** — premature, just show the number
- ❌ **Failed runs filtering** — `ai_threads` has full history, show recent only
- ❌ **Separate endpoints per concern** — one status endpoint is simpler

**Design Decision (from spec review):**

Per [governance-status-api spec](../../docs/spec/governance-status-api.md), hexagonal architecture with proper ports:

- Create `GovernanceStatusPort` interface (even for single caller — architecture compliance)
- Feature service orchestrates `AccountService` + `GovernanceStatusPort` (both ports)
- Route delegates to feature service (app → features → ports → adapters)
- Adapter implements port with Drizzle queries (adapters layer owns database access)

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] SYSTEM_TENANT_SCOPE: All queries filter by `COGNI_SYSTEM_PRINCIPAL_USER_ID` (spec: governance-status-api)
- [ ] RLS_COMPATIBLE: Queries use owner_user_id filter compatible with RLS (spec: governance-status-api)
- [ ] CONTRACT_FIRST: Define Zod contract for status endpoint (spec: governance-status-api)
- [ ] BIGINT_SERIALIZATION: Balance returned as string for JSON compatibility (spec: governance-status-api)
- [ ] HEXAGONAL_ARCHITECTURE: Feature service calls ports only; never imports adapters or database clients (spec: governance-status-api)
- [ ] FEATURE_SERVICE_LAYER: Route delegates to feature service; route never queries database directly (spec: governance-status-api)
- [ ] PORT_ABSTRACTION: GovernanceStatusPort provides clean interface; adapter handles Drizzle queries (spec: governance-status-api)
- [ ] AUTH_REQUIRED: Authenticated users only (public read for DAO transparency) (spec: governance-status-api)

### Files

**Create:**

- `src/contracts/governance.status.v1.contract.ts` — Status endpoint contract (balance, nextRunAt, recentRuns[])
- `src/ports/governance-status.port.ts` — Port interface (getScheduleStatus, getRecentRuns)
- `src/adapters/server/governance/drizzle-governance-status.adapter.ts` — Drizzle implementation of port
- `src/features/governance/services/get-governance-status.ts` — Feature service (orchestrates AccountService + GovernanceStatusPort)
- `src/app/api/v1/governance/status/route.ts` — Route handler (calls feature service)
- `src/app/(app)/governance/page.tsx` — Server component (auth check)
- `src/app/(app)/governance/view.tsx` — Client component with React Query polling
- `src/features/governance/hooks/useGovernanceStatus.ts` — React Query hook (30s polling)
- `src/features/governance/AGENTS.md` — Governance feature slice documentation
- `src/adapters/server/governance/AGENTS.md` — Governance adapter documentation

**Modify:**

- `src/features/AGENTS.md` — Add governance to exports list
- `src/bootstrap/container.ts` — Wire up GovernanceStatusPort adapter

**Test:**

- Unit: `tests/unit/features/governance/get-governance-status.test.ts` — Test feature service with mocked ports
- Contract: `tests/contract/governance-status.contract.ts` — Verify port adapter compliance
- API: Verify `/api/v1/governance/status` matches contract schema
- Manual: Navigate to `/governance`, verify data displays

## Implementation Checkpoints

- [x] **Checkpoint 1: Port & Contract Layer**
  - Milestone: Port interface and API contract defined
  - Invariants: CONTRACT_FIRST, PORT_ABSTRACTION
  - Todos:
    - [x] Create `src/ports/governance-status.port.ts`
    - [x] Create `src/contracts/governance.status.v1.contract.ts`
    - [x] Export port from `src/ports/index.ts`
  - Validation:
    - [x] `pnpm typecheck` passes
    - [x] Port interface matches spec design
    - [x] Contract includes `id` field

- [x] **Checkpoint 2: Adapter Layer**
  - Milestone: Drizzle adapter implements GovernanceStatusPort
  - Invariants: SYSTEM_TENANT_SCOPE, RLS_COMPATIBLE, HEXAGONAL_ARCHITECTURE
  - Todos:
    - [x] Create `src/adapters/server/governance/drizzle-governance-status.adapter.ts`
    - [x] Create `src/adapters/server/governance/AGENTS.md`
    - [x] Export adapter from `src/adapters/server/index.ts`
  - Validation:
    - [x] `pnpm typecheck` passes
    - [x] Adapter queries filter by COGNI_SYSTEM_PRINCIPAL_USER_ID
    - [x] `pnpm check` passes (commit efbad073)

- [x] **Checkpoint 3: Feature Service Layer**
  - Milestone: Feature service orchestrates ports
  - Invariants: HEXAGONAL_ARCHITECTURE, FEATURE_SERVICE_LAYER, BIGINT_SERIALIZATION
  - Todos:
    - [x] Create `src/features/governance/services/get-governance-status.ts`
    - [x] Update `src/features/governance/AGENTS.md` (AGENTS.md already existed)
  - Validation:
    - [x] `pnpm typecheck` passes
    - [x] Service only imports ports (no adapters)
    - [x] Balance converted to string via `.toString()`
    - [x] `pnpm check` passes (commit 2339c97b)

- [x] **Checkpoint 4: Container Wiring**
  - Milestone: GovernanceStatusPort adapter wired in DI container
  - Invariants: PORT_ABSTRACTION
  - Todos:
    - [x] Update `src/bootstrap/container.ts`
  - Validation:
    - [x] `pnpm typecheck` passes
    - [x] Container exposes `governanceStatus` property
    - [x] `pnpm check` passes (commit 73e4c80c)

- [x] **Checkpoint 5: API Route Layer**
  - Milestone: Route handler calls feature service
  - Invariants: AUTH_REQUIRED, FEATURE_SERVICE_LAYER
  - Todos:
    - [x] Create `src/app/api/v1/governance/status/route.ts`
  - Validation:
    - [x] `pnpm typecheck` passes
    - [x] Route uses wrapRouteHandlerWithLogging
    - [x] Route requires authentication
    - [x] Route validates output with contract schema
    - [x] `pnpm check` passes (commit 57794681)

- [x] **Checkpoint 6: UI Layer**
  - Milestone: /governance page displays status
  - Invariants: AUTH_REQUIRED
  - Todos:
    - [x] Create `src/features/governance/hooks/useGovernanceStatus.ts`
    - [x] Create `src/app/(app)/governance/page.tsx`
    - [x] Create `src/app/(app)/governance/view.tsx`
  - Validation:
    - [x] `pnpm check` passes
    - [x] Page requires authentication (via (app) layout guard)
    - [x] React Query polling interval = 30s
    - [ ] Manual: Navigate to `/governance`, verify data displays
    - [x] Commit 2adea212

- [x] **Final Checkpoint**
  - [x] All unit tests pass (5/5 in get-governance-status.test.ts)
  - [x] `pnpm check` passes
  - [x] Update task status to "In Progress"
  - [x] Update `updated:` date
  - [x] Update `branch:` field

## Original Plan (for reference)

### 1. Define Contract (5 min)

```typescript
// src/contracts/governance.status.v1.contract.ts
import { z } from "zod";

export const governanceStatusOperation = {
  id: "governance.status.v1",
  input: z.object({}),
  output: z.object({
    systemCredits: z.string().describe("Balance as string (BigInt serialized)"),
    nextRunAt: z
      .string()
      .datetime()
      .nullable()
      .describe("Next scheduled governance run (ISO 8601)"),
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

### 2. Define Port Interface (5 min)

```typescript
// src/ports/governance-status.port.ts

export interface GovernanceRun {
  id: string;
  title: string | null;
  startedAt: Date;
  lastActivity: Date;
}

export interface GovernanceStatusPort {
  /**
   * Get next scheduled governance run time for system tenant.
   * Returns null if no runs are scheduled.
   */
  getScheduleStatus(): Promise<Date | null>;

  /**
   * Get recent governance runs for system tenant.
   * Returns up to `limit` runs ordered by most recent first.
   */
  getRecentRuns(params: { limit: number }): Promise<GovernanceRun[]>;
}
```

### 3. Implement Adapter (20 min)

```typescript
// src/adapters/server/governance/drizzle-governance-status.adapter.ts
import { and, desc, eq, isNotNull, isNull, asc } from "drizzle-orm";
import type {
  GovernanceStatusPort,
  GovernanceRun,
} from "@/ports/governance-status.port";
import { COGNI_SYSTEM_PRINCIPAL_USER_ID } from "@/shared/constants/system-tenant";
import { getDb } from "@/adapters/server/db/client";

export class DrizzleGovernanceStatusAdapter implements GovernanceStatusPort {
  constructor(private readonly db: ReturnType<typeof getDb>) {}

  async getScheduleStatus(): Promise<Date | null> {
    const { schedules } = await import("@/shared/db/schema");

    const results = await this.db.query.schedules.findMany({
      where: and(
        eq(schedules.ownerUserId, COGNI_SYSTEM_PRINCIPAL_USER_ID),
        eq(schedules.enabled, true),
        isNotNull(schedules.nextRunAt)
      ),
      orderBy: asc(schedules.nextRunAt),
      limit: 1,
    });

    return results[0]?.nextRunAt ?? null;
  }

  async getRecentRuns(params: { limit: number }): Promise<GovernanceRun[]> {
    const { aiThreads } = await import("@/shared/db/schema");

    const threads = await this.db.query.aiThreads.findMany({
      where: and(
        eq(aiThreads.ownerUserId, COGNI_SYSTEM_PRINCIPAL_USER_ID),
        isNull(aiThreads.deletedAt)
      ),
      orderBy: desc(aiThreads.updatedAt),
      limit: params.limit,
    });

    return threads.map((t) => ({
      id: t.stateKey,
      title: (t.metadata as { title?: string })?.title ?? null,
      startedAt: t.createdAt,
      lastActivity: t.updatedAt,
    }));
  }
}
```

### 4. Create Feature Service (15 min)

```typescript
// src/features/governance/services/get-governance-status.ts
import type { AccountService } from "@/ports/accounts.port";
import type { GovernanceStatusPort } from "@/ports/governance-status.port";
import { COGNI_SYSTEM_BILLING_ACCOUNT_ID } from "@/shared/constants/system-tenant";

export interface GovernanceStatus {
  systemCredits: string;
  nextRunAt: string | null;
  recentRuns: Array<{
    id: string;
    title: string | null;
    startedAt: string;
    lastActivity: string;
  }>;
}

export async function getGovernanceStatus(params: {
  accountService: AccountService;
  governanceStatusPort: GovernanceStatusPort;
}): Promise<GovernanceStatus> {
  const { accountService, governanceStatusPort } = params;

  // Get system balance via AccountService port
  const balance = await accountService.getBalance(
    COGNI_SYSTEM_BILLING_ACCOUNT_ID
  );

  // Get schedule status via GovernanceStatusPort
  const nextRunAt = await governanceStatusPort.getScheduleStatus();

  // Get recent runs via GovernanceStatusPort
  const recentRuns = await governanceStatusPort.getRecentRuns({ limit: 10 });

  return {
    systemCredits: balance.toString(),
    nextRunAt: nextRunAt?.toISOString() ?? null,
    recentRuns: recentRuns.map((run) => ({
      id: run.id,
      title: run.title,
      startedAt: run.startedAt.toISOString(),
      lastActivity: run.lastActivity.toISOString(),
    })),
  };
}
```

### 5. Implement API Route (10 min)

```typescript
// src/app/api/v1/governance/status/route.ts
import { NextResponse } from "next/server";
import { toUserId } from "@cogni/ids";
import { getContainer } from "@/bootstrap/container";
import { getGovernanceStatus } from "@/features/governance/services/get-governance-status";
import { governanceStatusOperation } from "@/contracts/governance.status.v1.contract";
import { COGNI_SYSTEM_PRINCIPAL_USER_ID } from "@/shared/constants/system-tenant";
import { wrapRouteHandlerWithLogging } from "@/shared/observability/server";
import { getServerSessionUser } from "@/lib/auth/server";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "governance.status.v1",
    auth: { mode: "required", getSessionUser: getServerSessionUser },
  },
  async (ctx, _request, sessionUser) => {
    const container = getContainer();

    const accountService = container.accountsForUser(
      toUserId(COGNI_SYSTEM_PRINCIPAL_USER_ID)
    );
    const governanceStatusPort = container.governanceStatus;

    const status = await getGovernanceStatus({
      accountService,
      governanceStatusPort,
    });

    return NextResponse.json(governanceStatusOperation.output.parse(status));
  }
);
```

### 6. Wire Up Container (5 min)

```typescript
// src/bootstrap/container.ts (add to existing container)
import { DrizzleGovernanceStatusAdapter } from "@/adapters/server/governance/drizzle-governance-status.adapter";

// In container object:
export function getContainer() {
  // ... existing code ...

  return {
    // ... existing exports ...
    governanceStatus: new DrizzleGovernanceStatusAdapter(db),
  };
}
```

### 7. Create UI Components (20 min)

```typescript
// src/app/(app)/governance/page.tsx
export default async function GovernancePage() {
  const user = await getServerSessionUser();
  if (!user) redirect("/");

  return <GovernanceView />;
}
```

```typescript
// src/app/(app)/governance/view.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components";
import { useGovernanceStatus } from "@/features/governance/hooks/useGovernanceStatus";

export function GovernanceView() {
  const { data, isLoading } = useGovernanceStatus();

  if (isLoading) return <div>Loading...</div>;
  if (!data) return <div>Failed to load governance status</div>;

  return (
    <div className="container mx-auto py-8 space-y-6">
      <h1 className="text-3xl font-bold">DAO Governance Status</h1>

      <Card>
        <CardHeader><CardTitle>Credit Balance</CardTitle></CardHeader>
        <CardContent>
          <div className="text-2xl font-mono">{data.systemCredits} credits</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Next Run</CardTitle></CardHeader>
        <CardContent>
          {data.nextRunAt ? (
            <div>Scheduled: {new Date(data.nextRunAt).toLocaleString()}</div>
          ) : (
            <div>No runs scheduled</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent Runs</CardTitle></CardHeader>
        <CardContent>
          {data.recentRuns.map(run => (
            <div key={run.id} className="border-b py-2 last:border-0">
              <div className="font-medium">{run.title || run.id}</div>
              <div className="text-sm text-muted-foreground">
                Started: {new Date(run.startedAt).toLocaleString()}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

### 8. React Query Hook (5 min)

```typescript
// src/features/governance/hooks/useGovernanceStatus.ts
import { useQuery } from "@tanstack/react-query";
import type { governanceStatusOperation } from "@/contracts/governance.status.v1.contract";
import { z } from "zod";

type GovernanceStatus = z.infer<typeof governanceStatusOperation.output>;

export function useGovernanceStatus() {
  return useQuery<GovernanceStatus>({
    queryKey: ["governance", "status"],
    queryFn: async () => {
      const res = await fetch("/api/v1/governance/status");
      if (!res.ok) throw new Error("Failed to fetch governance status");
      return res.json();
    },
    refetchInterval: 30000, // 30s polling (not aggressive)
  });
}
```

### 9. Create AGENTS.md Files (5 min)

```markdown
# src/features/governance/AGENTS.md

Feature slice for DAO governance transparency and monitoring.

**Exports:** hooks/useGovernanceStatus, services/get-governance-status
**Imports:** AccountService, GovernanceStatusPort (ports only, no adapters)
```

```markdown
# src/adapters/server/governance/AGENTS.md

Governance data adapters (Drizzle implementations).

**Implements:** GovernanceStatusPort
**Queries:** schedules, ai_threads (system tenant scope only)
```

## Validation

**Manual:**

1. Start dev: `pnpm dev:stack`
2. Navigate to `/governance`
3. Verify:
   - Credit balance displays (number)
   - Next run time displays (or "No runs scheduled")
   - Recent runs list shows last 10 threads
4. Wait 30s, verify page auto-refreshes

**Automated:**

```bash
pnpm check  # Type check + lint
```

## Future Enhancements (NOT MVP)

Deferred to later:

- Runway calculation (balance ÷ burn rate → hours remaining)
- Health color coding (🟢/🟡/🔴)
- Failed runs filtering (status='error')
- Per-charter breakdown
- Drill-down into individual run transcripts
- Real-time updates (WebSocket instead of polling)

## Review Checklist

- [ ] **Work Item:** `task.0070` linked in PR body
- [x] **Spec:** System tenant constants used correctly
- [x] **Architecture:** Feature service calls ports only (GovernanceStatusPort + AccountService)
- [x] **Port Implementation:** DrizzleGovernanceStatusAdapter implements GovernanceStatusPort correctly
- [x] **Container Wiring:** GovernanceStatusPort adapter registered in bootstrap/container
- [x] **Tests:** Unit tests for feature service with mocked ports (5 tests)
- [x] **Contracts:** Zod contract defined with `id` field and used throughout
- [x] **AGENTS.md:** Updated for features/governance and created for adapters/server/governance
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [task.0070.handoff.md](../handoffs/task.0070.handoff.md) (updated 2026-02-17 — bar charts + per-model/agent breakdown on `feat/bar-charts`)

## Attribution

- Design: derekg1729
- Implementation: derekg1729
