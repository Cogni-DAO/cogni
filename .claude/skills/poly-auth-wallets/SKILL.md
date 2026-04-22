---
name: poly-auth-wallets
description: "Polymarket wallet provisioning, signing, and onboarding specialist. Load when working on per-tenant trading wallets (Phase B, `task.0318`), `PolyTraderWalletPort`, `PrivyPolyTraderWalletAdapter`, `poly_wallet_connections`, `CustodialConsent`, AEAD-at-rest for CLOB creds, `/api/v1/poly/wallet/{connect,status,balance}`, Privy SDK errors, CTF `setApprovalForAll`, USDC.e deposits, shared-operator bootstrap, raw-PK experiment scripts, or anything with 'provision a trading wallet', 'Privy per-user', 'approvals for SELL', 'AEAD key rotation', 'connect returned already_exists', 'onboarding a new wallet'. For the mirror pipeline / coordinator see `poly-copy-trading`; for CLOB wire semantics / Data-API / target research see `poly-market-data`."
---

# Poly Auth & Wallets

You are the expert for every seam that **gets a wallet into a signing-ready state** — per-tenant provisioning, shared-operator bootstrap, CTF + USDC.e approvals, and the port/adapter contract. Mirror glue lives in `poly-copy-trading`; CLOB order wire semantics live in `poly-market-data`.

## Three wallet roles (canonical)

| Role                                         | Signer                | Lives in                                       | Used for                                                                                                    |
| -------------------------------------------- | --------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Per-tenant** (Phase B, **primary**)        | Privy per-user HSM    | `poly_wallet_connections` (encrypted via AEAD) | Real production — every tenant gets their own trading wallet at `/connect`. This is the line going forward. |
| **Shared operator** (legacy fallback)        | Privy app-wallet HSM  | `POLY_PROTO_*` env + `poly-node-app-secrets`   | v0 candidate-a flight before Phase B. Still live for `COGNI_SYSTEM_BILLING_ACCOUNT_ID`. Retiring.           |
| **Target / test** (raw PK, experiments only) | local `.env.local` PK | `scripts/experiments/`                         | On-chain proofs, dress-rehearsal $1 post-only orders, wallet research. **Never** in production code.        |

## Per-tenant provisioning (Phase B, shipped)

`deploy_verified: true` as of 2026-04-22 via [task.0318](../../../work/items/task.0318.poly-wallet-multi-tenant-auth.md). The canonical flow:

1. **Tenant hits `POST /api/v1/poly/wallet/connect`** with body `{ custodialConsentActorId, custodialConsentVersion }` — the Zod contract `poly.wallet.connection.v1.contract.ts` validates at the HTTP boundary.
2. **Route handler** (`nodes/poly/app/src/app/api/v1/poly/wallet/connect/route.ts`):
   - Authenticates session (never trust client-supplied actor id directly — session is truth).
   - Defense-in-depth: `session.userId` must `===` `custodialConsentActorId` in the body.
   - Calls `checkConnectRateLimit` bootstrap helper (DB-backed, not in-memory — survives pod restart).
3. **Adapter** (`PrivyPolyTraderWalletAdapter.provision`) with required `custodialConsent: CustodialConsent` parameter (compile-time enforced since the B-5 fix):
   - Takes `pg_advisory_xact_lock(hashtextextended(billingAccountId))` — serializes concurrent provisions for one tenant.
   - Computes monotonically-increasing `generation` from the DB row.
   - Derives deterministic `idempotencyKey = sha256(billingAccountId + ':' + generation)` and passes to Privy SDK `wallets().create({ options: { idempotencyKey } })` — retries converge on the same backend wallet, no orphans.
   - Encrypts CLOB API creds with AES-256-GCM, AAD bound to `(billing_account_id, connection_id, provider)`.
   - Upserts `poly_wallet_connections` row + consent audit.
