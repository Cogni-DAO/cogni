---
id: task.0149
type: task
title: "PR Review Bot V0 — LangGraph graph + gate orchestrator for automated PR review"
status: needs_merge
priority: 1
rank: 1
estimate: 4
summary: "Port cogni-git-review's core review logic into cogni-template: a pr-review LangGraph graph (single-call structured output, no ReAct tools), a deterministic gate orchestrator, installation token factory for outbound GitHub API calls, and Check Run + PR comment output. V0 self-install only, billing to system tenant."
outcome: "When a PR is opened/updated on this repo, the webhook fires, a pr-review graph evaluates the diff against `.cogni/rules/*.yaml` via the graph executor (billed to system tenant), a gate orchestrator applies success_criteria thresholds deterministically, and results post as a GitHub Check Run + PR comment."
spec_refs:
  - vcs-integration
  - unified-graph-launch
assignees: []
credit:
project: proj.vcs-integration
branch:
pr:
reviewer:
revision: 3
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-10
labels: [vcs, ai, review, langgraph]
external_refs:
  - https://github.com/cogni-dao/cogni-git-review
---

# PR Review Bot V0 — LangGraph Graph + Gate Orchestrator

## Problem

`cogni-git-review` is a standalone Probot app that reviews PRs against declarative rules. This repo already has the GitHub App webhook infrastructure (for attribution ingestion), the LangGraph graph framework, the graph executor with LLM routing + cost tracking + billing, and `.cogni/repo-spec.yaml` with gate + rule definitions — but no review agent. We need to absorb the review logic without Probot, running it through our existing LLM infrastructure.

## Design

### Prerequisites

- **GitHub App `checks:write` permission**: The Review App must have `checks:write` to create Check Runs. Verify at GitHub App settings before implementation. (Per vcs-integration spec §Permission Matrix, the Review App should have this.)
- **No new env vars**: Uses existing `GH_REVIEW_APP_ID`, `GH_REVIEW_APP_PRIVATE_KEY_BASE64`, `GH_WEBHOOK_SECRET`. Installation ID extracted from webhook payload (`installation.id`).

### Crawl/Walk/Run Phasing

**Crawl** — Single-call structured output. The graph receives pre-fetched PR evidence (diff summary + file patches, budget-aware truncation done _outside_ the LLM) and a rule's `evaluations[]`. One LLM call via the graph executor produces per-metric 0-1 scores + observations. No ReAct tools — evidence gathering is deterministic. The webhook handler applies `success_criteria` thresholds directly.

**Walk** — Gate orchestrator. Factor out threshold evaluation into a deterministic gate runner that processes `gates[]` from repo-spec in order. Built-in gates (`review-limits` for PR size checks) run without LLM. AI-rule gates invoke the pr-review graph. Each gate returns a normalized result. Orchestrator aggregates to overall pass/fail/neutral with per-gate timeout + crash isolation.

**Run** — Multi-repo install support. DB-backed installation tracking (`operator_node_registrations`). Dynamic repo-spec fetching from installed repos. Token provider selects correct installation token per repo. This is task.0122 territory.

**This task implements Crawl + Walk** (both fit in one PR).

### Architecture

```
GitHub webhook (pull_request.opened / .synchronize / .reopened)
  │
  ├─ [existing] POST /api/internal/webhooks/github
  │     ├─ Verify signature (existing)
  │     ├─ Return 200 immediately
  │     ├─ [existing] GitHubWebhookNormalizer → attribution events (sync)
  │     │
  │     └─ [NEW] Fire-and-forget: dispatch PR review handler (async)
  │           │  Errors logged via Pino, never block webhook response
  │           │
  │           ├─ Filter: pull_request + action in [opened, synchronize, reopened]
  │           ├─ Build Octokit client (JWT → installation token, from webhook payload)
  │           ├─ Fetch PR diff + file list via Octokit (budget-aware truncation)
  │           ├─ Create GitHub Check Run (status: in_progress)
  │           ├─ Load .cogni/repo-spec.yaml gates config (local fs)
  │           │
  │           ├─ Gate Orchestrator (deterministic, no LLM)
  │           │   ├─ For each gate in spec order:
  │           │   │   ├─ review-limits: check file count + diff size → pass/neutral
  │           │   │   └─ ai-rule: invoke pr-review graph via internal API
  │           │   │       ├─ POST /api/internal/graphs/{graphId}/runs
  │           │   │       │   (same endpoint executeGraphActivity uses)
  │           │   │       ├─ Caller: system tenant (COGNI_SYSTEM_BILLING_ACCOUNT_ID)
  │           │   │       ├─ Evidence pre-fetched, passed as message content
  │           │   │       ├─ Single LLM call → structured output (0-1 scores)
  │           │   │       └─ Return metrics to orchestrator
  │           │   │   Apply success_criteria thresholds deterministically
  │           │   ├─ Per-gate timeout (default 120s) → neutral on timeout
  │           │   └─ Aggregate: fail > neutral > pass
  │           │
  │           ├─ Update GitHub Check Run (conclusion: success/failure/neutral)
  │           │   └─ Summary: per-gate markdown with scores + observations
  │           │
  │           └─ Post PR Comment (staleness guard — skip if HEAD SHA changed)
  │               └─ Developer-friendly summary + DAO vote link if configured
```

