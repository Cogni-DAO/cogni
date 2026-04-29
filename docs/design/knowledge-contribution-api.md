---
id: knowledge-contribution-api
type: design
title: "Knowledge Contribution API — Dolt branch-per-PR for external agents"
status: draft
spec_refs:
  - knowledge-data-plane-spec
  - agent-contributor-protocol
work_items:
  - task.0425
created: 2026-04-29
---

# Knowledge Contribution API — Dolt branch-per-PR for external agents

> External agents submit knowledge the same way they submit code: branch, commit, PR, merge. Internal writes still go straight to trunk. The contribution surface is **shared cross-node infrastructure** — every node with a Doltgres knowledge database gets the same routes wired the same way.

## Context

`docs/spec/knowledge-data-plane.md` defines `KnowledgeClass: experimental` and "knowledge moves upward by explicit promotion only" — but lists "single branch (`main`), no merge workflows" as a Non-Goal. This design lifts that restriction for the **external contribution path only** while keeping internal `core__knowledge_write` on trunk.

PR #1130 (`task.0424`) shipped the doltgres-on-operator scaffold (drizzle schema package, drizzle-kit migrator, `sql.unsafe + escapeValue` pattern, `AUTO_COMMIT_ON_WRITE`). This design reuses that scaffold and adds:

1. The `knowledge` table to operator (parity with poly — `KNOWLEDGE_TABLE_ON_EVERY_NODE`).
2. Branch ops on the Doltgres knowledge adapter.
3. A shared contribution service in `@cogni/knowledge-store` with per-node thin route wrappers.

## Goals

1. External agents (registered via `/api/v1/agent/register`) contribute schema-aligned `knowledge` entries via HTTP.
2. Each contribution is one Dolt branch + one commit (atomic, PR-equivalent).
3. Authorized operators review via diff and merge to `main`. v0 = curl + JSON.
4. Internal `core__knowledge_write` is unchanged.
5. **Identical surface across all knowledge-capable nodes** (poly, operator, future resy/ai-only). One implementation, N node bindings.

## Non-Goals

- Web UI for diff review.
- Long-lived per-agent branches / multi-commit PRs.
- Real RBAC tables / per-user knowledge RLS.
- Cross-node fan-out (one contribution targets one node).
- MCP tool for knowledge contribution (HTTP only in v0).
- Confidence promotion ladder beyond `30 → operator-set value on merge`.

## Considered & rejected: staging-table alternative

A `knowledge_pending` table on `main` would solve v0 with less complexity: POST writes a row, GET diff is a SELECT, merge is `INSERT ... SELECT`-then-DELETE-then-`dolt_commit`. No `dolt_checkout`, no session-state, no mutex.

**Rejected** because:

- `dolt_diff` gives row-level structural diff for free; staging-table needs hand-rolled diff
- v1 wants UI rendering proper Dolt commit history; staging-table would be torn out and replaced wholesale
- The branch model is the _natural_ Dolt primitive for "PR" — staging-table is a workaround for not having branches

The branching cost (~one extra Doltgres function per op) is paid once in the adapter; staging-table cost would compound forever in code that has to be redone.

## Architecture

### Shared service, per-node route bindings

```
┌──────────────────────────────────────────────────────────────────────┐
│ @cogni/knowledge-store (SHARED — cross-node infrastructure)          │
│                                                                       │
│ port/                                                                 │
│   contribution.port.ts          KnowledgeContributionPort            │
│ adapters/doltgres/                                                    │
│   contribution-adapter.ts       DoltgresKnowledgeContributionAdapter │
│ service/                                                              │
│   contribution-service.ts       createContributionService(deps)      │
│ domain/                                                               │
│   contribution.schema.ts        KnowledgeEntryInput, ContributionRecord │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               │ service exposes framework-agnostic
                               │ typed handlers:
                               │   create({ principal, body }) → record
                               │   list({ principal, query })  → records[]
                               │   getById, diff, merge, close
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ nodes/{poly,operator}/app/src/app/api/v1/knowledge/contributions/    │
│                                                                       │
│ route.ts                  ~10 lines: POST/GET wrapper                 │
│ [id]/route.ts             GET wrapper                                 │
│ [id]/diff/route.ts        GET wrapper                                 │
│ [id]/merge/route.ts       POST wrapper                                │
│ [id]/close/route.ts       POST wrapper                                │
│                                                                       │
│ Each wrapper:                                                         │
│   1. Parse body with Zod contract from @cogni/node-contracts          │
│   2. Resolve principal via getSessionUser (Bearer or session)        │
│   3. Call service.<op>({ principal, ... })                            │
│   4. Map service errors → HTTP status + body                          │
└──────────────────────────────────────────────────────────────────────┘
```

