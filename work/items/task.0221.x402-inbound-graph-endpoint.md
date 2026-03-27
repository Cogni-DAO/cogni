---
id: task.0221
type: task
title: "x402 inbound payment gate — prototype public graph execution"
status: done
priority: 1
rank: 10
estimate: 2
summary: "Working prototype: x402 payment gate on a public endpoint that runs Cogni graphs. Uses synthetic SessionUser shim for identity (proper actor_id identity is task.0222)."
outcome: "An agent with a USDC wallet can POST to /api/v1/public/x402/chat/completions, pay via x402, and get an AI graph response. Identity uses a temporary shim — proper agent identity design follows in task.0222."
spec_refs: [x402-e2e-spec]
assignees: []
credit:
project: proj.x402-e2e-migration
branch: worktree-spike-0220-aimo-x402
pr: https://github.com/Cogni-DAO/node-template/pull/646
reviewer:
created: 2026-03-27
updated: 2026-03-27
revision: 3
labels: [x402, web3, billing, api]
external_refs: ["docs/research/x402-provider-passthrough.md"]
blocked_by: []
deploy_verified: false
---

## Design

### Outcome

An external AI agent with a USDC wallet can call the Cogni node's public endpoint, pay via x402, and receive an AI graph response — using the existing graph execution pipeline, LiteLLM cost oracle, and charge_receipts audit trail. No session, no API key, no signup.

### Critical Design Decision: Inbound-only x402

The spike (spike.0220) proved full x402 E2E works (inbound + outbound). But the **simplest correct P0** keeps LiteLLM + API key on the outbound leg:

```
Agent --x402 USDC--> [Cogni Node] --API key--> [LiteLLM] --API key--> [Hyperbolic]
      <--completion--             <--cost header--         <--inference--
```

**Why not x402 outbound in P0:**
- LiteLLM is the cost oracle (`x-litellm-response-cost` header) — all billing math flows through it
- Removing LiteLLM means building a new cost oracle from x402 settlement amounts (bespoke)
- The existing `commitUsageFact()` → `charge_receipts` pipeline works unchanged
- API key auth to Hyperbolic is reliable; their x402 Vercel wrapper is an additional dependency
- x402 outbound requires a signing wallet (`NODE_WALLET_PRIVATE_KEY`) — spec says no private keys in P0

**What changes:** Auth layer (x402 replaces session), billing identity (wallet replaces billingAccountId), preflight check (x402 verify replaces credit balance check). Everything downstream is unchanged.

### Approach

**Solution:** New public route at `/api/v1/public/x402/chat/completions` with x402 payment verification replacing session auth. Reuses the entire existing execution pipeline — same facade, same decorators, same LiteLLM, same charge_receipts.

**Reuses:**
- `chatCompletion` / `chatCompletionStream` facades (unchanged)
- `createScopedGraphExecutor` with full decorator stack (unchanged)
- `LiteLlmAdapter` for LLM calls through LiteLLM (unchanged)
- `commitUsageFact` for receipt writing (unchanged)
- `calculateLlmUserCharge` for pricing math (unchanged)
- `/api/v1/public/*` namespace — already bypasses session auth in proxy.ts

**New code:**
- Route handler that parses x402 payment, verifies via facilitator, delegates to existing facade
- `X402PaymentGate` — thin adapter wrapping `@x402/evm` facilitator verification
- `x402-billing-account.adapter.ts` — resolves/creates billing_account from wallet address
- 2 new env vars: `NODE_RECEIVING_ADDRESS`, `X402_FACILITATOR_URL`
- charge_receipts gets `x402_settlement_tx` column via migration

**Rejected alternatives:**

1. **x402 outbound to Hyperbolic (full E2E)** — Rejected because it bypasses LiteLLM cost oracle, requires a signing wallet, and adds a Vercel proxy dependency. More complex, less reliable, bespoke cost tracking. Correct for P2, not P0.

2. **New HyperbolicX402LlmAdapter** — Rejected because it duplicates `LiteLlmAdapter` functionality. LiteLLM already routes to Hyperbolic. The outbound leg doesn't change.

3. **Separate middleware file** — Rejected. Next.js App Router doesn't have per-route middleware. The x402 logic lives in the route handler, same as session auth lives in existing route handlers.

4. **`@cogni/x402-middleware` shared package** — Rejected for P0. Only one consumer (this route). Extract to package when a second consumer appears (e.g., MCP server).

### Invariants

<!-- CODE REVIEW CRITERIA — from x402-e2e spec + architecture -->

