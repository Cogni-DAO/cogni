---
id: thirdweb-auth-migration-audit
type: research
title: "Research: Thirdweb Auth + Wallet Migration Audit"
status: active
trust: draft
summary: Feature-by-feature comparison of our current auth stack (NextAuth v4 + RainbowKit + SIWE + custom account linking) against thirdweb Connect, plus evaluation of thirdweb Engine Server Wallets as an operator wallet custody alternative to Privy.
read_when: Evaluating auth simplification, considering thirdweb adoption, planning operator wallet custody, or revisiting the RainbowKit/NextAuth dependency surface.
owner: derekg1729
created: 2026-02-28
verified: 2026-02-28
tags: [auth, wallet, web3, thirdweb, migration, research]
---

# Thirdweb Auth + Wallet Migration Audit

> date: 2026-02-28

## Question

Can and should we migrate from our current auth stack (NextAuth v4 + RainbowKit + SIWE + custom account linking) to thirdweb Connect? Separately, should thirdweb Engine Server Wallets replace Privy as the operator wallet custody provider?

## Context

Our auth system spans 6 packages (`next-auth`, `@rainbow-me/rainbowkit`, `@rainbow-me/rainbowkit-siwe-next-auth`, `wagmi`, `siwe`, `@tanstack/react-query`) with ~300 LOC of custom account linking logic (DB-backed `linkTransactions`, fail-closed verification via signed JWT cookies + AsyncLocalStorage propagation). The system enforces strong invariants: `WALLET_SESSION_COHERENCE`, `LINK_IS_FAIL_CLOSED`, `BINDINGS_ARE_EVIDENCED`, `NO_AUTO_MERGE`.

The `rainbowkit-siwe-next-auth` adapter blocks Auth.js v5 migration (noted in [authentication spec](../spec/authentication.md) as a non-goal). Adding new OAuth providers requires per-provider NextAuth configuration.

Meanwhile, the [AI Operator Wallet project](../../work/projects/proj.ai-operator-wallet.md) plans Privy for server-side wallet custody. Privy was acquired by Stripe (Jun 2025), raising long-term ecosystem drift concerns. Thirdweb and Coinbase CDP are potential alternatives.

This research evaluates both decisions independently.

## Current Auth Stack Inventory

### Architecture

| Layer              | Implementation                                                                                                 | Key Files                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Wallet auth        | RainbowKit 2.2.9 + wagmi 2.19.5 + SIWE via `rainbowkit-siwe-next-auth`                                         | `wallet.client.tsx`, `wagmi.config.ts`             |
| OAuth              | NextAuth v4 — GitHub, Discord, Google (conditional on env vars)                                                | `src/auth.ts`                                      |
| Session            | JWT strategy (HttpOnly cookie), no DB sessions table                                                           | `src/auth.ts`, `proxy.ts`                          |
| Canonical identity | `users.id` (UUID). Wallet address is optional attribute.                                                       | `packages/db-schema/src/refs.ts`                   |
| Account linking    | Custom DB-backed `linkTransactions` table, fail-closed                                                         | `link/[provider]/route.ts`, `link-intent-store.ts` |
| Identity model     | `user_bindings(provider, external_id)` → canonical `user_id`. `identityEvents` audit trail. RLS on all tables. | `packages/db-schema/src/identity.ts`               |
| Routing            | Server-side `proxy.ts` is single routing authority                                                             | `proxy.ts`, `AuthRedirect.tsx`                     |

### Package Dependencies

| Package                                 | Version  | Role                                               |
| --------------------------------------- | -------- | -------------------------------------------------- |
| `next-auth`                             | ^4.24.10 | OAuth providers, JWT session, signIn callbacks     |
| `@rainbow-me/rainbowkit`                | 2.2.9    | Wallet connection UI, ConnectButton                |
| `@rainbow-me/rainbowkit-siwe-next-auth` | ^0.5.0   | Glue: RainbowKit SIWE ↔ NextAuth session          |
| `wagmi`                                 | 2.19.5   | Wallet hooks (also used in payments, DAO setup)    |
| `siwe`                                  | ^3.0.0   | SiweMessage verification in credentials provider   |
| `viem`                                  | 2.39.3   | EVM interactions (payments, on-chain verification) |