### Key Design Decisions

| Decision                  | Choice                                                                                 | Rationale                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Graph execution path      | `POST /api/internal/graphs/{graphId}/runs` — same endpoint `executeGraphActivity` uses | Reuses existing billing/routing/cost-tracking. Avoids creating a third execution path. Easy to wrap in Temporal `GraphRunWorkflow` when it exists (unified-graph-launch P1). Aligns with unified-graph-launch P2 (webhook triggers). |
| LLM routing               | Internal API → graph executor → LiteLLM → system tenant billing                        | Cost tracking, model routing via LiteLLM, billing to `COGNI_SYSTEM_BILLING_ACCOUNT_ID`. No new billing path. No direct GraphExecutorPort calls from webhook context.                                                                 |
| Evidence gathering        | Pre-fetch outside LLM, pass as context                                                 | Cheaper (one LLM call), deterministic, budget-controllable. Walk+ can add ReAct tools if needed.                                                                                                                                     |
| Async execution           | Fire-and-forget from webhook handler                                                   | GitHub expects 200 within 10s. Review takes 30-120s. Errors logged, never block webhook.                                                                                                                                             |
| Installation token        | JWT sign + exchange per webhook                                                        | Extract `installation.id` from webhook payload. No new env vars. Token factory in `src/adapters/server/review/`.                                                                                                                     |
| System tenant virtual key | Lookup at handler init                                                                 | `LlmCaller` requires `virtualKeyId`. Query system tenant's default virtual key from DB at startup/first-use, cache in memory.                                                                                                        |
| No Probot                 | Direct Octokit + `@octokit/auth-app`                                                   | NO_PROBOT_DEPENDENCY per vcs-integration spec                                                                                                                                                                                        |
| No new env vars           | Reuse `GH_REVIEW_APP_*`                                                                | Already configured for attribution webhook verification                                                                                                                                                                              |
| repo-spec schema          | Add gates/rules validation with `.passthrough()`                                       | Fields exist in YAML today but aren't validated. Add validation without breaking existing parsing.                                                                                                                                   |

### Key Porting Decisions

| cogni-git-review                         | cogni-template adoption                 | Rationale                                                                        |
| ---------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| Probot framework                         | Drop entirely                           | NO_PROBOT_DEPENDENCY; Next.js webhook routes                                     |
| `goal-evaluations` LangGraph ReAct agent | Single-call structured output graph     | Cheaper; evidence is deterministic                                               |
| `context.vcs.*` host abstraction         | Skip for V0                             | Self-install only                                                                |
| Gate registry (filesystem scan)          | Static registry map                     | 2 gate types suffice                                                             |
| AJV schema validation                    | Zod (project standard)                  | Consistency                                                                      |
| OpenRouter direct                        | Internal API → graph executor → LiteLLM | Unified LLM routing + cost tracking via same endpoint as Temporal scheduled runs |
| No billing                               | System tenant billing                   | All LLM calls tracked and costed                                                 |

## Requirements

