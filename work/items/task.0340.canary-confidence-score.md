---
id: task.0340
type: task
title: "Canary — `/api/singularity` confidence score + daily synth graph (4o-mini)"
status: needs_design
priority: 2
estimate: 3
rank: 4
summary: "First real product of the canary node: a 0-100 confidence score that the universe is tilting toward an 'AI singularity', with supporting reasoning and source snapshot. Daily cron charter runs a LangGraph graph using 4o-mini as the sole synthesizer."
outcome: "`GET /api/singularity` returns `{ score, reasoning, sources[], model, generated_at }`. Score is refreshed daily by the `SINGULARITY_SCORE_DAILY` governance charter. All prior scores + reasoning persist in Dolt for trend analysis."
spec_refs:
  - canary
assignees: derekg1729
project: proj.cogni-canary
created: 2026-04-20
updated: 2026-04-20
labels: [canary, langgraph, 4o-mini, dolt]
external_refs:
  - nodes/canary/graphs/
  - packages/langgraph-graphs/
---

# Canary confidence score

## Context

The canary needs one visible, measurable, cheap-to-produce output. A daily 0-100 score with reasoning is the smallest possible "is the system alive and producing signal?" probe. It also forces the canary to practice the full end-to-end loop (read signals → synthesize via 4o-mini → persist to Dolt → expose via HTTP) before anything harder is attempted.

## Signal sources (v0)

Cheap, rate-limit-friendly, ToS-clean:

- GitHub search API — count of PRs tagged `ai`/`agent`/`llm` merged in the last 7 days across top 100 repos
- arXiv API — count of cs.AI/cs.CL submissions per week
- Hugging Face model releases per week (HF API)
- OpenRouter model catalog delta (new models added per week)
- Published benchmark scores (MMLU, SWE-bench) — manual weekly paste for v0, automated later

Each source returns a normalized 0-1 sub-score. 4o-mini synthesizes into a single 0-100 and produces 2-3 sentence reasoning.

## Deliverables

- [ ] `nodes/canary/app/src/app/api/singularity/route.ts` — GET handler reading latest row from Dolt `canary_singularity_scores` table
- [ ] `nodes/canary/graphs/singularity-synth/graph.ts` — LangGraph graph (ingest node per source → synth node via 4o-mini → persist node)
- [ ] `packages/canary-db-schema/` — Dolt schema for `canary_singularity_scores` (columns: `id`, `score`, `reasoning`, `sources` JSONB, `model`, `generated_at`)
- [ ] Governance charter `SINGULARITY_SCORE_DAILY` — cron `0 12 * * *` UTC, entrypoint name `SINGULARITY_SCORE_DAILY`
- [ ] LiteLLM key-budget cap ≤ $0.50/run (4o-mini is ~$0.15/1M input, so this is trivially safe)
- [ ] Unit test: synth node given canned signals produces a valid score+reasoning

## Validation

- `exercise:` — `curl https://canary-candidate-a.cognidao.org/api/singularity` returns JSON with `score` in `[0,100]` and `reasoning` length > 50 chars.
- `observability:` — Loki query `{app="canary"} |= "singularity-synth"` shows one graph run per day at the deployed SHA; Dolt query `SELECT COUNT(*) FROM canary_singularity_scores WHERE generated_at >= NOW() - INTERVAL 7 DAY` returns ≥ 5.

## Non-goals

- Subscription monetization (CP5)
- Historical backfill
- Predictive modeling — this is synthesis, not forecasting

## Open questions

- Do we need human QA on the reasoning before it's publicly visible? v0 says no (public read-only); revisit if 4o-mini hallucinates a specific claim.
