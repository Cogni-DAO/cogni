---
id: spike.0097
type: spike
title: "Research epoch event ingestion pipeline — SourceCred plugin patterns + OSS tooling"
status: done
priority: 1
estimate: 2
summary: "Survey SourceCred's plugin/graph/ledger architecture and OSS event ingestion tooling to design an epoch-based contribution ingestion pipeline that minimizes bespoke code."
outcome: "Research doc with SourceCred architecture analysis, OSS tool recommendations, and proposed pipeline design replacing both the over-engineered governance-data spec and the manual-only ledger spec."
spec_refs:
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-v0
pr:
reviewer:
created: 2026-02-21
updated: 2026-02-21
labels: [governance, transparency, research, ingestion]
external_refs: docs/research/epoch-event-ingestion-pipeline.md
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Research: Epoch Event Ingestion Pipeline

## Context

The existing specs are slightly misguided in opposite directions:

- **ai-governance-data.md**: Over-engineered CloudEvents → brief → agent pipeline with too many bespoke types
- **attribution-ledger.md**: Manual-only receipt issuance — no automated event ingestion

This spike surveys SourceCred's plugin architecture and OSS tooling to design a unified ingestion pipeline that feeds the epoch ledger with minimal bespoke code.

## Requirements

### Research questions

1. What SourceCred plugin/graph/ledger patterns can we adopt (design, not code)?
2. What OSS libraries handle GitHub/Discord event normalization?
3. How do we bridge automated event ingestion → the existing epoch ledger schema?
4. What's the minimal bespoke code needed?

## Allowed Changes

- New research doc in `docs/research/`
- New spike work item
- No code changes

## Plan

- [x] Deep-read SourceCred plugin architecture, graph model, ledger, credequate system
- [x] Survey OSS: CloudEvents SDK, Octokit, discord.js, Coordinape patterns, event sourcing libs
- [x] Audit existing cogni-template: billing, ledger schema, Temporal worker, governance ports
- [x] Write research doc with findings, recommendations, and proposed layout

## Validation

```bash
pnpm check:docs
```

## Attribution

- derekg1729