### Custom Auth Code Surface (~8 files)

- `src/auth.ts` — NextAuth config, `createLinkTransaction()`, `consumeLinkTransaction()`, signIn/jwt/session callbacks
- `src/app/api/auth/[...nextauth]/route.ts` — JWT decode → link intent via AsyncLocalStorage
- `src/app/api/auth/link/[provider]/route.ts` — Link initiation: DB insert + signed JWT cookie
- `src/shared/auth/link-intent-store.ts` — Discriminated union types + AsyncLocalStorage
- `src/adapters/server/identity/create-binding.ts` — Atomic binding + event creation
- `src/proxy.ts` — Server-side auth routing
- `src/lib/auth/server.ts` — `getServerSessionUser()`
- `src/components/kit/auth/SignInDialog.tsx` — Modal: wallet + OAuth options
- `src/components/kit/auth/WalletConnectButton.tsx` — Custom ConnectButton wrapper

### Enforced Invariants

| Invariant                  | Mechanism                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `WALLET_SESSION_COHERENCE` | RainbowKit SIWE adapter invalidates session on wallet disconnect/switch                |
| `CANONICAL_IS_USER_ID`     | `users.id` (UUID) is FK anchor for billing, RBAC, agents, ledger                       |
| `LINK_IS_FAIL_CLOSED`      | DB transaction + signed JWT + atomic consumption; invalid = reject, never fall-through |
| `BINDINGS_ARE_EVIDENCED`   | Every binding INSERT paired with `identity_events` INSERT                              |
| `NO_AUTO_MERGE`            | `UNIQUE(provider, external_id)` at DB level                                            |

## Thirdweb Capabilities Summary

