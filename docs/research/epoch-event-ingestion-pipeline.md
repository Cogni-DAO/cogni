---
id: epoch-event-ingestion-research
type: research
title: "Research: Epoch Event Ingestion Pipeline — SourceCred Patterns + OSS Tooling"
status: active
trust: draft
summary: "Analysis of SourceCred's plugin architecture and OSS event ingestion tools to design an automated contribution pipeline feeding the epoch ledger, minimizing bespoke code."
read_when: Designing the contribution ingestion pipeline, choosing between automated vs manual receipt creation, or evaluating SourceCred replacement.
owner: derekg1729
created: 2026-02-21
verified: 2026-03-01
tags: [governance, transparency, ingestion, research]
---

# Research: Epoch Event Ingestion Pipeline

> spike: spike.0097 | date: 2026-02-21

## Question

How should we ingest contribution events (GitHub PRs, reviews, Discord activity) into the epoch ledger system? What can we reuse from SourceCred's plugin architecture and the OSS ecosystem to minimize bespoke code?

## Context

### The two misguided specs

**ai-governance-data.md** designs a complex CloudEvents → GovernanceBrief → LLM agent → EDO pipeline. It has 28 invariants, 6 ports, 4 tables, and 3 Temporal workflows — all before any contribution reaches a human reviewer. It's an autonomous governance agent system, not a contribution ingestion pipeline. The signal_events table, SignalWritePort, and SourceAdapter interface are useful patterns, but they're buried in an architecture whose primary purpose (LLM-generated governance briefs) is orthogonal to contribution tracking.

**attribution-ledger.md** is the opposite: an epoch-based attribution system with deterministic statements and strong schema invariants. It already implements the storage and workflow backbone, but it originally left automated event ingestion and claimant-aware pending attribution underspecified.

**The missing piece:** A plugin-based event ingestion layer that watches GitHub/Discord, normalizes events, and either (a) auto-creates draft receipts for human approval, or (b) feeds a contribution record that informs manual valuation decisions.

### What exists today

| Layer                             | Status                 | Location                                            |
| --------------------------------- | ---------------------- | --------------------------------------------------- |
| Ledger schema + statement storage | Done                   | `packages/db-schema/src/attribution.ts`             |
| Core attribution domain           | Done                   | `packages/attribution-ledger/src/`                  |
| Temporal worker infrastructure    | Done                   | `services/scheduler-worker/`                        |
| SourceCred instance (standalone)  | Running                | `infra/compose/sourcecred/`                         |
| Billing/credit system             | Done                   | `packages/db-schema/src/billing.ts`                 |
| Governance status API             | Done                   | `src/ports/governance-status.port.ts`               |
| Attribution APIs/routes           | Done                   | `src/app/api/v1/attribution/`                       |
| Claimant-aware read models        | Done                   | `src/app/_facades/attribution/`, `users/`           |
| Event ingestion pipeline          | Implemented for GitHub | `services/scheduler-worker/src/adapters/ingestion/` |

---

## Findings

### 1. SourceCred Architecture Analysis

SourceCred is a comprehensive contribution scoring system. Its architecture has several layers worth understanding:

#### Plugin Interface

```javascript
// SourceCred Plugin contract (simplified from src/api/plugin.js)
interface Plugin {
  declaration(): PluginDeclaration;  // node types, edge types, weights
  load(ctx, reporter): void;         // fetch + cache external data
  graph(ctx, refDetector): WeightedGraph;  // build contribution graph
  identities(ctx): IdentityProposal[];    // extract user identities
  contributions(ctx, config): ContributionsByTarget;  // structured contributions
}
```

Each plugin (GitHub, Discord, Discourse) fetches data from one system, caches it locally in SQLite, and produces a weighted graph of nodes (entities) and edges (relationships).

#### Graph Model

Nodes and edges use hierarchical addresses (`["sourcecred", "github", "pull", "owner/repo", "42"]`) enabling prefix-based filtering. The graph is append-only and supports dangling edges (partial data). Graphs from different plugins merge into a single weighted graph.

#### Credequate System (Contribution Scoring)

