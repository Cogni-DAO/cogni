---
id: task.0029
type: task
title: "Callback-driven billing — LiteLLM generic_api webhook replaces log scraping"
status: done
priority: 0
estimate: 1
summary: "P0 MVP: LiteLLM generic_api callback writes charge receipts via ingest endpoint. Fixes bug.0037 ($0 gateway billing). Old billing path coexists during cutover — idempotency prevents doubles."
outcome: "Callback-driven billing operational. Proxy billing path deleted — LiteLLM callback is sole cost authority (COST_AUTHORITY_IS_LITELLM). commitUsageFact() is a strict ledger writer: requires costUsd from LiteLLM, defers when unknown. Gateway nginx audit log removed."
spec_refs: billing-ingest-spec
assignees: derekg1729
credit:
project: proj.unified-graph-launch
branch: feat/billing-callback-fix
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-14
labels: [billing, litellm, p0, mvp]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# task.0029 — Callback-driven billing via LiteLLM generic_api webhook

## Context

bug.0037 (P0): all `sandbox:openclaw` LLM calls bill $0. Root cause: nginx proxy captures `x-litellm-response-cost` from response headers, but streaming SSE responses don't include cost in headers. The proxy-based billing approach is architecturally broken for streaming.

bug.0027 shipped a bridge fix (nginx JSONL audit log → shared volume → filesystem reads). This works for non-streaming but is the wrong architecture — file-based coupling, adapters constructing full `UsageFact` with cost data, separate billing codepaths per executor type.

The real fix: LiteLLM's `generic_api` callback fires AFTER the stream completes with full cost data. A single ingest endpoint receives all billing data. No log scraping anywhere.

## Requirements

Per billing-ingest-spec invariants (verified via spike 2026-02-13):

- **ONE_BILLING_PATH**: all billing confirmation is receipt-existence by `litellm_call_id` (callback payload `id` field)
- **ADAPTERS_NEVER_BILL**: adapters only emit `usage_unit_created{call_id}`; no cost parsing, no log reads
- **COST_ORACLE_IS_LITELLM**: cost comes from callback `response_cost` field — verified present and accurate for streaming
- **CHARGE_RECEIPTS_IDEMPOTENT_BY_CALL_ID**: duplicate callbacks are no-ops
- **NO_SYNCHRONOUS_RECEIPT_BARRIER**: user response never blocked waiting for callback arrival

## Allowed Changes

- `src/app/api/internal/billing/ingest/route.ts` — new ingest endpoint
- `src/contracts/billing-ingest.contract.ts` — Zod schema matching verified `StandardLoggingPayload`
- `platform/infra/services/runtime/configs/litellm.config.yaml` — add `generic_api` to `success_callback`
- `platform/infra/services/runtime/docker-compose.dev.yml` — add `GENERIC_LOGGER_ENDPOINT` + `GENERIC_LOGGER_HEADERS` env vars to litellm service
- `platform/infra/services/runtime/docker-compose.yml` — same for prod compose
- `src/shared/env/server.ts` — add `BILLING_INGEST_TOKEN`

## Plan

**P0 scope: steps 1-2 only.** Old billing path coexists safely (idempotent by `source_reference`). Adapter stripping, decorator changes, and old-path deletion are follow-up work after callback is proven in production.

- [ ] **1. Add ingest endpoint** — `POST /api/internal/billing/ingest` accepting `List[StandardLoggingPayload]` (Zod validated), shared-secret auth, calls `commitUsageFact()` per entry. Idempotent by `(source_system, source_reference)` where `source_reference` includes `litellm_call_id`. Safe alongside existing billing path.
- [ ] **2. Configure LiteLLM `generic_api` callback** — `success_callback: ["langfuse", "generic_api"]`, `GENERIC_LOGGER_ENDPOINT=http://app:3000/api/internal/billing/ingest`, `GENERIC_LOGGER_HEADERS=Authorization=Bearer ${BILLING_INGEST_TOKEN}`. Both old and new paths write receipts; idempotency prevents doubles.
- [ ] **3. Stack test** — Verify callback → receipt for streaming calls on paid models. `charge_receipts.response_cost_usd > 0` for gateway streaming.

### Deferred to follow-up (after callback proven in prod)

- Fix gateway `run_id` gap (OpenClaw outboundHeaders — cross-repo, `end_user` already works for account correlation)
- Add `usage_unit_created` event type + decorator change (steps 4 of original plan)
- Strip billing from adapters (step 5)
- Delete old paths: `ProxyBillingReader`, billing volumes, `OPENCLAW_BILLING_DIR` (step 6)

## Acceptance Criteria

- Ingest endpoint accepts `List[StandardLoggingPayload]`, validates via Zod, writes receipts idempotently
- LiteLLM `generic_api` callback fires on every successful LLM call and reaches ingest endpoint
- `charge_receipts` show accurate `response_cost_usd > 0` for paid model gateway streaming calls (bug.0037 resolved)
- Old billing path continues to function (no regressions during coexistence)
- Duplicate receipts (from old + new path writing same call) are no-ops via `UNIQUE(source_system, source_reference)`

## Validation

**Command:**

```bash
pnpm test:stack:dev
```

**Expected:** All existing sandbox + billing tests still pass. New stack test proves callback → receipt for streaming calls.

## Review Checklist

- [ ] **Work Item:** `task.0029` linked in PR body
- [ ] **Spec:** billing-ingest-spec invariants upheld (ONE_BILLING_PATH, ADAPTERS_NEVER_BILL, COST_ORACLE_IS_LITELLM, NO_SYNCHRONOUS_RECEIPT_BARRIER)
- [ ] **Tests:** ingest endpoint contract test + stack test proving callback → receipt for streaming calls
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Fixes: bug.0037 (gateway proxy zero-cost streaming)
- Supersedes: billing-sandbox-spec (proxy audit log pipeline)
- Companion: task.0039 (reconciliation worker — catches missing callbacks)
- Related: bug.0004 (activity dashboard cost column — separate fix)
- Handoff: [handoff](../handoffs/task.0029.handoff.md)

## Attribution

-
