---
id: chr.evals
type: charter
title: "AI Evaluation Charter"
state: Active
summary: Living evaluation program for AI graph quality across all nodes. Tracks eval coverage, defines practices, and drives continuous improvement via user feedback.
created: 2026-04-06
updated: 2026-04-06
---

# AI Evaluation Charter

## Goal

Every AI graph shipped to users has measurable quality, tracked over time, and improved by real-world feedback. Eval coverage is a first-class engineering metric — like test coverage, but for AI behavior.

## Principles

These principles are derived from what top AI teams (Anthropic, OpenAI, Stripe, Braintrust) actually ship, not what they blog about.

### 1. DATA FIRST, TOOLING SECOND

> "The main thing inhibiting people is not doing the error analysis." — Hamel Husain

Before writing an eval, review 50+ real outputs. Categorize failures. Write evals for the failure modes you found. Never invent synthetic test cases without first understanding what actually goes wrong.

### 2. CODE EVALS BEFORE LLM JUDGES

If a failure can be verified with code, always use a code-based eval. LLM-as-judge is the last resort for subjective dimensions only.

**Eval type priority:**
1. **Deterministic** — format, tool calls, latency, required fields, exact matches
2. **Heuristic** — semantic similarity, keyword presence, length bounds
3. **LLM-as-judge** — subjective quality (tone, reasoning, synthesis) — binary pass/fail only
4. **Human review** — calibration, edge cases, annotation of new failure modes

### 3. BINARY PASS/FAIL, NOT SCORES

> "Binary evaluations force clearer thinking and more consistent labeling." — Hamel Husain

Every eval is a yes/no question. Not "rate helpfulness 0-1" but "did the agent call the correct tool? yes/no." Float scores with thresholds maximize flakiness.

### 4. MINIMUM 20 CASES TO START

No source recommends fewer than 20 cases. Anthropic's floor: "20-50 simple tasks drawn from real failures." Below 20, there is zero statistical signal — you cannot distinguish regression from noise.

### 5. HEALTHY PASS RATE IS 70-85%, NOT 100%

> "If you're passing 100% of your evals, you're likely not challenging your system enough." — Hamel Husain

100% pass rate means your evals are too easy. A 70-85% baseline means evals are actually testing something. Improvements are measured as pass rate increasing over time.

### 6. ADVISORY BEFORE GATING