Contributions use recursive expression trees that compose operators (ADD, MULTIPLY, MAX) with configurable weights. Each contribution has typed participants with share allocations. Weights are configurable per key/subkey (e.g., per emoji type, per channel, per role).

#### Ledger

Append-only event log with Grain (18-decimal-precision tokens, like ERC-20). Distributions allocate grain to identities using policies (RECENT, BALANCED, IMMEDIATE). The ledger serializes as JSON and can be replayed from the event log.

#### What's Reusable (Design, Not Code)

SourceCred is Flow-typed JavaScript, unmaintained, and architecturally coupled to its internal graph/PageRank system. **No code can be directly imported.** But several design patterns are valuable:

| Pattern                                    | SourceCred                                          | Adoptable?                                           |
| ------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------- |
| Plugin interface (load → normalize → emit) | `Plugin.load()` + `Plugin.graph()`                  | Yes — adopt the contract, not the implementation     |
| Hierarchical entity addressing             | `NodeAddress.fromParts(["sc","github","pull",...])` | Maybe — simpler flat IDs may suffice                 |
| SQLite mirror for external data            | `better-sqlite3` cache per plugin                   | No — Postgres is our store; no need for SQLite       |
| Append-only ledger events                  | `Ledger._ledgerEventLog`                            | Already have — `receipt_events` table                |
| Configurable weight trees                  | `Expression` + `WeightConfig`                       | Premature — manual valuation is V0's explicit choice |
| Identity resolution across platforms       | `Identity` + `Alias`                                | Yes — maps to our `user_id` + wallet bindings        |

### 2. OSS Tool Survey

#### Event Envelope: CloudEvents SDK

**Package:** `cloudevents` (npm, 1.1M weekly downloads)

The CloudEvents v1.0 spec is a CNCF graduated project. The JS SDK provides TypeScript types, serialization, and HTTP protocol bindings. Using it as an envelope for contribution events is standards-compliant and eliminates the need for bespoke event schemas.

**Verdict:** Use. The ai-governance-data spec already chose CloudEvents — this is the right call. But use the official SDK rather than hand-rolling types.

#### GitHub: Octokit Ecosystem

| Package                   | Purpose                                       | Maturity                       |
| ------------------------- | --------------------------------------------- | ------------------------------ |
| `@octokit/webhooks`       | Webhook receiver with full TypeScript types   | Official, maintained by GitHub |
| `@octokit/webhooks-types` | Auto-generated types for all webhook payloads | Official                       |
| `@octokit/graphql`        | GraphQL client for historical backfill        | Official                       |
| `@octokit/rest`           | REST client (5k req/hr rate limit)            | Official                       |

**Key insight:** No library normalizes GitHub events into CloudEvents or contribution records. The mapping layer is bespoke but thin — it maps well-typed Octokit payloads to well-typed CloudEvents. This is ~200 lines per event type, not a framework.

**Historical backfill:** GraphQL is dramatically more efficient (1 request replaces ~11 REST calls). Use GraphQL for epoch initialization, webhooks for real-time.

#### Discord: discord.js

The only serious Discord library for Node.js. Fully typed, actively maintained. Historical message fetching is paginated (100 per call, rate-limited). No normalization layer exists.

**Verdict:** Use discord.js for data access. Write thin mappers to CloudEvents (~150 lines).

#### Coordinape: Design Reference

Coordinape's epoch model is the strongest design reference for our use case:

- Admins create time-bounded epochs (1–100 days)
- During epoch: members record contributions and allocate GIVE tokens
- At epoch end: GIVE allocation → percentage share → payout

This maps cleanly to our epoch ledger: contributions recorded during open epoch → epoch close → proportional payout. The key difference: Coordinape uses peer allocation (GIVE), we use human-assigned `valuation_units`.

#### Event Sourcing Libraries

| Library                   | Fit                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `@event-driven-io/emmett` | Lightweight, no framework lock-in. Could work but is overkill — we already have append-only tables |
| `@ocoda/event-sourcing`   | NestJS-specific. Wrong framework                                                                   |
| Plain Postgres tables     | What we already have. receipt_events IS event sourcing                                             |

