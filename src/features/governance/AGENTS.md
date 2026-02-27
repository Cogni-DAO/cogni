# governance · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Last reviewed:** 2026-02-24
- **Status:** draft

## Purpose

Governance feature slice — schedule sync, governance status dashboard, and epoch contribution UI (current epoch, history, holdings).

## Pointers

- [Governance Scheduling Spec](../../../docs/spec/governance-scheduling.md)
- [Epoch Ledger Spec](../../../docs/spec/epoch-ledger.md)
- [Repo Spec Config](../../../.cogni/repo-spec.yaml)

## Boundaries

```json
{
  "layer": "features",
  "may_import": ["features", "ports", "core", "shared", "types"],
  "must_not_import": [
    "app",
    "adapters/server",
    "adapters/worker",
    "bootstrap",
    "contracts"
  ]
}
```

## Public Surface

- **Exports (services):** `syncGovernanceSchedules()`, `GovernanceScheduleSyncDeps`, `GovernanceScheduleSyncResult`, `governanceScheduleId()`, `getGovernanceStatus()`, `GovernanceStatusResult`
- **Exports (hooks):** `useGovernanceStatus()`, `useCurrentEpoch()`, `useEpochHistory()`, `useHoldings()`
- **Exports (components):** `ContributorCard`, `ContributionRow`, `EpochCard`, `EpochCountdown`, `HoldingCard`, `SourceBadge`
- **Exports (lib):** `composeEpochView()`, `composeEpochViewFromStatement()`, `composeHoldings()`
- **Exports (types):** `EpochView`, `EpochContributor`, `IngestionReceipt`, `HoldingView`, `CurrentEpochData`, `EpochHistoryData`, `HoldingsData`
- **Routes (app pages):** `/gov` (system), `/gov/epoch` (current), `/gov/history` (finalized), `/gov/holdings` (aggregated)
- **Routes (API — in `src/app/api/v1/ledger/`):** `GET /epochs`, `GET /epochs/:id/allocations`, `GET /epochs/:id/statement`, `GET /epochs/:id/activity`
- **CLI:** `pnpm governance:schedules:sync`, `pnpm db:seed`, `pnpm dev:setup`
- **Env/Config keys:** `.cogni/repo-spec.yaml` → `governance.schedules`

## Ports

- **Uses ports:** `ScheduleControlPort` (Temporal lifecycle), `ExecutionGrantUserPort.ensureGrant` (stable grant), `AccountService` (balance), `GovernanceStatusPort` (schedule/run queries)
- **Implements ports:** none

## Responsibilities

- This directory **does**: Sync governance schedules; provide epoch UI hooks, view-model composition, and presentational components; pause removed schedules (PRUNE_IS_PAUSE)
- This directory **does not**: Execute workflows, manage tenant-facing schedule CRUD, access DB directly, perform credit math (ALL_MATH_BIGINT stays server-side)

## Usage

```bash
pnpm test tests/unit/features/governance/  # unit tests
pnpm governance:schedules:sync             # trigger internal route (app must be running)
pnpm dev:setup                             # db:setup + db:setup:test + gov schedule sync
```

## Standards

- Hooks fetch from ledger API, compose via `lib/` pure functions into view models (`types.ts`)
- Components are presentational only — no data fetching
- No direct adapter or DB imports

## Dependencies

- **Internal:** `@cogni/scheduler-core` (ports), `@/shared/config` (governance config), `@tanstack/react-query` (hooks), `p-limit` (concurrent fetches)
- **External:** `lucide-react` (icons)

## Change Protocol

- Update this file when exports, routes, or env/config changes
- Bump **Last reviewed** date
- Ensure `pnpm check` passes

## Notes

- Governance schedules are system-ops only; never exposed as tenant-facing API
- PRUNE_IS_PAUSE: removed charters get paused, never deleted
- Epoch seed script uses `computeEpochWindowV1()` from `@cogni/attribution-ledger` for Monday-aligned UTC windows matching the scheduler grid