4. **RLS** on `poly_wallet_connections`: tenant isolation via `EXISTS(SELECT 1 FROM billing_accounts WHERE id = billing_account_id AND owner_user_id = current_setting('app.current_user_id')::uuid)`. **Not** keyed on `created_by_user_id` — the pivot through `billing_accounts.owner_user_id` makes the policy principal-agnostic and forward-compatible with multi-user billing + agents-as-actors.
5. **Response** — `{ connection_id, funder_address, requires_funding, suggested_usdc, suggested_matic }`. `requires_funding` + suggestions are currently hardcoded — [task.0347](../../../work/items/task.0347.poly-wallet-preferences-sizing-config.md) replaces them with honest RPC-backed reads + tenant-configured preferences.

### Invariants (from `docs/spec/poly-trader-wallet-port.md`)

- **`CUSTODIAL_CONSENT`** — enforced at _two_ layers:
  1. Zod (HTTP boundary): the `poly.wallet.connect.request.v1` schema requires both consent fields.
  2. TypeScript (port boundary): `PolyTraderWalletPort.provision`'s `input.custodialConsent: CustodialConsent` is non-optional. The adapter **cannot** be called without consent because the type system rejects it.
     The runtime `if (!consent) throw` check was removed because the type-system enforcement is strictly stronger. If you re-introduce it, you've accidentally weakened the invariant.
- **`CREDS_AT_REST`** — all CLOB API keys AEAD-encrypted at rest; AAD binds ciphertext to `(billing_account_id, connection_id, provider)`. Swapping AAD shape is a **cross-node breaking change** (tracked as `D-5` on task.0318 review) — every existing ciphertext in prod uses the current shape. Don't "standardize" without a migration plan.
- **`ORPHAN_FREE`** — every successful Privy wallet creation is traceable to a `poly_wallet_connections` row. The `idempotencyKey` + advisory-lock pair guarantees retries of a failed provision converge rather than creating new Privy wallets. [task.0346](../../../work/items/task.0346.poly-wallet-orphan-sweep.md) is the cleanup for any pre-Phase-B orphans.
- **`RLS_ENFORCED`** — `poly_wallet_connections` reads under `appDb` must filter by the policy. Only the rate-limit helper and the mirror-poll enumerator may use `serviceDb` / `BYPASSRLS`, and both are audited seams.
- **`CONSENT_ACTOR_MATCHES_SESSION`** — session.userId must equal custodialConsent.actorId. Agent-API-key paths (future) must re-derive the actor from the key, not trust the body.

## Phase B key code landmarks

- `nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts` — the adapter
- `packages/poly-wallet/src/port/poly-trader-wallet.port.ts` — the `PolyTraderWalletPort` interface + `CustodialConsent` type
- `packages/poly-wallet/src/index.ts` + `port/index.ts` — barrel re-exports (`CustodialConsent` must be in both)
- `nodes/poly/app/src/bootstrap/poly-trader-wallet.ts` — adapter wiring + `checkConnectRateLimit` helper
- `nodes/poly/app/src/app/api/v1/poly/wallet/connect/route.ts` — route handler (session auth + rate-limit + adapter call)
- `nodes/poly/app/src/app/api/v1/poly/wallet/status/route.ts` — non-destructive state read
- `nodes/poly/app/src/app/api/v1/poly/wallet/balance/route.ts` — Polygon RPC balance read (existing pre-Phase-B)
- `src/contracts/poly.wallet.connection.v1.contract.ts` — Zod contract (single source of truth for request/response shape)
- `nodes/poly/app/src/db/migrations/0030_poly_wallet_connections.sql` — table + RLS policy (post-B-4 fix, pivot-through-billing-account shape)
- `packages/node-shared/src/crypto/aead.ts` — AEAD helper (used across multiple nodes — **breaking changes forbidden** without a cross-node migration plan)

## CTF + USDC.e onboarding (required before any trade)

Polymarket uses **two** conditional-tokens contracts on Polygon:

1. **Standard CTF** (`0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`) — for regular binary markets.
2. **Neg-risk CTF** (`0xC5d563A36AE78145C45a50134d48A1215220f80a`) — for neg-risk markets. **Separate approval.**

Both need `setApprovalForAll(clobExchangeAddress, true)` from the trading wallet before the CLOB will accept SELL / close-position orders. Missing the neg-risk approval is the root cause of [bug.0329](../../../work/items/bug.0329.poly-sell-neg-risk-empty-reject.md) — any position opened on a neg-risk market becomes roach-motel.