**Verdict:** Don't add an ES library. Our `receipt_events` + `epoch_pool_components` tables already implement the append-only event pattern with DB trigger enforcement.

### 3. The Gap: What Needs to Be Built

The missing piece is a **thin adapter layer** between external systems and the epoch ledger:

```
GitHub webhooks ──→ ┌──────────────────────┐     ┌─────────────────┐
GitHub GraphQL  ──→ │  Source Adapters      │ ──→ │  Epoch Ledger   │
Discord events  ──→ │  (plugin-per-system)  │     │  (existing DB)  │
                    │  normalize → propose  │     │  receipts +     │
                    └──────────────────────┘     │  events         │
                                                  └─────────────────┘
```

Each source adapter:

1. **Fetches** events from one system (GitHub API, Discord bot, webhook)
2. **Normalizes** to a `ContributionEvent` (thin wrapper, not full CloudEvents for internal use)
3. **Proposes** a draft receipt or contribution record for human review

This is dramatically simpler than the ai-governance-data spec's 6-port, 4-table, 3-workflow design. It doesn't need:

- GovernanceBriefPort (no LLM agent in the ingestion path)
- SignalWritePort/SignalReadPort split (adapters write to the ledger, not a signal store)
- IncidentRouterWorkflow (no incident routing — just contribution recording)
- Budget-enforced briefs (no context window management)

### 4. Critical Design Decision: Where Events Land

Two approaches for what the adapters produce:

#### Option A: Auto-Draft Receipts (Recommended for V0)

Adapters create `work_receipts` with `valuation_units = 0` (unvalued) and a `proposed` event. A human reviewer then:

1. Reviews the draft receipt
2. Sets `valuation_units` based on judgment
3. Approves via `receipt_events`

**Pros:** Uses existing schema. Human valuation preserved. Simple.
**Cons:** Requires UI to review/value drafts (P1 dependency). High volume for active repos.

#### Option B: Contribution Log → Manual Receipt

Adapters write to a lightweight `contribution_events` table (not the ledger). Human reviewers browse contributions and manually create receipts for work they want to value.

**Pros:** Keeps ledger clean. No unvalued receipts.
**Cons:** Extra table. Two-step process. Easy to miss contributions.

#### Option C: Hybrid — Event Feed + Receipt Templates

Adapters write contribution events to a feed table. The system generates receipt templates (pre-filled `work_item_id`, `artifact_ref`, `role`) that an approver can sign with one click after setting `valuation_units`.

**Pros:** Low friction for approvers. No noise in ledger. Best of both worlds.
**Cons:** Slightly more complex than A.

**Recommendation:** Start with **Option A** (auto-draft receipts, `valuation_units = 0`). It uses the existing schema unchanged, exercises the full receipt lifecycle immediately, and defers the contribution feed UI to P1. The `receipt_events` table already supports the `proposed → approved` flow.

### 5. Proposed Adapter Interface

Borrowing SourceCred's plugin contract, simplified for our needs:

```typescript
// packages/ingestion-adapters/src/types.ts

interface SourceAdapter {
  readonly source: string; // "github", "discord"
  readonly version: string; // bump on schema changes

  streams(): StreamDefinition[]; // what event types this adapter produces

  /** Fetch new events since cursor. Replay-safe. */
  collect(
    streamId: string,
    cursor: StreamCursor | null
  ): Promise<{ events: DraftReceipt[]; nextCursor: StreamCursor }>;

  /** Handle webhook push (optional). */
  handleWebhook?(payload: unknown): Promise<DraftReceipt[]>;
}

interface DraftReceipt {
  epochId: number;
  userId: string; // resolved from platform identity
  workItemId: string; // e.g., "github:pr:owner/repo:42"
  artifactRef: string; // PR URL, commit SHA
  role: "author" | "reviewer" | "approver";
  valuationUnits: 0n; // always 0 — human sets this
  rationaleRef: string; // link to PR/review/message
  idempotencyKey: string; // deterministic: prevents duplicates
}

interface StreamDefinition {
  id: string; // "pull_requests", "reviews", "messages"
  name: string;
  cursorType: "timestamp" | "token";
  defaultPollInterval: number; // seconds
}

interface StreamCursor {
  streamId: string;
  value: string;
  retrievedAt: Date;
}
```

