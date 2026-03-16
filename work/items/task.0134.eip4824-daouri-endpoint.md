---
id: task.0134
type: task
title: "EIP-4824 daoURI v0 — lightweight DAOstar metadata endpoint"
status: needs_implement
priority: 2
rank: 50
estimate: 2
summary: "Add a public `GET /api/v1/public/dao/metadata` endpoint returning EIP-4824-compliant JSON-LD. Sources DAO name, contracts, and governance links from repo-spec.yaml; members from user_bindings; attribution epochs as activity log. Thin read-only export — no new data models, no on-chain registration yet."
outcome: "Cogni publishes a standards-compliant daoURI that DAOstar, Tally, DeepDAO, and other ecosystem tools can index. Federation-ready metadata layer for P2."
spec_refs:
  - financial-ledger-spec
  - attribution-pipeline-overview-spec
assignees: derekg1729
credit:
project: proj.financial-ledger
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-03
updated: 2026-03-03
labels: [dao, standards, web3, treasury]
external_refs:
  - https://eips.ethereum.org/EIPS/eip-4824
  - docs/research/daostar-eip4824-alignment.md
  - spike.0131
---

# EIP-4824 daoURI v0 — Lightweight DAOstar Metadata Endpoint

## Context

> **Cogni's attribution pipeline is the novel part** — activity-based allocation with EIP-712 signed statements, LLM-powered enrichment, human review, and Merkle claim trees. No existing standard or OSS tool does this. EIP-4824 is just the wrapping paper for discoverability. Don't let standards alignment delay the actual product.
>
> The pipeline has deterministic aspects (integer math, canonical hashing, largest-remainder rounding) but also includes LLM-powered enrichment and human review phases — it is NOT fully deterministic end-to-end. The determinism guarantees apply to the allocation-through-statement path, not the full pipeline.

Spike [spike.0131](./spike.0131.daostar-eip4824-alignment.md) found that Cogni already has ~80% of the data EIP-4824 describes. The gap is a standardized JSON-LD export format, not missing data. This task adds that thin export layer.

EIP-4824 defines a `daoURI` — a JSON-LD document describing a DAO's name, members, proposals, activity, governance, and contracts. 200+ DAOs have adopted it (Snapshot, Aragon, Optimism Collective, Aave, etc.). Adding support takes ~1-2 days and immediately makes Cogni discoverable by ecosystem indexers.

**What this task is NOT:**

- NOT on-chain registration (separate follow-up task)
- NOT DAOIP-4/5 adoption (proposal types / grants schema — poor fit for automated attribution)
- NOT a new data model — purely reads existing data and formats as JSON-LD

## Requirements

- `GET /api/v1/public/dao/metadata` returns valid EIP-4824 JSON-LD with:
  - `@context`: `"http://www.daostar.org/schemas"`
  - `type`: `"DAO"`
  - `name`: from repo-spec `intent.name` (or new `dao_info.name` field)
  - `description`: from repo-spec (new `dao_info.description` field)
  - `membersURI`: points to `/api/v1/public/dao/members`
  - `proposalsURI`: points to `/api/v1/public/dao/proposals`
  - `activityLogURI`: points to `/api/v1/public/dao/activity`
  - `governanceURI`: points to a governance markdown URL (`.cogni/` or hosted)
  - `contractsURI`: inline array from repo-spec `cogni_dao.*` addresses (CAIP-10 format)
- `GET /api/v1/public/dao/members` returns EIP-4824 Members JSON-LD:
  - Array of `{ id: "<CAIP-10 address>" }` for users with wallet bindings
  - Sources from `user_bindings` table where `provider = 'wallet'`
  - Uses CAIP-10 format: `eip155:<chain_id>:<address>`
- `GET /api/v1/public/dao/proposals` returns EIP-4824 Proposals JSON-LD:
  - Maps finalized attribution epochs as proposals (they ARE governance proposals — signed credit statements)
  - Fields: `id`, `type: "proposal"`, `name`, `status` (mapped from epoch state)
- `GET /api/v1/public/dao/activity` returns EIP-4824 Activity Log JSON-LD:
  - Maps epoch participation (claimant allocations) as activities
  - Links member (CAIP-10) to proposal (epoch)
