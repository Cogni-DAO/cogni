# ledger · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Last reviewed:** 2026-02-23
- **Status:** draft

## Purpose

Authenticated HTTP endpoints for ledger operations. SIWE-protected reads for all epochs and PII-containing activity streams, plus approver-gated write mutations for allocation adjustments, pool components, epoch review transitions, and epoch finalization.

## Pointers

- [Epoch Ledger Spec](../../../../../docs/spec/epoch-ledger.md)
- [Ledger Contracts](../../../../contracts/ledger.list-epochs.v1.contract.ts)

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
  - `GET /api/v1/ledger/epochs` — list all epochs including open (SIWE auth)
  - `GET /api/v1/ledger/epochs/[id]/activity` — activity events with curation join (SIWE auth, PII)
  - `PATCH /api/v1/ledger/epochs/[id]/allocations` — adjust allocation final_units (SIWE + approver)
  - `POST /api/v1/ledger/epochs/[id]/pool-components` — record pool component (SIWE + approver)
  - `POST /api/v1/ledger/epochs/[id]/review` — close ingestion, transition open → review (SIWE + approver)
  - `POST /api/v1/ledger/epochs/[id]/finalize` — sign + finalize epoch, returns 202 + workflowId (SIWE + approver, WRITES_VIA_TEMPORAL)
- **CLI:** none
- **Env/Config keys:** none
- **Files considered API:** `epochs/route.ts`, `epochs/[id]/activity/route.ts`, `epochs/[id]/allocations/route.ts`, `epochs/[id]/pool-components/route.ts`, `epochs/[id]/review/route.ts`, `epochs/[id]/finalize/route.ts`

## Ports

- **Uses ports:** `ActivityLedgerStore` (via container)
- **Implements ports:** none

## Responsibilities

- This directory **does:** authenticate via SIWE session, check approver allowlist for write routes, validate I/O via Zod contracts, delegate to `ActivityLedgerStore`.
- This directory **does not:** contain business logic, expose unauthenticated data, or bypass approver checks.

## Usage

```bash
# Authenticated reads (require SIWE session cookie)
curl -b session http://localhost:3000/api/v1/ledger/epochs
curl -b session http://localhost:3000/api/v1/ledger/epochs/1/activity

# Approver-gated writes
curl -X PATCH -b session http://localhost:3000/api/v1/ledger/epochs/1/allocations \
  -d '{"adjustments":[{"userId":"...","finalUnits":"5000"}]}'
```

## Standards

- All routes use `wrapRouteHandlerWithLogging({ auth: { mode: "required" } })`
- Write routes call `checkApprover()` from `_lib/approver-guard.ts` before mutations
- Approver allowlist sourced from `activity_ledger.approvers` in `.cogni/repo-spec.yaml`

## Dependencies

- **Internal:** `@/bootstrap/http`, `@/bootstrap/container`, `@/contracts/ledger.*.v1.contract`, `@/shared/config`, `@/app/_lib/auth/session`
- **External:** `next/server`

## Change Protocol

- Update this file when **Routes** or **approver-guard** logic changes
- Bump **Last reviewed** date

## Notes

- `_lib/approver-guard.ts` checks `sessionUser.walletAddress` against `getLedgerApprovers()`. Empty approvers list = all writes rejected.
- Approver list is cached at process level; changes require restart.
