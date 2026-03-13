---
id: ai-eval-pipeline-architecture
type: research
title: "AI Eval Pipeline Architecture — Langfuse experiments, tiered strategy, CI separation"
status: draft
trust: draft
summary: "Research on structuring AI evals using Langfuse Experiments SDK v4, separate from main CI, with two tiers (cheap/fast per-PR, expensive/full nightly)."
read_when: Setting up AI evaluation pipelines, choosing eval tools, or designing CI integration for LLM testing.
owner: derekg1729
created: 2026-03-13
tags: [ai, evals, langfuse, ci, research]
---

# Research: AI Eval Pipeline Architecture

> spike: spike.0162 | date: 2026-03-13

## Question

How should we structure an AI eval pipeline that uses Langfuse for dataset management and experiment tracking, runs separately from main CI (zero network dependency in CI), supports two tiers of evaluation (cheap models and expensive thinking models), and integrates with our existing LangGraph graph architecture?

## Context

### What exists today

- **Langfuse observability** is wired (`langfuse@^3.38.6` via `LangfuseAdapter`). Traces, generations, and tool spans flow to Langfuse. But no datasets or experiments are configured.
- **5 LangGraph graphs** exist in `packages/langgraph-graphs/`: brain (repo search), poet (creative), ponderer (reasoning), pr-review (structured output), research (multi-agent web research).
- **ai-evals.md spec** defines golden output format, tolerance system (exact/subset/numeric_delta), CI gate policy, and `evals/` directory structure. None of it is implemented.
- **ai-setup.md P2** lists eval runner deliverables. Status: not started.
- **story.0089** covers Discord bot evals specifically, not general graph evals.
- **CI** (`ci.yaml`) has 5 jobs: static, unit, component, sonar, stack-test. No eval job exists.
- **No separate eval workflow** — evals were originally spec'd to run inside CI (`pnpm eval:run` step in `ci.yaml`).

### What prompted this research

The user identified three problems with the original spec design:

1. **Evals in CI is wrong** — CI runs constantly, evals hit real LLMs, this creates both cost and reliability problems (network dependency).
2. **No tiered strategy** — the spec doesn't distinguish between cheap fast checks and expensive production-model evals.
3. **Langfuse underutilized** — Langfuse has a full experiment runner SDK (`@langfuse/client` v4) that the spec ignores in favor of bespoke comparison logic.

## Findings

### Option A: Separate GitHub Actions workflow with Langfuse Experiments SDK

**What**: A dedicated `eval.yaml` workflow (not in `ci.yaml`) triggered by `workflow_dispatch`, `schedule`, and `repository_dispatch`. Uses `@langfuse/client` v4's `dataset.runExperiment()` API for all eval execution and scoring.

**Architecture:**

```
┌─────────────────────────────────────────────────────┐
│ eval.yaml (separate workflow)                        │
│                                                      │
│ Triggers:                                            │
│   - schedule: nightly (cron)                         │
│   - workflow_dispatch: manual trigger from UI        │
│   - repository_dispatch: triggered by CI on AI paths │
│                                                      │
│ Tier 1 (always): cheap model, deterministic checks   │
│ Tier 2 (nightly/manual): production model, LLM judge │
└─────────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
   Langfuse Datasets        Real LLM (OpenRouter)
   (fetch test cases)       (via LiteLLM or direct)
         │                        │
         └────────┬───────────────┘
                  ▼
         Langfuse Experiments
         (scores, comparison, regression detection)
```

**How CI triggers evals without blocking:**

```yaml
# In ci.yaml, after static job passes:
notify-evals:
  needs: static
  if: # paths filter matches AI code
  runs-on: ubuntu-latest
  steps:
    - uses: peter-evans/repository-dispatch@v3
      with:
        event-type: ai-code-changed
        client-payload: '{"sha": "${{ github.sha }}", "pr": "${{ github.event.pull_request.number }}", "tier": "1"}'
```

This is fire-and-forget. CI completes normally. The eval workflow picks up the dispatch event asynchronously.

**Tier structure:**

| Tier       | When                                | Model                                             | Evaluators                                                  | Budget     | Time  |
| ---------- | ----------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- | ---------- | ----- |
| **Tier 1** | Every AI-touching PR (via dispatch) | Cheap model (e.g. `gpt-4o-mini`, `claude-haiku`)  | Schema validation, exact match, subset match, numeric delta | ~$0.05/run | ~30s  |
| **Tier 2** | Nightly schedule + manual dispatch  | Production model (e.g. `gpt-4o`, `claude-sonnet`) | All Tier 1 + LLM-as-judge quality scoring                   | ~$2/run    | ~5min |

**Langfuse SDK usage (v4):**