Run evals in advisory mode (log scores, don't block) for at least 2 weeks before enabling deployment gating. This calibrates thresholds and surfaces flaky evals before they block real work.

### 7. PRODUCTION FEEDBACK CLOSES THE LOOP

User thumbs-up/down on responses is the ultimate eval signal. Every downvote becomes a candidate eval case. The eval suite grows from production reality, not imagination.

## Node Eval Matrix

Every node that serves AI graphs must maintain eval coverage. `node-template` defines the baseline; spawned nodes inherit and extend.

### node-template (baseline — all nodes inherit)

| Graph | Tier | Code Evals | LLM Judge | Human Calibrated | Cases | Status |
| --- | --- | --- | --- | --- | --- | --- |
| brain | Core | — | — | — | 0 | Not Started |
| poet | Core | — | — | — | 0 | Not Started |
| ponderer | Core | — | — | — | 0 | Not Started |
| research | Core | — | — | — | 0 | Not Started |
| pr-review | Core | — | — | — | 0 | Not Started |
| browser | Extended | — | — | — | 0 | Not Started |
| frontend-tester | Extended | — | — | — | 0 | Not Started |

### operator

| Graph | Tier | Code Evals | LLM Judge | Human Calibrated | Cases | Status |
| --- | --- | --- | --- | --- | --- | --- |
| operating-review | Operator | — | — | — | 0 | Not Started |
| pr-manager | Operator | — | — | — | 0 | Not Started |
| git-reviewer | Operator | — | — | — | 0 | Not Started |

### resy

_Inherits node-template matrix. Add node-specific graphs here as they ship._

### poly

_Inherits node-template matrix. Add node-specific graphs here as they ship._

### Coverage targets

| Phase | Code Evals | LLM Judge | Cases/Graph | User Feedback |
| --- | --- | --- | --- | --- |
| P0 (Crawl) | 2+ per core graph | 1 per core graph | 20-30 | — |
| P1 (Walk) | 5+ per graph | 2 per graph | 50-100 | Thumbs up/down wired |
| P2 (Run) | 10+ per graph | 3+ per graph | 200+ | Downvotes → eval cases |

## Feedback Loop (v-next)

```
User sends message → Graph responds → User gives thumbs up/down
                                            ↓
                                     downvote logged to Langfuse
                                            ↓
                                     weekly: review downvoted traces
                                            ↓
                                     categorize failure mode
                                            ↓
                                     write eval case for that mode
                                            ↓
                                     eval suite grows from reality
```

### Implementation path

1. **P0:** No feedback UI. Evals derived from manual output review.
2. **P1:** Wire thumbs up/down in chat UI. Store as Langfuse score (`user_feedback`, value: 1 or 0). No automated processing.
3. **P2:** Weekly cron: fetch downvoted traces from Langfuse API → present for human review → approved cases added to eval datasets. Langfuse SDK: `langfuse.get_scores(name="user_feedback", value=0)`.
4. **P3:** Auto-suggest eval cases from downvoted clusters (LLM summarizes common failure patterns across downvoted traces).

## Error Analysis Protocol

Before writing evals for any graph, follow this protocol:

### Step 1: Collect real outputs (Day 1)

Run 30-50 real prompts through the graph. Use production-realistic inputs, not synthetic ones. Save every input/output pair.

### Step 2: Review and annotate (Day 1-2)

One domain expert reviews every output. Spend ~30 seconds each. Write freeform notes: what's wrong, what's right, what's surprising.

### Step 3: Categorize (Day 2)

Group notes into 5-6 failure buckets (axial coding). Examples:
- Tool selection errors (called wrong tool or no tool)
- Hallucination (stated facts not in context)
- Format violations (wrong structure, missing fields)
- Incomplete responses (stopped early, missed key info)
- Irrelevant content (off-topic or overly verbose)

### Step 4: Count and prioritize (Day 2)

Pivot table: which failure modes are most common? Write evals for the top 3-4 modes first. Ignore rare failures until the common ones are covered.

### Step 5: Write evals (Day 3-5)

- Code-based evals for deterministic failures (format, tool calls, latency)
- LLM-as-judge (binary pass/fail) for top 1-2 subjective failures
- 20-30 total cases, balanced: include passing cases too (Eugene Yan: "50-100 fail cases out of 200+ total for a balanced dataset")

## Key References

| Type | Path | Purpose |
| --- | --- | --- |
| Spec | [AI Evals Spec](../../docs/spec/ai-evals.md) | Invariants, directory conventions, golden format |
| Spec | [AI Setup](../../docs/spec/ai-setup.md) | Correlation IDs, reproducibility keys |
| Spec | [Observability](../../docs/spec/observability.md) | Langfuse integration, trace structure |
| Project | [AI Evals Pipeline](../projects/proj.ai-evals-pipeline.md) | Roadmap and scorecard |
| Catalog | [Graph Catalog](../../packages/langgraph-graphs/src/catalog.ts) | Source of truth for graph definitions |

## Projects

| Project | Why now | Status |
| --- | --- | --- |
| `proj.ai-evals-pipeline` | First evals — prove the pipeline works | Active |

## Constraints

- Zero eval cases exist today — everything is greenfield
- Auth for programmatic API access unresolved (synthetic sessions deferred)
- Single operator means error analysis is one person's judgment
- No user feedback mechanism exists yet (chat UI has no thumbs up/down)
- Canary CI/CD pipeline not yet running E2E (task.0281)
