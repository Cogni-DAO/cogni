---
name: poly-dev-expert
description: "Polymarket copy-trade / prediction-bot domain expert. Use this skill when work touches the poly node's mirror pipeline, Polymarket CLOB, per-tenant trading wallets (Privy-custody via `/api/v1/poly/wallet/connect`), the legacy shared operator wallet, target / raw-PK wallets, CTF ERC-1155 approvals, `poly_copy_trade_*` + `poly_wallet_connections` tables, mirror-coordinator, wallet-watch, AEAD encryption of CLOB creds, RLS tenant isolation, or any experiment under `scripts/experiments/*poly*`. Also triggers for: 'provision a trading wallet', 'place a polymarket trade', 'mirror this wallet', 'why did SELL reject', 'onboard a new wallet', 'what's in candidate-a poly-node-app-secrets', 'flip copy_trade_config', 'how does the data-api poll work', 'validate task.0318', 'deploy_verified on poly', 'custodial consent', 'AEAD key rotation'."
---

# Poly Dev Expert

You are the domain expert for Cogni's Polymarket copy-trade system. This skill exists because the poly node has specific gotchas that have repeatedly burned devs and agents. **Read this file before touching poly code or running poly experiments.**

The system is mid-migration: v0 was a single shared operator wallet (`POLY_PROTO_*`, bug.0335 still affects it); Phase A landed per-tenant RLS on copy-trade tables; Phase B (PR #968, `deploy_verified 2026-04-22`) landed per-tenant Privy trading wallets. The shared operator is now a legacy fallback path for the system tenant; per-tenant wallets are the forward direction.

## Ground truth — read before acting

**Specs (as-built):**

- [docs/spec/poly-copy-trade-phase1.md](../../../docs/spec/poly-copy-trade-phase1.md) — layer boundaries, invariants, `fill_id` shape
- [docs/spec/poly-multi-tenant-auth.md](../../../docs/spec/poly-multi-tenant-auth.md) — tenant-scoped copy-trade tables, RLS policy, `CopyTradeTargetSource` port
- [docs/spec/poly-trader-wallet-port.md](../../../docs/spec/poly-trader-wallet-port.md) — **Phase B** `PolyTraderWalletPort`, invariants, AEAD + consent, two-layer Zod/TS enforcement

**Guides:**

- [docs/guides/poly-wallet-provisioning.md](../../../docs/guides/poly-wallet-provisioning.md) — per-tenant provisioning flow + honest architecture accounting
- [docs/guides/polymarket-account-setup.md](../../../docs/guides/polymarket-account-setup.md) — shared-operator Privy onboarding (legacy; CTF approvals added via task.0323)

**Work items:**

- [task.0315](../../../work/items/task.0315.poly-copy-trade-prototype.md) — Phase 1 parent, P1→P4 roadmap
- [task.0318](../../../work/items/task.0318.poly-wallet-multi-tenant-auth.md) — multi-tenant auth, Phase A + B
- [task.0323](../../../work/items/task.0323.poly-copy-trade-v1-hardening.md) — v1 hardening (CTF SELL, cursor persistence, status-sync)
- [task.0347](../../../work/items/task.0347.poly-wallet-preferences-sizing-config.md) — retire hardcoded caps + funding suggestions
- [task.0348](../../../work/items/task.0348.poly-wallet-orphan-sweep.md) — Privy orphan cleanup (ops)
- [bug.0335](../../../work/items/bug.0335.poly-clob-buy-empty-reject-candidate-a.md) — **active** — shared operator BUY empty-reject on candidate-a

**Code landmarks:**

- `nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts` — `runOnce` glue
- `nodes/poly/app/src/features/wallet-watch/polymarket-source.ts` — Data-API source
- `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts` — poll shim + hardcoded v0 caps
- `nodes/poly/app/src/app/api/v1/poly/wallet/{connect,status,balance}/route.ts` — Phase B routes
- `nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts` — Phase B adapter (AEAD, advisory-lock tx, idempotency key)
- `packages/poly-wallet/src/port/poly-trader-wallet.port.ts` — port contract + `CustodialConsent` type
- `packages/market-provider/src/adapters/polymarket/` — CLOB + Data-API adapters

## Wallet roles — three roles, never conflate

Post-Phase-B there are **three** disjoint wallet roles. Know which one you're touching.

| Role                                         | Address source                                                         | Signer                                            | Purpose                                                                       | When it places trades                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Per-tenant** (Privy-per-user, **primary**) | `poly_wallet_connections.funder_address`, one per `billing_account_id` | Privy HSM, dedicated app (`PRIVY_USER_WALLETS_*`) | The user's own Polymarket trading wallet. Minted on `POST /connect`.          | When the mirror fires for that tenant.                                         |
| **Shared operator** (Privy, legacy fallback) | `POLY_PROTO_WALLET_ADDRESS` (`0x7A33…0aEB` on candidate-a)             | Privy HSM (`POLY_PROTO_PRIVY_*`)                  | Fallback for the system tenant before Phase B tenants existed.                | When the system tenant's `copy_trade_config.enabled=true`. Broken by bug.0335. |
| **Target / test** (raw-PK, experiments only) | `TEST_WALLET_ADDRESS` (`0x50f4…c42B` in `.env.test`)                   | Raw PK in `.env.test`                             | What gets monitored by the mirror. Also the wallet WE place test trades from. | Only via `scripts/experiments/raw-pk-*`. Never in prod code paths.             |

**Anti-patterns — each has burned at least one agent:**

- **"I placed a $1 BUY from the operator wallet and the mirror works"** — validates nothing. The operator is the wallet that PLACES; you need the target wallet to TRADE so the mirror sees a fill and copies it.
- **"I provisioned my own per-tenant wallet and placed a trade; the mirror's working"** — same mistake, new skin. A per-tenant wallet is still a wallet that places trades. The target must trade.
- **"I'll reuse `POLY_PROTO_*` for the per-tenant path"** — no. The Phase-B adapter requires a **dedicated** Privy app (`PRIVY_USER_WALLETS_*`) by invariant (`SEPARATE_PRIVY_APP`). Mixing funds + operator-wallet funds under one app is the threat model.

## Per-tenant provisioning (Phase B, shipped)

The canonical tenant onboarding flow:

1. User signs in → `getOrCreateBillingAccountForUser` resolves `billing_account_id` (RLS key).
2. UI / client calls `POST /api/v1/poly/wallet/connect` with the custodial-consent payload (`custodialConsentActorKind: "user"`, `custodialConsentActorId: <userId>`, `custodialConsentAcknowledged: true`).
3. Route validates the Zod contract (`poly.wallet.connection.v1`), enforces session-user == consent-actor, runs `checkConnectRateLimit` (5-min cooldown), then calls `adapter.provision({ billingAccountId, createdByUserId, custodialConsent })`.
4. Adapter opens a DB transaction → `pg_advisory_xact_lock(hashtext(billing_account_id))` → computes a per-tenant generation counter → calls Privy `wallets().create()` with a **deterministic** `idempotencyKey` (`poly-wallet:${billingAccountId}:${generation}`) → derives CLOB L2 creds for that signer → AEAD-encrypts the creds with AAD = `{billing_account_id, connection_id, provider}` → `INSERT INTO poly_wallet_connections` → commits.
5. Route logs `"poly.wallet.connect — provisioned per-tenant Polymarket trading wallet"` with `funder_address`.

**Key invariants (from `docs/spec/poly-trader-wallet-port.md`):**

- `CUSTODIAL_CONSENT` — two-layer enforcement: Zod on the HTTP wire, TypeScript on the port. Every `provision()` call receives a `CustodialConsent` struct; the adapter persists it.
- `TENANT_SCOPED` — tenant resolved from session → billing account; RLS policy on `poly_wallet_connections` uses `EXISTS` through `billing_accounts.owner_user_id` (principal-agnostic, forward-compatible with agents + multi-user billing).
- `KEY_NEVER_IN_APP` — raw EOA private keys never enter app memory. The Privy HSM authorization key does (threat model: compromised process ⇒ attacker can request signs, but never exfiltrates the key).
- `AEAD_AAD_BINDING` — CLOB creds at rest are bound to `(billing_account_id, connection_id, provider)`. Rebinding ciphertext to a different tenant fails decrypt.
- `SEPARATE_PRIVY_APP` — per-tenant wallets use the dedicated `PRIVY_USER_WALLETS_*` app, NOT the shared `POLY_PROTO_*` operator app.

**AEAD key rotation is a migration, not a config change.** `POLY_WALLET_AEAD_KEY_HEX` currently has no keyring; rotating it breaks decryption of all existing rows. Tracked in `D-2` in task.0318. Don't rotate without a key-id-aware decrypt path.

## Validation recipe — how to prove provisioning works on candidate-a

The playbook I used to flip `task.0318 → deploy_verified: true` on 2026-04-22. Reuse verbatim.

1. **Read the deployed SHA.** `curl -sf https://poly-test.cognidao.org/readyz` → `.version`. Don't skip — this pins your observation to a build, not a branch.
2. **Exercise.** Sign in on `poly-test.cognidao.org`, hit `/profile`, click `Create trading wallet` (or `POST /api/v1/poly/wallet/connect` directly with a session cookie). Note the `reqId` from DevTools → network tab, or from the 200-response's pino log downstream. Expect a `funder_address` in the response.
3. **Verify on-chain.** `https://polygonscan.com/address/<funder_address>`. The wallet should exist (even with zero balance — it was just minted).
4. **Read your own request back from Loki.** The `grafana` MCP may be down; fallback is `scripts/loki-query.sh`:

   ```bash
   COGNI_ENV_FILE=/path/to/.env.canary scripts/loki-query.sh \
     '{env="candidate-a",service="app",pod=~"poly-node-app-.*"} | json | reqId=`<your-reqid>`' 60
   ```

   Look for the `"poly.wallet.connect — provisioned per-tenant Polymarket trading wallet"` line. Its `funder_address` field MUST equal the address from step 3.

5. **Sweep for errors.** Same helper: `| json | level=\`50\`` over the window. Should be zero.
6. **Update work item** — front-matter `deploy_verified: true` + add a `## Validation Result` block on the work item with exercise + observability pasted in. See task.0318 for the template.
7. **PR comment** — post the same block (with the on-chain link + the Loki trace) on the PR as the `PR Discipline → Validation result` comment.

## Wallet onboarding — USDC.e + CTF, not just USDC.e

Applies to any wallet that will place or settle trades — shared operator, per-tenant (if you're debugging the provisioning path), or raw-PK test wallets.

1. **USDC.e `approve(spender, MaxUint256)`** — three contracts: Exchange (`0x4bFb…982E`), Neg-Risk Exchange (`0xC5d5…f80a`), Neg-Risk Adapter (`0xd91E…5296`). Needed to BUY.
2. **CTF ERC-1155 `setApprovalForAll(operator, true)`** — CTF at `0x4D97…6045`, operators = Exchange + Neg-Risk Exchange (NOT the Adapter — never takes 1155 custody). **Needed to SELL.**

**Symptom of missing CTF approval on SELL:** `CLOB rejected order (success=undefined, errorMsg="")`. No real error message — just silent reject. This is also the active signature for bug.0335 on the shared operator wallet on candidate-a (needs re-running `approve-polymarket-allowances.ts` against that wallet).

**Scripts:** see the arsenal below. All idempotent — re-run safely.

## Scripts arsenal — know what exists before writing new ones

| Script (under `scripts/experiments/`)                                                                               | For              | Purpose                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `approve-polymarket-allowances.ts`                                                                                  | Privy wallet     | USDC.e + CTF approvals                                                                                                  |
| `derive-polymarket-api-keys.ts`                                                                                     | Privy wallet     | Derive CLOB L2 creds                                                                                                    |
| `onboard-raw-pk-wallet.ts`                                                                                          | Raw-PK wallet    | USDC.e + CTF + CLOB keys in one                                                                                         |
| `privy-polymarket-order.ts`                                                                                         | Privy wallet     | Reusable place/cancel with `--side`, `--size`, `--price`, `--outcome`, `--post-only`                                    |
| `raw-pk-polymarket-order.ts`                                                                                        | Raw-PK wallet    | Same interface, raw-PK signer                                                                                           |
| `place-polymarket-order.ts`                                                                                         | Privy wallet     | Scope-narrow dress-rehearsal (post-only $1 BUY only — do NOT generalize; use `privy-polymarket-order.ts` for new flows) |
| `probe-polymarket-account.ts`                                                                                       | Either           | Verify balances + allowances                                                                                            |
| `sign-polymarket-order.ts`                                                                                          | Either           | Sign-only (no submit) for debugging                                                                                     |
| `attach-poly-proto-signer.ts`                                                                                       | Shared operator  | Attach signer to Privy app                                                                                              |
| `poly-privy-per-user-spike/1-create-wallet.ts`                                                                      | Per-tenant (dev) | Phase-B design spike; not the production path (which is `/api/v1/poly/wallet/connect`)                                  |
| `poly-rls-smoke.sh`                                                                                                 | DB               | Manual RLS smoke on `poly_copy_trade_targets` (Phase A acceptance #2)                                                   |
| `copy-top-wallet-rehearsal.ts`                                                                                      | Privy            | Top-wallet research rehearsal                                                                                           |
| `fill-market.ts`                                                                                                    | —                | Market-data test helper                                                                                                 |
| `wallet-screen-v2.ts`, `wallet-screen-resolved.ts`, `top-wallet-{metrics,recent-trades}.ts`, `screen-v3-goldsky.ts` | Research         | Target-wallet screening / ranking research (Phase 4 prep)                                                               |

**RPC flakiness:** `polygon-bor-rpc.publicnode.com` round-robins and occasionally returns stale nonces. Just retry — scripts are idempotent.

## Mirror runtime — candidate-a wiring

**Secrets consumed by `poly-node-app` pod** (k8s secret `poly-node-app-secrets`, namespace `cogni-candidate-a`):

- **Shared operator (legacy, still live):** `POLY_PROTO_WALLET_ADDRESS`, `POLY_PROTO_PRIVY_SIGNING_KEY`, `POLY_PROTO_PRIVY_APP_ID`, `POLY_PROTO_PRIVY_APP_SECRET`, `POLY_CLOB_API_KEY`, `POLY_CLOB_API_SECRET`, `POLY_CLOB_PASSPHRASE`
- **Per-tenant Phase B:** `PRIVY_USER_WALLETS_APP_ID`, `PRIVY_USER_WALLETS_APP_SECRET`, `PRIVY_USER_WALLETS_SIGNING_KEY`, `POLY_WALLET_AEAD_KEY_HEX`, `POLY_WALLET_AEAD_KEY_ID`, `POLY_WALLET_ALLOW_STUB_CREDS` (dev-only)
- **Shared:** `POLYGON_RPC_URL`

Updates to any of these go through `scripts/setup/setup-secrets.ts` + `candidate-flight-infra` workflow — never `kubectl set env` (Argo will revert on next sync).

**Tracked target wallets** are **per-user rows in `poly_copy_trade_targets`** (RLS-scoped, migration 0029). Add via dashboard `+` button or `POST /api/v1/poly/copy-trade/targets`; remove via `−` or `DELETE /api/v1/poly/copy-trade/targets/[id]`. Mirror poll uses `dbTargetSource.listAllActive()` — **the ONE sanctioned BYPASSRLS read** across tenants, lives in `container.ts`.

**Enable switch:** `UPDATE poly_copy_trade_config SET enabled=true WHERE billing_account_id='<billing-account-uuid>';` on the poly DB. Per-tenant in Phase A — flipping one tenant's row has zero effect on others. The system tenant (`COGNI_SYSTEM_BILLING_ACCOUNT_ID`) is seeded `enabled=true` by migration 0029. Takes effect within one poll tick (≤30s).

**Poll cadence:** 30s. Warmup backlog: 60s. Hardcoded in `copy-trade-mirror.job.ts`.

**Live-money caps (hardcoded v0):** $1/trade, $10/day, 5 fills/hr. Per-tenant config lift tracked in task.0347. Changing now = edit source + redeploy.

## Observability

| Signal                                                       | Where           | Good state                                                                             |
| ------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------- |
| `poly.wallet.connect` — `"provisioned per-tenant …"`         | Loki            | On success, logs `funder_address`, `connection_id`, `billing_account_id`, `actor_kind` |
| `poly.wallet.status`                                         | Loki            | `connected=true` iff runtime can resolve signing context for this tenant               |
| `poly.wallet.balance`                                        | Loki            | Polygon RPC balance read (~1-2s); caches in-flight                                     |
| `poly.mirror.poll.singleton_claim`                           | Loki            | Fires exactly once per pod start                                                       |
| `poly.wallet_watch.fetch`                                    | Loki, every 30s | `raw=N, fills=N, phase=ok`                                                             |
| `poly.mirror.decision outcome=placed`                        | Loki            | Emitted when mirror fires                                                              |
| `poly.mirror.decision outcome=skipped reason=already_placed` | Loki            | Dedup (noisy — see task.0323 §1)                                                       |
| `poly.mirror.poll.tick_error`                                | Loki            | ZERO. Any hit = bug.                                                                   |
| `level=50` (error/warn) on `{pod=~"poly-node-app-.*"}`       | Loki            | Should be 0 over normal windows.                                                       |
| `poly_copy_trade_fills`                                      | poly DB         | Row per mirror decision                                                                |
| `poly_wallet_connections`                                    | poly DB         | Row per `/connect` success (active = `revoked_at IS NULL`)                             |

**Status gotcha (task.0323 §2):** ledger `status=open` is set at insert time and never re-read from CLOB. Actual CLOB state may be filled. Don't trust the ledger status column alone — cross-check Data-API `/positions?user=<addr>` or `synced_at` staleness (task.0328).

**Loki access when MCP is down:** use `scripts/loki-query.sh` (added 2026-04-22). Auto-sources `GRAFANA_URL` + `GRAFANA_SERVICE_ACCOUNT_TOKEN` from `.env.canary` / `.env.local` and hits the Grafana Cloud datasource proxy directly. Same LogQL syntax as the MCP.

## Data-API notes

- Base: `https://data-api.polymarket.com`
- `/trades?user=<addr>` — the mirror's input. Filters by `timestamp >= sinceTs` client-side.
- `/positions?user=<addr>` — canonical source of truth for what a wallet holds. Use this, not the UI.
- Lag: ~30–60s between CLOB fill and Data-API surfacing.

## EOA-direct vs Safe-proxy — why the UI profile looks empty

The `PolymarketClobAdapter` hardcodes `signatureType: SignatureType.EOA` (`EOA_PATH_ONLY` invariant). Trades settle against the EOA on-chain. **Polymarket's `/profile/<addr>` UI auto-redirects any EOA to its deterministic Safe-proxy address and renders _that_ profile.** For EOA-direct users (including per-tenant wallets minted by `/connect`), the Safe was never instantiated — its profile is empty forever.

**Symptom:** shares show up on Data-API + Polygonscan + market "Activity" tab, but `polymarket.com/profile/<our-eoa>` looks like a blank new account. Easy to mistake for "the trade never happened."

**Ground-truth checks (in order):**

1. `https://data-api.polymarket.com/positions?user=<EOA>` — authoritative
2. `https://data-api.polymarket.com/trades?user=<EOA>&limit=10`
3. Market page → Activity tab → filter by EOA
4. Polygonscan tx hash (from Data-API `transactionHash` field)

Do not rely on the Polymarket profile page for EOA-direct accounts.

## Anti-patterns to flag

- **Placing test trades from any wallet you control (operator OR your own per-tenant) to "validate the mirror"** — validates nothing. The mirror copies the target. The target must trade.
- **Skipping CTF approvals** during onboarding — creates a one-way-trade wallet. Signature: `success=undefined, errorMsg=""` on SELL.
- **Generalizing `place-polymarket-order.ts`** (scope-narrow dress-rehearsal) instead of using `privy-polymarket-order.ts`.
- **Mixing the shared-operator Privy app with per-tenant provisioning** — `SEPARATE_PRIVY_APP` is an invariant. Don't move funds between the two; don't try to reuse `POLY_PROTO_PRIVY_APP_ID` for per-tenant wallets.
- **Rotating `POLY_WALLET_AEAD_KEY_HEX` without a key-id-aware decrypt path** — breaks every existing `poly_wallet_connections` row (see D-2 in task.0318).
- **`POLY_WALLET_ALLOW_STUB_CREDS=1` outside local dev.** Candidate-a / preview / production must use real CLOB creds. The stub flag exists for component tests + smoke.
- **Re-setting GH env secrets that already exist** without first checking `gh secret list --env candidate-a`.
- **Using `kubectl set env` for long-lived config** — Argo will revert on next sync. Add to the overlay or to `poly-node-app-secrets` via `scripts/setup/setup-secrets.ts`.
- **Adding P4 work to v0** — tracked in task.0322. Don't smuggle WS/streaming changes into v0 tasks.

## Enforcement rules

When reviewing code that touches poly runtime, wallet onboarding, mirror logic, or tenant-provisioning:

- **Never use raw PKs in production code paths.** Raw-PK is for `scripts/experiments/` only. Production signing: per-tenant Privy (Phase B) or shared-operator Privy (legacy).
- **Never place orders without `--yes-real-money` on the CLI path** or an equivalent explicit opt-in.
- **Never skip `INSERT_BEFORE_PLACE`** in the coordinator — correctness gate for at-most-once mirroring.
- **CTF approvals live alongside USDC.e approvals** — adding a new wallet to the system means both or nothing.
- **Idempotency is always `keccak256(target_id + ':' + fill_id)` → client_order_id.** Do not invent alternatives.
- **`fill_id` shape is frozen** at `data-api:<tx>:<asset>:<side>:<ts>`. Phase 4 will add `clob-ws:…` — do not mix.
- **`CustodialConsent` is a compile-time obligation on `PolyTraderWalletPort.provision`.** Don't widen it to optional or add runtime backstops — that's the bug B-5 caught.
- **AEAD AAD must bind `(billing_account_id, connection_id, provider)`.** Any code that calls `aeadEncrypt` / `aeadDecrypt` on CLOB creds MUST pass that exact triple. Review any new callers.
- **`deploy_verified: true` requires the full recipe above** — exercise on candidate-a, on-chain confirmation, Loki trace matched to the deployed SHA. Don't flip it based on `pnpm check` alone.
