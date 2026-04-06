---
id: task.0286
type: task
status: needs_implement
priority: 1
rank: 2
estimate: 3
title: "Eval POC — 2 evals with 4o-mini judge, Langfuse datasets, canary HTTP target"
summary: First actual evals. Poet quality + brain tool-calling. TypeScript harness, 4o-mini LLM-as-judge via OpenRouter, Langfuse dataset experiments, threshold gate. Runs against canary deployment.
outcome: "pnpm eval:canary runs 2 eval suites against live canary, scores with 4o-mini, pushes to Langfuse, exits non-zero on threshold failure."
initiative: proj.ai-evals-pipeline
assignees: []
labels: [ai, evals, langfuse, poc]
branch:
pr:
reviewer:
created: 2026-04-04
updated: 2026-04-04
---

# task.0286 — Eval POC: 2 evals with 4o-mini judge on canary

## Design

### Outcome

`pnpm eval:canary` runs 2 eval suites against the canary deployment, scores responses with 4o-mini, pushes scores to Langfuse as dataset experiments, and exits non-zero if any score falls below threshold.

### Approach

**Solution:** Lightweight TypeScript eval harness in `evals/` that:

1. Reads test cases from JSON dataset files
2. Calls canary HTTP chat API (same pattern as E2E Playwright tests)
3. Runs deterministic assertions (format, tool calls, latency)
4. Scores with 4o-mini via OpenRouter as LLM-as-judge
5. Pushes all results to Langfuse as dataset experiment runs
6. Checks aggregate scores against thresholds → exit code

**Reuses:**

- Langfuse SDK (`langfuse` — already a dependency)
- OpenRouter API key (already in CI secrets)
- Canary HTTP endpoint (same as E2E tests)
- Existing Langfuse env vars (public key, secret key, base URL)
- SSE stream parsing from existing test utils

**Rejected:**

- **promptfoo** — adds a new tool + YAML DSL. Overkill for 2 evals. Revisit at 20+ evals.
- **DeepEval** — Python-only. We're a TypeScript shop. Would require Python in CI.
- **LangSmith** — we already use Langfuse. Adding a second observability platform is waste.
- **In-process graph execution for canary evals** — user specifically wants deployment-level testing. In-process testing is a Phase 2 CI gate concern.

### Invariants

- [ ] EVAL_REGRESSION_GATE: Threshold failures produce non-zero exit code (spec: ai-evals-spec)
- [ ] GOLDEN_UPDATE_DISCIPLINE: Dataset changes require explicit commit messages (spec: ai-evals-spec)
- [ ] LANGFUSE_DATASET_EXPERIMENTS: All eval runs create Langfuse experiments for UI review
- [ ] JUDGE_MODEL_CHEAP: 4o-mini only — never use expensive models for judging
- [ ] CANARY_HTTP_TARGET: Evals hit the live deployment, not in-process graphs
- [ ] SIMPLE_SOLUTION: No new frameworks or dependencies beyond langfuse SDK
- [ ] ARCHITECTURE_ALIGNMENT: Follows evals/ directory structure from ai-evals-spec

### Eval 1: Poet Response Quality

**Graph:** `langgraph:poet`
**What it tests:** Can the simplest graph produce a coherent, relevant response?

```json
{
  "name": "poet-quality-v1",
  "cases": [
    {
      "input": {
        "message": "Write a haiku about TypeScript",
        "graphName": "poet",
        "modelRef": {
          "providerKey": "platform",
          "modelId": "openai/gpt-4o-mini"
        }
      },
      "assertions": {
        "deterministic": {
          "non_empty": true,
          "max_latency_ms": 15000,
          "min_length": 10
        },
        "llm_judge": {
          "prompt": "Score this haiku response on two dimensions:\n1. FORMAT (0-1): Is it a valid haiku (3 lines, roughly 5-7-5 syllables)?\n2. RELEVANCE (0-1): Is it about TypeScript?\nRespond as JSON: {\"format\": 0.X, \"relevance\": 0.X, \"reasoning\": \"...\"}",
          "thresholds": { "format": 0.7, "relevance": 0.7 }
        }
      }
    },
    {
      "input": {
        "message": "Write a limerick about debugging",
        "graphName": "poet",
        "modelRef": {
          "providerKey": "platform",
          "modelId": "openai/gpt-4o-mini"
        }
      },
      "assertions": {
        "deterministic": {
          "non_empty": true,
          "max_latency_ms": 15000,
          "min_length": 20
        },
        "llm_judge": {
          "prompt": "Score this limerick on two dimensions:\n1. FORMAT (0-1): Is it a valid limerick (5 lines, AABBA rhyme scheme)?\n2. RELEVANCE (0-1): Is it about debugging?\nRespond as JSON: {\"format\": 0.X, \"relevance\": 0.X, \"reasoning\": \"...\"}",
          "thresholds": { "format": 0.6, "relevance": 0.7 }
        }
      }
    }
  ]
}
```

### Eval 2: Brain Tool-Calling Accuracy

**Graph:** `langgraph:brain`
**What it tests:** Does the brain graph correctly invoke repo-search tools and synthesize results?

