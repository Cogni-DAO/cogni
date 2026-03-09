---
id: openclaw-user-context-passing
type: research
title: "OpenClaw User Context: PII-Safe Identity Passing to Gateway Agents"
status: active
trust: draft
summary: How to give OpenClaw agents a 1st-class understanding of who they're talking to — userID, cred score, communication preferences — without leaking PII
read_when: Designing user context injection for OpenClaw sessions, planning cred-score integration, or building per-user agent personalization
owner: derekg1729
created: 2026-02-13
verified: 2026-02-13
tags: [openclaw, auth, identity, research]
---

# Research: OpenClaw User Context — PII-Safe Identity Passing to Gateway Agents

> spike: spike.0046 | date: 2026-02-13

## Question

How can we give OpenClaw agents a 1st-class understanding of _who_ they're talking to — userId, trust/cred score, communication preferences — at each session, while keeping user data PII-protected? What mechanisms does the current architecture already provide, and what would we need to build?

## Context

### What Exists Today

**Cogni auth story**: SIWE (Sign-In with Ethereum) via Auth.js Credentials provider. Users authenticate with their wallet, get a JWT session cookie. The `SessionUser` type is minimal: `{ id: string (UUID), walletAddress: string }`. A 1:1 `billing_accounts` row is auto-created per user.

**Identity flow through graph execution**: The completion facade builds an `LlmCaller` from the session:

```
SessionUser { id, walletAddress }
  → AccountService.getOrCreate(userId, walletAddress)
  → LlmCaller {
      billingAccountId,   // billing identity (passed to LiteLLM as end_user)
      virtualKeyId,       // per-user LiteLLM key handle
      requestId,          // correlation
      traceId,            // OTel trace
      userId,             // stable internal ID (Langfuse only)
      sessionId,          // Langfuse grouping
      maskContent,        // PII opt-out for Langfuse
    }
```

**What reaches OpenClaw today**: Only `billingAccountId` (via `x-litellm-end-user-id` header) and `runId` + `graphId` (via `x-litellm-spend-logs-metadata`). These are billing/attribution headers injected into LLM proxy requests. **The agent itself has zero knowledge of who it's talking to.**

**OpenClaw's mechanisms for per-session context**:

1. **`outboundHeaders`** — arbitrary `Record<string, string>` per session (max 8KB). Merged into every outbound LLM API call. Currently used for billing headers. Agent cannot read these directly (they're HTTP headers on the LLM call, not visible to the agent runtime).

2. **Workspace files** — `SOUL.md`, `USER.md`, `AGENTS.md`, `IDENTITY.md`, `MEMORY.md` in the workspace root. OpenClaw auto-injects these into the agent's system prompt context at session start. **`USER.md` is the canonical place for user context**.

3. **`sessions.patch`** — WS method to update session config before/during agent interaction. Can update `outboundHeaders`, `modelOverride`, `providerOverride`, label, and other metadata.

4. **`origin` metadata** — `SessionEntry.origin` has fields like `provider`, `surface`, `from`, `to`, `accountId`. Not injected into agent prompt — used for routing/audit.

### The Gap

The agent (OpenClaw runtime) needs to know:

- **Who** is talking to it (opaque identifier, not PII)
- **How trusted** that user is (cred score / tenure signal)
- **How to communicate** (style preferences, medium context)

Currently none of this reaches the agent. The workspace is shared/static for gateway mode, and outboundHeaders are invisible to the agent runtime (they're HTTP headers on the LLM proxy call).

## Findings

### Option A: USER.md Injection via `sessions.patch` + Workspace Write

**What**: Before each session, Cogni writes a per-user `USER.md` (or a section of it) into the gateway workspace, then references it in the agent's system prompt. For gateway mode, this means either:

- Writing the file to the shared gateway workspace (risk: concurrent users overwrite each other)
- Using the `sessions.patch` method to inject a system prompt addendum

**Problem**: Gateway mode uses a **shared workspace** (`/workspace/`). `USER.md` at workspace root is global — not per-session. Writing per-user files would require path namespacing (e.g., `/workspace/.cogni/users/{userId}/USER.md`), and OpenClaw doesn't dynamically load arbitrary paths into system prompt.

**Verdict**: Not viable for gateway mode without OpenClaw changes. Works for ephemeral mode (each container has its own workspace).

### Option B: System Prompt Prepend via Agent Message Injection

**What**: Cogni prepends a structured context block to the first user message (or as a system message) sent to the OpenClaw agent. The context is plain text that the LLM reads as part of the conversation.

```markdown
<user-context>
  user_id: ba_7f3a2c...  (opaque billing account ID)
  trust_tier: founding_architect | established | new_user
  member_since: 2025-03-15
  total_interactions: 1,247
  communication_style: direct, technical
  preferred_medium: webapp  (future: whatsapp, discord, telegram)
</user-context>
```

**How it works today**: `SandboxGraphProvider.createGatewayExecution()` already builds the message that goes to `gatewayClient.runAgent()`. We can prepend context to the message text. The agent sees it as part of the conversation input.

**Pros**:

- Zero OpenClaw changes required
- Works with both gateway and ephemeral modes
- Agent can reference context naturally in conversation
- PII-safe: we control exactly what's included (opaque IDs, tier labels, not names/emails)
- Per-session (each `runAgent` call gets fresh context)

**Cons**:

- Consumes prompt tokens on every turn (small — ~100 tokens for the context block)
- Agent must be instructed (via SOUL.md/AGENTS.md) to use this context
- No structured API — it's free-text in the message, not typed metadata
- Context could be manipulated if user controls message content (mitigated: context block is prepended by server, not user-editable)

**Fit with our system**: This is the simplest viable option. It works within existing architecture. The `SandboxGraphProvider` already controls message construction.

### Option C: Custom OpenClaw `sessionContext` Field (Upstream Patch)

**What**: Patch OpenClaw to add a `sessionContext` field to `SessionEntry` and the `agent`/`sessions.patch` WS methods. This context would be injected into the agent's system prompt alongside workspace files but scoped per-session.

**Pros**:

- Clean separation: context is metadata, not message content
- Per-session scoping built into the protocol
- Agent receives it as structured system prompt injection (not mixed with user messages)
- No token overhead in user message turns after the first

**Cons**:

- Requires OpenClaw upstream patch (we control the fork, but it's maintenance burden)
- Need to design the injection point in OpenClaw's Pi agent runtime (where does sessionContext appear in the system prompt?)
- Adds to the `openclaw-outbound-headers` fork divergence

**Fit with our system**: This is the clean long-term solution. We already maintain a forked OpenClaw image (`openclaw-outbound-headers`). Adding `sessionContext` is similar in scope to the `outboundHeaders` patch we already shipped.

### Option D: LLM-Level System Message via Proxy Injection

**What**: The nginx LLM proxy (between OpenClaw and LiteLLM) intercepts the `/v1/chat/completions` request body and injects a system message with user context. OpenClaw never sees the context — the LLM does.

**Pros**:

- Zero OpenClaw changes
- Agent runtime is unaware (context is between proxy and LLM)
- Could work for any agent runtime, not just OpenClaw

**Cons**:

- Proxy must parse and modify JSON request bodies (complex, error-prone)
- Breaks streaming request forwarding (must buffer full body)
- Violates separation of concerns (proxy should be transport, not content-aware)
- Agent can't reference "I see your user context" because it doesn't know it's there at runtime level
- Hard to debug

**Verdict**: Anti-pattern. Rejected.

## Recommendation

**Start with Option B (message prepend), plan for Option C (upstream sessionContext).**

### Phase 1 (immediate, zero dependencies): Message Prepend

Modify `SandboxGraphProvider.createGatewayExecution()` to prepend a `<user-context>` block to the agent message. The block is server-generated from the `LlmCaller` + a new `UserContext` type.

```typescript
interface UserContext {
  /** Opaque identifier (billing account ID, NOT wallet address) */
  userId: string;
  /** Trust tier derived from cred score + tenure */
  trustTier: "founding_architect" | "established" | "active" | "new_user";
  /** ISO date of first interaction */
  memberSince: string;
  /** Communication style hints */
  style?: string;
  /** Current medium (webapp, discord, whatsapp, api) */
  medium: string;
}
```

**PII protection rules**:

- `userId` is the `billingAccountId` (opaque UUID), never wallet address or email
- `trustTier` is a bucketed label, not a raw score (prevents fingerprinting)
- No real names, emails, phone numbers, or wallet addresses
- `memberSince` is coarsened to month (not exact timestamp)
- The context block is server-generated; users cannot inject or modify it

**Trust tier derivation** (proposed, needs cred score work):

| Tier                 | Criteria                                         |
| -------------------- | ------------------------------------------------ |
| `founding_architect` | Wallet in DAO multi-sig or hardcoded founder set |
| `established`        | >100 interactions AND >30 days tenure            |
| `active`             | >10 interactions AND >7 days tenure              |
| `new_user`           | Everyone else                                    |

Initially, this can be derived from `billing_accounts.created_at` + `charge_receipts` count. A proper cred score system (SourceCred or custom) replaces the heuristic later.

### Phase 2 (future, after messenger integration): Upstream `sessionContext`

When OpenClaw messenger channels are live (users talking via WhatsApp/Discord/Telegram), message prepend becomes awkward — the user's first message is their actual text, and we'd be silently prepending context. For channels, we need the context injected at session creation, not per-message.

Patch OpenClaw to accept `sessionContext: Record<string, string>` in `sessions.patch` and `agent` WS methods. The Pi agent runtime merges this into the system prompt alongside workspace files.

### What the Agent Needs to Know

Update `SOUL.md` (gateway workspace) to instruct the agent:

```markdown
## User Context

Every conversation includes a `<user-context>` block with the caller's identity
and trust level. Use this to:

- Address the user appropriately (founding architects get direct, technical
  communication; new users get more guidance and explanation)
- Adjust autonomy level (high-trust users can approve riskier operations;
  new users should get more confirmation prompts)
- Never expose or repeat the raw user_id to the user
- Never ask for personal information — you know what you need from the context
```

## Open Questions

1. **Cred score source**: SourceCred integration exists in `platform/infra/services/sourcecred/` but isn't wired to user identity. Is SourceCred the right cred system, or do we want something simpler (interaction count + tenure + DAO membership)?

2. **Context staleness in multi-turn conversations**: In gateway mode, sessions persist across multiple messages. Should context be refreshed on every message, or only at session creation? Refreshing on every turn means the trust tier could change mid-conversation (unlikely but possible).

3. **Communication style persistence**: Where does the user's preferred communication style live? Options: (a) user profile table column, (b) OpenClaw MEMORY.md per-user, (c) Cogni user preferences table. Need a storage decision before implementing style passthrough.

4. **Messenger medium context**: When users talk via WhatsApp vs Discord vs webapp, the `medium` field should reflect this. For webapp, it's trivial. For messenger channels, OpenClaw already knows the inbound channel — but how does that propagate back to the context block?

5. **Agent-to-agent context**: When OpenClaw spawns sub-agents (task.0045), should the sub-agent inherit the parent's user context? Probably yes — the sub-agent is acting on behalf of the same user.

## Proposed Layout

### Project

This doesn't warrant a standalone project. It fits naturally as tasks within `proj.openclaw-capabilities` (gateway agent improvements).

### Specs

| Spec                       | Action    | What Changes                                                                                     |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `openclaw-sandbox-spec.md` | Update    | Add "User Context Injection" section documenting the `<user-context>` block format and PII rules |
| `accounts-design.md`       | Update    | Add `UserContext` type definition and trust tier derivation rules                                |
| `rbac.md`                  | No change | RBAC is about authorization (can this user do X?), not identity context (who is this user?)      |

### Tasks (rough, PR-sized)

1. **`task.XXXX` — Define UserContext type + trust tier derivation** — Add `UserContext` interface to `src/core/` or `src/shared/auth/`, implement `deriveTrustTier()` from billing account data (created_at + charge_receipts count). Pure logic, no I/O.

2. **`task.XXXX` — Inject user context into gateway agent messages** — Modify `SandboxGraphProvider.createGatewayExecution()` to prepend `<user-context>` block. Add `resolveUserContext()` to completion facade. Update gateway SOUL.md with context usage instructions.

3. **`task.XXXX` — User communication preferences storage** — Add `user_preferences` table (or columns on `users`) for `communication_style` and future preference fields. Wire into `resolveUserContext()`.

4. **`task.XXXX` — (Future) OpenClaw sessionContext upstream patch** — Add `sessionContext` field to OpenClaw `sessions.patch` and `agent` methods. Inject into Pi agent system prompt. Build + publish updated `openclaw-outbound-headers` image.

### Dependencies

- Trust tier derivation depends on `billing_accounts.created_at` existing (it does) and `charge_receipts` being queryable (it is)
- Communication preferences depend on a storage decision (Open Question 3)
- Upstream `sessionContext` patch depends on messenger channels work making it necessary

## Related

- [OpenClaw Sandbox Spec](../spec/openclaw-sandbox-spec.md) — Current gateway integration, `outboundHeaders` mechanism
- [OpenClaw Gateway Header Injection](openclaw-gateway-header-injection.md) — How we patched `outboundHeaders` into OpenClaw
- [Messenger Integration Research](messenger-integration-openclaw-channels.md) — WhatsApp/Telegram channels via OpenClaw
- [RBAC Spec](../spec/rbac.md) — Actor/subject model, delegation
- [Accounts Design](../spec/accounts-design.md) — Billing identity model
- [Tenant Connections](../spec/tenant-connections.md) — Credential brokering (related but distinct)
- OpenClaw session types: `/Users/derek/dev/openclaw/src/config/sessions/types.ts`
- OpenClaw extra params (header injection): `/Users/derek/dev/openclaw/src/agents/pi-embedded-runner/extra-params.ts`
