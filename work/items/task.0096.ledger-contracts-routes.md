---
id: task.0096
type: task
title: "Ledger Zod contracts + API routes (2 write, 4 read) + stack tests"
status: done
priority: 1
rank: 5
estimate: 2
summary: "Define 6 Zod contracts, implement 4 public read routes (under /api/v1/public/ledger/) and 2 SIWE-protected write routes (under /api/v1/ledger/), with stack tests. Deferred: collect trigger, finalize, verify, close-ingestion, sign."
outcome: "Frontend can display current epoch, past epochs with allocations, and payout statements. Admins can adjust allocations and record pool components via API."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-api-routes
pr: https://github.com/Cogni-DAO/node-template/pull/464
reviewer:
revision: 3
blocked_by:
deploy_verified: false
created: 2026-02-20
updated: 2026-02-23
labels: [governance, ledger, api]
external_refs:
---

# Ledger Zod Contracts + API Routes

## Problem

The ledger pipeline collects activity and stores it in the DB, but nothing exposes this data over HTTP. The frontend mockup (community-ledger) needs epoch data, activity events, allocations, and payout statements to render its 3 pages (Current Epoch, History, Holdings). Admins need write routes to trigger collection, adjust allocations, and record pool components.

## Design

### Outcome

Public visitors can see finalized epoch results (closed epochs, allocations, statements). Authenticated operators can see live epoch data (open epochs, raw activity with PII). Approved operators can adjust allocations and record pool components.

### Approach

**Solution**: 6 Zod contracts defining ledger API shapes. 3 public read routes (closed-epoch data only, under `/api/v1/public/ledger/`), 1 authenticated read route (activity with PII, under `/api/v1/ledger/`), and 2 approver-gated write routes (under `/api/v1/ledger/`). Routes are thin HTTP handlers that validate with contracts, resolve `activityLedgerStore` from container, query with `getNodeId()`, and return validated output.

**Public vs Authenticated split** — Raw activity streams expose platformUserId/platformLogin/artifactUrl/metadata — PII-adjacent, scrapeable, harassment-bait. Transparency is satisfied by publishing closed-epoch allocations + statements.

| Route                                       | Auth            | Rationale                                                         |
| ------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `GET /public/ledger/epochs`                 | public          | Only returns `status: "closed"` epochs — finalized, safe to share |
| `GET /public/ledger/epochs/:id/allocations` | public          | Only for closed epochs — shows who earned what                    |
| `GET /public/ledger/epochs/:id/statement`   | public          | Signed payout statement — the transparency artifact               |
| `GET /ledger/epochs`                        | SIWE            | Returns all epochs including open — operational detail            |
| `GET /ledger/epochs/:id/activity`           | SIWE            | PII fields (platformUserId, platformLogin, artifactUrl, metadata) |
| `PATCH /ledger/epochs/:id/allocations`      | SIWE + approver | Mutates allocations — must be in `ledger.approvers`               |
| `POST /ledger/epochs/:id/pool-components`   | SIWE + approver | Mutates pool — must be in `ledger.approvers`                      |

**Approver allowlist**: Add `ledger.approvers` (array of EVM addresses) to repo-spec schema + yaml. Write routes check `sessionUser.address ∈ ledger.approvers` before allowing mutations. Reads the config from `getLedgerApprovers()` in `@/shared/config`.

**Statement semantics**: Consistent `200 { statement: ... }` or `200 null` — no 404 ambiguity. Null means "no statement yet".

**Activity pagination**: Hard-cap limit at 500 events. `getActivityForWindow()` returns all matching events; route applies in-memory `slice()` with enforced max. DB-level limit/offset deferred until data volumes warrant a store port change.

**Reuses**:

- Existing `ActivityLedgerStore` port — all read methods already implemented in `DrizzleLedgerAdapter`
- Existing `getContainer().activityLedgerStore` — wired in bootstrap
- Existing `getNodeId()` from `@/shared/config` — provides node_id for all queries
- Existing `wrapRouteHandlerWithLogging` — auth + logging + error handling
- Existing `wrapPublicRoute` — rate limiting + cache headers for public read routes
- Existing Zod contract pattern from `src/contracts/schedules.*.v1.contract.ts`