**No HTTP framework leaks into `@cogni/knowledge-store`.** The service exports plain async functions taking `{ principal: Principal, ... }` and returning typed records or throwing typed errors. Per-node `route.ts` files do the Next-specific binding. This is the same shape #1130 used for `WorkItemQueryPort` + per-node routes — extended to the cross-node case.

### Where `knowledge` schema lives

- **Generic shape** (id, domain, title, content, tags, ...) — defined once in `@cogni/knowledge-store/domain/knowledge.schema.ts`, currently re-exported by `nodes/poly/packages/doltgres-schema/`.
- **Operator gains it**: `nodes/operator/packages/doltgres-schema/` adds `knowledge` re-export + new migration `0001_add_knowledge.sql`.
- **Per-node companion tables** (e.g. `poly_market_categories`) stay node-private — that's the entire reason node-local schema packages exist.

### Branch lifecycle

```
                  ┌────────────────────────────────────┐
   POST /create   │ async sql.reserve(conn → {         │
   ─────────────► │   conn`SELECT dolt_checkout(       │
                  │     '-b', branch, 'main')`         │
                  │   for entry of entries:            │
                  │     conn`INSERT INTO knowledge ...`│
                  │   conn`SELECT dolt_commit(...)`    │
                  │   conn`SELECT dolt_checkout(main)` │
                  │   conn`INSERT knowledge_contribs`  │
                  │   conn`SELECT dolt_commit(...)`    │
                  │ })                                 │
                  └──────────────────┬─────────────────┘
                                     │ branch + main metadata persist
                                     ▼
       ┌──────────────────────┬──────────────────────┬───────────────────┐
       │  GET /diff           │  POST /merge         │  POST /close      │
       │  see "Reads on a     │  reserve(conn → {    │  reserve(conn → { │
       │   branch", below     │    dolt_checkout(    │    dolt_branch(   │
       │                      │      'main')         │      '-d',branch) │
       │                      │    dolt_merge(branch)│    metadata.update│
       │                      │    dolt_branch(      │       state=closed│
       │                      │      '-d',branch)    │  })               │
       │                      │    metadata.update   │                   │
       │                      │       state=merged   │                   │
       │                      │  })                  │                   │
       └──────────────────────┴──────────────────────┴───────────────────┘
```

### Contribution metadata table (on `main`)

The list of contributions can't live in `dolt_branch -l` alone — we'd lose state, principal, message, close-reason after merge/delete. Add a normal table on `main`:

