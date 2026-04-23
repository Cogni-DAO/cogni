---
id: task.0355
type: task
title: "Poly trading wallet — Enable Trading (token approvals + readiness gate)"
status: needs_review
priority: 1
rank: 10
estimate: 5
created: 2026-04-22
updated: 2026-04-22
summary: "Productize the missing third onboarding step — Polymarket token approvals — as a first-class multi-tenant backend capability + Money-page UI. Today the 3× USDC.e `approve` + 2× CTF `setApprovalForAll` calls only exist in the raw-PK experiment script `scripts/experiments/approve-polymarket-allowances.ts`, making Phase B3 (task.0318) untestable by any real user and leaving `deploy_verified: true` unreachable. This task adds a `PolyTraderWalletPort.ensureTradingApprovals` method signed via Privy HSM, a `POST /api/v1/poly/wallet/enable-trading` route, a readiness signal on `poly.wallet.status.v1`, an `APPROVALS_BEFORE_PLACE` invariant on `authorizeIntent`, and an Enable-Trading flow on the Money page that mirrors Polymarket's own 3-step modal (Deploy ✓ / Sign ✓ / Approve ⬜)."
outcome: "A freshly provisioned + funded tenant clicks one button on the Money page, signs nothing manually, and ends with a wallet that can BUY and SELL on Polymarket — confirmed by placing a real mirror trade on candidate-a, observed in Loki at the deployed SHA. `authorizeIntent` fail-closes with `trading_not_ready` for any tenant whose approvals haven't completed, so no placement can reach the CLOB and silently empty-reject."
spec_refs:
  - docs/spec/poly-trader-wallet-port.md
  - docs/spec/poly-multi-tenant-auth.md
  - docs/guides/polymarket-account-setup.md
assignees: []
credit:
project: proj.poly-copy-trading
branch: design/task-0355-enable-trading-approvals
pr:
reviewer:
revision: 0
blocked_by: []
labels:
  [poly, wallet, onboarding, approvals, privy, ui, blocker-for-deploy-verified]
---

# task.0355 — Poly trading wallet: Enable Trading (token approvals)

## Problem

Polymarket's own web onboarding is a 3-step modal: **Deploy Proxy Wallet → Enable Trading (sign) → Approve Tokens**. Our per-tenant Poly stack has 1 + 2 covered and is silent on 3:

| Polymarket step           | Cogni-template equivalent                                                                                                   | Shipped? |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| Deploy Proxy Wallet       | `provisionWithGrant` (EOA-direct, no proxy — deliberate)                                                                    | ✅       |
| Enable Trading (sign msg) | `createOrDerivePolymarketApiKeyForSigner` (lazy on first placement)                                                         | ✅       |
| Approve Tokens            | **Nothing productized** — only `scripts/experiments/approve-polymarket-allowances.ts`, raw-PK, single-operator, run-by-hand | ❌       |

**Net effect:** a user who `connect`s, funds the returned address with USDC.e + POL, and registers a copy-trade target will still see zero placements land. The mirror pipeline will enter the hot path, `authorizeIntent` will return `ok`, `placeOrder` will hit the CLOB, and the CLOB will silently empty-reject every BUY (missing USDC.e allowance on Exchange / Neg-Risk Exchange / Neg-Risk Adapter) and empty-reject every SELL on neg_risk markets (missing CTF `setApprovalForAll`). This is the failure mode of [bug.0335](./bug.0335.poly-clob-buy-empty-reject-candidate-a.md) and it applies to every freshly provisioned per-tenant wallet.

**Consequence for task.0318 Phase B3:** PR #990 has passed static checks and component tests, but its feature gate (`deploy_verified: true`) is unreachable without this task — no tenant can complete an end-to-end trade on candidate-a. Every downstream trading feature (task.0347 preferences, task.0351 withdraw, task.0352 fund flow) inherits the same dependency.

This is also **not a script problem**. This is a multi-tenant productized capability: every user that connects a trading wallet must, before placing their first trade, execute five on-chain approvals from their Privy-custodied wallet. The existing experiment script requires a raw private key and the operator's env file — neither of which is legal in the per-tenant path.

## Scope

In:

**Backend — port + adapter:**