This is ~40 lines of types. The ai-governance-data spec's equivalent (SignalEvent + SignalWritePort + SignalReadPort + SourceAdapter + StreamDefinition + StreamCursor + IngestResult) is ~120 lines of types for the same functionality, plus 4 tables that duplicate what the ledger already has.

### 6. What We Keep from ai-governance-data.md

The governance-data spec is valuable for a different use case (autonomous governance agents monitoring infrastructure). For contribution ingestion specifically, we keep:

| Keep                                       | Why                         |
| ------------------------------------------ | --------------------------- |
| SourceAdapter interface pattern            | Clean plugin contract       |
| Cursor-based collection with replay safety | Reliable incremental sync   |
| Temporal Schedules for polling             | Already in scheduler-worker |
| Webhook fast-path for real-time            | Low-latency for PRs/alerts  |
| Idempotent event IDs                       | Prevents duplicates         |

| Don't need for contribution ingestion                          |
| -------------------------------------------------------------- |
| signal_events table (use existing work_receipts)               |
| GovernanceBriefPort (no LLM agent)                             |
| IncidentRouterWorkflow (no incident routing)                   |
| GovernanceEdoPort (no decision-outcome tracking for ingestion) |
| Budget-enforced briefs (no context management)                 |
| WorkItemPort (Plane integration — separate concern)            |

### 7. Identity Resolution

SourceCred solves cross-platform identity via `Identity` + `Alias`. We need the same:

- GitHub user → cogni `user_id`
- Discord member → cogni `user_id`
- Wallet address → cogni `user_id` (already exists via SIWE)

The existing `user_identity_bindings` schema (from proj.decentralized-identity / task.0089) handles this. Each binding maps a platform identity (`github:username`, `discord:snowflake`) to a `user_id`. Adapters look up bindings to resolve `userId` on draft receipts.

**Unknown contributors:** If a GitHub actor has a stable external identity (for GitHub, numeric `databaseId`), the adapter should ingest the receipt and preserve that identity as an unresolved claimant until the user links. Only actors without a stable external identifier should be skipped.

---

## Recommendation

### Don't build the ai-governance-data pipeline for contribution ingestion

The signal → brief → agent → EDO pipeline is designed for a different problem (autonomous monitoring and governance decisions). It's valuable infrastructure for P2+ governance agents, but it's massive overkill for "watch GitHub and propose receipts."

### Do build a thin adapter layer on top of the existing ledger

The epoch ledger schema is already done and well-designed. Build source adapters that:

1. Poll GitHub/Discord APIs (or receive webhooks) on Temporal Schedules
2. Normalize events to draft receipts using `@octokit/webhooks-types` and `discord.js` types
3. Insert draft receipts with `valuation_units = 0` via the existing ledger port (task.0094)
4. Human approvers review, value, and approve via the ledger API (task.0096)

### OSS stack

| Layer         | Tool                                     | Bespoke code needed              |
| ------------- | ---------------------------------------- | -------------------------------- |
| Event types   | `@octokit/webhooks-types`                | Zero (auto-generated types)      |
| GitHub API    | `@octokit/graphql` + `@octokit/webhooks` | ~200 lines per event type mapper |
| Discord API   | `discord.js`                             | ~150 lines per event type mapper |
| Orchestration | Temporal (existing)                      | ~1 workflow + 3 activities       |
| Schema        | Existing ledger tables                   | Zero new tables for V0           |
| Identity      | User identity bindings (task.0089)       | Binding lookup in adapters       |

### Total bespoke code estimate

- Adapter interface types: ~40 lines
- GitHub adapter (PRs + reviews): ~400 lines
- Discord adapter (messages): ~300 lines
- Temporal collection workflow: ~100 lines
- Temporal activities (fetch, ingest, cursor): ~200 lines
- Webhook handler (GitHub): ~100 lines
- **Total: ~1,100 lines** vs the governance-data spec's estimated ~3,000+ lines for equivalent functionality

