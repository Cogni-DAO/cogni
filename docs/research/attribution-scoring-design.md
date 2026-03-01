---
id: attribution-scoring-design
type: research
title: "Design: Attribution Scoring — Thin Ingestion, LLM Evaluation, and Retrospective Value"
status: active
trust: draft
summary: "Design reasoning for the attribution scoring model: thin receipt ingestion, LLM-powered contextual evaluation, versioned immutable ledger entries, and the unsolved problem of retrospective value reassessment."
read_when: Designing evaluation enrichers, planning rebalancing mechanisms, reasoning about attribution algorithm versioning, or understanding why SourceCred failed and how this system improves on it.
owner: cogni-dev
created: 2026-02-28
verified: null
tags: [governance, attribution, scoring, design]
---

# Attribution Scoring Design

> Receipts are thin pointers. Evaluation is where intelligence lives. The ledger is a journal of best attempts, not a database to update in place. Value reveals itself over time — no algorithm can know true impact at event time.

## Why SourceCred Failed (And What We're Actually Fixing)

SourceCred is being superseded ([sourcecred.md](../spec/sourcecred.md),
[sourcecred-config-rationale.md](../spec/sourcecred-config-rationale.md)). Understanding
*why* it failed is essential to not repeating the same mistakes.

**SourceCred's failure was content-blindness.** PageRank sees graph structure — nodes,
edges, weights — but cannot look inside a PR and assess its actual value. A typo fix
and a security overhaul both produce the same graph edge: `user → AUTHORED → pull_request`.
The flat weight (`PULL: 10`) is identical for both.

Gaming was trivial because users could optimize for graph structure: open more issues,
comment more, self-reference. The algorithm literally could not distinguish valuable work
from worthless work. The problem was NOT the two-concept model (Cred + Grain), and NOT
that Cred was cumulative. It was that the scoring mechanism was deterministic, static,
and blind to content.

SourceCred's BALANCED allocation policy (see `sourcecred-config-rationale.md:42`) was
designed to correct historical underpayment: "Early risk-takers keep upside — BALANCED
ensures contributors who did a lot of work early but were underpaid still get pulled
upward over time." This worked by comparing cumulative cred-share to cumulative grain-share
every distribution. The concept was sound — the scoring that fed it was broken.

**What LLM evaluation fixes:** An evaluator that reads the actual PR diff, examines
codebase context, and reasons about value is fundamentally harder to game than a static
weight applied to an event type. This is the core improvement — not eliminating
cumulative scoring, but making the scoring mechanism content-aware.