- **New port method** on `PolyTraderWalletPort` (`packages/poly-wallet/src/port/poly-trader-wallet.port.ts`):
  ```ts
  ensureTradingApprovals(billingAccountId: string): Promise<TradingApprovalsState>;
  ```
  where `TradingApprovalsState` is
  ```ts
  {
    ready: boolean;                   // true iff all 5 targets are at max / approved
    address: 0x${string};             // funder address (same as getBalances)
    polBalance: number;               // native POL for gas; surfaces insufficient_pol_gas pre-submit
    steps: readonly {
      kind: "erc20_approve" | "ctf_set_approval_for_all";
      label: string;                  // "USDC.e → Exchange", "CTF → Neg-Risk Exchange", …
      tokenContract: 0x${string};     // USDC.e or CTF — pinned constants
      operator: 0x${string};          // one of the five pinned spenders/operators
      beforeState: "missing" | "partial" | "satisfied";
      afterState: "satisfied" | "failed";
      txHash: 0x${string} | null;     // null when beforeState === satisfied (no-op)
      error: string | null;           // "insufficient_pol_gas" | "rpc_timeout" | "reverted" | …
    }[];
    readyAt: Date | null;             // stamped iff ready === true
  }
  ```
- **Adapter impl** on `PrivyPolyTraderWalletAdapter` (`nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts`):
  - Resolve the signing context via existing `resolve()`.
  - Pre-check `POL` balance ≥ `ENABLE_TRADING_MIN_POL_GAS_WEI` (constant, ≈ 0.05 POL for headroom across 5 txs). If short → return `ready: false`, all steps `error: "insufficient_pol_gas"`, no txs submitted. (Gas funding UX hand-off to [task.0352](./task.0352.poly-trading-wallet-fund-flow.md).)
  - Read current state for all 5 targets (3 `allowance(...)` + 2 `isApprovedForAll(...)`) in parallel. Skip any already at `maxUint256` / `true`.
  - Submit the remaining approvals **in sequence** (not parallel — avoids nonce races on the same Privy signer; matches the existing experiment script). For each: `writeContract` → `waitForTransactionReceipt` (1 conf) → verify post-state at the receipt's block (publicnode RPCs round-robin; fresh reads can hit a lagging node — the script already handles this).
  - On full success, stamp `poly_wallet_connections.trading_approvals_ready_at = now()` (new column, see migration below). On partial failure, leave it NULL; return the partial state to the caller so the UI can show which step failed.
- **Pinned constants** in the adapter (not env, not user-input — `APPROVAL_TARGETS_PINNED` invariant):
  ```ts
  USDC_E_POLYGON = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
  CTF_POLYGON = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
  EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
  NEG_RISK_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
  NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";
  ERC20_SPENDERS = [EXCHANGE, NEG_RISK_EXCHANGE, NEG_RISK_ADAPTER]; // USDC.e
  CTF_OPERATORS = [EXCHANGE, NEG_RISK_EXCHANGE]; // ERC-1155 set-for-all
  ```
  These are Polymarket's mainnet addresses (source-of-truth: `@polymarket/clob-client` `config.js`, and `scripts/experiments/approve-polymarket-allowances.ts`). No user input, no env var, no per-deployment override.