```sql
CREATE TABLE knowledge_contributions (
  id              text PRIMARY KEY,        -- contributionId
  branch          text NOT NULL,
  state           text NOT NULL,           -- 'open' | 'merged' | 'closed'
  principal_id    text NOT NULL,
  principal_kind  text NOT NULL,           -- 'agent' | 'user'
  message         text NOT NULL,
  entry_count     integer NOT NULL,
  commit_hash     text NOT NULL,           -- branch HEAD at create
  merged_commit   text,                    -- main HEAD after merge
  closed_reason   text,                    -- operator-supplied on /close
  idempotency_key text,                    -- (principal_id, idempotency_key) unique 24h
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     text                     -- principal who merged/closed
);
CREATE INDEX ON knowledge_contributions (state);
CREATE INDEX ON knowledge_contributions (principal_id, state);
CREATE UNIQUE INDEX ON knowledge_contributions (principal_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

This makes `GET /contributions` a normal SELECT; `dolt_branch -l` is only used for cross-checking. Metadata writes auto-commit on `main` like all other writes.

### Reads on a branch — `GET /:id` and `GET /:id/diff`

Two unverified options; design picks one and falls back if Doltgres 0.56 doesn't support it:

| Approach                   | SQL                                                            | Pros                             | Cons                                                   |
| -------------------------- | -------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------ |
| **`AS OF`** (preferred)    | `SELECT * FROM knowledge AS OF '<branch>'`                     | No session state, parallel reads | Unverified in 0.56 — needs spike before implementation |
| **Reserved-conn checkout** | `sql.reserve(conn → checkout(branch); SELECT; checkout(main))` | Confirmed-working primitive      | Serializes per-op via reservation lifetime             |

**Pre-implementation spike (gates this PR):** verify `AS OF '<branch_ref>'` works on Doltgres 0.56 against a feature branch. If yes, all reads use `AS OF`. If no, reserved-conn pattern with try/finally restoring `main`. **The implementation PR cannot proceed until this is verified** — file as a 30-min spike against the existing knowledge-store testcontainer.

`GET /:id/diff` — always uses `dolt_diff('main', '<branch>', 'knowledge')` regardless of read strategy.

### Connection pinning

`postgres.js` is a connection **pool**. `sql.unsafe('dolt_checkout(...)')` followed by `sql.unsafe('INSERT...')` may land on different physical connections — checkout would apply to a connection that the next call doesn't use. A process-level mutex doesn't fix this.

**Correct pattern:** every branch op runs inside a single `await sql.reserve(async (conn) => { ... })`. The reserved connection is pinned for the closure's duration; checkout + insert + commit + checkout-back all execute on it. On exception, `try/finally` restores `dolt_checkout('main')` before releasing.

```typescript
async create(input) {
  return await this.sql.reserve(async (conn) => {
    try {
      await conn.unsafe(`SELECT dolt_checkout('-b', '${esc(branch)}', 'main')`);
      for (const entry of input.entries) {
        await conn.unsafe(`INSERT INTO knowledge (...) VALUES (...)`);
      }
      await conn.unsafe(`SELECT dolt_commit('-Am', '${esc(message)}')`);
      const [{ hash }] = await conn.unsafe(`SELECT dolt_hashof('${esc(branch)}') AS hash`);
      await conn.unsafe(`SELECT dolt_checkout('main')`);
      await conn.unsafe(`INSERT INTO knowledge_contributions (...) VALUES (...)`);
      await conn.unsafe(`SELECT dolt_commit('-Am', 'contrib-meta: ${esc(id)}')`);
      return record;
    } finally {
      try { await conn.unsafe(`SELECT dolt_checkout('main')`); } catch { /* swallow */ }
    }
  });
}
```

No process-level mutex needed — postgres.js handles connection isolation per reservation.

## Contracts

`packages/node-contracts/src/knowledge.contributions.v1.contract.ts` — HTTP request/response wrappers; reuses domain types from `@cogni/knowledge-store`:

```typescript
import { z } from "zod";
import {
  KnowledgeEntryInput,
  ContributionRecord,
} from "@cogni/knowledge-store";

export const ContributionsCreateRequest = z.object({
  message: z.string().min(1).max(512),
  entries: z.array(KnowledgeEntryInput).min(1).max(50),
  idempotencyKey: z.string().min(8).max(64).optional(),
});

