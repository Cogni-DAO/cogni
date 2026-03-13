---
id: task.0167
type: task
title: "Expand evals to poet graph"
status: needs_design
priority: 2
rank: 14
estimate: 2
summary: "Add poet graph eval: seed dataset, format/structure evaluators (markdown validation, stanza detection), vitest test."
outcome: "Poet graph has eval coverage. Eval workflow runs both pr-review and poet evals."
spec_refs: ai-evals-spec
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0164
deploy_verified: false
created: 2026-03-13
updated: 2026-03-13
labels: [ai, evals, langfuse]
external_refs:
  - docs/research/ai-eval-pipeline-architecture.md
---

# Expand evals to poet graph

## Requirements

- `evals/seed/datasets/poet.seed.ts` — 3 dataset items (greeting, technical question, philosophical question)
- Evaluators: markdown format validation, stanza structure detection, emoji placement
- `evals/__tests__/poet.eval.test.ts` — vitest test
- Update `evals/seed/seed-datasets.ts` to include poet dataset

## Allowed Changes

- `evals/` directory

## Validation

```bash
pnpm eval:seed && pnpm eval:run
```