```typescript
import { LangfuseClient } from "@langfuse/client";

const langfuse = new LangfuseClient();
const dataset = await langfuse.dataset.get("pr-review-evals");

const result = await dataset.runExperiment({
  name: `eval-${process.env.GITHUB_SHA?.slice(0, 8)}`,
  metadata: { tier: "1", model: "gpt-4o-mini", sha: process.env.GITHUB_SHA },
  task: async (item) => {
    // Invoke graph directly with LangChain model
    const graph = createPrReviewGraph({ llm, tools: [] });
    const result = await graph.invoke({
      messages: [new HumanMessage(item.input)],
    });
    return extractAssistantContent(result);
  },
  evaluators: [schemaValidator, exactMatchEvaluator, subsetMatchEvaluator],
  maxConcurrency: 2,
});
```

**Pros:**

- Zero impact on CI speed and reliability
- Langfuse tracks all experiment runs — compare across commits in UI
- Two tiers with clear cost boundaries
- `@langfuse/client` v4 handles concurrency, tracing, and error isolation
- Scores visible in Langfuse, not buried in CI logs
- Can add LLM-as-judge in Tier 2 without touching Tier 1

**Cons:**

- Eval results are async — PR author must check Langfuse or wait for GitHub status
- Requires `@langfuse/client` v4 (new dependency; existing adapter uses `langfuse` v3)
- Langfuse must be reachable from GitHub Actions (cloud Langfuse is fine)
- Datasets must be seeded before first run

**OSS tools:**

- `@langfuse/client` v4 — experiment runner, datasets, scoring
- `autoevals` — Braintrust's open-source LLM evaluators (Factuality, etc.), integrates with Langfuse via `createEvaluatorFromAutoevals()`
- `peter-evans/repository-dispatch` — fire eval workflow from CI

**Fit with our system:**

- Graphs are already `createXGraph()` factories with injected LLM — eval task just passes a different model
- Existing `langfuse@^3.38.6` adapter stays for production tracing; `@langfuse/client` v4 is separate (datasets/experiments only)
- Eval workflow is a standalone `.github/workflows/eval.yaml` — no changes to `ci.yaml` beyond the dispatch step

### Option B: GitHub Actions with local golden files (no Langfuse for datasets)

**What**: Same separate workflow, but datasets/goldens live as JSON files in `evals/` (as the existing spec describes). Comparison logic is bespoke TypeScript. Results posted as PR comments.

**Pros:**

- No external dependency for test cases — everything in git
- Simpler initial setup
- Works offline

**Cons:**

- Reinvents what Langfuse already provides (comparison UI, versioning, scoring)
- No experiment history or cross-run comparison without building it
- Golden update workflow is manual and error-prone
- Diverges from the Langfuse-native direction the team wants
- Bespoke comparison logic is more code to maintain

**OSS tools:** None beyond vitest.

**Fit with our system:** Matches the existing `ai-evals.md` spec but ignores Langfuse's experiment capabilities.

### Option C: Hybrid — git-tracked seeds, Langfuse experiments

**What**: Seed data definitions live in git (`evals/seed/*.ts`) as the bootstrap source. A seed script pushes them to Langfuse datasets. Experiments run against Langfuse datasets. Seeds are the "golden" source of truth; Langfuse is the execution/comparison engine.

**Pros:**

- Seed data is version-controlled and code-reviewed
- Langfuse handles execution, scoring, and comparison
- Clear ownership: git owns test case definitions, Langfuse owns experiment results
- Seed script is idempotent — safe to re-run

**Cons:**

- Two places to think about (git seeds + Langfuse datasets)
- Seed drift if someone edits Langfuse datasets directly without updating git

**Fit with our system:** Best of both worlds. Follows the spec's `evals/` structure while leveraging Langfuse. Seed script runs as part of `eval:seed` before experiments.

## Recommendation

**Option A (Langfuse Experiments SDK) with Option C's seed pattern.** Specifically:

### 1. Separate `eval.yaml` workflow (NOT in ci.yaml)

- `repository_dispatch` from CI when AI paths change (Tier 1)
- `schedule` for nightly Tier 2 runs
- `workflow_dispatch` for manual triggers
- CI has zero network dependency on eval infrastructure

### 2. Two tiers

- **Tier 1 (per-PR, cheap):** `gpt-4o-mini` or `claude-haiku`, deterministic evaluators only (schema, exact, subset, delta). Budget: ~$0.05/run, 30s timeout. Triggered automatically.
- **Tier 2 (nightly, full):** Production models, adds LLM-as-judge evaluator and cost delta tracking. Budget: ~$5/run, 10min timeout. Runs on schedule.

### 3. Langfuse as experiment engine

