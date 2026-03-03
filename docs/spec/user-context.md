---
id: user-context
type: spec
title: Agent User Context
status: draft
spec_state: draft
trust: draft
summary: PII-safe user identity and trust context injected into agent sessions — opaque IDs, bucketed trust tiers, communication preferences
read_when: Injecting user context into OpenClaw agents, deriving trust tiers, adding user preference fields
implements: proj.openclaw-capabilities
owner: derekg1729
created: 2026-02-13
verified: 2026-02-13
tags: [auth, identity, openclaw]
---

# Agent User Context

> Agents need to know _who_ they're talking to (opaque ID, trust level, communication prefs) without receiving PII. This spec defines the `UserContext` type, trust tier derivation, PII boundary rules, and the injection mechanism that delivers context to agents per-session.

### Key References

|              |                                                                                 |                                        |
| ------------ | ------------------------------------------------------------------------------- | -------------------------------------- |
| **Project**  | [proj.openclaw-capabilities](../../work/projects/proj.openclaw-capabilities.md) | Agent injection mechanism              |
| **Project**  | [proj.web3-gov-mvp](../../work/projects/proj.web3-gov-mvp.md)                   | Web3 identity foundation (wallet, DAO) |
| **Research** | [spike.0046 research](../research/openclaw-user-context-passing.md)             | Options analysis and recommendation    |
| **Spec**     | [OpenClaw Sandbox Integration](openclaw-sandbox-spec.md)                        | Gateway architecture, outboundHeaders  |
| **Spec**     | [Accounts Design](accounts-design.md)                                           | Billing identity model                 |
| **Spec**     | [RBAC](rbac.md)                                                                 | Authorization (orthogonal to identity) |

## Design

### Data Flow

```
SessionUser { id, walletAddress }
  │
  ▼  (completion facade — existing)
LlmCaller { billingAccountId, virtualKeyId, userId, ... }
  │
  ▼  (new: resolveUserContext)
UserContext { opaqueId, trustTier, memberSince, style?, medium }
  │
  ▼  (SandboxGraphProvider.createGatewayExecution)
Prepend <user-context> block to agent message
  │
  ▼  (OpenClaw gateway → Pi agent runtime)
Agent reads context as part of conversation input
```

### Injection Point

```
SandboxGraphProvider.createGatewayExecution()
  │
  ├── Build outboundHeaders (billing — existing, unchanged)
  │
  ├── Extract last user message (existing)
  │
  ├── NEW: resolveUserContext(caller, medium) → UserContext
  │
  ├── NEW: Prepend <user-context> block to message text
  │
  └── gatewayClient.runAgent({ message: contextBlock + userMessage, ... })
```

The context block is prepended to the user's message text. The agent receives it as part of the conversation input — no OpenClaw protocol changes required.

### Context Block Format

```xml
<user-context>
  user_id: ba_7f3a2c...
  trust_tier: established
  member_since: 2025-03
  communication_style: direct, technical
  medium: webapp
</user-context>
```

The block uses an XML-style tag so agents can parse it structurally. The content is key-value plain text, not JSON — optimized for LLM readability.

### Trust Tier Derivation

```
deriveTrustTier(walletAddress, createdAt, interactionCount)
  │
  ├── isFounder(walletAddress)?     → "founding_architect"
  ├── interactions > 100 AND days > 30 → "established"
  ├── interactions > 10 AND days > 7  → "active"
  └── else                             → "new_user"
```

`interactionCount` = `COUNT(*) FROM charge_receipts WHERE billing_account_id = ?`.
`isFounder` = wallet address in a hardcoded set (DAO multi-sig signers or config).

Trust tier is **computed at request time**, never stored. The derivation function is pure (no I/O) — the caller provides the inputs.

### Storage

No new tables. All inputs come from existing schema:

| UserContext field    | Source                            | Storage                   |
| -------------------- | --------------------------------- | ------------------------- |
| `opaqueId`           | `billingAccounts.id`              | Existing                  |
| `trustTier`          | Derived (see above)               | Computed, not stored      |
| `memberSince`        | `billingAccounts.createdAt`       | Existing                  |
| `medium`             | Request metadata (delivery layer) | Ephemeral, per-request    |
| `communicationStyle` | `users.communication_style`       | **New column on `users`** |

The `users` table gains one nullable column:

```sql
ALTER TABLE users ADD COLUMN communication_style text;
```

A `jsonb preferences` column is an alternative if more preference fields emerge, but a single `text` column is sufficient until then.

## Goal

Enable agents to adapt their behavior based on who they're talking to — communication style, autonomy level, explanation depth — without exposing personally identifiable information.

## Non-Goals

