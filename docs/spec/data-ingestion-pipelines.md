---
id: data-ingestion-pipelines-spec
type: spec
title: "Data Ingestion Pipelines: Singer Taps via Temporal"
status: draft
spec_state: draft
trust: draft
summary: "Standardized data ingestion via Singer (MIT/Apache) taps orchestrated by Temporal. Domain-agnostic event archive in ingestion_receipts — N domain pipelines select independently. V0 TypeScript adapters coexist during migration."
read_when: Working on source adapters, ingestion receipts, data collection, Singer taps, or adding new data sources.
owner: derekg1729
created: 2026-03-02
verified:
tags: [ingestion, infrastructure]
---

# Data Ingestion Pipelines: Singer Taps via Temporal

## Goal

Standardize data ingestion using Singer taps (MIT/Apache ecosystem) orchestrated by Temporal workflows. The event archive (`ingestion_receipts`) is domain-agnostic — attribution, treasury, knowledge, and any future pipeline each select what they need. No domain tag on receipts.

## Core Invariants

| Rule                    | Constraint                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SINGER_TAPS             | Singer (MIT/Apache licensed) taps as the connector standard. Large existing ecosystem for GitHub, Discord, Stripe, blockchain, etc.                            |
| DOMAIN_AGNOSTIC_ARCHIVE | `ingestion_receipts` has no domain column. Each domain pipeline (attribution, treasury, knowledge, future) selects independently from the shared archive.      |
| TEMPORAL_ORCHESTRATION  | Temporal workflows run Singer taps, manage retries, store state in Postgres. Contract: `tap → stdout JSON stream → map to IngestionReceipt`.                   |
| DETERMINISTIC_RECEIPTS  | Receipt IDs are deterministic from source data (e.g., `github:pr:owner/repo:42`). Provenance hashing (`payloadHash`), `producer`, `producerVersion` preserved. |
| COEXISTENCE             | V0 TypeScript `SourceAdapter` implementations coexist with Singer taps during migration. Both write to the same `ingestion_receipts` table.                    |
| CURSOR_PERSISTENCE      | Singer `state.json` persisted to Postgres via Temporal activity (same role as `ingestion_cursors` table for TS adapters).                                      |

## Design

Stub — to be fleshed out when implementation begins. See [data-ingestion-pipelines spec](../../docs/spec/data-ingestion-pipelines.md) migration path section for the transition plan.

## Non-Goals

- Meltano UI or managed platform (CLI + plain taps only)
- Connector platform lock-in (taps are standalone executables)
- Licensing-ambiguous connectors (stick to MIT/Apache)
- Replacing `ingestion_receipts` schema (Singer output maps to existing schema)

## Migration Path

1. Existing GitHub TS adapter remains until Singer `tap-github` equivalent is proven
2. New sources default to Singer taps
3. `SourceAdapter` interface becomes one possible mapper; Singer output mapper is another
4. Both write to `ingestion_receipts` — downstream pipelines don't know the difference

## Related

- [Attribution Ledger](./attribution-ledger.md) — primary consumer of ingestion receipts today
- [Financial Ledger](./financial-ledger.md) — treasury pipeline will also consume from the archive
- [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) — current ingestion implementation
