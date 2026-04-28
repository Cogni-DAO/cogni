---
id: bug.0420
type: bug
title: "Adapter error catches lose context — silent step failures + unstructured error envelopes need a cross-API standard"
status: needs_triage
priority: 2
rank: 30
estimate: 3
summary: 'Two related observability gaps surfaced during the V2 cutover (PR #1118). (1) `submitErc20Approve` and `submitCtfSetApproval` in `privy-poly-trader-wallet.adapter.ts` catch failures and stuff the error string into the step row''s `error` field but emit no log line — when the API response is dropped or 500''d by Zod (as happened during bug.0419 wrap-ABI debug), the failure detail is unrecoverable from Loki. Only the rolled-up `tx.reverted` summary survives. PR #1118 fixed the equivalent gap on the new `submitCollateralWrap` (`bug.0419`) by adding `wrap.error`, but the pattern hasn''t been generalized. (2) More broadly, our cross-adapter error envelope is inconsistent: `classifyClientError` in the polymarket CLOB adapter buckets thrown errors into `error_code: "unknown"` whenever the message doesn''t string-match a known pattern, dropping the JS error class, stack frame, response body, and any cause chain. PR #1118 added `error_class` + `stack_top` to that one call site as a pareto fix, but every other adapter (privy, langfuse, openrouter, viem, ethers) catches errors with its own ad-hoc shape. There''s no shared convention for what an adapter''s error log line should carry.'
outcome: "Two-part outcome: (a) every `submitX` step in `ensureTradingApprovals` emits a typed error log on the catch path, mirroring `wrap.error` from PR #1118 — operators can root-cause an Enable Trading failure from Loki alone, no DB read or response-body grep required. (b) A repo-wide convention lands for adapter error envelopes: shared `AdapterFailureDetails` (or extension on the existing pino base bindings) that carries `error_class`, `stack_top`, optional `http_status`, optional `response_keys`, and an enum `error_code` — adopted by polymarket-clob, polymarket-data-api, privy, viem-adapters, and any LLM adapter we own. New adapters opt in via the convention, not by reinventing per-class catch handlers."
spec_refs:
  - observability
  - poly-trader-wallet-port
assignees: []
project: proj.observability-hardening
labels: [observability, errors, adapters, cross-cutting]
created: 2026-04-28
updated: 2026-04-28
external_refs:
  - work/items/bug.0419.poly-v2-approval-contract-addresses.md
  - https://github.com/Cogni-DAO/node-template/pull/1118
  - packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts
  - nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts
---

# bug.0420 — Standardize adapter error envelopes; close silent-step-failure gap

> Surfaced during PR #1118's V2 cutover debug. Two specific symptoms below; both trace to a single missing convention.

## Symptom 1 — silent step failures in `ensureTradingApprovals`

Re-running Enable Trading on candidate-a to debug a wrap revert (the v2 SDK ABI bug, before bug.0419 shipped):

- `poly.wallet.enable_trading.start` fired (ok).
- `poly.wallet.enable_trading.tx.submitted/confirmed` fired for the first ERC20 approve (ok).
- The wrap reverted. The `submitCollateralWrap` catch block returned a failed `TradingApprovalStep` with `error: "<msg>"` populated, but **emitted no log line**.
- The high-level `tx.reverted` log summarized `step_states: ['set','failed','skipped',...]` but stripped the per-step error fields.
- The route's response body carried the structured detail — but it 500'd at Zod validation (separate bug, since fixed) and the response was discarded.
- Net result: operators had to grep the Zod parse error, decode the response body, and reverse-engineer which step failed.

PR #1118 closed the gap for `submitCollateralWrap` by emitting `poly.wallet.enable_trading.wrap.error` at the catch site. The same gap remains on `submitErc20Approve` and `submitCtfSetApproval` — they swallow into the step row and never log. If the next outage hits an approve revert, we'll be back to grepping route response bodies.

**Per-step error log emit, mirroring `wrap.error`'s shape:**

- `submitErc20Approve` → `poly.wallet.enable_trading.erc20_approve.error` with `token_contract`, `operator`, `err`, `error_class`.
- `submitCtfSetApproval` → `poly.wallet.enable_trading.ctf_set_approval.error` with `operator`, `err`, `error_class`.

Both at error-level. Carrying `billing_account_id` + `connection_id` so the row is correlatable per-tenant.

## Symptom 2 — `classifyClientError` collapses thrown errors into `error_code: "unknown"`

`packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts` → `classifyClientError(err)` reduces every thrown value to its `.message` string and runs a chain of `lowered.includes(...)` checks. Anything that doesn't pattern-match (transitive-dep `TypeError`, viem `ContractFunctionRevertedError`, axios `AxiosError`, native fetch `TypeError: fetch failed`, future `ZodError`) lands in the catch-all `unknown` bucket. The original error class, stack frame, `cause` chain, and any axios payload are dropped on the floor.

PR #1118 patched the symptom for this adapter — added `error_class` and `stack_top` optional fields to `ClobFailureDetails`, populated by `classifyClientError`, surfaced on the `placeOrder` error log. That fix is real, but **scoped to one adapter**.

We have a dozen-plus adapters in the tree (privy, viem, ethers, langfuse, openrouter, litellm, polymarket-clob, polymarket-data-api, polymarket-gamma, kalshi, paper, etc.). Each catches errors with its own ad-hoc shape. There's no shared convention for what an adapter's error log line should look like.

## Cross-cutting fix — the convention

Repo-wide minimum for adapter error catches:

| Field            | Required when               | Source                                                                                          |
| ---------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| `error_code`     | always                      | adapter-local closed enum (already exists per adapter — keep)                                   |
| `error_class`    | when `err instanceof Error` | `err.constructor.name`                                                                          |
| `reason`         | always                      | `err.message.slice(0, 256)` or `String(err)` truncated                                          |
| `stack_top`      | when `err instanceof Error` | first non-noise frame from `err.stack`, single line, ≤200 chars                                 |
| `http_status?`   | axios-shape errors          | `err.response.status`                                                                           |
| `response_keys?` | structured response body    | `Object.keys(err.response.data)` for `{}` vs `{error,code}` distinction (no values, just shape) |
| `cause_class?`   | `err.cause` is set          | `err.cause.constructor.name` — viem wraps lower-level errors here                               |

This generalizes the pareto fix from PR #1118 into a shared pattern. Implementation paths to evaluate:

- (A) **Helper in `@cogni/observability` (or wherever adapter-shared utilities live)**: `enrichAdapterError(err): AdapterFailureDetails`. Adapters call it inside their catch and spread into the log line. Lowest blast radius.
- (B) **Convention only, no shared code**: each adapter implements the same shape locally. Repeats the code but avoids cross-package churn.
- (C) **A pino formatter**: tag the log line with `level: error, isAdapter: true` and let a serializer hoist the fields. Loses type safety; pino formatters are global.

Lean toward (A) — one shared helper, every adapter calls it, no behavior change in the classifier.

## Out of scope

- Restructuring `classifyClobFailure` (the structured-body classifier) — works correctly, just doesn't apply when the error is thrown rather than returned.
- Adding metrics for `error_class` — Prometheus label cardinality risk; keep it log-only.
- Backfilling old logs — convention applies forward.

## Validation

**exercise:** induce a thrown error in `submitErc20Approve` (e.g. `walletClient.writeContract` mocked to throw a `TypeError`) and confirm a `*.error` log fires with `error_class`, `stack_top`, `err`, and the same correlation fields the success path carries.

**observability:**

```logql
# After this lands, every adapter error log carries error_class
{env="candidate-a", service="app"} | json | level="50" | error_class != ""
```
