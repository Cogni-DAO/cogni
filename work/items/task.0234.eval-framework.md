---
id: task.0234
type: task
title: "Eval framework for agent quality measurement"
status: needs_design
priority: 2
rank: 4
estimate: 5
summary: Eval harness to measure agent quality before/after changes — LLM-as-judge + deterministic scorers
outcome: Every agent change is measurable; regressions caught before merge
spec_refs:
assignees:
credit:
project:
branch:
pr:
reviewer:
created: 2026-03-29
updated: 2026-03-29
labels: [agents, testing, quality, evals]
external_refs: [spike.0231]
revision: 0
blocked_by:
deploy_verified: false
---

# Eval Framework for Agent Quality

## Problem

No way to measure if an agent change makes things better or worse. Unit tests verify mechanics (tool calls happen, errors handled), not quality (did the agent give a good answer? did it use the right tools? did it hallucinate?).

Top agent teams (Cursor, Vercel, Cognition) run eval suites on every PR. This is the single biggest differentiator between "demo" and "production."

## Design

### Invariants

- **EVALS_ARE_TESTS**: Run via `pnpm test:eval`, integrated with Vitest
- **SCORERS_ARE_COMPOSABLE**: Each eval case can use multiple scorers (deterministic + LLM judge)
- **CASES_ARE_DATA**: Eval cases are JSON/TS data, not test code
- **RESULTS_ARE_COMPARABLE**: Output includes scores that can be diffed across runs

### Approach

1. **Eval case definition**:
   ```typescript
   interface EvalCase {
     id: string;
     graphId: string;                    // which graph to test
     input: string;                      // user message
     expectedBehavior: string;           // natural language description for LLM judge
     scorers: ScorerConfig[];            // which scorers to apply
     tags?: string[];                    // for filtering (e.g., "brain", "tool-use")
   }
   ```

2. **Scorers**:
   - `contains(substring)` — output contains expected text
   - `not_contains(substring)` — output doesn't contain forbidden text
   - `tool_was_called(toolId)` — specific tool was invoked
   - `llm_judge(criteria)` — LLM scores output 1-5 on criteria (relevance, accuracy, helpfulness)
   - `json_schema(schema)` — structured output matches schema

3. **Runner**:
   - Loads eval cases from `tests/evals/cases/`
   - Executes graph via `GraphExecutorPort` (same path as production)
   - Applies scorers to output
   - Writes results to `tests/evals/results/<timestamp>.json`
   - Prints summary table: case ID, scores, pass/fail

4. **Initial eval cases** (20 total):
   - Brain (10): code questions, repo search, tool selection
   - Research (10): multi-step research, source quality, synthesis

### Files to Create

| File | Purpose |
|---|---|
| `tests/evals/runner.ts` | Eval runner integrated with Vitest |
| `tests/evals/scorers.ts` | Scorer implementations |
| `tests/evals/types.ts` | EvalCase, ScorerConfig, EvalResult types |
| `tests/evals/cases/brain.ts` | 10 eval cases for Brain graph |
| `tests/evals/cases/research.ts` | 10 eval cases for Research graph |
| `vitest.eval.config.mts` | Separate Vitest config (long timeout, serial execution) |

### Validation

- `pnpm test:eval` runs all cases and prints summary
- Results JSON written for comparison
- At least 80% of initial cases pass on current graphs (baseline, not regression)
