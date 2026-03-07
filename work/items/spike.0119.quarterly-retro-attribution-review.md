---
id: spike.0119
type: spike
title: "Quarterly people-centric attribution review — evaluation payload, governance input, and signal collection"
status: needs_research
priority: 1
rank: 3
estimate: 3
summary: "Design the people-centric quarterly retro review mechanism: what does the LLM assessment of a contributor's quarter look like, what governance input drives it, what signals feed it, and how does it produce correction allocations via rebalance epochs."
outcome: "A research document with a concrete evaluation payload schema, governance input format, signal collection strategy, and worked example showing how a quarterly retro produces rebalance epoch allocations. Ready for spec and implementation."
spec_refs: attribution-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 1
blocked_by: [task.0113]
deploy_verified: false
created: 2026-03-01
updated: 2026-03-01
labels: [governance, attribution, scoring, retro]
external_refs:
---

# Quarterly People-Centric Attribution Review

## Problem

The attribution ledger pipeline scores contributions at event time using the best
available algorithm. But value is retrospective — a PR's true impact isn't knowable
when it merges. The system needs systematic periodic reassessment.

The research doc ([attribution-scoring-design](../../docs/research/attribution-scoring-design.md))
established the weekly base + quarterly retro cadence and argued for people-centric
quarterly reviews over event-centric re-scoring. But the mechanism is not yet designed.

## Research Questions

### 1. Quarterly evaluation payload

What does a people-centric assessment look like as data?

- Per-actor assessment with cited receipts? Relative ranking with reasoning?
- What evidence is cited from the receipt history?
- How does the LLM aggregate a contributor's quarter — chronological narrative,
  thematic grouping, or impact-ranked list?
- What's the schema for `cogni.quarterly_review.v0` evaluation payload?

### 2. Governance input format

How does governance express "here are the outcomes that mattered this quarter"?

- Free-text objectives? Structured KPI deltas? Work-item completion status?
- Who provides this input and when?
- How does the system consume it as evaluation input?

### 3. Signal collection for quarterly review

The research doc identified that quarterly review needs anchors/linkage edges
built during weekly epochs. Which signals are worth instrumenting?

- Code survival (git blame, cheap)
- Revert detection (commit message parsing, cheap)
- Cross-reference linkage (issue/PR cross-refs, GitHub metadata)
- File-path overlap between receipts
- Work-item completion status from the work-item enricher

Should these be enricher data on existing receipts, or new receipt types?

### 4. People-centric vs event-centric trade-offs

Validate the argument from the research doc:

- Cost: O(contributors) vs O(receipts) — quantify for our scale
- Auditability gap: what granularity is lost?
- Cross-cutting work: how are mentoring, architecture, coordination credited?
- Contributors across multiple objectives: split credit or primary/secondary?

### 5. Rebalance epoch integration

The rebalance epoch vehicle is solid (same lifecycle, `epoch_kind = 'rebalance'`).
How does the quarterly retro feed into it?

- Evaluation payload → allocation algorithm → correction allocations
- Pool sizing: how much goes to weekly base vs quarterly retro?
- Schema constraints: EPOCH_WINDOW_UNIQUE and ONE_OPEN_EPOCH need `epoch_kind`

### 6. Worked example

Produce a concrete example: given N contributors and M receipts across one quarter,
what does governance input look like, what does the LLM produce, and what does the
rebalance epoch statement contain?

## Prior Art

- [attribution-scoring-design.md](../../docs/research/attribution-scoring-design.md) — Core research, SourceCred failure analysis, weekly/quarterly cadence, people-centric argument
- [sourcecred-config-rationale.md](../../docs/spec/sourcecred-config-rationale.md) — BALANCED policy rationale (the predecessor mechanism)
- [attribution-ledger.md](../../docs/spec/attribution-ledger.md) — Existing pipeline spec

## Validation

Research spike is complete when:

- [ ] Quarterly evaluation payload schema is defined with a worked example
- [ ] Governance input format is specified
- [ ] Signal collection strategy is chosen (which signals, how collected, where stored)
- [ ] People-centric vs event-centric trade-offs are quantified for our scale
- [ ] Rebalance epoch integration path is concrete (including schema constraint fixes)
- [ ] Document is written in `docs/research/` and linked from project roadmap