**Rejected**:

- **Composite "epoch detail" endpoint**: Over-engineering — frontend can compose from 2-3 granular calls. Matches REST conventions.
- **Server-side Holdings aggregation endpoint**: V0 has <10 epochs, <20 users. Client-side aggregation is trivial. Add when data volume warrants it.
- **Facade layer**: Routes are single store calls — no shared wiring to extract. Facades add files without value.
- **All-public reads**: Raw activity streams are PII-adjacent + scrapeable. Only finalized outputs are public.

### Deferred Routes (no stubs — contracts + routes created when features land)

| Route                              | Blocked By | Reason                                                                                |
| ---------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `POST /epochs/collect`             | follow-up  | Needs Temporal `triggerSchedule` port method — daily schedule already runs collection |
| `POST /epochs/:id/finalize`        | task.0102  | Needs `FinalizeEpochWorkflow` + `computeProposedAllocations`                          |
| `GET /verify/epoch/:id`            | task.0102  | Needs `computeProposedAllocations` to recompute and compare                           |
| `POST /epochs/:id/close-ingestion` | task.0100  | Needs 3-phase epoch state machine                                                     |
| `POST /epochs/:id/sign`            | task.0100  | Needs signing workflow + approver config                                              |

No stub files created for deferred routes. Contracts and route handlers are added when their blocking tasks land. This avoids dead code that needs updating later.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] CONTRACTS_SINGLE_SOURCE: All request/response shapes defined in `src/contracts/ledger.*.v1.contract.ts`. Routes, tests, and frontend use `z.infer<>` — no parallel interfaces. (spec: architecture)
- [ ] VALIDATE_IO: Routes parse input before processing, parse output before responding. Fail closed. (spec: architecture)
- [ ] PUBLIC_READS_CLOSED_ONLY: Public read routes only return closed-epoch data. Open/current epoch data requires SIWE session. (spec: epoch-ledger)
- [ ] ACTIVITY_AUTHED: Activity events (PII fields) only served via authenticated route. Never public. (spec: epoch-ledger)
- [ ] WRITE_ROUTES_APPROVER_GATED: Write routes require SIWE session + wallet in `ledger.approvers` from repo-spec. (spec: epoch-ledger)
- [ ] NODE_SCOPED: All store queries pass `nodeId` from `getNodeId()`, never from user input. (spec: epoch-ledger)
- [ ] ALL_MATH_BIGINT: BigInt values serialized as strings in JSON contracts. Parsed back with `BigInt()` in routes. (spec: epoch-ledger)
- [ ] SIMPLE_SOLUTION: Thin routes, no facades, no extra abstractions. (spec: architecture)
- [ ] ARCHITECTURE_ALIGNMENT: `app → features/contracts/shared` only. Routes never import adapters or core. (spec: architecture)

### API Contracts

#### Read Routes (public — under `/api/v1/public/ledger/`)

**1. `GET /api/v1/public/ledger/epochs`** — List all epochs

```typescript
// ledger.list-epochs.v1.contract.ts
const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const EpochSchema = z.object({
  id: z.string(), // bigint as string
  status: z.enum(["open", "closed"]), // matches current EpochStatus model
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  weightConfig: z.record(z.string(), z.number()),
  poolTotalCredits: z.string().nullable(), // bigint as string
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
// Output: { epochs: EpochSchema[], total: number }
```

Note: `status` enum matches the current `EpochStatus = "open" | "closed"` from `packages/ledger-core/src/model.ts`. When task.0100 implements 3-phase lifecycle, the model AND this contract are updated together.

**2. `GET /api/v1/public/ledger/epochs/[id]/activity`** — Activity events for epoch