USDC.e (`0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` on Polygon PoS) is deposited **to the EOA directly** — no Safe bridging step, because we trade EOA-direct (see `poly-market-data` for the EOA-vs-Safe gotcha).

Guides:

- [`docs/guides/polymarket-account-setup.md`](../../../docs/guides/polymarket-account-setup.md) — shared-operator onboarding (legacy path, still applicable to USDC.e + CTF mechanics)
- [`docs/guides/poly-wallet-provisioning.md`](../../../docs/guides/poly-wallet-provisioning.md) — Phase B per-tenant flow + honest accounting of what's shipped

## Scripts arsenal (wallet-relevant)

Production-adjacent (reads Privy / DB state, no raw PKs):

- `scripts/experiments/poly-privy-per-user-spike/provision-per-user-wallet.ts` — happy-path Privy-per-user provision (matches the Phase B adapter flow).
- `scripts/experiments/poly-rls-smoke.sh` — sanity-check RLS on the copy-trade tables (Phase A RLS work product; equally useful for Phase B validation).
- `scripts/experiments/privy-polymarket-order.ts` — Privy-signed $1 post-only order (end-to-end sanity check using Privy rather than raw PK).
- `scripts/experiments/sign-polymarket-order.ts` — EIP-712 hash preview before Privy-HSM signing (useful when debugging chain-id / typed-data drift).

Raw-PK experiments (`.env.local` only — never production):

