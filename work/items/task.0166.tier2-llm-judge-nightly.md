---
id: task.0166
type: task
title: "Tier 2 — LLM-as-judge evaluator and nightly schedule"
status: needs_design
priority: 2
rank: 13
estimate: 3
summary: "Add LLM-as-judge evaluator using production models for Tier 2 nightly evals. Integrate autoevals library. Add cost delta tracking."
outcome: "Nightly eval runs use production models with LLM-as-judge scoring. Cost delta tracked and warned if >20% vs baseline."
spec_refs: ai-evals-spec
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0165
deploy_verified: false
created: 2026-03-13
updated: 2026-03-13
labels: [ai, evals, langfuse]
external_refs:
  - docs/research/ai-eval-pipeline-architecture.md
---

# Tier 2 — LLM-as-judge evaluator and nightly schedule

## Requirements

- Add `autoevals` dependency for LLM-as-judge evaluators (Factuality, etc.)
- Implement LLM-as-judge evaluator wrapping `createEvaluatorFromAutoevals()`
- Configure Tier 2 to use production model (gpt-4o, claude-sonnet)
- Add cost delta tracking: compare token usage against baseline, warn if >20%
- First nightly run establishes the baseline in Langfuse experiment metadata

## Allowed Changes

- `evals/harness/evaluators.ts` (add LLM judge)
- `evals/config.ts` (Tier 2 model config)
- `.github/workflows/eval.yaml` (Tier 2 job config)
- Root `package.json` (autoevals devDep)

## Validation

```bash
EVAL_TIER=2 pnpm eval:run  # runs with production model + LLM judge
```