- External reputation system integration (future cred score replaces the heuristic)
- Agent-side user profile editing (agents read context, they don't write preferences)
- Authorization decisions based on trust tier (that's RBAC — see [rbac.md](rbac.md))
- OpenClaw upstream `sessionContext` protocol patch (deferred until messenger channels need it)
- Storing or materializing trust tier in the database

## Invariants

| Rule                       | Constraint                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| CONTEXT_NO_PII             | `UserContext` must never contain wallet addresses, email addresses, real names, phone numbers, or any field that can identify a natural person |
| CONTEXT_OPAQUE_ID          | `opaqueId` is the `billingAccountId` (UUID). Never the `users.id`, wallet address, or any cross-system identifier                              |
| CONTEXT_SERVER_GENERATED   | The `<user-context>` block is constructed server-side in `SandboxGraphProvider`. Users cannot inject, modify, or omit it                       |
| TRUST_TIER_IS_BUCKETED     | Trust tier is one of four labels (`founding_architect`, `established`, `active`, `new_user`). Never a raw score, count, or continuous value    |
| TRUST_TIER_IS_COMPUTED     | Trust tier is derived at request time from `(walletAddress, createdAt, interactionCount)`. Never stored or cached across requests              |
| MEMBER_SINCE_COARSENED     | `memberSince` is truncated to `YYYY-MM` (month granularity). Never includes day, time, or timezone                                             |
| CONTEXT_PER_SESSION        | Each `runAgent()` call includes a freshly-resolved context block. No stale context carried across sessions                                     |
| CONTEXT_DOES_NOT_AUTHORIZE | Trust tier is a behavioral hint for agents, not an authorization signal. Permission checks use RBAC exclusively (see DENY_BY_DEFAULT_AUTHZ)    |
| STYLE_IS_OPTIONAL          | `communicationStyle` is nullable. Agents must function correctly when it's absent                                                              |

### Schema

**Column addition:** `users`

| Column                | Type   | Constraints | Description                                           |
| --------------------- | ------ | ----------- | ----------------------------------------------------- |
| `communication_style` | `text` | NULLABLE    | Free-text user preference (e.g., "direct, technical") |

### UserContext Type

```typescript
interface UserContext {
  /** Opaque identifier — billingAccountId, NOT wallet or user ID */
  readonly opaqueId: string;
  /** Bucketed trust level */
  readonly trustTier:
    | "founding_architect"
    | "established"
    | "active"
    | "new_user";
  /** Account creation month (YYYY-MM) */
  readonly memberSince: string;
  /** User-set communication style preference (nullable) */
  readonly communicationStyle: string | null;
  /** Current interaction medium */
  readonly medium: "webapp" | "discord" | "whatsapp" | "telegram" | "api";
}
```

### TrustTier Derivation

```typescript
type TrustTier = "founding_architect" | "established" | "active" | "new_user";

interface TrustTierInputs {
  readonly walletAddress: string;
  readonly accountCreatedAt: Date;
  readonly interactionCount: number;
}

/** Pure function — no I/O, no side effects */
function deriveTrustTier(inputs: TrustTierInputs): TrustTier;
```

| Tier                 | Criteria                                                    |
| -------------------- | ----------------------------------------------------------- |
| `founding_architect` | `walletAddress` in founder set (hardcoded or DAO multi-sig) |
| `established`        | `interactionCount > 100` AND tenure `> 30 days`             |
| `active`             | `interactionCount > 10` AND tenure `> 7 days`               |
| `new_user`           | Default                                                     |

**Founder set**: Initially a hardcoded array of wallet addresses. Future: read from DAO multi-sig contract or on-chain governance role.

### File Pointers

| File                                                    | Purpose                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/core/identity/user-context.ts`                     | `UserContext` type, `deriveTrustTier()`, `formatContextBlock()`  |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts` | Injection point: prepend context block to gateway messages       |
| `src/app/_facades/ai/completion.server.ts`              | Resolve user context inputs (billing account, interaction count) |
| `packages/db-schema/src/refs.ts`                        | `users` table (add `communication_style` column)                 |
| `services/openclaw-gateway/gateway-workspace/SOUL.md`   | Agent instructions for interpreting `<user-context>`             |

## Acceptance Checks

**Automated:**

- `user-context-no-pii.test.ts` — verify `formatContextBlock()` output never contains wallet address patterns (`0x[0-9a-f]{40}`) or email patterns
- `trust-tier-derivation.test.ts` — unit tests for `deriveTrustTier()` with boundary values (exactly 10 interactions at 7 days = `active`, 9 interactions = `new_user`)
- `member-since-coarsened.test.ts` — verify `memberSince` output matches `YYYY-MM` regex, never includes day
- `context-block-format.test.ts` — verify `formatContextBlock()` produces valid `<user-context>` block with all required fields

**Manual:**

1. Send a message via webapp → verify agent response references trust tier appropriately (new user gets more explanation, established user gets direct response)
2. Verify `<user-context>` block appears in gateway agent logs but contains no PII

## Open Questions

- [ ] **Founder set source**: Hardcoded array vs DAO multi-sig contract read? Hardcoded is simpler but requires code changes when signers change. On-chain read is durable but adds an RPC call to the hot path.
- [ ] **Interaction count query cost**: `COUNT(*) FROM charge_receipts` per request could be expensive for high-volume users. Consider a materialized count column or periodic aggregation if query latency becomes an issue.
- [ ] **Sub-agent inheritance**: When OpenClaw spawns sub-agents (task.0045), should sub-agents inherit the parent's `<user-context>` block? If yes, via OpenClaw session propagation or Cogni-side re-injection?

## Related

- [Web3 Governance MVP](../../work/projects/proj.web3-gov-mvp.md) — Web3 identity chain: wallet auth → DAO membership → founder trust tier
- [OpenClaw Sandbox Integration](openclaw-sandbox-spec.md) — Gateway architecture, session keys, outboundHeaders
- [Accounts Design](accounts-design.md) — `ONE_USER_ONE_BILLING_ACCOUNT`, billing identity model
- [RBAC](rbac.md) — Authorization (orthogonal: RBAC decides _can they_, user context decides _how to talk to them_)
- [Security Auth](security-auth.md) — SIWE authentication, session structure
- [Messenger Integration Research](../research/messenger-integration-openclaw-channels.md) — Future messenger channels inform `medium` field
- [spike.0046 Research](../research/openclaw-user-context-passing.md) — Options analysis that led to this spec