```typescript
// ledger.epoch-activity.v1.contract.ts
const ActivityEventSchema = z.object({
  id: z.string(),
  source: z.string(),
  eventType: z.string(),
  platformUserId: z.string(),
  platformLogin: z.string().nullable(),
  artifactUrl: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  eventTime: z.string().datetime(),
  // Curation join (populated after task.0101, null before)
  curation: z
    .object({
      userId: z.string().nullable(),
      included: z.boolean(),
      weightOverrideMilli: z.string().nullable(), // bigint as string
      note: z.string().nullable(),
    })
    .nullable(),
});
// Input: PaginationQuerySchema (limit, offset)
// Output: { events: ActivityEventSchema[], epochId: z.string(), total: number }
```

Implementation: Load epoch → `getActivityForWindow(nodeId, periodStart, periodEnd)` + `getCurationForEpoch(epochId)` → join by eventId in handler → apply `offset`/`limit` via `slice()`.

**3. `GET /api/v1/public/ledger/epochs/[id]/allocations`** — Proposed + final allocations

```typescript
// ledger.epoch-allocations.v1.contract.ts
const AllocationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  proposedUnits: z.string(), // bigint as string
  finalUnits: z.string().nullable(), // bigint as string
  overrideReason: z.string().nullable(),
  activityCount: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
// Output: { allocations: AllocationSchema[], epochId: z.string() }
```

**4. `GET /api/v1/public/ledger/epochs/[id]/statement`** — Payout statement

```typescript
// ledger.epoch-statement.v1.contract.ts
const PayoutLineSchema = z.object({
  user_id: z.string(),
  total_units: z.string(),
  share: z.string(),
  amount_credits: z.string(),
});
const StatementSchema = z.object({
  id: z.string(),
  epochId: z.string(),
  allocationSetHash: z.string(),
  poolTotalCredits: z.string(),
  payouts: z.array(PayoutLineSchema),
  supersedesStatementId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
// Output: { statement: StatementSchema | null } (200 always, null = no statement yet)
```

#### Write Routes (SIWE-protected — under `/api/v1/ledger/`)

**5. `PATCH /api/v1/ledger/epochs/[id]/allocations`** — Adjust final_units

```typescript
// ledger.update-allocations.v1.contract.ts
const UpdateAllocationInputSchema = z.object({
  adjustments: z.array(
    z.object({
      userId: z.string(),
      finalUnits: z.string(), // bigint as string
      overrideReason: z.string().optional(),
    })
  ),
});
// Output: { updated: number }
```

Implementation: Parse epoch ID from URL, call `updateAllocationFinalUnits()` for each adjustment. Verify epoch exists and is `open` (or `review` once task.0100 lands).

**6. `POST /api/v1/ledger/epochs/[id]/pool-components`** — Record pool component

```typescript
// ledger.record-pool-component.v1.contract.ts
const PoolComponentInputSchema = z.object({
  componentId: z.string(), // "base_issuance", "kpi_bonus_v0", "top_up"
  algorithmVersion: z.string(),
  inputsJson: z.record(z.string(), z.unknown()),
  amountCredits: z.string(), // bigint as string
  evidenceRef: z.string().optional(),
});
// Output: { id, componentId, amountCredits, computedAt }
```

Implementation: Parse epoch ID from URL, call `insertPoolComponent()` with nodeId from `getNodeId()`.

### Route Structure

```
src/app/api/v1/
  public/ledger/                         # Public reads (closed-epoch data only)
    epochs/
      route.ts                           # GET list (closed only)
      [id]/
        allocations/route.ts            # GET (closed only)
        statement/route.ts              # GET
  ledger/                                # Authenticated (SIWE-protected by proxy)
    epochs/
      route.ts                           # GET list (all epochs)
      [id]/
        activity/route.ts               # GET (PII fields)
        allocations/route.ts            # PATCH (approver-gated)
        pool-components/route.ts        # POST (approver-gated)
```

### BigInt Serialization Convention

All bigint values are serialized as strings in JSON:

- `epochId: "123"` (not `123`)
- `proposedUnits: "8000"` (not `8000`)
- `poolTotalCredits: "10000"` (not `10000`)

Routes parse string → BigInt for store calls, and BigInt → string for responses. This is consistent with how `ensureEpochForWindow` already handles `epochId` for Temporal.

### Files

**Create:**

- `src/contracts/ledger.list-epochs.v1.contract.ts` — Epoch list output + pagination input schema
- `src/contracts/ledger.epoch-activity.v1.contract.ts` — Activity events + curation output schema
- `src/contracts/ledger.epoch-allocations.v1.contract.ts` — Allocations output + update input schema
- `src/contracts/ledger.epoch-statement.v1.contract.ts` — Payout statement output schema
- `src/contracts/ledger.update-allocations.v1.contract.ts` — Allocation adjustment input schema
- `src/contracts/ledger.record-pool-component.v1.contract.ts` — Pool component input/output schema
- `src/app/api/v1/public/ledger/epochs/route.ts` — GET list (public, closed only)
- `src/app/api/v1/public/ledger/epochs/[id]/allocations/route.ts` — GET allocations (public, closed only)
- `src/app/api/v1/public/ledger/epochs/[id]/statement/route.ts` — GET statement (public)
- `src/app/api/v1/ledger/epochs/route.ts` — GET list (authenticated, all epochs)
- `src/app/api/v1/ledger/epochs/[id]/activity/route.ts` — GET activity (authenticated, PII)
- `src/app/api/v1/ledger/epochs/[id]/allocations/route.ts` — PATCH allocations (approver-gated)
- `src/app/api/v1/ledger/epochs/[id]/pool-components/route.ts` — POST pool component (approver-gated)
- `src/app/api/v1/ledger/_lib/approver-guard.ts` — Shared approver check utility

**Test:**

- `tests/stack/ledger/ledger-api.stack.test.ts` — Stack test: seed data → query all read routes → verify shapes

**Modify:**

- `src/shared/config/repoSpec.schema.ts` — Add `ledger.approvers` EVM address array
- `src/shared/config/repoSpec.server.ts` — Add `getLedgerApprovers()` helper
- `.cogni/repo-spec.yaml` — Add `ledger.approvers` with operator wallet
- `src/contracts/AGENTS.md` — Add ledger contracts to public surface list

### Implementation Details

#### Route Handler Pattern

Read routes use `wrapPublicRoute` (rate-limited, no auth, under `/api/v1/public/`). Write routes use `wrapRouteHandlerWithLogging({ auth: { mode: "required" } })` (under `/api/v1/`).

```typescript
// src/app/api/v1/public/ledger/epochs/route.ts
import { getContainer } from "@/bootstrap/container";
import { wrapPublicRoute } from "@/bootstrap/http";
import { getNodeId } from "@/shared/config";
import { listEpochsOperation } from "@/contracts/ledger.list-epochs.v1.contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapPublicRoute(
  { routeId: "ledger.list-epochs" },
  async (ctx, request) => {
    const url = new URL(request.url);
    const { limit, offset } = listEpochsOperation.input.parse({
      limit: url.searchParams.get("limit"),
      offset: url.searchParams.get("offset"),
    });
    const store = getContainer().activityLedgerStore;
    const allEpochs = await store.listEpochs(getNodeId());
    const page = allEpochs.slice(offset, offset + limit);
    return NextResponse.json(
      listEpochsOperation.output.parse({
        epochs: page.map(toEpochDto),
        total: allEpochs.length,
      })
    );
  }
);
```

#### DTO Mapping

BigInt/Date → string conversion in a shared mapper (inline in route file or a small `_lib/ledger-dto.ts`):

```typescript
function toEpochDto(e: LedgerEpoch) {
  return {
    id: e.id.toString(),
    status: e.status,
    periodStart: e.periodStart.toISOString(),
    periodEnd: e.periodEnd.toISOString(),
    weightConfig: e.weightConfig,
    poolTotalCredits: e.poolTotalCredits?.toString() ?? null,
    openedAt: e.openedAt.toISOString(),
    closedAt: e.closedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}
```

