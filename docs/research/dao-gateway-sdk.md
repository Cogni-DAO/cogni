---
id: dao-gateway-sdk-research
type: research
title: "Research: DAO Gateway SDK — Simplest Path to Empower AI Projects as DAOs"
status: active
trust: draft
summary: How CogniDAO could become a minimal passthrough layer (SDK/gateway) that lets any AI project add DAO governance + crypto billing via a config file.
read_when: Designing the DAO gateway product, evaluating SDK vs gateway approaches, or extending the .cogni/repo-spec pattern.
owner: derekg1729
created: 2026-02-26
verified: 2026-02-26
tags: [dao, sdk, billing, product, research]
---

# Research: DAO Gateway SDK — Simplest Path to Empower AI Projects as DAOs

> spike: spike.0113 | date: 2026-02-26

## Question

What is the simplest, cleanest way for CogniDAO to empower AI projects to become DAOs? Could we be a passthrough layer — an SDK or gateway — where a project adds a `.cogni/repo-spec` defining their node/scope/DAO/payment address, routes AI calls through our interface, and voilà: they can receive crypto payments and DAO funding?

## Context

### What exists today

CogniDAO already has production-grade infrastructure for the core loop:

1. **DAO Formation** — Web wizard deploys an Aragon OSx DAO (TokenVoting + GovernanceERC20 + CogniSignal) in 2 wallet transactions. Server derives all addresses from receipts. Output: `.cogni/repo-spec.yaml`.

2. **`.cogni/repo-spec.yaml`** — Declarative config defining DAO contract addresses, payment rails (receiving address, allowed chains/tokens), LLM proxy config, governance schedules, and AI review gates.

3. **Crypto Billing** — Full USDC payment flow: intent → wallet tx → on-chain EVM verification → credit ledger. Protocol constant: 1 credit = $0.0000001 USD (10M credits/USD). Markup factor configurable.

4. **LLM Metering** — LiteLLM proxy sits between app and providers (OpenRouter). Every call metered via `x-litellm-response-cost` header → `charge_receipts` table → credit debit. Idempotent via `(source_system, source_reference)`.

5. **Transparent Payouts** — Work receipts + epoch-based distribution engine + Merkle integrity log. Contributors earn credits for approved work, distributed proportionally per epoch.

6. **Hexagonal Architecture** — Every component is behind a port interface. Swappable adapters. The billing core is framework-agnostic.

**The gap**: All of this is tightly coupled to `cogni-template` (a Next.js monolith). There's no way for an external project to use these capabilities without forking the entire repo.

---

## Findings

### Option A: Config-File Gateway (Recommended)

**What**: An external project adds a `.cogni/repo-spec.yaml` to their repo and points their AI calls at a Cogni Gateway URL. The gateway handles billing, DAO treasury routing, and credit accounting. The project never touches smart contracts or billing code.

**How it works**:

```
External AI Project                    Cogni Gateway
    │                                      │
    ├─ Add .cogni/repo-spec.yaml           │
    │   (dao_contract, payment_address,    │
    │    chain_id, api_key)                │
    │                                      │
    ├─ AI call ─────────────────────────►  │
    │   POST gateway.cogni.org/v1/chat     │
    │   Authorization: Bearer <api-key>    │
    │                                      │
    │                              ┌───────┤
    │                              │ 1. Validate api-key → billing account
    │                              │ 2. Preflight: check credit balance
    │                              │ 3. Forward to LiteLLM → OpenRouter
    │                              │ 4. Extract cost from response
    │                              │ 5. Debit credits, write charge_receipt
    │                              │ 6. Return response to caller
    │                              └───────┤
    │                                      │
    ◄──────────────────────────────────────┤
    │   Response (same as OpenAI format)   │
    │                                      │
    │                                      │
    │  User pays USDC ──────────────────►  │
    │   (to DAO wallet from repo-spec)     │
    │   → On-chain verify → credit account │
```

**Integration for an external project**:

1. Run DAO Formation wizard → get `.cogni/repo-spec.yaml`
2. Commit it to repo
3. Get a gateway API key (linked to billing account)
4. Replace OpenAI base URL with `gateway.cogni.org/v1`
5. Done. AI calls are metered, USDC payments go to their DAO wallet, credits work.

**Pros**:

- Zero code changes for the project (just a base URL swap)
- OpenAI-compatible API (drop-in replacement)
- `.cogni/repo-spec.yaml` is the single source of truth
- Reuses 100% of existing billing, payment, and metering infrastructure
- The gateway is just LiteLLM + our billing middleware — already built

**Cons**:

- Centralized dependency on Cogni Gateway (conflicts with FORK_FREEDOM)
- Projects must trust Cogni to handle billing correctly
- Network latency through the gateway
- Revenue model requires Cogni to run infrastructure

**OSS tools**: LiteLLM (MIT), existing Cogni billing stack

**Fit with our system**: Excellent. The gateway IS our existing LiteLLM + billing stack, exposed as a multi-tenant service. The `repo-spec.yaml` already defines everything needed.

