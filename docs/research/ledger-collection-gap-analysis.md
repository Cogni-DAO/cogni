---
id: ledger-collection-gap-analysis
type: research
title: "Gap Analysis: Epoch Ledger Collection Pipeline vs. SourceCred"
status: active
trust: draft
summary: "Critical comparison of Cogni's windowed epoch collection model against SourceCred's full-history mirror. Identifies blindspots in data breadth, failure recovery, unresolved identity handling, and collection completeness."
read_when: Planning ledger collection improvements, evaluating activity coverage, debugging missing contributor payouts, or designing backfill/webhook support.
owner: derekg1729
created: 2026-02-24
verified: 2026-02-24
tags: [governance, transparency, ingestion, research, gap-analysis]
---

# Gap Analysis: Epoch Ledger Collection Pipeline vs. SourceCred

> date: 2026-02-24 | project: proj.transparent-credit-payouts

## Question

What are the structural blindspots in our epoch-windowed data collection pipeline compared to SourceCred's full-history model, and which gaps must be fixed before the first real payout?

## Context

### What Cogni has built (as of 2026-02-24)

- **Schema**: 8 tables across a 3-layer immutability model (`activity_events` → `activity_curation` → `epoch_allocations` / `payout_statements`)
- **GitHub adapter**: Collects `pr_merged`, `review_submitted`, `issue_closed` via `@octokit/graphql`
- **Temporal workflow**: `CollectEpochWorkflow` runs per-epoch, fetches activity within `[periodStart, periodEnd]`, curates, resolves identities, computes allocations
- **Cursor state**: `source_cursors` table tracks incremental progress within a collection run
- **Dev seed**: 3 epochs (2 finalized, 1 open) with realistic data for UI testing
- **Discord adapter**: Specced but not implemented

### What SourceCred does

SourceCred maintains a **persistent local SQLite mirror** per plugin (GitHub, Discord, Discourse). On each run:

1. **Incrementally updates** the mirror (TTL-based for GitHub, cursor-based for Discord)
2. **Rebuilds the full contribution graph** from the complete cached dataset
3. Runs PageRank/Credequate scoring across the **entire project history**

Key architectural properties:

- **Full-history retention**: Every PR, comment, reaction, and message ever seen is stored in the mirror
- **Incremental fetch, full graph rebuild**: API calls are incremental, but scoring always operates on complete state
- **Identity proposals**: Plugins propose identities; unresolved contributors still accumulate cred claimable later
- **Rich event types**: PRs, issues, comments, reactions, commits, reviews, mentions — full GitHub/Discord entity model

---

## Findings

### 1. The Fundamental Architectural Difference

| Property                    | SourceCred                                         | Cogni Epoch Ledger                                         |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| **Collection scope**        | Full project history, incrementally updated        | Single epoch window (`periodStart` → `periodEnd`)          |
| **Data retention**          | Full API mirror in SQLite                          | Normalized `activity_events` rows; raw responses discarded |
| **Graph model**             | Rich node/edge graph with PageRank                 | Flat event list, no inter-contribution relationships       |
| **Cross-epoch continuity**  | Built-in (full history)                            | None — each epoch is an island                             |
| **Unresolved contributors** | Accumulate cred, claimable later                   | Silently excluded from allocations                         |
| **Platform breadth**        | GitHub, Discord, Discourse (3 plugins)             | GitHub only (3 event types)                                |
| **Activity depth**          | PRs, issues, comments, reactions, commits, reviews | Merged PRs, submitted reviews, closed issues               |
| **Failure recovery**        | Next mirror update catches up                      | Missed events permanently lost after finalize              |
| **Maintenance burden**      | High (project abandoned)                           | Lower but scales linearly per source                       |

The windowed model is a deliberate, defensible design choice — it's simpler, auditable, and avoids SourceCred's opacity problem. But it introduces specific blindspots.

### 2. Blindspots in the Windowed Collection Model

#### 2a. Cross-window contributions are misattributed (Severity: Medium)

A PR opened in epoch N, merged in epoch N+1: the author gets credit in N+1, not when they actually wrote the code. The `pr_merged` event timestamp is `mergedAt`, not `createdAt`.