#### Activity + Curation Join

The activity route joins events with curations in-memory (V0 data sizes make this trivial):

```typescript
const epoch = await store.getEpoch(epochId);
const events = await store.getActivityForWindow(
  nodeId,
  epoch.periodStart,
  epoch.periodEnd
);
const curations = await store.getCurationForEpoch(epochId);
const curationMap = new Map(curations.map((c) => [c.eventId, c]));

const enriched = events.map((e) => ({
  ...toEventDto(e),
  curation: curationMap.has(e.id)
    ? toCurationDto(curationMap.get(e.id)!)
    : null,
}));
```

## Plan

- [x] Define 6 Zod contract files in `src/contracts/ledger.*.v1.contract.ts`
- [ ] Add `ledger.approvers` to repo-spec schema + yaml + `getLedgerApprovers()` helper
- [ ] Create route directory structure under `src/app/api/v1/public/ledger/` (public closed reads) and `src/app/api/v1/ledger/` (auth reads + writes)
- [ ] Implement 3 public read routes: list-epochs (closed only, paginated), allocations (closed only), statement
- [ ] Implement 1 authenticated read route: activity (paginated, hard-cap 500)
- [ ] Implement 1 authenticated read route: list-epochs (all, paginated)
- [ ] Implement 2 approver-gated write routes: update-allocations, record-pool-component
- [ ] Add approver guard utility (`_lib/approver-guard.ts`)
- [ ] Add DTO mappers for BigInt/Date serialization
- [ ] Write stack test: seed epoch + events → query all read routes → verify contract shapes
- [ ] Update `src/contracts/AGENTS.md` public surface list
- [ ] `pnpm check` clean

## Validation

```bash
pnpm check
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/ledger/
```

## Review Checklist

- [ ] **Work Item:** `task.0096` linked in PR body
- [ ] **Spec:** NODE_SCOPED, ALL_MATH_BIGINT upheld
- [ ] **Contracts:** 6 defined, shapes match spec schema + current EpochStatus model
- [ ] **BigInt:** Serialized as strings in all JSON responses
- [ ] **Auth namespace:** Read routes under `/api/v1/public/ledger/` (wrapPublicRoute), write routes under `/api/v1/ledger/` (SIWE)
- [ ] **Pagination:** list-epochs and epoch-activity support `?limit=N&offset=M`
- [ ] **No stubs:** No 501 route files — deferred features have no files
- [ ] **Tests:** Stack test covers read routes with seeded data
- [ ] **Reviewer:** assigned and approved

## Review Feedback

### r3 — Implementation Review (2026-02-23)

**Blocking:**

1. **Pagination null coercion** — `url.searchParams.get()` returns `null`, but `z.coerce.number().default()` only defaults on `undefined`. `Number(null) === 0` fails `.min(1)`. All paginated routes 500 on default calls. Fix: `searchParams.get("limit") ?? undefined`.
2. **BigInt parsing uncaught throws** — `BigInt("abc")` throws `SyntaxError` → unhandled 500. All 4 `[id]` routes. Fix: try/catch returning 400.
3. **Statement route missing PUBLIC_READS_CLOSED_ONLY** — Header declares invariant but implementation doesn't check epoch status. Fix: add closed-check matching allocations route.

**Non-blocking:**

- Activity contract description says "Public endpoint" — should say "Authenticated endpoint."
- `ACTIVITY_HARD_CAP` (500) unreachable since contract limits to 200.
- `handleRouteError` duplicated in 2 write routes.
- Sequential allocation updates lack transaction boundary (partial failure possible).

## PR / Links

- Handoff: [handoff](../handoffs/task.0096.handoff.md)
- Frontend mockup: `/Users/derek/dev/community-ledger/` (Lovable.dev React app)

## Attribution

-