- `@langfuse/client` v4 for dataset fetch, experiment execution, and score reporting
- Existing `langfuse@^3.38.6` adapter stays untouched (production tracing)
- Both packages can coexist — different purposes, different import paths

### 4. Git-tracked seeds

- `evals/seed/*.ts` define dataset items (input, expectedOutput, metadata)
- `pnpm eval:seed` pushes to Langfuse datasets (idempotent)
- Seeds are the authoritative source; Langfuse datasets are derived

### 5. Start with pr-review graph

- Structured output (Zod schema) → easiest to evaluate deterministically
- No tools → simplest invocation
- 3-5 seed items covering: simple PR, complex refactor, security issue

### 6. GitHub commit status (not PR comment)

- Eval workflow posts a GitHub commit status (`pending` → `success`/`failure`)
- Links to Langfuse experiment run for details
- Non-blocking — informational status, not a required check (initially)

## Open Questions

1. **Langfuse self-hosted vs cloud in CI**: Cloud is simpler but adds external dependency to eval workflow. Self-hosted Langfuse in CI would be heavy. Recommend cloud for now, accept the external dependency for the eval workflow (not CI).

2. **`langfuse` v3 → `@langfuse/client` v4 migration**: The existing `LangfuseAdapter` uses `langfuse@^3.38.6`. The v4 SDK is a separate package (`@langfuse/client`). Should we migrate the adapter now or keep both? Recommend: keep both for now. Adapter migration is a separate task.

3. **Cost tracking baseline**: The spec says "cost delta < 20% vs baseline (warn)". How do we establish the baseline? First Tier 2 nightly run becomes the baseline; subsequent runs compare against it via Langfuse experiment comparison.

4. **Graph invocation level**: Evals call `createXGraph()` directly (graph-level), bypassing ports/adapters/billing decorators. This tests prompt quality, not integration. Should we also have stack-level evals that go through the full HTTP API? Recommend: start with graph-level, add stack-level only if bugs slip through.

5. **pr-review graph has no tools**: Good for first eval (simple). But brain/research/ponderer graphs need tool mocking or real tool access. How to handle? Recommend: defer tool-using graph evals until pr-review eval is working.

## Proposed Layout

### Project

This fits under the existing **proj.observability-hardening** project (paused, priority 2) or could start a new `proj.ai-eval-pipeline`. Given the scope is focused and the observability project is paused, recommend a **new project**: `proj.ai-eval-pipeline`.

**Phases:**

1. **Bootstrap** — `@langfuse/client` v4 dependency, seed script, first dataset (pr-review)
2. **Tier 1** — eval.yaml workflow, repository_dispatch from CI, cheap model evals, GitHub status
3. **Tier 2** — nightly schedule, production model evals, LLM-as-judge, cost tracking
4. **Expansion** — poet/brain/research graph evals, tool mocking, auto-curation from prod traces

### Specs to update

- **`docs/spec/ai-evals.md`** — Update to reflect two-tier strategy, Langfuse experiments SDK, separate workflow (not in ci.yaml). Remove bespoke harness design, replace with Langfuse experiment runner.
- **`docs/spec/ai-setup.md`** — Update P2 deliverables to reference new approach.

### Tasks (PR-sized)

1. **task: Add `@langfuse/client` v4 + eval seed infrastructure**
   - Install `@langfuse/client` in root (or `evals/` workspace)
   - Create `evals/seed/`, `evals/harness/`, `evals/__tests__/`
   - Implement seed script for pr-review dataset
   - `pnpm eval:seed` script

2. **task: Implement Tier 1 eval runner for pr-review graph**
   - `evals/harness/task.ts` — graph invocation
   - `evals/harness/evaluators.ts` — schema_valid, exact_match, subset_match
   - `evals/__tests__/pr-review.eval.test.ts` — vitest test using Langfuse experiment
   - `evals/vitest.config.mts`
   - `pnpm eval:run` script

3. **task: Create eval.yaml workflow with repository_dispatch + schedule**
   - `.github/workflows/eval.yaml` — Tier 1 + Tier 2 jobs
   - CI path filter + repository_dispatch in `ci.yaml`
   - GitHub commit status reporting
   - Cost budget guard

4. **task: Tier 2 — LLM-as-judge evaluator + nightly schedule**
   - Add `autoevals` integration
   - LLM-as-judge evaluator for quality scoring
   - Nightly cron trigger
   - Cost delta tracking

5. **task: Expand to poet graph evals**
   - Seed poet dataset
   - Evaluators for creative output (format validation, markdown structure)
   - Add to eval workflow

### Sequence

```
task 1 (seed infra) → task 2 (Tier 1 runner) → task 3 (workflow) → task 4 (Tier 2) → task 5 (expand)
```

Tasks 1-3 are the MVP. Tasks 4-5 are follow-on.
