---
id: task.0164
type: task
title: "Implement Tier 1 eval runner for pr-review graph"
status: needs_design
priority: 1
rank: 11
estimate: 3
summary: "Build eval harness using Langfuse Experiments SDK: task function invoking pr-review graph with cheap model, deterministic evaluators (schema, exact, subset, delta), vitest test."
outcome: "Running pnpm eval:run executes pr-review eval against Langfuse dataset, reports scores to Langfuse, and fails vitest if regressions detected."
spec_refs: ai-evals-spec, ai-setup-spec
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0163
deploy_verified: false
created: 2026-03-13
updated: 2026-03-13
labels: [ai, evals, langfuse]
external_refs:
  - docs/research/ai-eval-pipeline-architecture.md
---

# Implement Tier 1 eval runner for pr-review graph

## Requirements

- `evals/harness/task.ts` — graph invocation task function: instantiates `createPrReviewGraph()` with `ChatOpenAI` (cheap model), invokes, extracts response
- `evals/harness/evaluators.ts` — item-level evaluators: `schema_valid` (Zod), `exact_match`, `subset_match`, `numeric_delta`
- `evals/__tests__/pr-review.eval.test.ts` — vitest test: fetches dataset from Langfuse, runs `dataset.runExperiment()`, asserts all evaluator scores pass thresholds
- `evals/vitest.config.mts` — 120s timeout, sequential, no threads
- `evals/config.ts` — model configs, thresholds, dataset names
- `pnpm eval:run` script in root package.json

## Key decisions

- Invokes graph directly (graph-level eval), NOT through HTTP API
- Uses cheap model (gpt-4o-mini or claude-haiku) for Tier 1
- Budget guard: maxConcurrency=2, abort if cumulative cost exceeds threshold

## Allowed Changes

- `evals/` directory
- Root `package.json` (new script)

## Validation

```bash
LANGFUSE_SECRET_KEY=... OPENROUTER_API_KEY=... pnpm eval:run
```