- **R1**: `pull_request` webhooks with action `opened`, `synchronize`, or `reopened` trigger PR review (in addition to existing attribution normalization)
- **R2**: Review dispatched as fire-and-forget after returning 200 — never blocks webhook response or attribution processing
- **R3**: A GitHub Check Run named "Cogni Git PR Review" is created (in_progress) then updated (success/failure/neutral)
- **R4**: Gate orchestrator processes `gates[]` from `.cogni/repo-spec.yaml` in order, with per-gate timeout (120s default), crash isolation (gate crash → neutral), and priority aggregation (fail > neutral > pass)
- **R5**: `review-limits` gate checks `max_changed_files` and `max_total_diff_kb` without LLM — pure numeric comparison
- **R6**: `ai-rule` gate pre-fetches PR evidence (diff + files, budget-truncated), invokes the pr-review graph via `POST /api/internal/graphs/{graphId}/runs` (same endpoint as `executeGraphActivity`) with system tenant caller, receives per-metric 0-1 scores, and applies `success_criteria` thresholds deterministically
- **R7**: PR comment posted with staleness guard (skip if HEAD SHA changed during review)
- **R8**: Check Run summary includes per-gate results with scores, observations, and overall conclusion
- **R9**: DAO "Propose Vote to Merge" link included in summary when `cogni_dao` is configured in repo-spec
- **R10**: Self-install only — reads `.cogni/` from local filesystem, uses existing `GH_REVIEW_APP_*` credentials, no new env vars

## Allowed Changes

- `packages/langgraph-graphs/src/graphs/pr-review/` — new graph (graph.ts, state.ts, prompts.ts)
- `packages/langgraph-graphs/src/catalog.ts` — register pr-review graph
- `packages/repo-spec/src/` — extend schema for gates + rules Zod validation
- `src/features/review/` — new feature module (gate orchestrator, review handler, summary formatter, criteria evaluator)
- `src/app/api/internal/webhooks/[source]/route.ts` — add fire-and-forget review dispatch
- `src/adapters/server/review/` — installation token factory, Check Run adapter, PR comment adapter
- `src/shared/constants/system-tenant.ts` — add `COGNI_SYSTEM_VIRTUAL_KEY_ID` if needed (or lookup helper)
- `.cogni/repo-spec.yaml` — no changes needed (already has gates config)
- `.cogni/rules/*.yaml` — no changes needed (already exist)
- Test files for all new modules

## Plan

### Phase 0: Installation Token Factory (src/adapters/server/review)

- [ ] `github-auth.ts` — JWT signing via `@octokit/auth-app` using existing `GH_REVIEW_APP_ID` + `GH_REVIEW_APP_PRIVATE_KEY_BASE64` env vars
- [ ] `createInstallationOctokit(installationId)` — signs JWT, exchanges for installation token, returns authenticated Octokit
- [ ] Verify GitHub App has `checks:write` permission (manual step, document in PR)
- [ ] Unit tests with mocked auth exchange

### Phase 1: Gate + Rule Schema (packages/repo-spec)

- [ ] Add `.passthrough()` to `repoSpecSchema` to preserve unvalidated fields during transition
- [ ] Add Zod schemas for `gates[]` entries (review-limits config, ai-rule config with rule_file reference)
- [ ] Add Zod schema for rule YAML files (evaluations[], success_criteria with require/any_of + comparison operators: gte, gt, lte, lt, eq)
- [ ] Add `parseRule(yamlString)` pure function — validates rule YAML against schema
- [ ] Add `extractGatesConfig(spec)` accessor — returns validated gates array
- [ ] Unit tests for gate + rule schema validation (including existing `.cogni/rules/*.yaml` files as fixtures)

### Phase 2: PR Review LangGraph Graph (single-call structured output)

