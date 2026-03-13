---
id: spike.0162
type: spike
title: "AI eval pipeline architecture — Langfuse experiments, tiered strategy, CI separation"
status: done
priority: 1
rank: 10
estimate: 2
summary: "Research how to structure AI evals using Langfuse Experiments SDK, separate from main CI, with two tiers (cheap/fast for PRs, expensive/full for nightly)."
outcome: "Research document with recommendation: Langfuse-native experiments via @langfuse/client v4, separate eval.yaml workflow triggered by repository_dispatch + schedule, git-tracked seeds, two-tier model strategy. 5 follow-up tasks identified."
spec_refs: ai-evals-spec, ai-setup-spec
assignees: []
credit:
project:
branch: claude/setup-ai-evals-gSx6n
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-13
updated: 2026-03-13
labels: [ai, evals, langfuse, ci]
external_refs:
  - docs/research/ai-eval-pipeline-architecture.md
---

# AI Eval Pipeline Architecture

## Research Question

How should we structure an AI eval pipeline that:

1. Uses Langfuse for dataset management and experiment tracking
2. Runs separately from main CI (zero network dependency in CI)
3. Supports two tiers: cheap models (per-PR) and expensive thinking models (nightly)
4. Integrates with our existing LangGraph graph architecture

## Findings

See [research document](../../docs/research/ai-eval-pipeline-architecture.md) for full analysis.

### Key decisions:

- **Separate workflow** (`eval.yaml`) — not in `ci.yaml`. CI fires `repository_dispatch` on AI path changes (fire-and-forget).
- **Langfuse Experiments SDK** (`@langfuse/client` v4) — handles dataset fetch, experiment execution, scoring, comparison. Not bespoke.
- **Two tiers**: Tier 1 (cheap model, deterministic evaluators, per-PR) and Tier 2 (production model, LLM-as-judge, nightly).
- **Git-tracked seeds** — dataset definitions in `evals/seed/*.ts`, pushed to Langfuse via `pnpm eval:seed`.
- **Start with pr-review graph** — structured output, no tools, easiest to evaluate.

## Validation

Research document reviewed, proposed layout captures all requirements.