- `scripts/experiments/derive-address-from-pk.ts` — derive address from `POLY_TEST_WALLET_PRIVATE_KEY`
- `scripts/experiments/approve-polymarket.ts` / `approve-polymarket-ethers.ts` — one-time CTF + USDC.e approvals (both standard and neg-risk)
- `scripts/experiments/onboard-polymarket-ctf-neg-risk.ts` — opinionated one-shot neg-risk onboarding
- `scripts/experiments/place-polymarket-order.ts` — scope-narrow $1 post-only dress-rehearsal (guardrailed; don't generalize)

## Observability — wallet signals

Route-level:

| Signal                                             | Good state                                                      |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `poly.wallet.connect status=200 reqId=<uuid>`      | New tenant provisioned; `funder_address` in payload             |
| `poly.wallet.connect status=200 idempotent=true`   | Retry / re-hit converged — same wallet, no new Privy row        |
| `poly.wallet.connect status=429 reason=rate_limit` | Abuse bound hit. Investigate attacker pattern if spiking.       |
| `poly.wallet.connect status=5xx`                   | **Zero in steady state.** Any hit = Privy outage / adapter bug. |
| `poly.wallet.status`                               | Per-request, surfaces `connected` (auth gate only, not balance) |
| `poly.wallet.balance`                              | Polygon RPC read (USDC.e + MATIC)                               |

State:

- `poly_wallet_connections` — one row per `(billing_account_id, provider)`. Rolling over a wallet = new row + `generation++`.
- AEAD ciphertext is opaque in logs; never log plaintext creds.

**Loki recipe for `deploy_verified` after a flight:**

```
{env="candidate-a",service="app",pod=~"poly-node-app-.*"} | json | route="poly.wallet.connect" | reqId="<uuid>"
```

Use `scripts/loki-query.sh` when the `grafana` MCP is down (see [`docs/../../.claude/commands/logs.md`](../../commands/logs.md) for full runbook). Confirm: (1) request reached the deployed SHA (`/readyz.version`), (2) `funder_address` matches your on-chain deposit destination on Polygonscan, (3) status=200 and `err_code` absent.

## Validation recipe — proving provisioning works on candidate-a

This is **the** deploy_verified playbook. Copy + adapt for any future wallet-adjacent task.

1. **Fetch deployed SHA** — `curl -s https://poly-test.cognidao.org/readyz | jq -r '.version'`. Remember this.
2. **Exercise** — `POST /api/v1/poly/wallet/connect` with a real session cookie, real billing account, fresh `custodialConsentActorId` matching session. Capture the response `funder_address` and `reqId`.
3. **On-chain proof** — open `https://polygonscan.com/address/<funder_address>`. Should exist, should be an EOA, should be zero-balance at this point (no funding yet).
4. **Loki trace** — `scripts/loki-query.sh '{env="candidate-a",service="app"} | json | reqId="<uuid>"' 30` → confirm `route=poly.wallet.connect`, `status=200`, `funder_address` matches step 2, `build_sha` matches step 1.
5. **Error sweep** — `scripts/loki-query.sh '{env="candidate-a",service="app",pod=~"poly-node-app-.*"} | json | level="50"' 30` → expect empty.
6. **Idempotency** — re-POST `/connect` with the same body. Expect `status=200` + same `funder_address` + Loki line with `idempotent=true` (or equivalent). **No new Privy wallet on Polygonscan.**
7. **Update work item** + PR comment with the exercise response, Loki line, Polygonscan URL, and flip `deploy_verified: true`.

The 2026-04-22 validation that flipped task.0318 ran exactly this flow — see that work item's `## Validation Result` section for a real artifact to clone.

## AEAD key rotation (the latent migration)

- `POLY_WALLET_AEAD_KEY_CURRENT` is the only key in prod today.
- Rotating keys without adding a keyring (fallback decrypt with old key) = **all existing encrypted creds unreadable on next deploy**.
- Adding a keyring is a medium-sized migration, not a hot-fix. Until that ships, **never** rotate.
- `D-5` on task.0318 review also deferred the "canonical-AAD" serialization cleanup because the same cross-node-deployed-ciphertext problem applies.

## Active bugs on the auth/wallets seam

- [bug.0335](../../../work/items/bug.0335.poly-clob-buy-empty-reject-candidate-a.md) — shared operator BUY empty reject. Not a per-tenant issue; specific to the legacy `POLY_PROTO_*`-backed shared wallet on candidate-a. Suspects: stale Privy keys, balance / allowance drift, chain-id mismatch. Per-tenant wallets (Phase B) bypass this failure domain.
- [bug.0329](../../../work/items/bug.0329.poly-sell-neg-risk-empty-reject.md) — as noted above, missing neg-risk CTF approval blocks SELL. Fix is a one-time `setApprovalForAll` against `0xC5d56…f80a`.

## Anti-patterns specific to wallets

- **Mixing Privy apps.** `PRIVY_APP_ID` for shared-operator vs per-user wallets are distinct. Cross-signing will fail with opaque errors. Secret names in `scripts/setup/setup-secrets.ts` are the source of truth.
- **Treating `/status` `connected: true` as "wallet is trade-ready."** It only asserts the signing context resolves. Balance + approvals are separate checks (`/balance` + on-chain). task.0347 fixes this by surfacing honest balances.
- **Rotating AEAD keys without a keyring.** Bricks all encrypted creds on the next deploy.
- **Widening `CustodialConsent`** to an optional or to something broader than the current actor+version tuple without bumping the consent schema version. The ledger is meant to be auditable; widening retroactively makes old rows ambiguous.
- **Adding a second `serviceDb` / `BYPASSRLS` call path** for wallet rows. Violates tenant isolation.
- **Setting `POLY_WALLET_ALLOW_STUB_CREDS=1`** anywhere but local-dev. It's a stub-adapter escape hatch that bypasses Privy entirely. In preview/candidate-a/prod it must be absent.
- **Putting raw PKs in production code paths.** `scripts/experiments/` only, `.env.local`-scoped. Production signs via Privy HSM (shared or per-user).

## Enforcement rules

- `CustodialConsent` is a **compile-time** invariant — `provision` signature requires it, no runtime null-check fallback.
- AEAD AAD shape is **frozen** across nodes. Any change is a coordinated cross-node migration (`D-5`).
- Per-wallet RLS uses the `EXISTS through billing_accounts.owner_user_id` pattern, NOT `created_by_user_id`.
- `POLY_WALLET_ALLOW_STUB_CREDS` must be absent in `preview` / `candidate-a` / `production` — `scripts/setup/setup-secrets.ts` enforces this.
- Every successful provision must produce exactly one `poly_wallet_connections` row per `(billing_account_id, provider, generation)`. Orphans = bug.
- `deploy_verified: true` on any wallet-touching PR requires the full validation recipe above, not just `pnpm check` + a green flight.