export const ContributionsListQuery = z.object({
  state: z.enum(["open", "merged", "closed", "all"]).default("open"),
  principalId: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const ContributionMergeRequest = z.object({
  confidencePct: z.number().int().min(30).max(95).optional(),
});

export const ContributionCloseRequest = z.object({
  reason: z.string().min(1).max(512),
});
```

`packages/knowledge-store/src/domain/contribution.schema.ts`:

```typescript
export const KnowledgeEntryInput = z.object({
  domain: z.string().min(1).max(64),
  entityId: z.string().max(128).optional(),
  title: z.string().min(1).max(256),
  content: z.string().min(1).max(8192),
  tags: z.array(z.string().max(64)).max(32).optional(),
  confidencePct: z.number().int().min(0).max(100).optional(),
});

export const ContributionRecord = z.object({
  contributionId: z.string(),
  branch: z.string(),
  commitHash: z.string(),
  state: z.enum(["open", "merged", "closed"]),
  principalKind: z.enum(["agent", "user"]),
  principalId: z.string(),
  message: z.string(),
  entryCount: z.number().int(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  closedReason: z.string().nullable(),
});

export const ContributionDiffEntry = z.object({
  changeType: z.enum(["added", "modified", "removed"]),
  rowId: z.string(),
  before: z.record(z.unknown()).nullable(),
  after: z.record(z.unknown()).nullable(),
});
```

## Port

`packages/knowledge-store/src/port/contribution.port.ts`:

```typescript
export interface KnowledgeContributionPort {
  create(input: {
    principal: Principal;
    message: string;
    entries: KnowledgeEntryInput[];
    idempotencyKey?: string;
  }): Promise<ContributionRecord>;

  list(query: {
    state: "open" | "merged" | "closed" | "all";
    principalId?: string;
    limit: number;
  }): Promise<ContributionRecord[]>;

  getById(contributionId: string): Promise<ContributionRecord | null>;

  diff(contributionId: string): Promise<ContributionDiffEntry[]>;

  merge(input: {
    contributionId: string;
    principal: Principal;
    confidencePct?: number;
  }): Promise<{ commitHash: string }>;

  close(input: {
    contributionId: string;
    principal: Principal;
    reason: string;
  }): Promise<void>;
}

export class ContributionConflictError extends Error {}
export class ContributionNotFoundError extends Error {}
export class ContributionStateError extends Error {}
export class ContributionQuotaError extends Error {}
export class ContributionForbiddenError extends Error {}
```

## Service factory (cross-node shared)

`packages/knowledge-store/src/service/contribution-service.ts`:

```typescript
export interface ContributionServiceDeps {
  port: KnowledgeContributionPort;
  canMergeKnowledge: (p: Principal) => boolean;
  rateLimit: { maxOpenPerPrincipal: number };
}

export function createContributionService(deps: ContributionServiceDeps) {
  return {
    async create({ principal, body }) {
      if (body.idempotencyKey) {
        const existing = await deps.port.list({
          state: "all",
          principalId: principal.id,
          limit: 100,
        });
        const hit = existing.find(
          (r) => r.idempotencyKey === body.idempotencyKey
        );
        if (hit) return hit;
      }
      const open = await deps.port.list({
        state: "open",
        principalId: principal.id,
        limit: 100,
      });
      if (open.length >= deps.rateLimit.maxOpenPerPrincipal) {
        throw new ContributionQuotaError(
          `max open contributions = ${deps.rateLimit.maxOpenPerPrincipal}`
        );
      }
      return deps.port.create({
        principal,
        message: body.message,
        entries: body.entries.map((e) => ({
          ...e,
          confidencePct:
            principal.kind === "agent" ? 30 : (e.confidencePct ?? 30),
        })),
        idempotencyKey: body.idempotencyKey,
      });
    },
    async merge({ principal, contributionId, confidencePct }) {
      if (!deps.canMergeKnowledge(principal))
        throw new ContributionForbiddenError();
      return deps.port.merge({ contributionId, principal, confidencePct });
    },
    async close({ principal, contributionId, reason }) {
      if (!deps.canMergeKnowledge(principal))
        throw new ContributionForbiddenError();
      return deps.port.close({ contributionId, principal, reason });
    },
    list: deps.port.list,
    getById: deps.port.getById,
    diff: deps.port.diff,
  };
}
```

Per-node `bootstrap/container.ts` constructs the service once with the node's port + the shared `canMergeKnowledge` policy. Per-node `route.ts` files are then ~10-line Next adapters.

## Auth

Reuses `getSessionUser` resolver from #1130 (Bearer or session). v0 merge/close gate:

```typescript
export function canMergeKnowledge(p: Principal): boolean {
  return p.kind === "user" && p.role === "admin";
}
```

**No env-var allowlist in v0.** Either you're an admin user with a session cookie, or you can't merge. v1 = `knowledge_merge_grants` table on operator DB with audit trail. Documented in spec as `KNOWLEDGE_MERGE_REQUIRES_ADMIN_SESSION` invariant.

## Rate limit / abuse

| Limit                            | Value | Enforcement                                            |
| -------------------------------- | ----- | ------------------------------------------------------ |
| Open contributions per principal | 10    | Service `create` checks before port call               |
| Entries per contribution         | 50    | Zod contract                                           |
| Bytes per `content` field        | 8192  | Zod contract                                           |
| Bytes per request total          | 64KB  | Next route handler `request.body.size` check           |
| Idempotency-Key TTL              | 24h   | Unique partial index `(principal_id, idempotency_key)` |

429 on quota; 413 on body size; 200 with existing record on idempotency-key replay.

## Spec edits (deferred to implementation PR)

`docs/spec/knowledge-data-plane.md`:

1. **Non-Goals** — replace "Branching, remotes, or cross-node sharing — single branch (`main`) only" with "Long-lived feature branches, multi-commit PRs, cross-node remotes, fan-out."
2. **Invariants** — add:
   - `EXTERNAL_CONTRIB_VIA_BRANCH` — external-agent writes to `knowledge` go through `contrib/<agent>-<id>` branches; only admin-session principals merge to `main`
   - `KNOWLEDGE_TABLE_ON_EVERY_NODE` — every knowledge-database node has the `knowledge` table
   - `INTERNAL_WRITES_TO_MAIN` — `core__knowledge_write` (agent runtime) writes straight to `main`; branching is the external-only path
   - `CONTRIBUTION_METADATA_ON_MAIN` — contribution state lives in `knowledge_contributions` table on main, not in dolt branch metadata
   - `KNOWLEDGE_MERGE_REQUIRES_ADMIN_SESSION` — v0 merge/close gate is admin-role session only

## Open Questions

| Q                                                                                                       | Status                                                                                |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Does Doltgres 0.56 support `SELECT ... AS OF '<branch>'`?                                               | **GATING** — spike before implementation; falls back to reserved-conn checkout if not |
| Does `sql.reserve()` exist on the postgres.js version we use, and pin reliably across `unsafe()` calls? | Per postgres.js v3 docs yes; component-test confirmation against Doltgres required    |
| Should `merge` require explicit confidence promotion or default-passthrough?                            | Default-passthrough in v0; required in v1 once flow is exercised                      |
| Branch-namespace GC for stale `contrib/*` branches — manual `/close-stale`, or 30-day cron?             | v0 = no GC; quota caps the worst case; v1 work item                                   |

## Test surface

- **Unit** (`@cogni/knowledge-store`) — service factory: rate-limit math, confidence-cap logic, `canMergeKnowledge` policy, contract Zod parse round-trips
- **Component** (testcontainer Doltgres) — adapter `create → list → getById → diff → merge` happy path; `merge` conflict → `ContributionConflictError`; `close` drops branch + writes metadata; reserved-conn restores `main` on error
- **Stack** (poly app + Doltgres) — full HTTP roundtrip via `/api/v1/agent/register` → contribute → admin-session merge

## Risks

- **`AS OF` may not work in 0.56** — gated by spike + reserved-conn fallback
- **Reserved-conn long-held during 50-entry insert** — postgres.js pool may starve under contention; v0 has at most 10 open contribs per principal, low-traffic. v1 concern with pool tuning
- **Connection-state leak on adapter error** — try/finally restores `main`; component test exercises error paths
- **Three-way merge on `dolt_merge`** — branch was created from `main` HEAD at create; if `main` advances before merge (concurrent internal writes), merge is three-way. Doltgres 0.56 supports this but conflicts on `knowledge.id` need explicit handling — v0 returns 409 (`ContributionConflictError`), agent must rebase by re-creating contribution against new main
- **Doltgres 0.56 RBAC non-functional** — every connection is superuser; app-layer auth is the _only_ gate. Already accepted per spec's `RUNTIME_URL_IS_SUPERUSER`. Reinforces why merge gate is admin-session-only — there is no DB-level enforcement
