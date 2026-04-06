---
id: proj.ai-evals-pipeline
type: project
primary_charter: chr.evals
title: AI Evals Pipeline
state: Active
priority: 1
estimate: 5
summary: Production eval pipeline — Langfuse datasets, LLM-as-judge scoring, canary deployment gates, CI regression checks.
outcome: Automated eval pipeline that scores AI graphs after every canary deployment. Quality regressions block promotion.
assignees: derekg1729
created: 2026-04-04
updated: 2026-04-06
labels: [ai, evals, langfuse, cicd, observability]
---

# AI Evals Pipeline

## Goal

Ship a repeatable, data-driven eval pipeline that scores AI graph responses after every canary deployment. Error analysis first, evals from observed failures, advisory mode before gating. Langfuse is the eval platform. User feedback closes the loop over time.

## Current State — Scorecard

We have **excellent infrastructure** and **zero running evals**.

```
+-----------------------------------------------+----------+-------------------+
| Practice                                      | Top 0.1% | Cogni Status      |
+===============================================+==========+===================+
| Prompt version tracking (git hash per call)   | Required | DONE              |
| OTel + Langfuse trace correlation             | Required | DONE              |
| Per-call cost tracking                        | Required | DONE              |
| Observability decorator on all graph runs     | Required | DONE              |
| Eval spec with invariants                     | Required | DONE (spec only)  |
| Golden dataset testing (500+ cases/graph)     | Required | MISSING           |
| LLM-as-judge online eval                      | Required | MISSING           |
| CI eval regression gate (blocks merge)        | Required | MISSING           |
| Canary eval before promotion                  | Required | MISSING           |
| Langfuse dataset experiments                  | Required | MISSING           |
| Multi-model A/B comparison                    | Advanced | MISSING           |
| Red teaming / adversarial testing             | Advanced | MISSING (P2)      |
| Eval dashboard (score trends over time)       | Advanced | MISSING           |
| Feedback loop (prod edge cases -> datasets)   | Advanced | MISSING           |
+-----------------------------------------------+----------+-------------------+

Infra readiness:  6/6  DONE
Eval readiness:   0/8  MISSING
```

**Translation:** The pipes are plumbed but no water is flowing. Every piece of infrastructure needed for evals exists (Langfuse, LiteLLM, canary CI/CD, graph execution, observability). We just need to wire them together and add test cases.

## Roadmap

### Crawl (P0) — Error Analysis + 20 Real Cases (Advisory Mode)

**Goal:** Look at real outputs, find what breaks, write evals for those failures. Advisory mode — no gating.

| Deliverable                                                     | Status      | Est | Work Item |
| --------------------------------------------------------------- | ----------- | --- | --------- |
| Error analysis: 30-50 real prompts through brain + pr-review    | Not Started | 1   | task.0286 |
| 20+ eval cases from observed failure modes (code-based + judge) | Not Started | 2   | task.0286 |
| Lightweight vitest harness + Langfuse dataset push              | Not Started | —   | task.0286 |
| `pnpm eval:canary` command (advisory, exit 0)                   | Not Started | —   | task.0286 |

### Walk (P1) — Calibrate Thresholds + Enable Gating + User Feedback

**Goal:** After 2+ weeks advisory, calibrate thresholds. Enable gating. Wire user feedback.

| Deliverable                                       | Status      | Est | Work Item            |
| ------------------------------------------------- | ----------- | --- | -------------------- |
| Calibrate pass rate thresholds from advisory data | Not Started | 1   | (create at P1 start) |
| Enable eval gating: exit non-zero on failure      | Not Started | 1   | (create at P1 start) |
| Expand to 50+ cases per graph                     | Not Started | 2   | (create at P1 start) |
| GitHub Action in `e2e.yml`                        | Not Started | 1   | (create at P1 start) |
| Canary → staging promotion gated on eval pass     | Not Started | 1   | (create at P1 start) |
| Thumbs up/down in chat UI → Langfuse score        | Not Started | 2   | (create at P1 start) |

### Run (P2) — Production Monitoring + Feedback Flywheel

**Goal:** Continuous quality monitoring. Downvoted responses auto-surface as eval candidates.

| Deliverable                                          | Status      | Est | Work Item            |
| ---------------------------------------------------- | ----------- | --- | -------------------- |
| Langfuse managed evaluators on live traces           | Not Started | 2   | (create at P2 start) |
| Score trend dashboard in Grafana                     | Not Started | 1   | (create at P2 start) |
| Alert rules for quality degradation                  | Not Started | 1   | (create at P2 start) |
| Weekly cron: downvoted traces → candidate eval cases | Not Started | 2   | (create at P2 start) |
| Multi-model A/B comparison                           | Not Started | 2   | (create at P2 start) |
| Red teaming / adversarial testing                    | Not Started | 3   | (create at P2 start) |
| All-node eval matrix coverage (per chr.evals)        | Not Started | 3   | (create at P2 start) |