**What LLM evaluation does NOT fix:** Value is retrospective. A PR that restructures
the auth module looks like moderate work today. Six months later, when three major
features build on that foundation, it turns out to be the most important contribution
of the year. No algorithm — not PageRank, not an LLM — can know true impact at event
time. We fully expect our understanding of what was valuable will evolve over time, and
we are designing for that evolution. See [Retrospective Value](#retrospective-value)
below.

---

## Core Philosophy

We are building an accounting journal, not a scoring engine.

Every epoch produces a signed, immutable statement: "given what we knew and the tools
we had at the time, here is how we valued contributions." That statement is a permanent
fact — even if future understanding reveals it was imperfect.

Four principles follow:

1. **Ingestion is thin.** A receipt is a reference to an event: who, what, when, where.
   It does not try to capture everything about the event. It captures enough to find it
   again later.

2. **Evaluation is rich.** The evaluator fetches additional context on-demand — reads
   the actual PR diff, examines the codebase at that point in time, uses an LLM to
   reason about value. The evaluation snapshots everything it consumed, so the scoring
   is reproducible from the evaluation payload alone.

3. **Algorithms are versioned and frozen.** `cogni.ai_scores.v0` is a permanent label.
   When a better model or better prompt exists, that becomes `v1` — it does not retroactively
   replace `v0`. Old epochs keep their original scores. New epochs use new algorithms.
   Corrections flow forward as rebalancing entries, never as rewrites.

4. **Value is retrospective.** We credit work when it happens, but we fully expect that
   our initial scoring is a primitive estimate. We are collecting data over time, and we
   will evolve to see which contributions were truly the most impactful. The system must
   support systematic periodic reassessment — not as an edge case, but as a core design
   assumption.

We are explicitly admitting that today we don't know how to fairly score everything.
The ledger captures our best attempt at each point in time. Future algorithms with
more context and data can review the historical record and issue corrections — but those
corrections are new signed entries, not edits to old ones.

---

## Design

### Layer 1: Thin Ingestion (existing — no changes)

The GitHub adapter collects lightweight event references:

```
Receipt: {
  id:              "github:pr:org/repo:42"      ← deterministic
  source:          "github"
  eventType:       "pr_merged"
  platformUserId:  "12345"                       ← stable numeric ID
  artifactUrl:     "https://github.com/org/repo/pull/42"
  metadata:        { title, additions, deletions, changedFiles, labels }
  payloadHash:     "sha256:..."
  eventTime:       "2026-02-15T..."
}
```

This is deliberately minimal. The receipt says "PR #42 was merged by user 12345 at
time T." It does not capture the full diff, the file list, the dependency graph, or the
codebase context. Those are the evaluator's job.

**Why thin?** GitHub's GraphQL API is flaky for deep pagination and complex nested queries.
Asking for 100 files per PR across hundreds of PRs within a single paginated connection
is fragile. The adapter's job is to reliably capture event references — a task that
requires only basic PR metadata and is robust against API instability.

The receipt's `artifactUrl` is the hook. Given a URL, the evaluator can fetch whatever
depth of context it needs using the most appropriate tool (REST API for a single PR's
files, git clone for full codebase context, etc.).

### Layer 2: LLM-Powered Evaluation (new enricher — fits existing contract)

This is the intelligence layer. For each epoch's selected receipts, the evaluator:

1. **Reads the receipt references** — gets the list of events to score
2. **Fetches context per event** — for a PR, this means:
   - Fetch the full diff via REST (`GET /repos/{owner}/{repo}/pulls/{n}/files`)
   - Fetch PR conversation/review comments if relevant
   - Optionally: checkout the repo at the merge commit for broader codebase context
3. **Scores with an LLM** — given the event data and codebase context, the LLM
   produces a score and reasoning for each event
4. **Snapshots everything** — the evaluation payload contains all inputs and outputs,
   making the scoring reproducible from the payload alone (ENRICHER_SNAPSHOT_RULE)

The evaluator sees **all receipts in the epoch together**, not each one in isolation.
This enables relative scoring: "PR #42 restructured the auth module (high impact);
PR #43 fixed a typo in a comment (low impact)" — the scores reflect relative value
within the epoch's activity set.

#### Evaluation contract (fits existing `epoch_evaluations` table)

```
evaluation_ref:  "cogni.ai_scores.v0"
algo_ref:        "llm-contextual-v0"
status:          "draft" | "locked"
inputs_hash:     sha256(sorted receipt IDs + context snapshot hash)
payload_hash:    sha256(canonical payload)
payload_json:    {
  modelId:          "claude-sonnet-4-6",
  promptVersion:    "scoring-v0.3",
  repoCommitSha:    "abc123def",
  scoredAt:         "2026-02-28T...",
  perReceiptScores: {
    "github:pr:org/repo:42": {
      score:      8500,              // milli-units, integer
      reasoning:  "Restructured auth module...",
      context:    { filesChanged: [...], modulesTouched: [...] }
    },
    "github:pr:org/repo:43": {
      score:      200,
      reasoning:  "Typo fix in comment...",
      context:    { filesChanged: [...] }
    }
  }
}
```

**Key design decisions:**

- **Scores are integers (milli-units).** ALL_MATH_BIGINT holds. No floats.
- **Model and prompt version are recorded in the payload.** Anyone can see exactly
  what produced the score. But we do NOT re-run when models update — the locked
  evaluation is a permanent fact.
- **Repo commit SHA is pinned.** The evaluator scored against a specific codebase
  snapshot. This makes the context reproducible.
- **Reasoning is included.** The LLM explains its score. This is essential for
  auditability — humans reviewing the epoch can read the reasoning and override
  via the selection layer (`weight_override_milli`) if they disagree.
- **LLM non-determinism vs ENRICHER_IDEMPOTENT.** The attribution-ledger spec
  establishes ENRICHER_IDEMPOTENT: "same receipts → same payload." LLMs are
  non-deterministic — even with `temperature=0`, outputs vary across calls.
  This enricher relies on the draft→locked lifecycle for consistency: a draft
  evaluation may be overwritten, but once locked it is immutable. The invariant
  should be relaxed to "same receipts → same payload *within a single evaluation
  run*" or `cogni.ai_scores.*` enrichers should be explicitly exempted. To be
  resolved in the spec phase.

#### Generalizes beyond GitHub

The same pattern works for any source:

| Source  | Receipt captures           | Evaluator fetches                          |
| ------- | -------------------------- | ------------------------------------------ |
| GitHub  | PR merged, URL             | Full diff, codebase context, review thread |
| Discord | Message sent, channel, URL | Message content, thread context            |
| Issues  | Issue closed, URL          | Issue body, linked PRs, discussion         |

The receipt is always thin. The evaluator always fetches rich context. The scoring
always happens in context of the full epoch's activity set.

### Layer 3: Evaluation-Aware Allocation (new algo — fits existing dispatch)

Current V0 (`weight-sum-v0`) uses flat per-event-type weights and ignores evaluations
entirely. The new allocation algorithm consumes evaluation scores:

```typescript
// New case in computeProposedAllocations dispatch
case "eval-scored-v0":
  return evalScoredV0(events, evaluations);
```

The algorithm reads the locked `cogni.ai_scores.v0` evaluation for the epoch, looks up
each receipt's score from `perReceiptScores`, and uses that as the weight instead of
a flat config value. Admin overrides (`weight_override_milli`) still take precedence
(ALLOCATION_PRESERVES_OVERRIDES).

**Input broadening:** `computeProposedAllocations` currently takes
`(algoRef, events, weightConfig)`. For `eval-scored-v0`, it also needs the evaluation
payload. Options:

- **(a)** Add optional `evaluations` parameter to the existing function
- **(b)** Use a context object: `{ events, weightConfig, evaluations? }`

Option (b) is cleaner — it avoids growing the parameter list as future algorithms
need different inputs:

```typescript
interface AllocationContext {
  events: readonly SelectedReceiptForAllocation[];
  weightConfig: Record<string, number>;
  evaluations?: readonly AttributionEvaluation[];
}

function computeProposedAllocations(
  algoRef: string,
  ctx: AllocationContext
): ProposedAllocation[]
```

This is a minor refactor to the existing function signature. The `weight-sum-v0` path
ignores `evaluations` and behaves identically.

---

## Retrospective Value: The Core Unsolved Problem

### The problem (deeper than algorithm versioning)

The original framing of this section was about algorithm upgrades: v0 used flat weights,
v1 uses LLM scoring, so re-evaluate old epochs with the better algorithm. That framing
is too narrow.

The real problem is that **value is retrospective.** When a PR is merged, we have a
primitive idea of its importance. Over time, as the system evolves, we collect data that
reveals true impact:

- A PR that restructured the auth module looked like moderate work. Six months later,
  three major features built on that foundation. It was the most important contribution
  of the year.
- A PR that added a feature looked impressive. It was reverted two weeks later because
  the approach was wrong. Its true value was near zero.
- A contributor who wrote foundational infrastructure during a quiet period was scored
  the same as someone fixing typos. The infrastructure became critical.

We fully expect this. We are designing a system that credits work when it happens, but
treats initial scores as provisional estimates that will be refined as understanding
evolves. Periodic reassessment is not an edge case — it is a **core design assumption**.

### What SourceCred got right here

SourceCred's BALANCED allocation policy addressed this problem continuously. Every
distribution, it compared cumulative cred-share to cumulative grain-share and corrected
underpayment automatically. The mechanism was sound. What was broken was the scoring
that fed it — PageRank couldn't see content, so BALANCED was faithfully correcting
toward a wrong target.

### What the initial rebalancing design got wrong

The original design proposed rebalancing via full LLM re-evaluation of historical
receipts. This has a fatal cost problem:

- Epoch 1-15: scored with flat `weight-sum-v0`
- Quarter 1 rebalance: re-evaluate epochs 1-15 with LLM → cost proportional to 15 epochs
- Quarter 2 rebalance: re-evaluate epochs 1-30 → cost proportional to 30 epochs
- Quarter N: cost proportional to ALL historical receipts, every quarter

This is `O(total_receipts × number_of_rebalances)`. LLM evaluation cost grows linearly
with history, forever. Worse, LLMs are non-deterministic — re-evaluating the same
receipt twice produces different scores, so each rebalance potentially contradicts
the previous one.

**This approach does not scale. It is error-prone. It is rejected.**

### The principle (unchanged)

**Finalized epochs are sealed journal entries.** You don't reopen them. You don't
unsign them. You don't re-score their receipts. The v0 statement for epoch 12 is a
permanent fact: "in February 2026, using weight-sum-v0, we valued Alice at 3000
and Bob at 2000."

Corrections go forward. A new entry in the journal says: "having re-analyzed epochs
1-15, we believe Alice was underpaid by 500 and Bob was overpaid by 300. Here is a
correction allocation." This is standard journal accounting: you never erase entries,
you post adjustments.

### What we need (not yet designed)

A retrospective reassessment mechanism that:

1. **Is systematic** — runs on a regular cadence (e.g., quarterly), not ad-hoc
   governance-triggered
2. **Does not require re-evaluating every historical receipt** — cost must be bounded,
   not proportional to total history
3. **Leverages accumulated data** — uses signals that emerge over time (downstream
   impact, code survival, feature dependencies) rather than re-running the same
   evaluation with a better model
4. **Produces correction epochs** — fits the journal accounting model, same lifecycle
   (open → review → finalized), same signing flow

**Possible approaches (requires spike):**

- **Downstream impact signals**: Track cheap proxy signals for retrospective value —
  did this code survive? Was it built on? Was it reverted? How many downstream changes
  depended on it? These signals accumulate passively and don't require LLM re-evaluation
  of old receipts.
- **Decay window**: Only reassess the last N epochs (e.g., 2 quarters). Older epochs
  are "settled" and accepted as-is. Bounds cost at the expense of accuracy for old work.
- **Sampling**: Reassess a statistical sample of old receipts, not all of them.
  Extrapolate corrections to the population.
- **Tiered evaluation**: Cheap automated pass identifies receipts that may be
  significantly mis-scored (based on impact signals). Expensive LLM evaluation only
  runs on the flagged subset.
- **User-level correction without per-receipt re-scoring**: Compare total allocations
  per user against a fairness metric derived from recent (well-scored) epochs. Apply
  corrections at the user level. Avoids per-receipt cost but assumes recent behavior
  predicts historical behavior.

**None of these are designed yet.** This is the most important open problem in the
attribution system. A dedicated research spike should evaluate these approaches before
the rebalance epoch mechanism is spec'd.

### The rebalance epoch vehicle (solid, mechanism TBD)

The mechanism for delivering corrections — rebalance epochs — is sound regardless of
which reassessment approach we choose. A rebalance epoch is an epoch whose inputs are
reassessment results rather than fresh activity. It goes through the same lifecycle
(open → review → finalized) and produces the same outputs (signed statement).

```
Activity Epoch (existing):
  receipts from source adapters → evaluation → allocation → statement

Rebalance Epoch (new):
  reassessment results → evaluation → delta allocation → statement
```

#### Schema change: one column

```sql
ALTER TABLE epochs ADD COLUMN epoch_kind TEXT NOT NULL DEFAULT 'activity';
ALTER TABLE epochs ADD CONSTRAINT epochs_kind_check
  CHECK (epoch_kind IN ('activity', 'rebalance'));
```

Everything else — evaluations, allocations, pool components, statements,
signatures — works as-is.

**Schema constraint note:** The current `EPOCH_WINDOW_UNIQUE` constraint
(`unique(node_id, scope_id, period_start, period_end)` at `db-schema/src/attribution.ts:82`)
and `ONE_OPEN_EPOCH` partial unique index (`db-schema/src/attribution.ts:89`) do not
include `epoch_kind`. Both constraints need `epoch_kind` added to their column lists,
or rebalance epochs will collide with activity epochs for the same scope/window. This
must be resolved in the spec phase.

#### What the ledger looks like over time

```
Epoch 12 (activity, weight-sum-v0):
  Alice = 3000, Bob = 2000
  Signed by 0xABC, finalized 2026-02-10            ← permanent

Epoch 13 (activity, weight-sum-v0):
  Alice = 2500, Bob = 3500
  Signed by 0xABC, finalized 2026-02-17            ← permanent

Epoch 14 (activity, eval-scored-v0):
  Alice = 8500, Bob = 1200                          ← new algo, richer scoring
  Signed by 0xABC, finalized 2026-02-24            ← permanent

Epoch 15 (rebalance, <reassessment-algo-TBD>):
  Reviewing epochs 12-13
  Alice = +1200 (underpaid), Bob = 0 (overpaid)    ← correction entry
  Pool: 1200 (retroactive_adjustment)
  Signed by 0xABC, finalized 2026-03-01            ← permanent
```

Anyone reading the ledger can see:
- What algorithm scored each epoch
- When the DAO switched algorithms
- What corrections were issued and why
- The full reasoning chain for every score

### Design decisions

#### Why positive-only rebalancing in V0?

`computeStatementItems` rejects negative `valuationUnits` (line 46 of `rules.ts`).
This is correct for V0 — negative allocations imply clawbacks, which require:
- Settlement layer integration (can you take back tokens already distributed?)
- Governance authorization (who approves clawbacks?)
- Legal/regulatory consideration

None of these exist yet. Positive-only rebalancing is safe: underpaid users catch up,
overpaid users simply don't receive corrections. Note: convergence toward fairness
depends on the rebalance pool being funded to cover the full positive-delta sum. If
governance underfunds the pool, correction is partial.

#### Why not re-evaluate old epochs?

Three reasons:
1. **Signed statements are commitments.** Re-evaluating would invalidate signatures.
   The signer attested to specific allocation data — changing that data is forgery.
2. **Determinism requires pinned inputs.** An evaluation is reproducible because it
   pins model ID, prompt version, repo commit SHA, and receipt set. "Re-running with
   a better model" produces a different evaluation — that's a new fact, not a correction
   to the old one.
3. **The journal model is more honest.** It acknowledges: "we scored this way then,
   we'd score differently now, and here's the correction." That's more transparent than
   silently replacing old scores.

#### Why one column instead of a new table?

A rebalance epoch IS an epoch. It has evaluations, allocations, pool components,
a statement, and signatures. Creating a parallel table structure would duplicate all
of those relationships. `epoch_kind` is a discriminator — it tells you how to interpret
the epoch, not what structure it has.

#### How does this interact with `supersedesStatementId`?

It doesn't need to. `supersedesStatementId` on `epoch_statements` is designed for
the case where a single epoch's statement is amended (e.g., fixing a computation error
before settlement). Rebalancing is a different concept — it's a new epoch with its own
statement, not an amendment to an old epoch's statement. Both mechanisms can coexist.