For weekly epochs this mostly works (most PRs don't span 2+ weeks). For larger PRs or slow review cycles, credit attribution shifts temporally.

**Impact**: Contributors who write code early in a cycle and merge late feel undervalued in the epoch they worked. Low urgency for weekly cadence, higher for longer epochs.

#### 2b. No retroactive discovery after finalization (Severity: High)

If the collector misses events during a window (API outage, rate limit exhaustion, misconfigured scope, Temporal worker down), those events are **permanently lost** once the epoch finalizes. There is no backfill mechanism.

The spec says "verification = recompute from stored data" — but this only verifies math correctness on _collected_ data. It cannot detect collection incompleteness.

SourceCred's mirror model means a missed event gets picked up on the next successful run.

**Impact**: Silent, undetectable data loss. No way for a contributor to appeal "my PR was merged but didn't appear in the epoch."

#### 2c. Narrow activity type coverage (Severity: High)

The GitHub adapter collects exactly 3 event types:

| Collected          | Missing                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `pr_merged`        | **PR comments / review comments** (detailed code review feedback)   |
| `review_submitted` | **Commits** (direct pushes, hotfixes)                               |
| `issue_closed`     | **Issue creation / triage** (filing good bugs)                      |
|                    | **PR opened** (WIP invisible until merge)                           |
|                    | **CI/release work** (infrastructure contributions)                  |
|                    | **Review iterations** (3 rounds of feedback = same as rubber-stamp) |

SourceCred captures all of these via its graph model — nodes for commits, comments, reactions, issues, with edges weighted by relationship type.

**Impact**: Anyone doing review-heavy, triage-heavy, or documentation work is systematically undervalued by the _data collection layer_ regardless of how valuation weights are configured. The collection layer predetermines the ceiling of what the valuation layer can recognize.

#### 2d. Unresolved identities silently excluded (Severity: High)

The pipeline requires `user_bindings` to map `platform_user_id → user_id`. When a contributor hasn't linked their account:

1. Their `activity_events` are ingested (the raw data exists)
2. Their `activity_curation` row gets `user_id = NULL`
3. They are **excluded from allocations entirely** — `getCuratedEventsForAllocation` requires resolved `user_id`

No notification, no pending credit, no visibility in the UI. A new contributor doing real work who hasn't completed account-linking gets zero credit, silently.

SourceCred handles this via `IdentityProposal` — plugins propose identities, and unresolved contributors still accumulate cred claimable later.

**Impact**: The single biggest operational blindspot for a small DAO onboarding new contributors. First-time contributors will be confused when their work doesn't appear in payouts.

#### 2e. No collection completeness verification (Severity: Medium)

There is no mechanism to compare "what we collected" against "what GitHub says exists in this window." The system trusts that the adapter's GraphQL queries returned everything, but:

- Rate limit exhaustion could truncate results
- API errors during pagination could drop pages
- `maxEventsPerCall` limit could cap collection

**Impact**: Under-collection is indistinguishable from a quiet week.

### 3. Bespokeness Risks

#### 3a. Linear scaling cost per platform

Each new source requires ~500+ lines of bespoke code: GraphQL queries, event normalizer, cursor model, rate limit handling, bot filtering. This is the same maintenance trap that contributed to SourceCred's abandonment.

**Mitigation already designed**: The `handleWebhook()` path (P1) would flip to push-based for GitHub, reducing the polling/cursor/pagination complexity to a backfill-only concern.

#### 3b. No raw data retention

`activity_events` stores normalized events but discards raw API responses. The `payload_hash` enables tamper detection on what _was_ collected, but can't prove collection completeness or enable re-normalization if the adapter logic changes.

**Impact**: If the normalization logic has a bug (e.g., wrong `eventTime` extraction), historical data cannot be corrected without re-fetching from the source API.

---

## Recommended Work Items

### P0 — Fix before first real payout

| ID        | Type | Title                                                                | Rationale                                                                                                                                           |
| --------- | ---- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| bug.0092  | bug  | Unresolved contributors silently excluded from epoch allocations     | Contributors without `user_bindings` get zero credit with no visibility. Must surface unresolved contributors in UI and block/warn on finalization. |
| task.0108 | task | Collection completeness verification for epoch ingestion             | Compare collected event counts against GitHub API totals before closing ingestion. Detect under-collection from rate limits or API failures.        |
| task.0109 | task | Expand GitHub adapter — PR comments, review comments, issue creation | 3 event types is too narrow. Review comments and issue creation are high-signal missing activity types using the same GraphQL infrastructure.       |

### P1 — Before scaling beyond founding team

| ID        | Type | Title                                     | Rationale                                                                                                                                                   |
| --------- | ---- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| task.0110 | task | Retroactive backfill for finalized epochs | Allow reopening a finalized epoch's collection (not allocations) to ingest missed events with audit trail. Fixes permanent data loss on collection failure. |
| task.0111 | task | Pending credit for unresolved identities  | Store provisional allocations that activate when user links account, rather than losing the data.                                                           |
| task.0112 | task | Webhook-first GitHub collection           | Flip to webhooks as primary, polling as verification/backfill. Eliminates window-boundary misattribution for real-time events.                              |

---

## Open Questions

1. **Should collection completeness block finalization or just warn?** Blocking is safer but could delay payouts if the GitHub API is flaky. Recommendation: warn with a diff count; block only if discrepancy > 10%.

2. **How should cross-window PRs be handled?** Options: (a) credit at merge time (current), (b) split credit across epochs proportional to time spent, (c) credit at creation time. Current approach is simplest and defensible for weekly cadence.

3. **Should we retain raw API responses?** Storage cost vs. auditability tradeoff. Could store in a separate `raw_events` JSONB table or S3-equivalent, not in the hot path.

4. **What's the right threshold for unresolved contributor warnings?** Any unresolved contributor with > 0 events in the epoch should trigger visibility. Finalization block threshold TBD.

---

## Related

- [Epoch Ledger Spec](../spec/epoch-ledger.md) — Authoritative spec (18 invariants)
- [Epoch Event Ingestion Pipeline Research](./epoch-event-ingestion-pipeline.md) — Original SourceCred analysis + adapter design
- [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) — Project roadmap
- [task.0094](../../work/items/task.0094.ledger-port-adapter.md) — Store interface + adapter (done)
- [task.0097](../../work/items/task.0097.ledger-source-adapters.md) — GitHub adapter (done)
- SourceCred GitHub plugin: `/Users/derek/dev/sourcecred/packages/sourcecred/src/plugins/github/`
- SourceCred Discord mirror: `/Users/derek/dev/sourcecred/packages/sourcecred/src/plugins/discord/mirror.js`
