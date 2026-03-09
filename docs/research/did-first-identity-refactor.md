---
id: did-first-identity-research
type: research
title: "Research: DID-First Identity Refactor"
status: active
trust: draft
summary: Gap analysis of current wallet-based identity system, OSS library evaluation for did:pkh/VCs/PEX, and minimal refactor design to adopt DIF standards.
read_when: Implementing DID-first identity, adding verifiable credentials, or understanding the identity migration plan.
owner: derekg1729
created: 2026-02-17
verified: 2026-02-17
tags: [identity, web3, ssi, research]
---

# Research: DID-First Identity Refactor

> spike: spike.0080 | date: 2026-02-17

## Question

How do we minimally refactor Cogni's wallet-address-based identity system to use `did:pkh` as the canonical identifier and represent account links as Verifiable Credentials, without breaking existing SIWE auth or billing?

## Context

Cogni uses SIWE (Sign-In with Ethereum) as the sole authentication method. Identity flows through three tiers: wallet address (entry point) → user UUID (DB primary key) → billing account UUID (economic entity). There are **zero** existing Discord/GitHub account linking implementations — the only Discord integration is a bot token passed to OpenClaw's gateway. This means the VC-based linking system is entirely greenfield.

---

## Findings: Current Identity Surface (Gap Analysis)

### Identity Flow (As-Built)

```
Wallet Sign (RainbowKit) → SIWE Verify (src/auth.ts)
  → User Lookup/Create by wallet_address (users table)
  → JWT Session { id: UUID, walletAddress: "0x..." }
  → SessionUser { id, walletAddress } (src/shared/auth/session.ts)
  → Billing Account { ownerUserId → users.id } (1:1)
  → RLS-scoped queries via withTenantScope(userActor(userId))
```

### Database Schema

**`users` table** (`packages/db-schema/src/refs.ts`):

- `id: text PK` — UUID v4, generated on first login
- `wallet_address: text UNIQUE` — Ethereum address from SIWE
- `name`, `email`, `image` — optional, unused in identity flows

**FK dependents** (all reference `users.id`):

- `billing_accounts.owner_user_id` — 1:1
- `execution_grants.user_id` — 1:N
- `schedules.owner_user_id` — 1:N
- `ai_threads.user_id` — 1:N

### Identity Touchpoints (Must Change)

| Location                                                  | Current Identity                                              | Change Required                                  |
| --------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| `src/auth.ts` (L129)                                      | `users.walletAddress` lookup                                  | Add DID derivation post-SIWE                     |
| `src/auth.ts` (L134-142)                                  | User created with `walletAddress`                             | Also store `did`                                 |
| `src/auth.ts` (L165-179)                                  | JWT includes `walletAddress`                                  | Also include `did`                               |
| `src/types/next-auth.d.ts`                                | `Session.user.walletAddress`                                  | Add `did` field                                  |
| `src/shared/auth/session.ts`                              | `SessionUser { id, walletAddress }`                           | Add `did` field                                  |
| `src/lib/auth/server.ts`                                  | Returns `{ id, walletAddress }`                               | Add `did`                                        |
| `src/lib/auth/mapping.ts`                                 | `getOrCreateBillingAccountForUser({ userId, walletAddress })` | Accept `did`                                     |
| `src/app/_facades/ai/completion.server.ts`                | `sessionUser.id` for billing                                  | Use `did` for identity, keep UUID for billing FK |
| `src/app/_facades/ai/activity.server.ts`                  | `sessionUser.id` for billing                                  | Same                                             |
| `src/app/_facades/payments/credits.server.ts`             | `sessionUser.id` + `walletAddress`                            | Same                                             |
| `src/adapters/server/accounts/drizzle.adapter.ts`         | `ownerUserId` FK                                              | Keep (UUID stays as DB PK)                       |
| `packages/db-schema/src/refs.ts`                          | `users` table definition                                      | Add `did` column                                 |
| RBAC spec `docs/spec/rbac.md`                             | Actor type `user:{walletAddress}`                             | Migrate to `user:{did}`                          |
| User context spec `docs/spec/user-context.md`             | `opaqueId` derivation from wallet                             | Derive from DID                                  |
| Messenger channels spec `docs/spec/messenger-channels.md` | `tenant-{billingAccountId}`                                   | No change (billing, not identity)                |