- **Approval amount**: `maxUint256` per USDC.e spender (matches Polymarket's own onboarding). Risk accepted — per-tenant Privy wallet is isolated, `revoke` cascades, grant caps bound per-session damage, and anything less than max means a second approval tx every cap-rebalance.

**Authz gate — new invariant:**

- `APPROVALS_BEFORE_PLACE`: `authorizeIntent` MUST read `trading_approvals_ready_at`; if NULL (or older than a TBD staleness window — v0: never stale until revoke) return a new `AuthorizationFailure` kind `trading_not_ready` _before_ running cap/scope checks. Ordering: `no_connection` → `trading_not_ready` → `no_active_grant` → `scope_missing` → `cap_exceeded_*`. Rationale: running cap math for a tenant that can't settle wastes grant budget in the counters and is misleading in Loki.

**Schema:**

- New migration `nodes/poly/app/src/adapters/server/db/migrations/0032_poly_wallet_trading_approvals.sql`:

  ```sql
  ALTER TABLE poly_wallet_connections
    ADD COLUMN trading_approvals_ready_at TIMESTAMPTZ;

  CREATE INDEX poly_wallet_connections_trading_ready_idx
    ON poly_wallet_connections (billing_account_id)
    WHERE trading_approvals_ready_at IS NOT NULL AND revoked_at IS NULL;
  ```

  Revoke cascades implicitly (already-existing `revoked_at` check in every read path).

- Drizzle schema + `packages/poly-db-schema` update; AGENTS.md bump.

**Contracts:**

- New `packages/node-contracts/src/poly.wallet.enable-trading.v1.contract.ts`:
  - Input: `z.object({})` (session auth carries the tenant).
  - Output: mirrors `TradingApprovalsState` above (JSON-safe: `polBalance` number, `readyAt` ISO string).
- Extend `poly.wallet.status.v1` output with `trading_ready: boolean` (driven by `trading_approvals_ready_at IS NOT NULL`). Existing consumers remain wire-compatible.

**HTTP:**

- `POST /api/v1/poly/wallet/enable-trading` — session auth; resolves billing account; delegates to `adapter.ensureTradingApprovals(billingAccountId)`. Idempotent: safe to retry, no-ops anything already satisfied. Same `wrapRouteHandlerWithLogging` pattern as `/wallet/connect`. Rate limit: same cooldown as `/connect` (one in-flight per tenant; later calls return the last state without re-submitting).

**UI — Money page / TradingWalletPanel:**

- New `TradingReadinessSection` component rendered above the stubbed Fund | Withdraw row. States:
  - **Not connected** — render nothing (section hidden, the panel already shows the "Connect wallet" CTA).
  - **Connected, balances pending** — skeleton row.
  - **Connected, funded, trading_ready = false, pol >= min** — "Enable Trading" primary button. Click → POST `/enable-trading`. During run: modal mirroring Polymarket's 3-step UX but with 2 rows (skip Deploy; skip Sign — already done on connect), 5 progress pills for USDC.e Exchange / Neg-Risk Exchange / Neg-Risk Adapter / CTF Exchange / CTF Neg-Risk Exchange. Per-pill states: idle → pending → ok ✓ / fail ✗. Final state: collapse to "✓ Trading enabled" pill.
  - **Connected, funded, trading_ready = false, pol < min** — muted badge "Add ~0.05 POL for gas to enable trading", hints at the future fund-flow (task.0352). Enable-Trading button disabled with the reason.
  - **Connected, trading_ready = true** — tiny inline "✓ Trading enabled" badge next to the funder-address row. No button. Re-enable path covered by revoke → re-provision.
  - **After revoke** — badge disappears (trading_approvals_ready_at is cleared with the connection).
- Copy mirrors Polymarket's modal terminology so returning users can map the mental model (see attached screenshot).

**Tests:**

- **Component test** (testcontainer Postgres + mocked Polygon RPC + mocked Privy): adapter matrix — all-satisfied (zero txs), partial (mix of erc20 and ctf missing), full cold start (5 txs), insufficient POL (zero txs + typed error), one tx revert mid-sequence (stops, returns partial state, DB stamp NOT set), rpc timeout on a read (retries or types the error). DB invariant: `trading_approvals_ready_at` is only non-null when `ready === true`.
- **Unit test**: `authorizeIntent` — `trading_not_ready` rejection fires before `no_active_grant` and `cap_exceeded_*` (ordering invariant).
- **Stack test**: full happy path through the route, fake Privy + fake RPC.
- **UI test** (Playwright or RTL): Money page state transitions, button disabled when pol < min.

**Observability:**

- Loki signals: `poly.wallet.enable_trading.{start,tx.submitted,tx.confirmed,ok,already_ready,insufficient_pol_gas,tx.reverted}` — each carrying `billing_account_id`, `connection_id`, `funder_address`, per-step `operator`, `tx_hash`, `block_number`.
- Counter metric `poly_wallet_trading_enabled_total{outcome}` — for alerting on first-contact failure rate.

Out:

- **Operator-subsidized gas.** v0 requires the user to have POL in the wallet already. If candidate-a UX demands it, a follow-up can send ~0.05 POL from an operator wallet on first `enable-trading` — but that introduces a new operator-wallet dependency and is a separate scope.
- **Safe / ERC-4337 smart-wallet backend.** This task locks in EOA-direct signing (`SignatureType.EOA`) with the mainnet Polymarket address set; Safe+4337 is tracked separately.
- **Allowance rotation / revocation UI.** v0 is set-and-forget. A future task can expose "Revoke approvals" on the Money page for users who wind down.
- **Re-checking on-chain state lazily per placement.** v0 trusts `trading_approvals_ready_at` until `revoked_at` flips. If a user manually resets allowance via an external wallet app, placements will empty-reject on the CLOB — `task.0354` can add a 24-h freshness window as hardening.
- **Agent-initiated enable-trading.** v0 is session-authed (user click). Agent-scoped enable is pending the broader agent-tool re-enable tracked in `task.0354`.

## Validation

- **exercise:**
  - (a) On candidate-a post-merge: sign in as a fresh test user, visit `/credits`, complete `connect` with defaultGrant (per-order $5 / daily $50), fund the returned address with 5 USDC.e + 0.1 POL, reload `/credits`. Expect: "Enable Trading" button visible. Click. Expect: modal shows 5 progress pills going idle → pending → ok; final state "✓ Trading enabled". Re-call `/wallet/status` → `trading_ready: true`.
  - (b) Register a known-active Polymarket target wallet via `POST /copy-trade/targets`. Within 60 s of a target fill, observe `poly.trade.authorize.ok` → `poly.trade.place.ok` in Loki at the deployed SHA, billing_account_id == test user. Flip `task.0318.deploy_verified: true` on the same pass.
  - (c) Negative path: provision a second tenant, fund with USDC.e only (no POL), click Enable Trading → 400 response shape with `ready: false`, `steps[*].error === "insufficient_pol_gas"`, no on-chain activity, `trading_ready` remains `false`.
  - (d) Negative path: bypass — try to place a trade for a tenant before `enable-trading` runs (script a `POST /copy-trade/targets` fill replay). Expect: `poly.trade.authorize.denied | reason="trading_not_ready"`, no CLOB call.
- **observability:**
  - `{service="poly-node-app",env="candidate-a"} |= "poly.wallet.enable_trading.ok" | json | billing_account_id="<ba_id>"` shows the completion at the deployed SHA.
  - `|= "poly.trade.authorize" | json | reason="trading_not_ready"` shows the bypass-attempt denial.
  - `sum by (outcome) (rate(poly_wallet_trading_enabled_total[5m]))` — first 24 h should show only `ok` + `insufficient_pol_gas`.

## Out of Scope

Subsidized gas, Safe+4337, approval revocation UI, lazy on-chain re-check, agent-mode enable. See "Out" above for details.

## Notes

- **Automated `ensureTradingApprovals` / full onboarding E2E ladder** is tracked separately — defer to [task.0356](./task.0356.poly-wallet-onboarding-trading-e2e-test-suite.md) (implementation-review gap on PR #992).
- **Blocks `task.0318.deploy_verified: true`.** The Phase B3 code gate is green (PR #990 in review). The feature gate requires a real user to trade end-to-end on candidate-a, which requires this task. Every day this sits in triage is a day the Phase B3 deployment stays unverifiable.
- **Supersedes bug.0335 operationally.** `bug.0335` was scoped to the single-operator prototype wallet, which is now purged. Its root cause (missing approvals on the trading EOA) applies identically to every per-tenant wallet — this task is the productized fix. Close `bug.0335` with a reference to this task once this ships.
- **Pairs with task.0352.** Fund flow (task.0352) lands USDC.e + POL into the tenant wallet in one click. v0 of this task (0355) requires the user to bring POL. If 0352 lands first, the Enable Trading button becomes reachable automatically on a fresh provision. If 0355 lands first, users onboard via a two-step (fund POL manually → enable) and 0352 compresses to one click.
- **Reuse the experiment logic verbatim.** `scripts/experiments/approve-polymarket-allowances.ts` already has the correct contract addresses, ABIs, idempotency reads, block-pinned post-verification, and sequencing. Port the on-chain calls as-is into the adapter; change only the caller (Privy backend-wallet viem account instead of raw-PK account) and the return-state shape. "Port, don't rewrite" applies.
- **Why `maxUint256` and not per-order caps?** Polymarket's own onboarding does maxUint256. Granular approvals force a second approval tx every time a user adjusts caps, which means every grant rotation becomes two on-chain txs. Since the wallet is Privy-custodied and revoke-cascades, the blast radius is already bounded by grant caps and connection lifetime. Documented tradeoff.
- **Deploy impact on PR.** New migration; needs `candidate-flight-infra`. New env: none (all constants are pinned).
