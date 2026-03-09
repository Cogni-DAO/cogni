---
id: task.0029.handoff
type: handoff
work_item_id: task.0029
status: active
created: 2026-02-12
updated: 2026-02-13
branch: fix/kill-proxy-billing-path
last_commit: 00a440ae
---

# Handoff: Kill proxy billing path — LiteLLM callback is sole cost authority

## Context

- **task.0029** shipped a LiteLLM `generic_api` callback ingest endpoint (PR #399, `feat/billing-callback-fix`). The callback writes `charge_receipts` with real cost data.
- **Duplicate receipt bug:** Gateway calls produced TWO receipts — $0 from `ProxyBillingReader` (synchronous audit log) and real-cost from callback (async). Different `source_reference` keys prevented idempotency dedup.
- **This branch** (`fix/kill-proxy-billing-path`, off `feat/billing-callback-fix`) deletes the entire proxy audit log billing path, refactors `commitUsageFact()` to be a strict LiteLLM-authoritative receipt writer, and removes the legacy nginx audit log.

## Current State

- **6 commits on `fix/kill-proxy-billing-path`:**
  1. `0aa9a895` — Delete ProxyBillingReader, billing volumes, OPENCLAW_BILLING_DIR, factory wiring
  2. `de01a5f6` — Refactor `commitUsageFact()`: cost-known/unknown branching, remove `isModelFree()` call, add billing metrics
  3. `6d952d5e` — Rename invariants across codebase (spec, route, AGENTS.md, tests)
  4. `516859ed` — Rewrite unit tests, fix lint in stack tests
  5. `51e00cf2` — (band-aid) mkdir for /billing — superseded by commit 6
  6. `00a440ae` — Remove legacy audit log from gateway nginx config entirely
- **Verified:** `pnpm typecheck` passes, `pnpm check:docs` passes, unit tests pass (4/4)
- **NOT done:** `pnpm test:contract`, push, PR creation, E2E verification, squash commits 5+6

## Decisions Made

1. **COST_AUTHORITY_IS_LITELLM** — `commitUsageFact()` does NOT consult model catalog. `costUsd` must come from LiteLLM (0 is valid). See `billing.ts:97-122`.
2. **RECEIPT_WRITES_REQUIRE_CALL_ID_AND_COST** — Receipt written iff `usageUnitId` exists AND `costUsd` is a number. Unknown cost → defer (litellm) or error (other).
3. **Metrics for alerting, not logs** — `billingMissingCostDeferredTotal` and `billingInvariantViolationTotal` counters in `metrics.ts`. Defer path uses `log.debug` (expected path, not a warning).
4. **Nginx audit log deleted** — Gateway proxy no longer writes `/billing/audit.jsonl`. Ephemeral proxy (`nginx.conf.template`) still uses audit logs for its own billing path.
5. **Commits 5+6 should be squashed** — Commit 5 was a band-aid (`mkdir /billing`), commit 6 is the proper fix (remove audit log). Squash before PR.

## Next Actions

- [ ] Squash commits 5+6 (or interactive rebase to fold 6 into 1)
- [ ] Run `pnpm test:contract` — verify contract tests pass
- [ ] Push `fix/kill-proxy-billing-path` and create PR against `feat/billing-callback-fix` (or `staging`)
- [ ] E2E: `pnpm dev:stack`, run gateway call, verify exactly ONE receipt with cost > 0
- [ ] Update handoff doc with final state after merge

## Risks / Gotchas

- **Silent callback failure = no receipt.** If LiteLLM callback fails, paid calls have ZERO receipts. Reconciler (task.0039) is the planned safety net but not yet built. Monitor `billing_missing_cost_deferred_total` metric.
- **Docker volume orphans.** Existing deployments have `openclaw_billing` named volume. Needs `docker volume prune` on deploy.
- **`ProxyBillingEntry` type stays.** Still used by ephemeral sandbox path (`LlmProxyManager.stop()`). Do not delete from `src/ports/sandbox-runner.port.ts`.
- **Ephemeral proxy unaffected.** `nginx.conf.template` (non-gateway) still writes audit logs to `${ACCESS_LOG_PATH}` — that's the ephemeral billing path, separate system.

## Pointers

| File / Resource                                                     | Why it matters                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/features/ai/services/billing.ts`                               | `commitUsageFact()` — cost-known/unknown branching at lines 97-122   |
| `src/shared/observability/server/metrics.ts`                        | `billingMissingCostDeferredTotal` + `billingInvariantViolationTotal` |
| `docs/spec/billing-ingest.md`                                       | Invariants table — 4 new billing invariants                          |
| `platform/infra/services/sandbox-proxy/nginx-gateway.conf.template` | Audit log removed                                                    |
| `tests/unit/features/ai/billing-receipt-invariants.spec.ts`         | 4 unit tests proving the invariants                                  |
| `work/items/task.0029.callback-driven-billing-kill-log-scraping.md` | Parent work item                                                     |
| PR #399 (`feat/billing-callback-fix`)                               | Base branch                                                          |