### Discord/GitHub Linking: Greenfield

**No existing code.** The codebase has:

- Discord bot token in OpenClaw gateway config (not user-level linking)
- GitHub RW token for OpenClaw sandbox Git operations (not user-level linking)
- Zero `discord_id`, `github_id`, `linked_account`, or `external_id` fields anywhere
- Zero OAuth providers configured
- Zero member tracking tables

This is good news: the VC-based linking system has no legacy to migrate.

---

## Findings: OSS Library Evaluation

### 1. DID Parsing + Resolution

| Package                  | Version | Last Publish | Weekly DL | Verdict                                                                       |
| ------------------------ | ------- | ------------ | --------- | ----------------------------------------------------------------------------- |
| `did-resolver`           | 4.1.0   | 2023-09      | ~20K      | **Use.** Universal DID resolution framework. Healthy, 30+ contributors.       |
| `pkh-did-resolver`       | 2.0.0   | 2024-10      | Low       | **Use.** Plugs into `did-resolver` for `did:pkh` method. Ceramic team.        |
| `@didtools/pkh-ethereum` | 0.6.0   | 2024-10      | ~9.4K     | Skip. Heavier than needed — designed for Ceramic ecosystem, includes CACAO.   |
| `@spruceid/didkit-wasm`  | 0.2.1   | 2025-05      | Low       | Skip. WASM binary adds bundle size. Pre-1.0. Overkill for did:pkh derivation. |

**Recommendation:** For Phase 0-1, a hand-rolled `walletToDid()` utility suffices — derivation is pure string concatenation. Add `did-resolver` + `pkh-did-resolver` at Phase 2 when external DID resolution is needed (accepting credentials from other issuers).

### 2. Verifiable Credentials

| Package                  | Approach | Version | Last Publish | Verdict                                                                     |
| ------------------------ | -------- | ------- | ------------ | --------------------------------------------------------------------------- |
| `did-jwt-vc`             | JWT VC   | 4.0.7   | 2024-10      | **Use.** Lightweight, JWT-native, same team as `did-resolver`.              |
| `@veramo/credential-w3c` | Both     | 6.x     | Active       | Skip for v0. Full agent framework — massive dependency tree. Good for P2.   |
| `@digitalbazaar/vc`      | JSON-LD  | 6.x     | Active       | Skip. JSON-LD is heavier and we don't need linked data proofs for v0.       |
| `@sd-jwt/core`           | SD-JWT   | 0.14.0  | 2026-02      | Watch. Selective disclosure is interesting for privacy but adds complexity. |

**Recommendation:** `did-jwt-vc` for v0. JWT VCs are the simplest format that preserves W3C VC data model compliance. JSON-LD can be evaluated at P2 if federation requires it.

**Format decision: JWT VC over JSON-LD VC because:**

- Simpler verification (standard JWT libraries)
- No JSON-LD context resolution (no network dependency for verification)
- `did-jwt-vc` is lightweight with minimal dependencies
- W3C VC data model compliance is maintained
- Can be upgraded to JSON-LD proofs later without changing the data model

### 3. Presentation Exchange

| Package         | Version | Last Publish | Verdict                                                             |
| --------------- | ------- | ------------ | ------------------------------------------------------------------- |
| `@sphereon/pex` | 5.x     | Active       | **Use for reference.** DIF PEX v1+v2. The canonical implementation. |
| `@animo-id/pex` | 6.1.1   | 2025-06      | Alternative fork by Animo. More recent but niche.                   |

**Recommendation:** For v0, implement PEX semantics as lightweight internal types (Presentation Definition / Submission shapes) rather than pulling the full `@sphereon/pex` library. The library is useful when you need full PEX validation, but for internal-only verification (single issuer, known credential types), hand-rolled types suffice. Adopt `@sphereon/pex` at P1 when credential types diversify.

### 4. Signature Scheme

**Two signing contexts exist — don't conflate them:**