- All endpoints use `wrapPublicRoute()` with appropriate cache TTLs
- All endpoints have Zod contracts in `src/contracts/`
- Add `dao_info` section to repo-spec.yaml schema (name, description)

## Allowed Changes

- `src/app/api/v1/public/dao/` — new route directory (4 route files)
- `src/app/_facades/dao/` — new facade for DAO metadata queries
- `src/contracts/dao.metadata.v1.contract.ts` — new contract
- `src/contracts/dao.members.v1.contract.ts` — new contract
- `src/contracts/dao.proposals.v1.contract.ts` — new contract
- `src/contracts/dao.activity.v1.contract.ts` — new contract
- `.cogni/repo-spec.yaml` — add `dao_info: { name, description }` fields
- `packages/repo-spec/src/schema.ts` — extend schema for `dao_info`
- `packages/repo-spec/src/accessors.ts` — add `getDaoInfo()` accessor
- `tests/unit/` or `tests/contract/` — contract tests for new endpoints
- `docs/spec/financial-ledger.md` — add "DAO Metadata (EIP-4824)" section

## Plan

- [ ] Add `dao_info: { name, description }` to repo-spec.yaml and extend `@cogni/repo-spec` schema + accessor
- [ ] Define Zod contracts for all 4 endpoints (`dao.metadata.v1`, `dao.members.v1`, `dao.proposals.v1`, `dao.activity.v1`)
- [ ] Create facade `src/app/_facades/dao/metadata.server.ts`:
  - Read repo-spec for DAO name, description, contract addresses
  - Query `user_bindings` for wallet members (CAIP-10 format)
  - Query `epochs` for finalized epochs as proposals
  - Query `epoch_final_claimant_allocations` for activity log
- [ ] Create routes under `src/app/api/v1/public/dao/`:
  - `metadata/route.ts` — main daoURI JSON-LD
  - `members/route.ts` — EIP-4824 members
  - `proposals/route.ts` — epochs as proposals
  - `activity/route.ts` — epoch participation as activities
- [ ] All routes use `wrapPublicRoute()` with cache: metadata (300s), members (300s), proposals (120s), activity (120s)
- [ ] Write contract tests verifying JSON-LD schema compliance
- [ ] Add brief "DAO Metadata (EIP-4824)" section to `docs/spec/financial-ledger.md`
- [ ] Run `pnpm check` — clean

## Validation

**Command:**

```bash
pnpm check
pnpm test -- --grep "dao.metadata"
```

**Expected:** All lint/type/format checks pass. Contract tests verify JSON-LD output matches EIP-4824 schema.

**Manual verification:**

```bash
curl http://localhost:3000/api/v1/public/dao/metadata | jq .
```

Should return valid JSON-LD with `@context`, `type: "DAO"`, `name`, and all subsidiary URIs.

## Review Checklist

- [ ] **Work Item:** `task.0134` linked in PR body
- [ ] **Spec:** EIP-4824 JSON-LD schema compliance verified (fields, CAIP-10 format, context URI)
- [ ] **Spec:** `wrapPublicRoute()` used on all new public routes (rate limiting + cache)
- [ ] **Spec:** No business logic in routes — facade pattern only
- [ ] **Tests:** Contract tests cover all 4 endpoints
- [ ] **Tests:** Edge cases: empty members, no finalized epochs, missing dao_info fields
- [ ] **Reviewer:** assigned and approved

## Design Notes

### CAIP-10 Format

Member IDs use [CAIP-10](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-10.md) format: `eip155:<chain_id>:<address>`. For Base: `eip155:8453:0x070075F1...`.

### Epoch → Proposal Mapping

| Epoch Field                          | EIP-4824 Proposal Field                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| `epoch_id`                           | `id` (as `eip155:8453:<dao_contract>?proposalId=<epoch_id>`) |
| `"Epoch #N"`                         | `name`                                                       |
| epoch status (open/review/finalized) | `status`                                                     |
| statement hash                       | `contentURI` (link to statement endpoint)                    |

### What This Does NOT Cover

- On-chain daoURI registration (separate task — requires governance tx)
- DAOIP-4 proposal type taxonomy (defer to P1)
- DAOIP-5 grants schema (poor fit for automated attribution)
- DAOIP-3 attestations (our EIP-712 signatures are already stronger)

## PR / Links

-

## Attribution

- spike.0131 research by derekg1729
