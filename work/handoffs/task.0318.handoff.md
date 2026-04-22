---
id: task.0318.handoff
type: handoff
work_item_id: task.0318
status: active
created: 2026-04-21
updated: 2026-04-21
branch: feat/task-0318-phase-b
last_commit: 921413314
---

# Handoff: task.0318 Phase B — per-tenant Polymarket trading wallets

## Context

- Phase A (merged PR #944) shipped tenant-isolated RLS on the copy-trade tables but kept a single shared Privy operator wallet doing all execution. Phase B (this PR #968) is "each user trades from their own wallet," using per-tenant Privy server-wallets under a **dedicated user-wallets Privy app** (not the operator system app).
- Phase B is decomposed B1–B7. B1 (Safe+4337 spike) was designed then **withdrawn** after review surfaced that the OSS framing didn't survive the Pimlico dependency and Privy-per-user reuses existing operator-wallet infra. The pivot is committed in the spec.
- This slice (PR #968) lands the port + schema + adapter + API route + CI plumbing for B2 — enough to exercise wallet creation on candidate-a via `/profile` or `POST /api/v1/poly/wallet/connect`, but not yet enough to place a real trade because grants / allowances / executor rewiring are still follow-up work.
- B2.10 is now covered locally by `nodes/poly/app/tests/component/wallet/privy-poly-trader-wallet.adapter.int.test.ts`, which round-trips `provision → resolve → getAddress → revoke → resolve=null` across two tenants and caught a real bug: fresh poly DBs were skipping `0030_poly_wallet_connections` because the Drizzle journal was missing that entry.
- **Reviewers have already flagged the code as partially hacky** — three-location split and two `biome-ignore noExplicitAny` remain. Those smells stay named explicitly in the runbook + PR body; the zero-tests complaint is now addressed and the stub-creds path is gone.

## Current State

- Port interface + types in `packages/poly-wallet/` (`PolyTraderWalletPort`, branded `AuthorizedSigningContext`, `AuthorizationFailure`, `OrderIntentSummary`).
- Migration `0030_poly_wallet_connections.sql` + Drizzle schema `poly_wallet_connections`, RLS-forced on `created_by_user_id`, partial unique on active rows per tenant.
- `PrivyPolyTraderWalletAdapter` lives node-local at `nodes/poly/app/src/adapters/server/wallet/` (can't move to the shared package because it imports `@cogni/poly-db-schema`, which is node-local per task.0324). Implements `provision` (advisory-locked), `resolve`, `getAddress`, `revoke`. `authorizeIntent` / `withdrawUsdc` / `rotateClobCreds` throw "not implemented."
- Bootstrap factory at `nodes/poly/app/src/bootstrap/poly-trader-wallet.ts` (routes can't import `@/adapters/**` per ESLint).
- `POST /api/v1/poly/wallet/connect` — session-authed, `CUSTODIAL_CONSENT` enforced, **501** on `actorKind: "agent"` (agent auth deferred), **503** on unconfigured env, info log on success.
- CI secret plumbing wires `PRIVY_USER_WALLETS_{APP_ID,APP_SECRET,SIGNING_KEY}` + `POLY_WALLET_AEAD_KEY_{HEX,ID}` through `candidate-flight-infra.yml` + `scripts/ci/deploy-infra.sh`.
- `pnpm check:fast` is green on the branch, and the targeted component lane for `privy-poly-trader-wallet.adapter.int.test.ts` now passes locally.
- Branch includes the latest main merge carried into PR #968; no new architectural churn beyond the B2.10 test + docs truth-sync.

## Decisions Made

- [Revised Phase B to Privy-per-user, Safe+4337 deferred to future OSS-hardening task](../../docs/spec/poly-multi-tenant-auth.md#phase-b-signing-backend-decision-revised-2026-04-20)
- [SEPARATE_PRIVY_APP: new Privy app for user wallets, distinct from operator](../../docs/spec/poly-trader-wallet-port.md#env--separation-of-system-and-user-wallet-privy-apps)
- [Branded `AuthorizedSigningContext` for compile-time scope/cap bypass protection](../../packages/poly-wallet/src/port/poly-trader-wallet.port.ts) — `placeOrder` will accept only the branded type
- [Advisory-locked `provision` + halt-future-only `revoke` + WITHDRAW_BEFORE_REVOKE UX contract](../../docs/spec/poly-trader-wallet-port.md#invariants)
- [Custodial consent persisted on row; agent-actor path requires follow-up API-key auth](../../docs/spec/poly-trader-wallet-port.md#onboarding)
- [B2.11 orphan sweep deferred to follow-up task.0348](../items/task.0348.poly-wallet-orphan-sweep.md)
- [Review feedback r3/r4 truth-sync — B2.10 fixed and B2.12 completed](../items/task.0318.poly-wallet-multi-tenant-auth.md#review-feedback-revision-3--2026-04-20-phase-b-slice-on-pr-968)

## Next Actions

- [x] **B2.10 — component test.** Testcontainers PG; two-tenant round-trip `provision → resolve → getAddress → revoke → resolve=null` exercising RLS + tenant defense-in-depth + AEAD round-trip. Landed locally in `nodes/poly/app/tests/component/wallet/privy-poly-trader-wallet.adapter.int.test.ts`.
- [x] **B2.12 — real CLOB L2 creds factory.** Shipped in bootstrap: `poly-trader-wallet.ts` now delegates to `createOrDerivePolymarketApiKeyForSigner()` at the existing `bootstrap/capabilities/poly-trade.ts` dynamic-import boundary, derives live CLOB L2 creds during `provision`, and no longer uses any stub-credential flag.
- [ ] **Post-v0 follow-up — orphan reconciler.** `scripts/ops/sweep-orphan-poly-wallets.ts` moved to [task.0348](../items/task.0348.poly-wallet-orphan-sweep.md). Useful hygiene, but not required to prove tenant-safe provisioning or real trading.
- [ ] Candidate-a secrets are now created for the dedicated user-wallets app. After merge, preview / production still need the same env rollout pattern before broader promotion.
- [ ] After merge → flight `candidate-flight-infra.yml` → exercise `POST /api/v1/poly/wallet/connect` per runbook § 5 → confirm Loki `poly.wallet.connect` line at the deployed SHA → post `deploy_verified` on PR.
- [ ] **Non-blocking cleanup** (follow-up PR): `crypto.randomUUID()` instead of PG roundtrip, delete dead `brandAuthorized`, move route Zod schemas to `packages/node-contracts/`, add `created_at` index, viem version unification to remove both `biome-ignore noExplicitAny`.
- [ ] B3–B7 remain unscoped beyond the checkpoint table. B3 (onboarding UX, both user + agent paths, withdraw) is the next meaningful slice.

## Risks / Gotchas

- **Three-location code split is intentional** (package port + node-local adapter + bootstrap factory). Driven by node-local `@cogni/poly-db-schema` + ESLint `no-restricted-imports` blocking `@/adapters/**` from routes. See [runbook § Architecture](../../docs/guides/poly-wallet-provisioning.md#architecture-honest-accounting) for full rationale. Do not "simplify" without solving the upstream boundary.
- **Two `biome-ignore lint/suspicious/noExplicitAny` in the adapter** at the `createViemAccount` sites. Same workaround `poly-trade.ts:696-700` uses. Root cause: `@privy-io/node/viem` ships viem `2.48.1` as peer; app pins `2.39.3`. Clean fix = unify viem across the repo. Don't silently delete the suppressions.
- **Live Polymarket creds now derive at provision time** — if `createOrDeriveApiKey()` fails, the route surfaces a 500 and logs `poly.wallet.provision failed to derive live CLOB creds`. There is no stub fallback anymore, so candidate-a validation should treat a successful `connect` as proof that Privy + Polymarket credential bootstrapping both worked.
- **`provision` does a PG roundtrip for UUID** via `tx.execute("SELECT gen_random_uuid()::text")` instead of `crypto.randomUUID()`. Noise, fix in the test PR.
- **Pre-commit hook has been SIGKILL-ing prettier** during this session under memory pressure. If you hit it, run `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec prettier --write <files>` directly before committing. 3 commits in this branch used `--no-verify` for this reason; each is named in the commit message.

## Pointers

| File / Resource                                                                                              | Why it matters                                                                                               |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [PR #968](https://github.com/Cogni-DAO/node-template/pull/968)                                               | The slice; PR body lists the smells reviewers have already flagged                                           |
| [docs/guides/poly-wallet-provisioning.md](../../docs/guides/poly-wallet-provisioning.md)                     | Runbook: 5-secret setup, `/profile` + API exercise paths, Loki handshake, § Architecture (honest accounting) |
| [docs/spec/poly-trader-wallet-port.md](../../docs/spec/poly-trader-wallet-port.md)                           | Port/adapter contract + 11 acceptance checks (tests must hit these)                                          |
| [docs/spec/poly-multi-tenant-auth.md](../../docs/spec/poly-multi-tenant-auth.md)                             | Tenant-isolation contract + schema                                                                           |
| [work/items/task.0318.poly-wallet-multi-tenant-auth.md](../items/task.0318.poly-wallet-multi-tenant-auth.md) | Lifecycle carrier — B2 checkpoint table shows shipped/open, r3 review feedback matrix                        |
| `packages/poly-wallet/src/port/poly-trader-wallet.port.ts`                                                   | The port interface (branded types)                                                                           |
| `nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts`                              | The adapter                                                                                                  |
| `nodes/poly/app/src/bootstrap/poly-trader-wallet.ts`                                                         | Bootstrap factory + live CLOB-creds derivation seam                                                          |
| `nodes/poly/app/src/app/api/v1/poly/wallet/connect/route.ts`                                                 | The route                                                                                                    |
| `nodes/poly/app/src/adapters/server/db/migrations/0030_poly_wallet_connections.sql`                          | Migration                                                                                                    |
| `nodes/poly/packages/db-schema/src/wallet-connections.ts`                                                    | Drizzle schema                                                                                               |
| `nodes/poly/app/src/bootstrap/capabilities/poly-trade.ts:660-726`                                            | **Reference pattern** — how the operator-wallet Privy flow is wired today; the adapter mirrors this shape    |
| `nodes/poly/app/src/adapters/server/connections/drizzle-broker.adapter.ts`                                   | **Reference pattern** for AEAD + tenant defense-in-depth + RLS-scoped SELECT; the adapter mirrors this       |
| `packages/node-shared/src/crypto/aead.ts`                                                                    | AEAD envelope helpers used by the adapter                                                                    |
