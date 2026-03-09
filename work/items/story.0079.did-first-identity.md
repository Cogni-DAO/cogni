---
id: story.0079
type: story
title: DID-first identity — decentralized member identifiers with verifiable account links
status: done
priority: 1
estimate: 4
summary: Replace wallet-address-as-identity with subject DID (did:key) as canonical identifier; wallet did:pkh and external accounts are linked DIDs/VCs, not the subject itself.
outcome: Members are identified by a stable subject DID regardless of first auth method; wallet/Discord/GitHub are linked identifiers; the system can federate identity claims without a database rewrite.
spec_refs:
assignees: derekg1729
credit:
project: proj.decentralized-identity
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-02-19
labels: [identity, web3, ssi]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 24
---

# DID-First Identity — Decentralized Member Identifiers

## Problem

Cogni currently treats identity as app-specific database rows: wallet addresses as primary keys, Discord/GitHub links as ad-hoc columns. This couples identity to our schema, makes federation impossible without schema integration, and doesn't align with decentralized identity standards the DAO should natively speak.

## Who Benefits

- **DAO members**: portable, privacy-respecting identity they control; account links they can export and prove elsewhere.
- **Node operators**: federate trust by accepting credentials rather than integrating databases.
- **Platform team**: clean identity abstraction that doesn't require rewrites when adding new auth methods or federating with other nodes.

## What Success Looks Like

1. **Canonical identity = subject DID**: every member is identified internally by a stable `did:key` minted at first contact. This works regardless of whether the user arrives via wallet, Discord, or any future auth method.
2. **Wallet = linked DID**: SIWE wallet adds a `did:pkh:eip155:{chainId}:{address}` as a linked identifier on the subject, not as the subject itself.
3. **Account links = Verifiable Credentials**: Discord and GitHub links are VC-shaped artifacts (issuer, subject, evidence, revocation status) — not rows in a linking table.
4. **Verification = Presentation Exchange**: when a service needs proof of an account link, it expresses requirements as a Presentation Definition (PEX) and gets back a Presentation Submission. Transport-agnostic (HTTP today, DIDComm later).
5. **Method agility**: DID create/resolve/update/deactivate behind a Registration/Resolution port so adding new DID methods doesn't rewrite business logic.
6. **Backward compatible**: SIWE login continues working end-to-end throughout transition. Existing users keep access uninterrupted.

## Requirements

- Canonical identity key is a subject DID (`did:key`), not a wallet address or `did:pkh`
- A user can exist without a wallet — subject DID is minted at first contact regardless of auth method
- Wallet login adds `did:pkh` as a linked DID on the subject, not as the subject itself
- Same wallet deterministically maps to the same `did:pkh` across environments
- External account links (Discord, GitHub) stored as Verifiable Credential objects with: proof method, evidence, issuance timestamp, issuer identity, revocation capability
- Identity state transitions recorded append-only (link issued, revoked, etc.); current state is derived
- Linking flows are idempotent (retries don't mint duplicate credentials)
- If a DID is already linked to a different subject, require explicit merge flow — never silently re-point
- Raw external identifiers (Discord numeric ID, GitHub username) treated as scoped/private data by default
- No blockchain registry, DIDComm, or trust registry required for v0
- No on-chain reputation tokens in scope
- SIWE authentication unchanged — DID derivation is additive

## Invariants

These must hold at all times once shipped:

1. **I-SUBJECT-DID**: Every member has a subject DID (`did:key`) minted at first contact. This is the stable canonical identifier. Wallet `did:pkh` is a linked DID, not the subject.
2. **I-CANONICAL-DID**: Internal identity key = subject DID, never raw wallet address or `did:pkh`
3. **I-DETERMINISTIC**: `did:pkh` derivation is pure function of chain + address
4. **I-NO-AUTO-MERGE**: If a linked DID (wallet, Discord, GitHub) is already bound to a different subject, require explicit merge with proofs. Never silently re-point links.
5. **I-CLAIMS-ARE-CREDENTIALS**: Account links are VC artifacts, not DB rows
6. **I-APPEND-ONLY-EVENTS**: Identity events are append-only; no mutation of history
7. **I-IDEMPOTENT-LINKING**: Repeated link attempts produce the same credential, not duplicates
8. **I-REVOCATION-EXISTS**: Links are revocable without deleting history
9. **I-PEX-VERIFICATION**: Proof requests use Presentation Exchange semantics
10. **I-METHOD-AGILITY**: DID ops behind a port; adding methods doesn't touch business logic
11. **I-PRIVACY-DEFAULT**: External identifiers not exposed publicly unless explicitly required

## Allowed Changes

- Identity/auth modules, DB schema, API routes
- Discord/GitHub linking flows
- Any code that references wallet address as user identity
- New `identity` service or module
- New DB tables/migrations for DIDs, credentials, identity events

## Plan

_High-level only — detailed planning in `/task` after spike completes._

- [ ] Complete spike.0080 (research current identity surface + design)
- [ ] Introduce DID fields + dual-write (Phase 0)
- [ ] Switch reads to DID (Phase 1)
- [ ] Represent account links as VCs with PEX verification interface
- [ ] Deprecate legacy wallet-address identifiers (Phase 2)

## Validation

**Acceptance criteria (must be testable):**

- New user creation mints a `did:key` subject DID and persists it
- SIWE login produces correct `did:pkh` and links it to the subject
- Subject DID is stable across logins — same user always gets same subject DID
- Linking Discord/GitHub issues a credential artifact about the subject DID, verifiable server-side
- Attempting to link a DID already bound to another subject is rejected (I-NO-AUTO-MERGE)
- Revoking a link marks credential as revoked without deleting history
- Identity endpoints are idempotent (duplicate calls don't create duplicate artifacts)
- No production data loss; existing users keep uninterrupted access
- All identity event state transitions appear in append-only ledger

## Review Checklist

- [ ] **Work Item:** `story.0079` linked in PR body
- [ ] **Spec:** all invariants upheld (I-SUBJECT-DID through I-PRIVACY-DEFAULT)
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Spike: spike.0080

## Attribution

-