- **System-issued VCs (v0):** The system is the sole issuer. `did-jwt-vc` uses `did-jwt` internally, which signs JWTs with ES256K (secp256k1). The system holds a server-side keypair (`did:key`) and signs credentials directly. No wallet interaction needed.
- **User-signed credentials (future):** If users ever self-attest or co-sign credentials, EIP-712 via `viem.signTypedData()` gives structured, human-readable signing UX. Defer to P2+.

**Recommendation:** For v0, use `did-jwt-vc` with a server-side `did:key` signer (ES256K). This is the library's native signing path — no custom JWT construction needed. EIP-712 wallet signing is orthogonal and only relevant when users sign their own credentials.

### 5. What's Missing (Build Behind Ports)

| Capability                  | OSS Status                                      | Our Approach                                         |
| --------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `did:pkh` string derivation | Trivial (string concat)                         | `walletToDid()` utility; no library needed           |
| VC issuance (system-signed) | `did-jwt-vc` + `did:key` signer                 | Thin wrapper, ES256K server-side key                 |
| VC revocation (status list) | `@transmute/vc-status-rl-2021` exists but heavy | Simple DB status column for v0, StatusList2021 at P2 |
| PEX validation              | `@sphereon/pex` exists                          | Internal types for v0, library at P1                 |
| Identity event ledger       | Nothing specific                                | Append-only DB table                                 |

---

## Recommendation

### Minimal Stack for v0

```
DID derivation:     Hand-rolled walletToDid() utility (string concat)
DID resolution:     did-resolver + pkh-did-resolver (add at Phase 2)
VC issuance:        did-jwt-vc (JWT VC format, ES256K server-side signer)
System issuer:      did:key from server-side secp256k1 keypair
PEX semantics:      Internal types (no library for v0)
Revocation:         DB status column (upgrade to StatusList2021 at P2)
```

### Key Architectural Decision: UUID Stays as DB Primary Key

The `users.id` UUID should **remain as the database primary key**. The DID becomes the **canonical identity for business logic and external interfaces**, while UUIDs stay as internal FK references. This avoids a massive FK migration and keeps RLS working.

```
External identity:  did:pkh:eip155:1:0xabc...  (canonical, deterministic)
Internal DB key:    users.id (UUID)              (FK target, stays)
Lookup bridge:      users.did column (UNIQUE)    (new, indexed)
```

### Migration Strategy

**Phase 0 — Dual Write (1 PR)**

1. Add `did TEXT UNIQUE` column to `users` table
2. Add DID derivation utility: `walletToDid(chainId, address) → did:pkh:eip155:{chainId}:{address}`
3. Populate DID on SIWE login (new users get it at creation, existing users on next login)
4. Backfill migration: deterministically populate `did` for all existing users
5. Add `did` to `SessionUser` type, JWT token, and session callbacks
6. No read path changes yet

**Phase 1 — Switch Reads (1-2 PRs)**

1. All business logic identity references use `did` instead of `walletAddress`
2. RBAC actor type becomes `user:{did}` instead of `user:{walletAddress}`
3. User context `opaqueId` derived from DID
4. `walletAddress` still stored but treated as a "proof method", not identity

**Phase 2 — Verifiable Credentials (design when account linking ships)**

Phase 2 tables, endpoints, and VC flows should be designed in a dedicated spec (`docs/spec/decentralized-identity.md`) when Discord/GitHub account linking is actually needed (see proj.messenger-channels). Pre-designing APIs for flows that don't exist yet would violate the codebase's no-premature-abstractions principle.

Directional sketch (not binding):

- New tables: `credentials`, `identity_events`
- VC issuance endpoints for Discord/GitHub linking
- PEX verification interface
- Revocation flow

### Data Model (Phase 0)

```sql
ALTER TABLE users ADD COLUMN did TEXT UNIQUE;
CREATE INDEX users_did_idx ON users(did);
```

Phase 2 tables (`credentials`, `identity_events`) will be designed when account linking ships. See invariants checklist for the constraints they must satisfy.

### Invariants Checklist