---

### Option B: npm SDK Package

**What**: Publish `@cogni/dao-gateway` as an npm package. Projects import it and wrap their AI calls. The SDK handles billing, credit tracking, and DAO treasury interactions client-side (or via a lightweight sidecar).

```typescript
// In the external project:
import { CogniGateway } from "@cogni/dao-gateway";

const gateway = CogniGateway.fromRepoSpec(".cogni/repo-spec.yaml");

// Drop-in replacement for OpenAI client
const response = await gateway.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
// Billing handled automatically
```

**Pros**:

- No centralized gateway dependency (sovereign)
- Project controls their own infrastructure
- Can work offline / air-gapped
- SDK can be progressively adopted

**Cons**:

- Requires the project to run their own LiteLLM + Postgres + billing stack
- Significantly more setup friction than a gateway URL swap
- Maintaining SDK compatibility across Node/Bun/Deno/Python
- Each project is an island — no shared infrastructure benefits

**OSS tools**: viem (wallet), drizzle (DB), LiteLLM (proxy)

**Fit with our system**: Moderate. Would require extracting `@cogni/billing-core`, `@cogni/aragon-osx`, and `@cogni/payment-verifier` as standalone packages. Feasible but high effort.

---

### Option C: x402 Protocol Integration (Complementary)

**What**: Use Coinbase's x402 protocol ("HTTP 402 Payment Required") to add per-request crypto payments to any API. A middleware intercepts requests, demands USDC payment, and settles on-chain before forwarding.

```typescript
// Server-side (1 line of middleware)
import { paywall } from "x402-express";

app.use(
  "/api/ai/*",
  paywall({
    address: "0x...", // DAO wallet from repo-spec
    price: "$0.01", // per request
    network: "base",
  })
);
```

**Pros**:

- Absurdly simple integration (1 middleware line)
- Open standard, not Cogni-specific
- Works with any HTTP API, not just AI
- Stripe has adopted x402 for USDC agent payments
- 1,000 free transactions/month via Coinbase facilitator
- AI agents can pay each other natively (agent-to-agent commerce)

**Cons**:

