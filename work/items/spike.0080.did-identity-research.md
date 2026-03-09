---
id: spike.0080
type: spike
title: Research current identity system + design minimal DID-first refactor
status: done
priority: 1
estimate: 2
summary: Map every place wallet address / user_id is assumed in the codebase; design the minimal refactor to adopt did:pkh + VCs + PEX aligned with DIF standards.
outcome: A design doc with gap analysis, target architecture, schema migration plan, API contracts, rollout phases, and test plan — ticking every invariant from story.0079.
spec_refs:
assignees: derekg1729
credit:
project: proj.decentralized-identity
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-02-17
labels: [identity, web3, ssi, research]
external_refs: docs/research/did-first-identity-refactor.md
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Research: DID-First Identity Refactor Design

## Context

Parent story: `story.0079` — DID-first identity with verifiable account links.

This spike produces the design doc that unblocks implementation. The design space involves DIF/SSI standards (did:pkh, VCs, PEX) applied to our existing SIWE-based identity system. The engineer needs to understand current state before proposing changes.

## Requirements (Research Questions)

### 1. Current Identity Surface (Gap Analysis)

- Map the SIWE login lifecycle: session model, DB schema, where "user_id" / wallet address is stored and referenced
- Identify all existing GitHub/Discord linking stubs, member tracking, bot integration points
- Find any identity coupling in: knowledge base citations, credit/billing, authz/permissions, audit trails
- Produce a gap list: every place `wallet address / user_id` is assumed and what it should become (DID)

### 2. Standards Evaluation

- Evaluate `did:pkh` libraries (JS/TS ecosystem): maturity, maintenance, API surface
- Evaluate VC data model options: JWT VC vs JSON-LD VC — pick simplest that preserves portability, justify choice
- Evaluate PEX libraries: DIF Presentation Exchange implementations in JS/TS
- Evaluate signature schemes: EIP-191 vs EIP-712 for VC signing — pick one, justify
- Identify gaps where no adequate OSS exists (isolate behind ports)

### 3. Design Output

Produce a single design doc containing:

**A) Minimal Target Architecture** (1-2 pages)

- Entities: Person, DID, Credential, CredentialStatus, IdentityEvent
- How SIWE maps to `did:pkh`
- How Discord/GitHub links become VCs (data model + signing + storage)
- How verification uses PEX constructs

**B) Data Model + Migration Plan**

- Schema changes with migration path preserving old identifiers
- Backfill plan: populate DIDs deterministically from existing wallet addresses

**C) API/Service Contracts**

- `GET/POST /identity/did`
- `POST /identity/link/discord`
- `POST /identity/link/github`
- `POST /identity/present` (PEX verification)
- `POST /identity/revoke`
- Include idempotency keys and audit event emission

**D) Rollout Plan**

- Phase 0: introduce DID fields + dual-write
- Phase 1: switch reads to DID
- Phase 2: deprecate legacy identifiers

**E) Invariants Checklist**

- Explicitly tick each invariant from story.0079 (I-CANONICAL-DID through I-PRIVACY-DEFAULT)
- If any cannot be met with minimal refactor, call out explicitly with rationale

**F) Risks**

- VC format choice ambiguity
- Wallet signature replay protection (nonce + domain separation)
- Discord identifiers: use immutable numeric IDs, not usernames
- GitHub proof method hardening

## Allowed Changes

- `docs/spec/` — new spec document for DID identity
- `work/items/` — may spawn subtasks if design reveals decomposition

## Plan

- [ ] Read current auth/identity code paths
- [ ] Read current Discord/GitHub linking code
- [ ] Read billing/credit identity references
- [ ] Evaluate OSS libraries (did:pkh, VC, PEX)
- [ ] Draft design doc as spec
- [ ] Validate invariants checklist

## Validation

**Command:**

```bash
pnpm check:docs
```

**Expected:** Design doc passes metadata validation. Gap analysis covers all identity touchpoints. Every invariant from story.0079 is addressed.

## Review Checklist

- [ ] **Work Item:** `spike.0080` linked in PR body
- [ ] **Spec:** design doc produced with all required sections (A-F)
- [ ] **Tests:** n/a (research spike)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Parent story: story.0079

## Attribution

-