#### Receiptless pipeline path

Rebalance epochs have no ingestion receipts — their inputs are reassessment results.
The existing pipeline is receipt-driven: `getSelectedReceiptsForAllocation(epochId)`
returns receipts joined to selection rows. For a rebalance epoch with zero receipts,
this returns an empty array. The rebalance allocation algorithm reads from the
evaluation payload's deltas rather than from receipts. The `AllocationContext.events`
field is a dead parameter for rebalance algos. This divergence must be explicitly
addressed in the spec — either make `events` optional or specify that
`RebalanceEpochWorkflow` skips the receipt-dependent steps.

---

## Schema Impact Summary

| Change | Type | Detail |
| ------ | ---- | ------ |
| `epochs.epoch_kind` | Add column | `TEXT NOT NULL DEFAULT 'activity'`, CHECK IN ('activity', 'rebalance') |
| `epochs_window_unique` index | Modify | Add `epoch_kind` to prevent rebalance/activity collisions |
| `epochs_one_open_per_node` index | Modify | Add `epoch_kind` or document serialization as intentional |
| `computeProposedAllocations` signature | Refactor | `(algoRef, events, weightConfig)` → `(algoRef, ctx: AllocationContext)` |
| `pool_component_allowlist` | Extend | Add `'retroactive_adjustment'` |
| New enricher: `cogni.ai_scores.v0` | Additive | New `evaluation_ref`, existing table |
| New enricher: `cogni.rebalance_review.v0` | Additive | New `evaluation_ref`, existing table |
| New algo: `eval-scored-v0` | Additive | New case in allocation dispatch |
| Reassessment algo | TBD | Depends on outcome of retrospective value spike |
| New workflow: `RebalanceEpochWorkflow` | Additive | Temporal workflow, similar lifecycle to CollectEpoch |