- [ ] Create `packages/langgraph-graphs/src/graphs/pr-review/` with state.ts, prompts.ts, graph.ts
- [ ] **No tools.ts** — this graph has no tools (evidence is pre-fetched)
- [ ] Prompt: receives pre-fetched evidence + rule evaluation statements, instructs LLM to score each metric 0-1 with observations
- [ ] Graph: single-node graph that calls LLM once with structured output schema (dynamic from rule's evaluations[])
- [ ] Register in catalog.ts with empty `toolIds: []`
- [ ] Unit tests for graph creation + prompt formatting

### Phase 3: Gate Orchestrator (src/features/review)

- [ ] `types.ts` — GateResult, GateStatus (pass/fail/neutral), ReviewResult, ReviewContext, EvidenceBundle interfaces
- [ ] `evidence-gatherer.ts` — pre-fetches PR diff + file list via Octokit, applies budget truncation (max files, max patch bytes from review-limits config)
- [ ] `criteria-evaluator.ts` — deterministic threshold evaluation (require[], any_of[], comparison operators gte/gt/lte/lt/eq, neutral_on_missing_metrics)
- [ ] `gates/review-limits.ts` — file count + diff size check (no LLM, pure numeric)
- [ ] `gates/ai-rule.ts` — builds message from evidence + rule, invokes graph via `POST /api/internal/graphs/{graphId}/runs` with system tenant caller (same endpoint as `executeGraphActivity`), extracts structured metrics, delegates to criteria-evaluator
- [ ] `gate-orchestrator.ts` — processes gates[] in order, per-gate timeout (Promise.race), crash isolation (try/catch → neutral), result aggregation (fail > neutral > pass)
- [ ] System tenant caller construction: `COGNI_SYSTEM_BILLING_ACCOUNT_ID` + lookup system tenant's default virtual key ID from DB (cache after first lookup)
- [ ] Internal API client: reuse `SCHEDULER_API_TOKEN` for auth header (same token `executeGraphActivity` uses), call `POST /api/internal/graphs/{graphId}/runs` with `{ messages, caller }` payload
- [ ] Unit tests for orchestrator, each gate, criteria evaluator, and evidence gatherer

### Phase 4: GitHub Output Adapters (src/adapters/server/review)

- [ ] `check-run.ts` — create/update GitHub Check Run via Octokit (in_progress → conclusion)
- [ ] `pr-comment.ts` — post PR comment with staleness guard (fetch current HEAD SHA before posting, skip if changed)
- [ ] `summary-formatter.ts` — markdown rendering for Check Run output + PR comment body (per-gate sections, scores, observations, DAO vote link)
- [ ] Unit tests with mocked Octokit

### Phase 5: Webhook Integration

- [ ] `src/features/review/services/review-handler.ts` — orchestrates full flow: build Octokit → create check → gather evidence → run gates → update check → post comment
- [ ] Wire into webhook route: after returning 200 and processing attribution, dispatch `reviewHandler(payload).catch(logError)` as fire-and-forget for `pull_request` events
- [ ] Extract `installation.id` from webhook payload for Octokit client creation
- [ ] Note: when `GraphRunWorkflow` exists (unified-graph-launch P1), the fire-and-forget dispatch becomes `temporalClient.start(GraphRunWorkflow, ...)` — this is the P2 webhook trigger use case from that spec. The internal API call inside the gate stays the same.
- [ ] Integration test: mock webhook payload → verify check run + comment calls + system tenant billing

### Phase 6: Validation

- [ ] `pnpm check` passes (lint + type + format)
- [ ] All new unit tests pass
- [ ] Manual test: create a PR on this repo, verify Check Run appears + PR comment posts

## Validation

**Command:**

```bash
pnpm check
```

**Expected:** Clean lint, types, format.

**Command:**

```bash
pnpm test packages/repo-spec/
pnpm test packages/langgraph-graphs/src/graphs/pr-review/
pnpm test src/features/review/
pnpm test src/adapters/server/review/
```

**Expected:** All tests pass.

**Manual validation:**

1. Push a branch, open a PR against staging
2. GitHub Check Run "Cogni PR Review" appears with in_progress → success/failure
3. PR comment with per-gate scores and observations appears
4. If PR is updated (new push), new review runs and old comment is superseded
5. System tenant billing account shows charge_receipts for review LLM calls

## Review Checklist

- [ ] **Work Item:** `task.0149` linked in PR body
- [ ] **Spec:** vcs-integration invariants upheld (NO_PROBOT_DEPENDENCY, WEBHOOK_SIGNATURE_REQUIRED, REVIEW_HANDLER_VIA_GRAPH)
- [ ] **Spec:** unified-graph-launch alignment — graph execution via internal API (same endpoint as `executeGraphActivity`), no new execution path
- [ ] **Tests:** unit tests for all new modules, integration test for webhook → review flow
- [ ] **No new env vars** — all auth from existing `GH_REVIEW_APP_*`
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Sister repo: https://github.com/cogni-dao/cogni-git-review
- Spec: docs/spec/vcs-integration.md
- Spec: docs/spec/unified-graph-launch.md (execution path alignment)
- Existing gates config: .cogni/repo-spec.yaml
- Existing rules: .cogni/rules/\*.yaml
- System tenant: src/shared/constants/system-tenant.ts

## Review Feedback

### Revision 3 — Blocking Issues

1. **No unit tests for feature layer** — criteria-evaluator, gate-orchestrator, ai-rule (parseScoresFromResponse), review-limits, summary-formatter all have zero tests. Tests are required per TESTS_PROVE_WORK.

2. **Timer leak in gate-orchestrator** — `timeout()` helper at `gate-orchestrator.ts:139-150` creates a `setTimeout` that is never cleared when the gate completes before timeout. In a long-running process handling many PRs, this leaks timers.

## Attribution

-
