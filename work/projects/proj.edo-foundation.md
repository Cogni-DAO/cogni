---
id: proj.edo-foundation
type: project
primary_charter: chr.knowledge
title: "EDO Foundation — Event/Hypothesis/Decision/Outcome Loop on the Knowledge Plane"
state: Active
priority: 1
estimate: 5
summary: Close the data → hypothesis → action → data loop. Four entry_type values (event, hypothesis, decision, outcome) + four citation types (evidence_for, derives_from, validates, invalidates) + evaluate_at column + EdoResolverPort + atomic agent tools + resolver cron + brain prompt + chain UI. Recursion via citation DAG; no new tables.
outcome: An agent files a hypothesis with evaluate_at, takes a decision citing it, the resolver cron files the outcome on schedule with a validates/invalidates edge, and confidence recomputes — visible end-to-end as a chain in /knowledge?mode=chains.
assignees: derekg1729
created: 2026-05-11
updated: 2026-05-11
labels: [knowledge, dolt, edo, hypothesis, syntropy, self-improving]
---

# EDO Foundation — Event/Hypothesis/Decision/Outcome Loop

> Knowledge that doesn't predict, decide, and resolve is just a filing cabinet. EDO turns the knowledge plane into a self-evaluating reasoning system — the foundation for AI-run companies and self-improving agentic loops.

## Goal

Close the **data → hypothesis → action → data** loop on the existing knowledge plane. Every agent prediction becomes falsifiable (`evaluate_at`), every decision is traceable to a hypothesis, every outcome cites what it validates or invalidates, and confidence updates mechanically through the citation DAG. EDO chains are recursive (an outcome is evidence for the next hypothesis) — depth is emergent from the graph, not materialized in DDL.

## As-Built Anchor