Sources: [thirdweb Auth](https://portal.thirdweb.com/connect/auth), [In-App Wallets](https://portal.thirdweb.com/connect/in-app-wallet/overview), [Link Profiles](https://portal.thirdweb.com/react/v5/linking), [wagmi Adapter](https://portal.thirdweb.com/react/v5/adapters), [Engine v3](https://portal.thirdweb.com/engine/v3), [RainbowKit Migration Guide](https://portal.thirdweb.com/react/v5/rainbow-kit-migrate).

### Auth Methods

Single `thirdweb` package provides: external wallet connect (500+ wallets), SIWE, social OAuth (Google, Apple, Facebook, X, Discord, GitHub, Twitch, TikTok, + more), email/phone verification, passkeys (WebAuthn), guest login, custom JWT auth.

### Identity & Sessions

- Each user gets a `userId` + `walletAddress` in thirdweb's system
- JWT-based sessions (HttpOnly cookie, server-side verification via `auth.verifyJWT()`)
- Backend user lookup API: query by `walletAddress`, `email`, `phone`, `externalWalletAddress`, or `id`
- Custom auth mode: pass your own JWT (your UUID as `sub`), thirdweb generates wallet from it

### Profile Linking

- `useLinkProfile()` hook for programmatic linking
- Built into ConnectButton "Manage Wallet" UI
- Supports linking email, phone, passkey, guest, wallet, and all social OAuth providers
- **Critical limitation: only works with in-app wallet or ecosystem wallet users. External wallet (MetaMask, etc.) users cannot use profile linking.**

### wagmi Compatibility

- `@thirdweb-dev/wagmi-adapter` package (requires wagmi ≥ 2.14.1)
- Adds `inAppWalletConnector` alongside existing wagmi connectors
- Bidirectional conversion: wagmi wallet ↔ thirdweb wallet

### Server Wallets (Engine)

- TEE/enclave-backed signing, backend-controlled
- Smart accounts (ERC-4337) auto-deployed per chain — wallet address IS the smart account address
- Built-in paymaster (no gas token management), automatic nonce handling, tx resubmission
- Permission-scoped access tokens for granular control

## Feature-by-Feature Comparison

| Feature                   | Current Stack                                        | Thirdweb                                                   | Assessment                                            |
| ------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| External wallet connect   | RainbowKit (500+ wallets)                            | ConnectButton (500+ wallets)                               | Parity                                                |
| SIWE auth                 | `rainbowkit-siwe-next-auth` → NextAuth credentials   | Built-in SIWE + JWT                                        | Thirdweb replaces two packages                        |
| OAuth providers           | NextAuth: GitHub, Discord, Google                    | 14+ providers, zero config                                 | Thirdweb superset                                     |
| Email/phone/passkey/guest | Not implemented                                      | Built-in                                                   | Thirdweb adds capability                              |
| Session handling          | NextAuth JWT in HttpOnly cookie                      | Thirdweb JWT in HttpOnly cookie                            | Equivalent pattern                                    |
| Account linking           | Custom `linkTransactions` (fail-closed, ~300 LOC)    | `useLinkProfile()` — in-app/ecosystem wallets only         | **Thirdweb cannot replace for external wallet users** |
| Canonical identity        | `users.id` UUID via `user_bindings`                  | `userId` in thirdweb cloud (or custom auth with your UUID) | Our DB must remain source of truth                    |
| Backend user lookup       | Direct DB queries                                    | REST API (`in-app-wallet.thirdweb.com`)                    | Thirdweb is API-only, no direct DB                    |
| Audit trail               | `identity_events` (append-only, DB trigger enforced) | Not exposed                                                | We lose this                                          |
| RLS / DB security         | All identity tables have Postgres RLS                | N/A — data in thirdweb cloud                               | Different trust model                                 |
| wagmi hooks               | Native (RainbowKit built on wagmi)                   | Via adapter (indirect)                                     | Adapter exists, needs validation                      |
| Package count             | 6 auth packages                                      | 1 package (`thirdweb`)                                     | Significant simplification                            |

## Operator Wallet Custody Comparison

Evaluated against the [operator wallet spec](../spec/operator-wallet.md) requirements: no raw keys in app, programmatic setup, typed intent interface, destination allowlist, per-tx caps.

| Capability       | Privy (current plan)                | Thirdweb Engine                             | Coinbase CDP Agentic                     |
| ---------------- | ----------------------------------- | ------------------------------------------- | ---------------------------------------- |
| Key storage      | HSM-backed                          | TEE/enclave-backed                          | TEE-backed (<200ms)                      |
| Wallet type      | Plain EOA                           | Smart account (ERC-4337)                    | EOA with policy engine                   |
| Signing          | API + signed requests (2-factor)    | API + permission-scoped tokens              | API + policy-enforced                    |
| Tx policies      | Chain + contract + cap restrictions | Access token scopes                         | Declarative: caps, allowlists, sanctions |
| Nonce management | Manual                              | Automatic (multi-dimensional, resubmission) | Automatic                                |
| Gas management   | You manage ETH balance              | Built-in paymaster (no gas tokens needed)   | Gas sponsorship available                |
| Creation         | API → returns address               | API → smart account auto-deploys            | API, deterministic from string ID        |
| Base support     | Yes                                 | Yes                                         | Native (Base-first)                      |
| x402 support     | No                                  | Yes (first-party client/server/facilitator) | Native (50M+ txs)                        |
| Maturity         | Production (Stripe-acquired)        | Production (Engine v3)                      | New (Feb 2026)                           |

### Smart Account vs EOA Consideration

Thirdweb Engine server wallets are smart accounts, not plain EOAs. This affects the operator wallet because:

- Split contract distributes USDC to the operator wallet address — smart account address differs from underlying EOA
- `transfer_intent.metadata.sender` from OpenRouter must match the operator wallet address
- ERC-20 approval flows may differ for smart accounts

Not a blocker (smart accounts can do everything EOAs can), but spike.0090 should validate if thirdweb Engine is considered.

### Thirdweb Engine Advantage: Gas + Nonce

The built-in paymaster eliminates the gas-balance-management concern entirely — no need to fund the operator wallet with ETH for gas, no low-balance alerts for gas. Automatic nonce handling + tx resubmission is directly valuable for the top-up reliability requirement.

### Thirdweb Account Abstraction for External Wallets

Gasless smart-account UX is **not limited to in-app wallets**. Thirdweb's ConnectButton can convert any connected external wallet (MetaMask, WalletConnect, etc.) into an ERC-4337 smart account via the `accountAbstraction` prop, with gas sponsorship enabled. This means external-wallet-first users can still benefit from gasless transaction UX without switching to in-app wallets.

### Thirdweb x402 Support

Thirdweb has first-party x402 client/server/facilitator support. The facilitator uses server wallets + EIP-7702 to submit transactions gaslessly. This is directly relevant to the P2 "autonomous spending" roadmap — thirdweb Engine is a viable x402 path, not just Coinbase CDP.

## Findings

### Finding 1: Profile Linking Limitation Kills the Primary Auth Migration Benefit

Thirdweb's `useLinkProfile()` only works with in-app or ecosystem wallets. Our primary user base (DAO members) connects with external wallets (MetaMask, WalletConnect). Migrating to thirdweb Connect would either:

- Force all users through in-app wallets (UX regression for crypto-native users who want their own wallet)
- Keep custom linking for external wallet users (defeats the simplification)

This is the decisive constraint. The package-count reduction is real but not worth the migration risk when the headline feature doesn't apply to our core user type.

### Finding 2: The Current Auth Stack Is Well-Engineered

The auth system enforces strong, tested invariants (fail-closed linking, wallet-session coherence, evidenced bindings, no-auto-merge). The custom code exists for good reasons — thirdweb's managed service cannot replicate these guarantees for external wallet users. Trading well-understood custom code for a vendor dependency that can't match the invariants is a net loss.

### Finding 3: The `rainbowkit-siwe-next-auth` Dependency Is the Real Pain Point

This adapter is the narrowest, most fragile piece — it glues RainbowKit's SIWE flow to NextAuth's session and blocks Auth.js v5 migration. When this becomes urgent, the cleanest fix is replacing this specific adapter (potentially with thirdweb's SIWE or a direct Auth.js v5 credentials provider), not migrating the entire auth stack.

### Finding 4: Auth and Operator Wallet Are Independent Decisions

The `OperatorWalletPort` abstraction already insulates custody backend choice from the rest of the system. Auth vendor choice and wallet custody vendor choice should be evaluated independently — coupling them to a single vendor creates a single point of failure.

### Finding 5: Thirdweb Engine Has Genuine Advantages for Operator Wallet

Built-in paymaster (no gas token management), automatic nonce handling, and tx resubmission are directly valuable for the automated top-up use case. If Privy's post-Stripe trajectory becomes concerning, thirdweb Engine is a credible alternative — the port abstraction makes swapping a single adapter file.

### Finding 6: Coinbase CDP and Thirdweb Engine Both Viable for x402

CDP Agentic Wallets are Base-native with x402 support and declarative policy engines, but launched Feb 2026 — least mature. Thirdweb Engine also has first-party x402 facilitator support using server wallets + EIP-7702. Both are credible paths for P2 autonomous spending; the `OperatorWalletPort` abstraction makes either a single-adapter swap.

### Finding 7: Three Wallet Lanes, Not a Binary Choice

The right model is not "external wallet vs in-app wallet" — it's three lanes serving different actors:

| Actor                               | Wallet Type                               | Rationale                                                                                                                                                   |
| ----------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Human (crypto-native)**           | External wallet (MetaMask, WalletConnect) | Primary path. DAO members manage their own keys. No forced custody change.                                                                                  |
| **Human (low-friction onboarding)** | In-app wallet (optional)                  | Email/social/passkey auth generates a wallet automatically. Layered via thirdweb custom auth with our UUID as `sub`. Does not replace external wallet path. |
| **Agent / system tenant**           | Server wallet (Engine)                    | Backend-controlled. For operator wallet, treasury automation, x402 facilitator. Not a user-facing wallet.                                                   |

External-wallet-first stays correct for the current DAO-style audience. In-app wallets are an additive onboarding lane, not a replacement. Server wallets are a separate concern entirely — they serve the operator wallet and future agent autonomy use cases.

### Finding 8: Custom Auth Preserves UUID as Canonical Identity

Thirdweb's custom auth mode explicitly supports generating a wallet from an OIDC JWT's `sub` claim. This means our `users.id` UUID can remain the canonical identity while thirdweb layers wallet/auth capabilities on top. The blocker is not "thirdweb replaces our identity" — it's the profile-linking limitation for external wallet users.

## Recommendation

### User Auth: Stay on Current Stack

Profile linking limitation for external wallets kills the primary migration benefit. The auth code is well-tested, invariants are sound, and the custom linking logic exists for good reasons thirdweb cannot replicate for external wallet users.

### Operator Wallet: Privy for P0, Thirdweb Engine as Backup

Proceed with Privy per existing plan. `OperatorWalletPort` makes custody backend swappable. Thirdweb Engine's built-in paymaster + nonce management + x402 facilitator make it the strongest backup candidate — evaluate as second adapter at PR 1 time.

### Wallet Architecture: Three Lanes

| Lane                                   | Status                                    | When                                          |
| -------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| External wallet (human, crypto-native) | **Active** — current primary path         | Now                                           |
| In-app wallet (human, low-friction)    | **Not started** — additive, optional      | When non-crypto onboarding becomes a priority |
| Server wallet (agent/system)           | **Not started** — operator wallet project | P0 via Privy, thirdweb Engine as alternative  |

### Do Not Unify Vendors

Keep auth and wallet custody as independent failure domains. A thirdweb outage should not block user login; a Privy outage should not block user login. Conversely, an auth outage should not block operator wallet signing.

### What Would Change This Recommendation

| Trigger                                    | Action                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| Non-crypto users become primary audience   | Add in-app wallet lane via thirdweb custom auth (layer on top, don't replace) |
| Auth.js v5 migration becomes urgent        | Replace `rainbowkit-siwe-next-auth` specifically, not full auth migration     |
| Privy degrades post-Stripe acquisition     | Swap to thirdweb Engine adapter (single file change via `OperatorWalletPort`) |
| P2 autonomous spending / x402              | Spike thirdweb Engine x402 facilitator vs Coinbase CDP                        |
| User base shifts to in-app-wallet-majority | Thirdweb profile linking becomes viable, revisit auth decision                |

## Open Questions

- [ ] Does thirdweb Engine smart account work correctly as a Split contract recipient + Coinbase Transfers sender? (validate during spike.0090 if Engine is considered)
- [ ] What is thirdweb Engine's pricing model for server wallet transactions? (not clear from docs)
- [ ] Can thirdweb's custom auth mode (`OIDC JWT`) preserve our `WALLET_SESSION_COHERENCE` invariant for external wallet users?
- [ ] Thirdweb x402 facilitator: what is the server wallet + EIP-7702 flow for gasless automated payments? (spike if P2 autonomous spending is prioritized)
- [ ] Account abstraction for external wallets: does ConnectButton's `accountAbstraction` prop work with RainbowKit, or only with thirdweb's ConnectButton?

## Related

- [Authentication Spec](../spec/authentication.md) — Current auth system as-built
- [Operator Wallet Spec](../spec/operator-wallet.md) — Wallet lifecycle, custody, access control
- [Web3 → OpenRouter Top-Up Spec](../spec/web3-openrouter-payments.md) — Outbound payment flow
- [AI Operator Wallet Project](../../work/projects/proj.ai-operator-wallet.md) — Project roadmap
- [AI Operator Wallet Research](./ai-operator-wallet-budgeted-spending.md) — Custody options evaluation