- [ ] X402_INBOUND: Payment verified via facilitator before any graph execution (spec: x402-e2e-spec, invariant 1)
- [ ] LITELLM_IS_THE_METER: Outbound still goes through LiteLLM → Hyperbolic via API key. Cost from `x-litellm-response-cost` header. (spec: x402-e2e-spec, invariant 3)
- [ ] CHARGE_RECEIPTS_IMMUTABLE: Settlement recorded with `x402_settlement_tx` column. Idempotency via `(source_system, source_reference)` unchanged. (spec: x402-e2e-spec, invariant 4)
- [ ] NO_CREDIT_BALANCE: x402 payment IS the authorization. No DB credit check for x402 requests. (spec: x402-e2e-spec, invariant 6)
- [ ] RECEIVING_ADDRESS_NOT_SIGNING_KEY: Node only verifies + settles inbound. No private key. (spec: x402-e2e-spec, invariant 7)
- [ ] PUBLIC_NAMESPACE: Route under `/api/v1/public/x402/` — bypasses session auth in proxy.ts (spec: architecture)
- [ ] CONTRACTS_FIRST: Request/response shapes defined in `src/contracts/` using Zod (spec: architecture)
- [ ] HEX_BOUNDARIES: Route → facade → features → ports → core. No shortcutting. (spec: architecture)
- [ ] CALLBACK_IS_SOLE_WRITER: LiteLLM callback still writes charge_receipts. x402 route only adds settlement metadata. (spec: billing-evolution)
- [ ] SIMPLE_SOLUTION: Reuses existing pipeline end-to-end. No new LlmService, no new executor, no new billing path.

### Request Flow

```
                        ┌─────────────────────────────────────────────┐
                        │  External Agent (has USDC wallet on Base)    │
                        └───────────────┬─────────────────────────────┘
                                        │
                        POST /api/v1/public/x402/chat/completions
                        (no session, no API key)
                                        │
                        ┌───────────────▼─────────────────────────────┐
                        │  Route Handler: x402 payment gate            │
                        │                                              │
                        │  1. Parse request body (OpenAI format)       │
                        │  2. Check X-PAYMENT header                   │
                        │     → Missing? Return 402 + challenge        │
                        │  3. Verify payment via facilitator           │
                        │     → Invalid? Return 402                    │
                        │  4. Resolve billing identity from wallet     │
                        │     → Find or create billing_account         │
                        │  5. Delegate to chatCompletion facade        │
                        │     (SAME facade as /v1/chat/completions)    │
                        │  6. After completion: settle via facilitator  │
                        │  7. Annotate charge_receipt with settlement  │
                        └───────────────┬─────────────────────────────┘
                                        │
                    ┌───────────────────▼──────────────────────────┐
                    │  EXISTING PIPELINE (zero changes)              │
                    │                                                │
                    │  chatCompletion facade                         │
                    │    → createScopedGraphExecutor                 │
                    │      → PreflightCreditCheck (SKIPPED —         │
                    │        x402 provider returns                   │
                    │        requiresPlatformCredits: false)          │
                    │      → BillingGraphExecutorDecorator            │
                    │      → ObservabilityDecorator                   │
                    │    → LangGraphInProcProvider.runGraph           │
                    │      → CogniCompletionAdapter                   │
                    │        → LiteLlmAdapter.completionStream        │
                    │          → LiteLLM proxy                        │
                    │            → Hyperbolic (API key auth)          │
                    │                                                │
                    │  LiteLLM callback → /api/internal/billing/     │
                    │    → commitUsageFact → charge_receipts          │
                    └────────────────────────────────────────────────┘
```

### Identity: Temporary shim (proper design in task.0222)

The facade requires `SessionUser` (id, walletAddress, displayName). For x402 prototype, we create a **synthetic SessionUser** from the wallet address:

```typescript
// Temporary shim — replaced by actor_id resolution in task.0222
function walletToSessionUser(walletAddress: `0x${string}`): SessionUser {
  // Deterministic UUID from wallet address (stable across requests)
  const id = uuidv5(walletAddress.toLowerCase(), X402_AGENT_NAMESPACE);
  return { id, walletAddress, displayName: null, avatarColor: null };
}
```

This creates a deterministic `users` row + `billing_account` on first contact via the existing `getOrCreateBillingAccountForUser()` path. It works but conflates `user_id` with what should be `actor_id` (kind=agent).