- Per-request pricing only (no credit balance / prepaid model)
- Requires the caller to have a crypto wallet (not all users do)
- No usage-based billing (can't charge based on tokens consumed)
- Coinbase facilitator is centralized (though protocol is open)
- Doesn't replace LLM metering — only handles the payment layer

**OSS tools**: `x402` (MIT), `x402-express`, supported on Base/Solana/Stellar

**Fit with our system**: Complementary. x402 could be the payment rail INTO the system (replacing USDC widget), while our billing stack handles the metering/credits internally. Especially powerful for AI-agent-to-AI-agent payments.

---

### Option D: Nevermined AI Payment Platform (Complementary)

**What**: Nevermined provides AI-native billing infrastructure — usage-based billing, agent-to-agent payments, credit plans. Integrates with Google's A2A protocol and MCP.

**Pros**:

- Purpose-built for AI agent commerce
- Credit-based AND pay-per-request models
- MCP integration (our agents could use it as a tool)
- A2A protocol support for multi-agent coordination

**Cons**:

- Vendor dependency (not fully OSS)
- Overlaps with our existing billing stack
- Early-stage platform

**Fit with our system**: Could replace our billing stack entirely for external projects, but introduces vendor lock-in. Better as a reference for design patterns.

---

### Option E: Snapshot + Gateway Hybrid

**What**: Use Snapshot for off-chain governance (gasless voting, JSON config) combined with Option A's gateway for billing. Projects get governance via Snapshot space + billing via Cogni Gateway.

**Pros**:

- Snapshot is the simplest governance tool (JSON config, gasless, free)
- No smart contract deployment for basic voting
- Combined with gateway, covers both governance AND billing
- Lower barrier than full Aragon DAO deployment

**Cons**:

- Off-chain voting (not as trustworthy as on-chain)
- Splits governance across two systems (Snapshot + Aragon)
- Less composable with smart contract actions

**Fit with our system**: Good as a "lite" tier. Projects that don't need full on-chain governance can start with Snapshot + Gateway, then upgrade to Aragon when ready.

---

## Recommendation

**Phase 1 (MVP): Option A — Config-File Gateway**

The simplest possible path:

1. **Multi-tenant the existing stack**. The Cogni LiteLLM proxy + billing middleware already does everything needed. Add tenant isolation keyed by `repo-spec.yaml` → `billing_account`.

2. **Gateway API**: A single OpenAI-compatible endpoint (`gateway.cogni.org/v1/chat/completions`) that:
   - Authenticates via API key → resolves to a billing account + repo-spec
   - Preflight checks credits
   - Forwards to LiteLLM
   - Debits credits on response
   - Returns standard OpenAI response format

3. **Onboarding flow**:
   - Run DAO Formation wizard (existing) → `.cogni/repo-spec.yaml`
   - Get gateway API key (new: simple registration endpoint)
   - Set `OPENAI_BASE_URL=https://gateway.cogni.org/v1` in your project
   - Done.

4. **Payment flow**: USDC → DAO wallet (from repo-spec `receiving_address`) → on-chain verify → credit account. Existing flow, no changes.

**Phase 2: x402 Inbound Payments**

Add x402 as an alternative payment rail. AI agents can pay per-request without pre-purchasing credits:

- Gateway responds 402 if no credits AND no x402 payment header
- x402 payment settles on-chain to the project's DAO wallet
- Credits are minted for the payment amount
- Enables agent-to-agent commerce out of the box

**Phase 3: SDK Extraction**

For projects that want sovereignty (self-hosted):

- Extract `@cogni/billing-core` (credit math, charge receipts, ledger)
- Extract `@cogni/payment-verifier` (on-chain USDC verification)
- Extract `@cogni/gateway-middleware` (LiteLLM billing wrapper)
- Projects can run the full stack themselves

**Why this order**:

- Gateway is ~2 weeks of work (multi-tenant the existing stack)
- x402 is ~1 week of middleware integration
- SDK extraction is ~4-6 weeks but not needed until demand proves the model
- Each phase validates the next before investing further

**Trade-offs accepted**:

- Phase 1 is centralized (violates FORK_FREEDOM for external projects). Accepted because sovereignty comes in Phase 3, and Phase 1 validates whether anyone wants this at all.
- x402 adds Coinbase dependency. Accepted because the protocol is open and facilitators are swappable.

---

## Open Questions

1. **Revenue model**: Does Cogni charge a markup on gateway traffic? Or is the value in growing the DAO ecosystem (network effects)?
2. **Multi-tenancy isolation**: How do we prevent one project's traffic from affecting another? Rate limiting per API key? Separate LiteLLM instances?
3. **Self-service onboarding**: Can DAO formation + API key generation be fully automated (no human in the loop)?
4. **Credit portability**: If a project moves from gateway to self-hosted SDK, can they take their credit balance?
5. **Governance integration**: Should the gateway enforce governance decisions (e.g., DAO votes to change markup factor)?
6. **Provider diversity**: Should the gateway support multiple LLM providers per project, or mandate OpenRouter?

---

## Proposed Layout

### Project

`proj.dao-gateway` — A minimal passthrough layer that lets any AI project add DAO governance + crypto billing via `.cogni/repo-spec.yaml`.

**Phases**:

- **Crawl**: Multi-tenant gateway — API key registration, billing account per project, OpenAI-compatible proxy. One LiteLLM instance shared across tenants.
- **Walk**: x402 payment integration, self-service DAO formation, usage dashboard per project. Snapshot governance for "lite" tier.
- **Run**: SDK extraction (`@cogni/billing-core`, `@cogni/gateway-middleware`), self-hosted mode, agent-to-agent commerce via x402, federated governance across projects.

### Specs (to write)

1. **`docs/spec/gateway-api.md`** — Multi-tenant gateway API contract, authentication, rate limiting, OpenAI compatibility invariants
2. **`docs/spec/tenant-billing.md`** — Per-project billing isolation, credit pools, markup policy, settlement
3. **Update `docs/spec/node-formation.md`** — Add "gateway onboarding" path alongside full fork

### Tasks (rough sequence)

| #   | Task                                                                                  | Est | Dependencies |
| --- | ------------------------------------------------------------------------------------- | --- | ------------ |
| 1   | Multi-tenant API key system — registration endpoint, key → billing account resolution | 2   | —            |
| 2   | Gateway proxy route — OpenAI-compatible passthrough with billing middleware           | 3   | Task 1       |
| 3   | Per-tenant repo-spec storage — link API keys to `.cogni/repo-spec.yaml` config        | 1   | Task 1       |
| 4   | Gateway payment flow — USDC verification scoped to tenant's DAO wallet                | 2   | Task 1, 3    |
| 5   | x402 middleware — 402 response + payment settlement for zero-credit callers           | 2   | Task 2       |
| 6   | Self-service DAO formation — automated wizard → API key → ready-to-use gateway        | 3   | Task 1, 3    |
| 7   | Usage dashboard — per-project spend, credit balance, call volume                      | 2   | Task 2       |

Total: ~15 points across 7 tasks.

### Sources

- [x402 Protocol](https://www.x402.org/) | [GitHub](https://github.com/coinbase/x402) | [npm](https://www.npmjs.com/package/x402)
- [Nevermined AI Payments](https://nevermined.ai/) | [npm](https://www.npmjs.com/package/@nevermined-io/payments)
- [Snapshot Governance](https://docs.snapshot.box/)
- [Aragon OSx SDK](https://devs.aragon.org/docs/sdk/)
- [LiteLLM Proxy](https://docs.litellm.ai/docs/proxy/quick_start)
- [Stripe x402 Integration](https://www.theblock.co/post/389352/stripe-adds-x402-integration-usdc-agent-payments)
- [Coinbase AgentKit](https://github.com/coinbase/agentkit)