## Constraints

- **Data first** — error analysis before writing any eval. No synthetic test cases without observed failures.
- **Binary pass/fail** — no float scores with thresholds. Every eval is yes/no.
- **Advisory before gating** — 2+ weeks advisory mode before enabling deployment gates.
- **4o-mini judge, code first** — deterministic code assertions 3:1 ratio over LLM judge. Judge only for subjective dimensions.
- **Canary HTTP target** — evals test the full deployment stack, not in-process graphs.
- **No LangSmith** — we use Langfuse. One observability platform, not two.
- **No new eval frameworks** (P0) — Langfuse SDK + raw fetch. Revisit promptfoo/DeepEval at scale.

## Dependencies

- **task.0281** (canary CI/CD parity) — canary must be deployable before we can eval against it
- **Langfuse Cloud** — API keys exist for local/preview/production. Canary env needs Langfuse keys added.
- **OpenRouter** — API key already in CI secrets for 4o-mini judge calls.

## Design Notes

### Package Mapping (LangGraph → Evals)

| Package                       | Role in Evals                                            |
| ----------------------------- | -------------------------------------------------------- |
| `@cogni/langgraph-graphs`     | **Subject under test** — graph definitions being scored  |
| `@cogni/graph-execution-core` | **Execution contract** — `GraphExecutorPort` for CI runs |
| `@cogni/graph-execution-host` | **Observability bridge** — auto-traces during eval runs  |
| `@cogni/ai-core`              | **Event types** — `AiEvent` for tool call assertions     |
| `langfuse` (SDK)              | **Eval platform** — datasets, experiments, scores, UI    |
| `@langchain/langgraph`        | **Runtime** — executes graphs under test                 |

No `@langchain/evals` package exists. LangChain deprecated its eval module in favor of LangSmith. Since we use Langfuse (not LangSmith), our eval harness is a lightweight TypeScript runner calling the Langfuse SDK directly.

### Three-Stage Pipeline Architecture

```
Stage 1: CI Gate (pre-merge)
  pnpm eval:check — run golden datasets against local graph execution
  Blocks PR if quality regresses beyond tolerance

Stage 2: Canary Gate (post-deploy, pre-promotion)
  pnpm eval:canary — run datasets against live canary HTTP API
  Blocks canary -> staging promotion if thresholds fail
  Tests full deployment stack (auth, routing, infra, model availability)

Stage 3: Production Monitoring (continuous)
  Langfuse managed evaluators score live traces automatically
  Daily batch scoring for drift detection
  Alert on quality degradation via Grafana
```

### Eval Harness (`evals/`)

```
evals/
  datasets/
    pr-review-scoring.json      # PR-review graph test cases
    brain-tool-calling.json     # Brain graph test cases
  harness/
    runner.ts                   # Main eval orchestrator
    judge.ts                    # 4o-mini LLM-as-judge scoring
    client.ts                   # HTTP client for canary/staging API
    langfuse-experiment.ts      # Langfuse dataset + score push
    assertions.ts               # Deterministic assertion helpers
  config.ts                     # Env config (URLs, keys, thresholds)
  vitest.config.ts              # Vitest config for eval test runner
```

### Judge Flow

```
Test case input
  -> HTTP POST to canary /api/v1/ai/chat (SSE stream)
  -> Collect full response + tool call events
  -> Deterministic assertions (format, tool names, latency)
  -> 4o-mini LLM-as-judge (via OpenRouter, ~$0.0001/eval)
  -> Push scores to Langfuse (trace + experiment)
  -> Threshold check -> pass/fail
```

### CI Integration

```yaml
# In e2e.yml (after canary deploy succeeds)
- name: Run AI Evals
  run: pnpm eval:canary
  env:
    EVAL_TARGET_URL: https://${{ vars.DOMAIN }}
    LANGFUSE_SECRET_KEY: ${{ secrets.LANGFUSE_SECRET_KEY }}
    LANGFUSE_PUBLIC_KEY: ${{ secrets.LANGFUSE_PUBLIC_KEY }}
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
    EVAL_JUDGE_MODEL: openai/gpt-4o-mini
```

## As-Built Specs

- [AI Evals Spec](../docs/spec/ai-evals.md) — invariants, directory conventions, golden output format

## Related

- [EVALS Charter](../charters/EVALS.md) — eval program principles, per-node matrix, feedback loop
- [story.0089](items/story.0089.discord-bot-conversation-evals.md) — Discord-specific evals (subsumed by this project)
- [task.0281](items/task.0281-canary-cicd-parity-staging-promotion.md) — canary CI/CD parity (prerequisite)
- [AI Pipeline E2E](../docs/spec/ai-pipeline-e2e.md) — execution flow being evaluated
- [Observability Spec](../docs/spec/observability.md) — Langfuse integration details