No new tables. No removed columns. The core pipeline
(ingestion → selection → evaluation → allocation → finalization) is unchanged.

---

## Design Review Findings

These issues were identified during design review and must be resolved before spec:

1. **EPOCH_WINDOW_UNIQUE collision** — `unique(node_id, scope_id, period_start, period_end)`
   at `db-schema/src/attribution.ts:82-86` does not include `epoch_kind`. Rebalance
   epochs will collide with activity epochs for the same scope/window. Fix: add
   `epoch_kind` to the unique index.

2. **ONE_OPEN_EPOCH blocks concurrent epochs** — the partial unique index at
   `db-schema/src/attribution.ts:89-91` prevents having an open rebalance epoch and an
   open activity epoch for the same scope simultaneously. Either add `epoch_kind` to
   the index or document serialization as intentional.

3. **ENRICHER_IDEMPOTENT vs LLM non-determinism** — see note in Layer 2 evaluation
   contract above. Requires invariant clarification.

4. **Receiptless pipeline path** — see note in rebalance epoch section above. Requires
   explicit handling in spec.

5. **Positive-only convergence depends on pool funding** — the claim that "cumulative
   distribution converges toward fairness" is only true if each rebalance pool is funded
   to cover the full positive-delta sum.

---

## What's Solid in This Design