Designed in **[docs/spec/knowledge-syntropy.md § The EDO Loop](../../docs/spec/knowledge-syntropy.md#the-edo-loop--event--hypothesis--decision--outcome)**. The spec captures invariants, the four beats, recursion-via-citations, the resolver port shape, and the atomic-tools contract. This project tracks delivery; the spec is the source of truth.

## Roadmap

### Crawl (P0) — Schema + Write Path

**Goal:** Agents can file the four beats with proper citations and `evaluate_at`. Nothing resolves yet — but the data shape is right and every write is committed.

| Deliverable                                                          | Status      | Est | Work Item |
| -------------------------------------------------------------------- | ----------- | --- | --------- |
| Schema extension: `evaluate_at` column + widen entry_type enum + widen citation_type enum (`EntryTypeSchema`, `CitationTypeSchema`) | Not Started | 1   | —         |
| `EdoResolverPort` + Doltgres adapter + 1-hop `recomputeConfidence`   | Not Started | 2   | —         |
| `createEdoCapability(knowledgePort, resolverPort)` — atomic write+cite+commit | Not Started | 1   | —         |
| Three tools: `core__edo_hypothesize`, `core__edo_decide`, `core__edo_record_outcome` (registered in `TOOL_CATALOG`) | Not Started | 2   | —         |

### Walk (P1) — Close the Loop

**Goal:** Resolution runs on a schedule. Outcomes file themselves and confidence recomputes. The loop is closed end-to-end without an agent in the seat.

| Deliverable                                                                          | Status      | Est | Work Item              |
| ------------------------------------------------------------------------------------ | ----------- | --- | ---------------------- |
| `resolveDueHypotheses` cron in `scheduler-worker` (idempotent on hypothesis id)       | Not Started | 2   | (create at P1 start)   |
| Small resolver graph (LangGraph) for hypotheses needing interpretation                | Not Started | 2   | (create at P1 start)   |
| Brain prompt update — teaches EDO discipline (recall + hypothesize + cite outcomes)   | Not Started | 1   | (create at P1 start)   |

### Run (P2+) — Visualize + Compound

**Goal:** Make syntropy visible. Operators can see EDO chains forming. Agents can surface chain neighbors via search.

| Deliverable                                                                                                      | Status      | Est | Work Item              |
| ---------------------------------------------------------------------------------------------------------------- | ----------- | --- | ---------------------- |
| UI: `/knowledge?mode=chains` — react-flow DAG view of recent EDO chains                                          | Not Started | 2   | (create at P2 start)   |
| `core__knowledge_search` returns 1-hop neighbors + `cited_by_count` per hit (P2 in knowledge-syntropy)            | Not Started | 2   | (create at P2 start)   |
| Multi-hop transitive confidence propagation + staleness decay job (P3 in knowledge-syntropy)                     | Not Started | 3   | (create when data demands) |

## Constraints

- **No new tables, two new columns.** The four beats are `entry_type` values on the existing `knowledge` table; recursion is emergent from `citations`. Only `evaluate_at` (timestamptz) + `resolution_strategy` (text, nullable) are added. Materializing EDO trees as DDL is rejected — see spec § Why No New Tables.
- **App-layer confidence only.** Doltgres 0.56 has no PL/pgSQL. `recomputeConfidence` runs in the adapter.
- **1-hop in v1.** Multi-hop transitive propagation is filed when v1 data shows the need.
- **Scheduler-worker, not Temporal.** The resolver cron matches the existing pattern (review, order-reconciler).
- **Type-narrow tools (revisit in P0).** Three distinct tools shipped first for model accuracy; consolidation to a single `core__edo_write({beat, citations[]})` reconsidered if/when 3-tool usage shows redundancy. Decision deferred to P0 implementation.
- **Per-node sovereignty bounds EDO chains.** `DOLTGRES_PER_NODE_DATABASE` means an outcome on poly cannot cite a hypothesis on operator. Cross-node EDO compounding waits on Dolt remotes (🔴 in [KNOWLEDGE charter](../charters/KNOWLEDGE.md)). Within-node compounding is the v1 goal.
- **Resolution opt-in by default.** `resolution_strategy IS NULL` is the default; cron skips. Non-null values are namespaced text (`agent` in v0; future kinds like `market:<id>` add values, not columns). Bounds LLM cost. See spec § `evaluate_at`: The Loop Closer.
- **One canonical port surface.** `KnowledgeStorePort` lives in `knowledge-data-plane.md § Port Interface`; this project contributes `addCitation` + `knowledgeExists` to that surface. Other specs never redefine the interface.

## Dependencies

- [x] P0 (operator-side merging, task.5037 / PR #1308) — done
- [ ] P0.5 (domain registry + FK, task.5038) — in flight; this project files after that merges
- [ ] `EntryTypeSchema` + `CitationTypeSchema` are freeform text in DB today — widening is a doc + Zod enum change, not a Doltgres migration

## As-Built Specs

- [docs/spec/knowledge-syntropy.md](../../docs/spec/knowledge-syntropy.md) — § The EDO Loop (this project's spec home)
- [docs/spec/knowledge-data-plane.md](../../docs/spec/knowledge-data-plane.md) — underlying Doltgres infra
- [docs/spec/knowledge-domain-registry.md](../../docs/spec/knowledge-domain-registry.md) — P0.5 dependency

## Design Notes

### Why "EDO" (Event-Decision-Outcome with implicit Hypothesis)

User clarification 2026-05-11: EDO = event → decision → outcome, with recursive depth. One outcome can be a full EDO chain. Hypothesis is the falsifiable bridge between event and decision — included in the spec as the second beat so the loop has an explicit prediction.

### Anti-patterns we explicitly rejected (see spec § Why No New Tables)

1. Separate tables for hypotheses/decisions/outcomes with FK columns
2. Materialized `edo_chains` table with parent_id / chain_id
3. DB triggers for confidence (Doltgres has no PL/pgSQL)
4. Temporal workflow for the resolver (overkill at v1 scale)
5. Multi-hop confidence walks in v1 (premature)
6. Vector embeddings as part of EDO (orthogonal, open question in syntropy spec)

### Karpathy + eval-discipline alignment

- **File-back** — every exploration ends with a knowledge write (existing recall loop) and now optionally a hypothesis + decision + outcome chain
- **Falsifiable up front** — `evaluate_at` is the appointment with truth; orphan hypotheses surface via `pendingResolutions(now)`
- **Causal traceability** — `derives_from` makes every decision traceable to a prediction; absent prediction → file as `finding`/`conclusion` instead
- **Mechanical promotion** — `validates`/`invalidates` writes trigger `recomputeConfidence`; status moves through draft → candidate → established without prompt engineering

### Open questions (tracked in spec § Open Questions)

- Resolver graph shape: one generic graph that dispatches by `resolution_strategy` namespace prefix, or per-domain resolvers? Start with one; split when domains diverge.
- Concurrency on `recomputeConfidence`: two simultaneous outcome writes against the same hypothesis race. v0: serialize via reserved-conn per cited_id; revisit if measurable contention.
- Brain prompt acceptance: minimum bar is a brain stack test that asserts the tool-call sequence (`core__edo_hypothesize` before `core__knowledge_write` when a prediction is being made). To be added with the prompt change in P1.
- Chain UI library (P2): no graph-viz dep installed today. Start with an indented text view in the existing DataGrid; pick a library (react-flow vs cytoscape vs dagre) only if the text view proves insufficient.
- Embedding model selection (BGE-M3 vs voyage) — still open in knowledge-syntropy; orthogonal to EDO.
