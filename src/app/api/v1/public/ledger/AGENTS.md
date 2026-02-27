# public/ledger · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Last reviewed:** 2026-02-23
- **Status:** draft

## Purpose

Public (unauthenticated) HTTP endpoints for finalized ledger data. Exposes closed-epoch lists, allocations, and payout statements to the community-ledger frontend without requiring a SIWE session.

## Pointers

- [Epoch Ledger Spec](../../../../../../docs/spec/epoch-ledger.md)
- [Ledger Contracts](../../../../../contracts/ledger.list-epochs.v1.contract.ts)

## Boundaries

```json
{
  "layer": "app",
  "may_import": ["bootstrap", "contracts", "shared"],
  "must_not_import": ["adapters", "core", "ports", "features"]
}
```

## Public Surface

- **Exports:** none (route handlers only)
- **Routes:**
  - `GET /api/v1/public/ledger/epochs` — list closed epochs (paginated)
  - `GET /api/v1/public/ledger/epochs/[id]/allocations` — allocations for a closed epoch
  - `GET /api/v1/public/ledger/epochs/[id]/statement` — payout statement (null if none)
- **CLI:** none
- **Env/Config keys:** none
- **Files considered API:** `epochs/route.ts`, `epochs/[id]/allocations/route.ts`, `epochs/[id]/statement/route.ts`

## Ports

- **Uses ports:** `EpochLedgerStore` (via container)
- **Implements ports:** none

## Responsibilities

- This directory **does:** serve finalized epoch data via `wrapPublicRoute()`, validate output via Zod contracts, enforce PUBLIC_READS_CLOSED_ONLY invariant.
- This directory **does not:** expose open/current epoch data, raw activity streams, PII fields, or write mutations.

## Usage

```bash
curl http://localhost:3000/api/v1/public/ledger/epochs
curl http://localhost:3000/api/v1/public/ledger/epochs/1/allocations
curl http://localhost:3000/api/v1/public/ledger/epochs/1/statement
```

## Standards

- All routes use `wrapPublicRoute()` with cache headers
- Output validated via contract schemas before responding
- Only closed epochs exposed (PUBLIC_READS_CLOSED_ONLY)

## Dependencies

- **Internal:** `@/bootstrap/http` (wrapPublicRoute), `@/bootstrap/container`, `@/contracts/ledger.*.v1.contract`, `@/shared/config`
- **External:** `next/server`

## Change Protocol

- Update this file when **Routes** change
- Bump **Last reviewed** date

## Notes

- `_lib/ledger-dto.ts` contains shared DTO mappers for BigInt/Date serialization; used by both public and auth routes.
- `wrapPublicRoute` does not propagate TContext to handler — dynamic routes use `context as { params: Promise<{ id: string }> }` cast.
