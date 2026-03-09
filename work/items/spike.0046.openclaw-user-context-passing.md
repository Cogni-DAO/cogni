---
id: spike.0046
type: spike
title: "Research: PII-safe user context passing to OpenClaw agents"
status: done
priority: 1
estimate: 1
summary: How to give OpenClaw agents 1st-class user awareness (ID, trust tier, communication prefs) without leaking PII
outcome: Research document with recommended approach and proposed task breakdown
spec_refs: openclaw-sandbox-spec
project: proj.openclaw-capabilities
assignees: derekg1729
credit:
pr:
reviewer:
created: 2026-02-13
updated: 2026-02-13
labels: [openclaw, auth, identity]
external_refs:
  - docs/research/openclaw-user-context-passing.md
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Research: PII-Safe User Context Passing to OpenClaw Agents

## Question

OpenClaw must have a 1st-class understanding of who is talking to it at any given time, yet it must also be PII-protected. How do we pass user context (userID, trust/cred score, communication preferences) to the agent on each session?

## Research Findings

See [docs/research/openclaw-user-context-passing.md](../../docs/research/openclaw-user-context-passing.md).

### Summary

Four options evaluated:

| Option | Approach                                    | Verdict                                               |
| ------ | ------------------------------------------- | ----------------------------------------------------- |
| A      | USER.md injection to gateway workspace      | Not viable (shared workspace, no per-session scoping) |
| B      | Message prepend with `<user-context>` block | **Recommended for Phase 1** (zero deps, works today)  |
| C      | Upstream OpenClaw `sessionContext` field    | **Recommended for Phase 2** (clean, needs fork patch) |
| D      | LLM proxy body injection                    | Rejected (anti-pattern)                               |

### Recommendation

1. **Phase 1**: Prepend a server-generated `<user-context>` XML block to agent messages. Contains opaque userId (billing account ID), bucketed trust tier, coarsened member-since date, communication style hints, and current medium. No PII.

2. **Phase 2**: Patch OpenClaw fork to accept `sessionContext` in `sessions.patch` — needed when messenger channels go live and message prepend becomes awkward.

### Trust Tier Derivation

| Tier                 | Criteria                                        |
| -------------------- | ----------------------------------------------- |
| `founding_architect` | Wallet in DAO multi-sig / hardcoded founder set |
| `established`        | >100 interactions AND >30 days tenure           |
| `active`             | >10 interactions AND >7 days tenure             |
| `new_user`           | Default                                         |

Derived from `billing_accounts.created_at` + `charge_receipts` count. Proper cred score (SourceCred or custom) replaces heuristic later.

## Validation

- [x] Research document written at `docs/research/openclaw-user-context-passing.md`
- [x] Four options evaluated with clear pros/cons/fit analysis
- [x] Recommendation includes phased approach (message prepend now, upstream patch later)
- [x] PII protection rules defined (opaque IDs, bucketed tiers, no PII fields)
- [x] Trust tier derivation heuristic specified with criteria table
- [x] Open questions explicitly flagged (cred score source, context staleness, style storage, medium propagation, sub-agent inheritance)

## Proposed Follow-Up Tasks

1. Define `UserContext` type + `deriveTrustTier()` pure logic
2. Inject `<user-context>` block in `SandboxGraphProvider.createGatewayExecution()`
3. User communication preferences storage
4. (Future) OpenClaw `sessionContext` upstream patch