| Invariant                    | Met? | Notes                                                            |
| ---------------------------- | ---- | ---------------------------------------------------------------- |
| **I-CANONICAL-DID**          | Yes  | `users.did` becomes canonical; business logic references DID     |
| **I-DETERMINISTIC**          | Yes  | `did:pkh:eip155:{chainId}:{address}` is a pure function          |
| **I-CLAIMS-ARE-CREDENTIALS** | Yes  | JWT VCs via `did-jwt-vc`, stored in `credentials` table          |
| **I-APPEND-ONLY-EVENTS**     | Yes  | `identity_events` table, insert-only                             |
| **I-IDEMPOTENT-LINKING**     | Yes  | `idempotency_key` UNIQUE constraint on `credentials`             |
| **I-REVOCATION-EXISTS**      | Yes  | `status` column + `revoked_at`, history preserved                |
| **I-PEX-VERIFICATION**       | Yes  | Internal PEX types for v0; `@sphereon/pex` at P1                 |
| **I-METHOD-AGILITY**         | Yes  | DID ops behind `DidRegistrationPort`; only `did:pkh` for v0      |
| **I-PRIVACY-DEFAULT**        | Yes  | External IDs in `credentials.evidence_ref`, not exposed publicly |

### Risks

| Risk                                        | Mitigation                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| JWT VC format limits future JSON-LD interop | `did-jwt-vc` produces W3C-compliant VCs; format upgrade path exists                     |
| Signature replay (future user-signed VCs)   | Include nonce + domain separation when EIP-712 wallet signing is introduced at P2       |
| Discord usernames change                    | Use immutable numeric Discord user ID, never username                                   |
| GitHub gist proof can be deleted            | Store evidence snapshot at issuance time; gist is proof method, not ongoing requirement |
| Backfill assumes chain ID 1 (mainnet)       | Correct for current SIWE config; make chain ID configurable in DID derivation function  |
| Large FK migration if UUID→DID              | Avoided: UUID stays as DB PK, DID is a new indexed column                               |

---

## Open Questions

1. **Chain ID handling**: DID derivation must read `chainId` from the SIWE message payload — not default to `1`. The SIWE message contains chainId; Phase 0 must extract and persist it. Wrong chainId = wrong DID permanently.
2. **System issuer DID**: `did:key` from a server-side secp256k1 keypair for v0. Upgrade to `did:web:cogni.dev` at P2 if federation requires a web-resolvable issuer.
3. **Discord linking proof flow**: Design when Discord integration matures (see proj.messenger-channels). Not in scope for Phase 0-1.
4. **Credential export format**: Defer to P2.

---

## Proposed Layout

### Project

Already exists: `proj.decentralized-identity`

### Specs to Write/Update

| Spec                                  | Action                                                                        | When           |
| ------------------------------------- | ----------------------------------------------------------------------------- | -------------- |
| `docs/spec/decentralized-identity.md` | **Create** — DID port, invariants (move from story.0079 to spec as canonical) | Before Phase 1 |
| `docs/spec/authentication.md`         | **Update** — `SIWE_CANONICAL_IDENTITY` evolves to include DID                 | Phase 1        |
| `docs/spec/rbac.md`                   | **Update** — actor type `user:{did}`                                          | Phase 1        |
| `docs/spec/user-context.md`           | **Update** — `opaqueId` from DID                                              | Phase 1        |
| `docs/spec/accounts-design.md`        | **Update** — identity model section                                           | Phase 1        |

**Note:** The 9 invariants (I-CANONICAL-DID through I-PRIVACY-DEFAULT) currently live in story.0079 — they must move to the spec as the authoritative source, not be duplicated.

### Architecture Mapping

Implementation must follow existing codebase patterns:

- `src/contracts/identity.did.v1.contract.ts` — Zod schemas for identity endpoints
- `src/ports/did-registration.port.ts` — following `accounts.port.ts` pattern (port-level errors, interface)
- `src/features/identity/` — feature service orchestrating DID ops through ports

### Likely Tasks (Phase 0-1 only)

Phase 2 tasks created when account linking ships — not pre-planned.

1. **task: DID derivation utility + DB migration** (Phase 0) — `walletToDid()`, `did` column, backfill, dual-write. Must read chainId from SIWE message. Est: 2
2. **task: SessionUser DID integration** (Phase 0) — JWT, session types, auth callbacks. Est: 1
3. **task: Switch identity reads to DID** (Phase 1) — business logic, RBAC actor type, user context. Est: 2