---

## Open Questions

1. **Which GitHub events are P0?** PR merged is obvious. Reviews? Issue close? Commit authorship? Recommend: start with PR merge + review submit only.

2. **Discord: what counts as a contribution?** Messages in specific channels? Reactions? Thread participation? Recommend: defer Discord to P1 — start with GitHub only.

3. **Unresolved identities:** What happens when a GitHub user has no cogni account? Current implementation ingests the receipt when a stable external identity exists, then carries it forward as claimant-aware pending attribution. Recommendation: keep this behavior; do not require known `user_id` at ingestion time.

4. **Backfill strategy:** Should opening an epoch trigger a historical backfill of recent activity? Or is it purely forward-looking from the webhook/poll cursor? Recommend: forward-looking only for V0; backfill as opt-in P1 feature.

5. **What about the governance-data spec?** It's valuable for autonomous governance agents (P2+). Don't delete it — but don't implement it as the contribution ingestion pipeline. The signal_events table and agent workflow may be built separately when the governance agent work starts.

6. **Adapter packaging:** Should adapters live in `packages/ingestion-adapters/` or `src/adapters/server/ingestion/`? If they're used only by the Temporal worker, they could live in `services/scheduler-worker/src/adapters/`. Recommend: start in `services/scheduler-worker/src/adapters/ingestion/` (co-located with the only consumer).

---

## Proposed Layout

### Project Impact

No new project needed. This extends **proj.transparent-credit-payouts** as a P1 deliverable ("Automated issuance hooks" is already listed in the Walk phase).

### Spec Updates

1. **attribution-ledger.md** — Add a section on automated receipt ingestion via source adapters. Define the adapter interface. Document unresolved identities as preserved claimants, not skipped receipts.

2. **ai-governance-data.md** — Add a note clarifying that this spec is for autonomous governance agents, not contribution ingestion. Cross-reference the attribution-ledger spec for the contribution pipeline.

### Likely Tasks (P1, after ledger APIs ship)

| Task                                            | Description                                                                                                         | Est |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --- |
| `task.TBD` — GitHub adapter (PR merge + review) | Source adapter for GitHub webhooks + GraphQL backfill. Uses `@octokit/webhooks-types`. Creates draft receipts.      | 2   |
| `task.TBD` — Ingestion Temporal workflow        | `CollectSourceStreamWorkflow` + activities. Cursor management. Runs on scheduler-worker.                            | 2   |
| `task.TBD` — Webhook receiver route             | `POST /api/internal/webhooks/github` — receives GitHub webhooks, normalizes, ingests. Immediate path for PR events. | 1   |
| `task.TBD` — Identity binding lookup            | Adapter utility to resolve `github:username` → `user_id` via user_identity_bindings table.                          | 1   |
| `task.TBD` — Discord adapter (P1+)              | Source adapter for Discord messages in governance channels. Requires discord.js bot.                                | 2   |

**Sequence:** Identity bindings (task.0089) → Ledger APIs (task.0094–0096) → GitHub adapter → Ingestion workflow → Webhook receiver → Discord adapter

### What NOT to build

- No `signal_events` table (use `work_receipts` directly)
- No GovernanceBriefPort (no LLM in ingestion path)
- No IncidentRouterWorkflow (no incident concept for contributions)
- No full CloudEvents SDK integration (adapters map directly to DraftReceipt, not CloudEvent envelopes — internal events don't need CloudEvents overhead)
- No SourceCred graph/PageRank computation (manual valuation is the design choice)
- No weight configuration system (premature for V0/V1)

---

## Related

- [attribution-ledger spec](../spec/attribution-ledger.md) — V0 attribution schema and invariants
- [ai-governance-data spec](../spec/ai-governance-data.md) — Autonomous governance agent pipeline (separate concern)
- [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) — Project roadmap
- [transparency-log-receipt-design](./transparency-log-receipt-design.md) — Original spike.0082 research
- [spike.0097](../../work/items/spike.0097.epoch-event-ingestion-pipeline.md) — This spike's work item