```json
{
  "name": "brain-tool-calling-v1",
  "cases": [
    {
      "input": {
        "message": "Search the codebase for the GraphExecutorPort interface and explain what it does",
        "graphName": "brain",
        "modelRef": {
          "providerKey": "platform",
          "modelId": "openai/gpt-4o-mini"
        }
      },
      "assertions": {
        "deterministic": {
          "non_empty": true,
          "max_latency_ms": 30000,
          "tool_called": ["repo-search"],
          "response_mentions": ["GraphExecutorPort", "graph"]
        },
        "llm_judge": {
          "prompt": "The user asked about GraphExecutorPort. Score the response:\n1. TOOL_USE (0-1): Did the agent search the codebase (not guess)?\n2. ACCURACY (0-1): Is the description of GraphExecutorPort correct?\n3. COMPLETENESS (0-1): Does it mention key details (interface, runGraph method, streaming)?\nRespond as JSON: {\"tool_use\": 0.X, \"accuracy\": 0.X, \"completeness\": 0.X, \"reasoning\": \"...\"}",
          "thresholds": {
            "tool_use": 0.8,
            "accuracy": 0.7,
            "completeness": 0.5
          }
        }
      }
    },
    {
      "input": {
        "message": "What files are in the evals/ directory?",
        "graphName": "brain",
        "modelRef": {
          "providerKey": "platform",
          "modelId": "openai/gpt-4o-mini"
        }
      },
      "assertions": {
        "deterministic": {
          "non_empty": true,
          "max_latency_ms": 30000,
          "tool_called": ["repo-list"]
        },
        "llm_judge": {
          "prompt": "The user asked about files in evals/. Score:\n1. TOOL_USE (0-1): Did the agent use a file listing tool?\n2. HONESTY (0-1): If the directory doesn't exist, does it say so honestly rather than hallucinate?\nRespond as JSON: {\"tool_use\": 0.X, \"honesty\": 0.X, \"reasoning\": \"...\"}",
          "thresholds": { "tool_use": 0.8, "honesty": 0.8 }
        }
      }
    }
  ]
}
```

### Files

- **Create:** `evals/datasets/poet-quality.json` — poet graph test cases
- **Create:** `evals/datasets/brain-tool-calling.json` — brain graph test cases
- **Create:** `evals/harness/runner.ts` — main eval orchestrator (iterate datasets, call API, score, report)
- **Create:** `evals/harness/judge.ts` — 4o-mini LLM-as-judge (call OpenRouter, parse structured JSON score)
- **Create:** `evals/harness/client.ts` — HTTP SSE client for canary chat API (collect full response + tool events)
- **Create:** `evals/harness/langfuse-experiment.ts` — create/get Langfuse datasets, push experiment runs + scores
- **Create:** `evals/harness/assertions.ts` — deterministic checks (non-empty, latency, tool called, mentions)
- **Create:** `evals/config.ts` — env config (EVAL*TARGET_URL, LANGFUSE*\*, OPENROUTER_API_KEY, EVAL_JUDGE_MODEL)
- **Create:** `evals/vitest.config.ts` — vitest config for running evals as test suite
- **Modify:** `package.json` — add `eval:canary` script
- **Create:** `evals/AGENTS.md` — directory scope doc
- **Test:** Evals themselves ARE the tests. Success = scores above thresholds.

### Auth Strategy for Canary API

The canary chat API requires authentication. Options (pick simplest):

1. **System API key** — if the canary has a system/service account with an API key, use it directly
2. **Test user session** — create a test user during canary provisioning, use its session token
3. **Bypass auth for eval endpoint** — add an `/api/internal/eval` route that skips auth (secured by network/secret)

Recommend option 1 or 2 — matches existing E2E test auth patterns. Check how `pnpm e2e:smoke` handles auth.

### Environment Variables

```bash
# Required for eval:canary
EVAL_TARGET_URL=https://canary.cogni.dev     # Canary deployment URL
EVAL_JUDGE_MODEL=openai/gpt-4o-mini          # Judge model (via OpenRouter)
OPENROUTER_API_KEY=sk-or-...                 # For judge calls (already in CI)
LANGFUSE_PUBLIC_KEY=pk-lf-...                # Already in CI
LANGFUSE_SECRET_KEY=sk-lf-...                # Already in CI
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com  # Already configured

# Optional
EVAL_TIMEOUT_MS=30000                        # Per-case timeout
EVAL_FAIL_THRESHOLD=0.7                      # Global pass/fail threshold
```

### Estimated Cost per Run

| Component                     | Cases | Cost        |
| ----------------------------- | ----- | ----------- |
| Poet graph (4o-mini subject)  | 2     | ~$0.001     |
| Brain graph (4o-mini subject) | 2     | ~$0.002     |
| 4o-mini judge calls           | 4     | ~$0.001     |
| **Total per run**             | **4** | **< $0.01** |

## Validation

```bash
# Against canary deployment
EVAL_TARGET_URL=https://canary.cogni.dev pnpm eval:canary

# Expected: 4 test cases run, scores printed, Langfuse experiment created, exit 0
```

## Review Checklist

- [ ] **Work Item:** task.0286 linked in PR body
- [ ] **Spec:** ai-evals-spec invariants upheld (EVAL_REGRESSION_GATE, GOLDEN_UPDATE_DISCIPLINE)
- [ ] **Tests:** Evals are self-testing — scores above thresholds = pass
- [ ] **Reviewer:** assigned and approved