**task.0222** will properly implement the `actors` table, `actor_bindings`, wallet→actor resolution, and refactor the facade to accept generic caller identity. This prototype is intentionally shim-level.

### Preflight credit check skip

The `PreflightCreditCheckDecorator` asks `provider.requiresPlatformCredits(modelRef)`. For x402, the route handler injects a noop check — x402 payment IS the authorization.

```typescript
const noopCreditCheck: PreflightCreditCheckFn = async () => {}; // x402 is the payment
```

### Files

<!-- High-level scope — prototype, intentionally minimal -->

- **Create:** `src/contracts/x402.chat.public.v1.contract.ts` — Zod contract (OpenAI format + x402 headers)
- **Create:** `src/app/api/v1/public/x402/chat/completions/route.ts` — Public route: x402 gate → synthetic SessionUser → existing facade
- **Create:** `src/adapters/server/x402/payment-gate.ts` — Verify via facilitator, return 402 challenge, settle after completion
- **Modify:** `.cogni/repo-spec.yaml` — Add `payments_in.x402` section
- **Modify:** `apps/web/package.json` — Add `@x402/evm`, `@x402/core`
- **Modify:** `packages/db-schema/src/billing.ts` — Add `x402_settlement_tx` (text, nullable) to charge_receipts
- **Create:** migration for new column
- **Test:** `tests/stack/x402-chat-completions.stack.test.ts` — E2E: wallet pays x402, gets graph response

### Settlement Timing

**Verify-before, settle-after pattern:**

1. **Before execution:** `verifyPayment(signedPayment)` — confirms the agent's USDC authorization covers the max estimated cost. No funds move yet.
2. **After execution:** LiteLLM callback fires with actual cost → `commitUsageFact()` writes charge_receipt → x402 route calls `settlePayment(actualCost)` → facilitator transfers actual USDC to node receiving address.
3. **charge_receipt update:** After settlement, update the receipt with `x402_settlement_tx` (the on-chain tx hash).

This means the charge_receipt is written in two phases: (1) by LiteLLM callback (standard), (2) enriched with settlement tx by the x402 route. The `x402_settlement_tx` column is nullable — NULL means LiteLLM-only billing (existing behavior), non-NULL means x402-settled.

### Configuration: repo-spec (no env vars)

x402 payment config lives in `.cogni/repo-spec.yaml` alongside existing payment rails — not in env vars. This aligns with how all node identity and financial config is managed:

```yaml
# .cogni/repo-spec.yaml — new section
payments_in:
  x402:
    provider: x402-usdc-base-v1
    receiving_address: "0xdCCa8D85603C2CC47dc6974a790dF846f8695056"  # reuses operator_wallet.address
    facilitator_url: "https://x402.org/facilitator"  # Coinbase-hosted (free ≤1k tx/mo, gas sponsored)
    allowed_chains:
      - Base
    allowed_tokens:
      - USDC
```

**Facilitator details:**
- The x402 facilitator is a **third-party settlement service** (like Stripe for crypto). It verifies signed payment authorizations and executes on-chain USDC transfers.
- **Coinbase-hosted** at `https://x402.org/facilitator` — free up to 1,000 settlements/month, gas fees sponsored by Coinbase.
- **Fully open source** at `github.com/coinbase/x402` — Go + TypeScript reference server (~300 lines), self-hostable with a funded wallet + RPC endpoint.
- **P0:** Use Coinbase free tier. **P2:** Self-host for full sovereignty (same pattern as DAO contract migration).

The `receiving_address` can default to `operator_wallet.address` from existing repo-spec config — same wallet that receives operator share from the Splits contract today.

### Dependencies

```json
{
  "@x402/evm": "^2.8.0",
  "@x402/core": "^2.8.0"
}
```

Server-side only (facilitator verification). NOT `@x402/fetch` (that's client-side). The node is an x402 server, not client.

## Validation

- [ ] Agent with USDC wallet can call public endpoint and get graph response
- [ ] 402 challenge returned for requests without X-PAYMENT header
- [ ] 402 challenge includes node receiving address, USDC asset, Base chain
- [ ] Payment verified via facilitator before graph execution starts
- [ ] Graph response matches existing /v1/chat/completions format (OpenAI-compatible)
- [ ] LiteLLM callback writes charge_receipt (existing flow unchanged)
- [ ] charge_receipt enriched with x402_settlement_tx after settlement
- [ ] Existing session-auth /v1/chat/completions endpoint unaffected
- [ ] Works with at least 2 graphs (poet, ponderer)
- [ ] No private keys required on the node