For clarity — these parts of the design are well-grounded and should carry forward:

- **Thin ingestion** — receipts as event references, evaluator fetches depth
- **LLM evaluation at epoch close** — fixes SourceCred's content-blindness
- **Immutable versioned epochs** — journal accounting model
- **Evaluation snapshots** — reproducibility from payload alone
- **Rebalance epoch as a vehicle** — fits existing lifecycle, minimal schema change
- **Positive-only V0** — safe default, clawbacks deferred correctly

## What's Unsolved

- **Retrospective value reassessment** — how to systematically reassess historical
  contributions without O(N×T) LLM cost. This is the most important open problem.
  Requires a dedicated research spike.
- **Reassessment cadence** — quarterly is the working assumption, but the mechanism
  that runs at that cadence is not designed.
- **What signals indicate retrospective value** — downstream impact, code survival,
  feature dependencies, revert rate. These need to be identified, validated, and
  instrumented.

---

## Open Questions

### LLM Evaluation (Layer 2)
- [ ] Should the evaluator score all receipts in a single LLM call, or chunk them?
      Single call enables relative scoring; chunking handles scale.
- [ ] How do we handle evaluation cost? LLM calls per receipt add up. Should there be
      a cost budget per epoch, or is this an operator concern?
- [ ] How should ENRICHER_IDEMPOTENT be relaxed for non-deterministic enrichers?

