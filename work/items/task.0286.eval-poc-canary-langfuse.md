---
id: task.0286
type: task
status: needs_implement
priority: 1
rank: 2
estimate: 3
title: "Eval POC — error analysis + 20 real cases, data-first, canary HTTP target"
summary: First actual evals. Error analysis of brain + pr-review graph outputs, then 20+ eval cases derived from observed failures. Code-based evals first, 1-2 LLM judges for subjective dimensions. Binary pass/fail. Advisory mode (no gating). Langfuse datasets.
outcome: "pnpm eval:canary runs 20+ eval cases (brain + pr-review) against live canary, reports pass/fail per case, pushes results to Langfuse. Advisory mode — logs results, does not gate."
initiative: proj.ai-evals-pipeline
assignees: []
labels: [ai, evals, langfuse, poc]
branch:
pr:
reviewer:
created: 2026-04-04
updated: 2026-04-06
---

# task.0286 — Eval POC: error analysis + 20 real cases on canary

## Design

### Outcome

`pnpm eval:canary` runs 20+ eval cases against the canary deployment, reports binary pass/fail per case, and pushes results to Langfuse as a dataset experiment. Advisory mode — exits 0 regardless, prints pass rate summary. Gating deferred to P1 after threshold calibration.

### Approach

**Solution:** Data-first eval development in 3 steps:

1. **Error analysis** — run 30-50 real prompts through brain + pr-review graphs, review every output, categorize failure modes (see [Error Analysis Protocol](../../work/charters/EVALS.md#error-analysis-protocol))
2. **Write evals from findings** — 20+ cases targeting the top 3-4 observed failure modes. Code-based assertions for deterministic failures. 1-2 binary LLM-as-judge evals for subjective dimensions only.
3. **Lightweight harness** — one vitest test file + dataset JSON + Langfuse push. Extract helpers later when seams are clear.

**Reuses:**

- Langfuse SDK (`langfuse` — already a dependency)
- OpenRouter API key (already in CI secrets) — raw `fetch`, no new npm deps
- Canary HTTP endpoint (same as E2E tests)
- Vitest (already in stack — timeouts, parallel, reporting for free)

**Rejected:**

- **Synthetic test cases** ("write a haiku") — top teams derive evals from observed failures, not invented scenarios. Evals without error analysis create a false sense of security.
- **Float scores with thresholds** (0.7 on 0-1 scale) — maximizes flakiness. Binary pass/fail only.
- **10-file decomposition** — premature abstraction for a POC. Start with 3 files, extract after patterns emerge.
- **Deployment gating in P0** — run advisory for 2+ weeks first to calibrate. Gating without calibration blocks real work on noise.
- **promptfoo / DeepEval** — revisit at 20+ evals across multiple graphs.

### Invariants

- [ ] DATA_FIRST: Error analysis completed before writing eval cases (charter: chr.evals)
- [ ] BINARY_PASS_FAIL: Every eval is yes/no, not a float score (charter: chr.evals)
- [ ] CODE_BEFORE_JUDGE: Deterministic assertions first, LLM judge only for subjective dimensions (charter: chr.evals)
- [ ] MINIMUM_20_CASES: At least 20 eval cases before the suite is useful (charter: chr.evals)
- [ ] ADVISORY_MODE: P0 logs results, does not gate deployments (charter: chr.evals)
- [ ] EVAL_CASES_FROM_FAILURES: Cases derived from error analysis, not invented (charter: chr.evals)
- [ ] NO_NEW_DEPS: Judge calls via raw fetch to OpenRouter, no new npm packages
- [ ] LANGFUSE_DATASET_EXPERIMENTS: All runs create Langfuse experiments for UI review

### Step 1: Error Analysis (prerequisite — before writing any eval code)

Run 30-50 real prompts through **brain** and **pr-review** graphs on the canary deployment. Save every input/output pair. Review each output (~30s each). Categorize into failure buckets.

**Brain graph prompts** (15-20):

- Code search queries ("find where GraphExecutorPort is defined")
- File listing queries ("what's in packages/ai-core/src/")
- Explanation queries ("explain how billing works in this codebase")
- Multi-step queries ("find all TODO comments and summarize them")
- Edge cases: queries about nonexistent files, ambiguous terms, very large results

**PR-review graph prompts** (10-15):

- Small focused diffs with clear rule violations (e.g., missing tests, oversized PR)
- Clean diffs that should score high across all metrics
- Diffs with mixed signals (good code, bad description)
- Edge cases: empty diff body, enormous diffs, diffs with only deletions
- Various evaluation criteria combinations (coherent-change, non-malicious, test-coverage)

**Expected failure buckets** (will be refined by actual data):

- Tool selection errors (wrong tool or no tool called — brain only)
- Hallucination (claims about code that don't exist)
- Format violations (wrong structure, missing required fields)
- Score calibration errors (scores inconsistent with evidence — pr-review)
- Incomplete responses (truncated, missing key information)
- Missing observations (scores present but no reasoning — pr-review)
- Irrelevant verbosity (correct answer buried in noise)

**Output:** `evals/analysis/error-analysis-v1.md` — annotated failure categories with counts and example traces.

### Step 2: Write Evals from Findings

Based on error analysis, write 20+ cases. Expected distribution (will shift based on findings):

**Code-based assertions (~15 cases):**

- Did brain call the right tool for a search query? (yes/no)
- Did brain call repo-list for a file listing query? (yes/no)
- Is the response non-empty? (yes/no)
- Did the response complete within 30s? (yes/no)
- Does the response mention the searched term? (yes/no)
- Does tool call have valid arguments (non-empty search term)? (yes/no)
- Does pr-review output valid structured JSON? (yes/no)
- Does pr-review output contain all required fields per metric (metric, value, observations)? (yes/no)
- Are pr-review scores in valid range 0.0-1.0? (yes/no)
- Does pr-review provide an observation for every scored metric? (yes/no)
- Does pr-review score a clearly-bad diff low (below 0.5)? (yes/no)
- Does pr-review score a clearly-good diff high (above 0.7)? (yes/no)

**LLM-as-judge — binary only (~5 cases):**

- Is the brain's code explanation accurate given the actual source? (yes/no — judge sees both response and real code)
- Is the pr-review observation coherent with the score given the diff evidence? (yes/no — judge sees diff + score + observation)

**Dataset format:**

```json
{
  "name": "brain-v1",
  "cases": [
    {
      "id": "brain-search-001",
      "input": {
        "message": "Find where GraphExecutorPort is defined",
        "graphName": "brain",
        "modelRef": {
          "providerKey": "platform",
          "modelId": "openai/gpt-4o-mini"
        }
      },
      "assertions": [
        { "type": "tool_called", "tool": "repo-search", "pass_if": "called" },
        {
          "type": "response_contains",
          "text": "GraphExecutorPort",
          "pass_if": "contains"
        },
        { "type": "latency_ms", "max": 30000, "pass_if": "under" },
        { "type": "non_empty", "pass_if": "true" }
      ]
    }
  ]
}
```

**LLM judge prompt template (binary):**

```
You are evaluating an AI assistant's response. Answer ONLY "PASS" or "FAIL".

Question: {input}
Response: {output}
Ground truth context: {context}

Criterion: {criterion}

Verdict (PASS or FAIL):
```

### Step 3: Harness Implementation

**3 files, not 10:**

```
evals/
  analysis/
    error-analysis-v1.md        # Step 1 output (committed, not code)
  datasets/
    brain-v1.json               # Brain graph eval cases
    pr-review-v1.json           # PR-review graph eval cases
  eval-canary.test.ts           # One vitest file: fetch, assert, judge, report
  vitest.config.ts              # Vitest config (test timeout, env vars)
```

**`eval-canary.test.ts` responsibilities** (single file, ~200 lines):

1. Load dataset JSON
2. For each case: POST to canary chat API (collect SSE stream → full response + tool events)
3. Run assertions (deterministic checks, binary pass/fail)
4. For judge cases: raw `fetch` to `https://openrouter.ai/api/v1/chat/completions` with 4o-mini, `temperature: 0`, parse "PASS"/"FAIL" from response
5. Push results to Langfuse: create/get dataset, run experiment, push scores
6. Print summary table: case ID, pass/fail, duration
7. Log aggregate pass rate (advisory — always exit 0)

Extract helpers into separate files ONLY when the single file exceeds 300 lines or a clear reuse seam emerges.

### Auth Strategy

The canary chat API requires NextAuth session auth. The E2E smoke tests do NOT authenticate — they only test public routes.

**Resolution: raw JWT via next-auth/jwt encode()**

The `createSyntheticSession()` fixture at `nodes/node-template/app/tests/_fixtures/auth/synthetic-session.ts` mints valid JWTs using `next-auth/jwt encode()`. It's marked DEFERRED for a JWE format issue, but the core approach (JWT signed with AUTH_SECRET) works for API routes.

For the eval harness:

1. Import `encode` from `next-auth/jwt`
2. Mint a session token with a test wallet address
3. Send as `Cookie: next-auth.session-token={token}` header
4. Requires `AUTH_SECRET` in eval runner env

If the JWE issue blocks this, fallback: add an `/api/internal/eval-health` endpoint that bypasses auth (secured by a shared secret header). But try JWT first.

### Environment Variables

```bash
# Required
EVAL_TARGET_URL=https://canary.cogni.dev     # Canary deployment URL
OPENROUTER_API_KEY=sk-or-...                 # For 4o-mini judge (raw fetch)
AUTH_SECRET=...                              # For minting eval session tokens
LANGFUSE_PUBLIC_KEY=pk-lf-...                # For pushing eval results
LANGFUSE_SECRET_KEY=sk-lf-...                # For pushing eval results
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com

# Optional
EVAL_JUDGE_MODEL=openai/gpt-4o-mini          # Default judge model
EVAL_TIMEOUT_MS=30000                        # Per-case timeout
```

### Files

- **Create:** `evals/analysis/error-analysis-v1.md` — error analysis findings (Step 1 output)
- **Create:** `evals/datasets/brain-v1.json` — brain graph eval cases (derived from error analysis)
- **Create:** `evals/datasets/pr-review-v1.json` — pr-review graph eval cases (derived from error analysis)
- **Create:** `evals/eval-canary.test.ts` — single vitest test file (fetch, assert, judge, report)
- **Create:** `evals/vitest.config.ts` — vitest config for eval runner
- **Modify:** `package.json` — add `eval:canary` script
- **Test:** Pass rate logged. Advisory mode (exit 0). Langfuse experiment created.

### Estimated Cost per Run

| Component                       | Cases  | Cost        |
| ------------------------------- | ------ | ----------- |
| Graph calls (4o-mini subject)   | 20     | ~$0.01      |
| Judge calls (4o-mini, ~5 cases) | 5      | ~$0.002     |
| **Total per run**               | **25** | **< $0.02** |

## Validation

```bash
# Step 1: Error analysis (manual — review outputs, write analysis doc)
# Run prompts against canary, save outputs, categorize failures

# Step 2-3: Run eval suite
EVAL_TARGET_URL=https://canary.cogni.dev pnpm eval:canary

# Expected output:
# ✓ brain-search-001    PASS  (1.2s)
# ✓ brain-search-002    PASS  (2.1s)
# ✗ brain-explain-003   FAIL  (tool_called: expected repo-search, got none)
# ...
# Pass rate: 17/20 (85%) — ADVISORY (no gate)
# Langfuse experiment: https://us.cloud.langfuse.com/...
```

## Review Checklist

- [ ] **Work Item:** task.0286 linked in PR body
- [ ] **Error Analysis:** `evals/analysis/error-analysis-v1.md` committed with categorized findings
- [ ] **Minimum Cases:** 20+ eval cases derived from error analysis (not synthetic)
- [ ] **Binary Pass/Fail:** Every assertion is yes/no
- [ ] **Code Before Judge:** Deterministic assertions outnumber LLM judge cases 3:1+
- [ ] **Advisory Mode:** Suite logs pass rate, always exits 0
- [ ] **Langfuse:** Experiment created, visible in UI