### Retrospective Value (requires spike)
- [ ] What cheap proxy signals indicate retrospective value? (code survival, downstream
      dependency count, revert rate, feature adoption metrics)
- [ ] Can reassessment be done at the user level (comparing allocation ratios across
      eras) rather than per-receipt? What accuracy is lost?
- [ ] Should reassessment use a decay window (only last N epochs) or cover all history?
- [ ] Is sampling (reassess a subset, extrapolate) viable for bounded-cost correction?
- [ ] How does the SourceCred BALANCED policy's continuous correction compare to
      periodic batch reassessment? What's gained and lost?

### Rebalance Mechanism
- [ ] Should the rebalance evaluation reference specific historical epoch IDs, or a
      time range? Epoch IDs are more precise; time ranges are simpler for governance.
- [ ] Should rebalance epochs be constrained to reviewing epochs scored by older
      algorithms only, or can they also review same-version epochs?

## Related

- [attribution-ledger.md](../spec/attribution-ledger.md) — Core ledger spec (five-stage pipeline)
- [epoch-event-ingestion-pipeline.md](./epoch-event-ingestion-pipeline.md) — Ingestion adapter research
- [sourcecred.md](../spec/sourcecred.md) — Legacy SourceCred scoring (being superseded)
- [sourcecred-config-rationale.md](../spec/sourcecred-config-rationale.md) — SourceCred weight/policy rationale (BALANCED policy context)
