---
id: research.x402-provider-passthrough
type: research
title: "x402 Provider Passthrough Research"
status: draft
trust: draft
summary: "Research findings from spike.0220 — x402 E2E with Hyperbolic, AiMo evaluation, proxy architecture validation"
read_when: Working on x402 integration, provider selection, or payment architecture
owner: derekg1729
created: 2026-03-27
updated: 2026-03-27
---

# Research: x402 Provider Passthrough

> spike: spike.0220 | date: 2026-03-27

## Question

Can a Cogni node act as an x402 middleman — receiving x402 payments from users and paying upstream AI providers via x402 — eliminating API keys entirely? Which providers support this today?

## Context

The x402-e2e-migration spec (proj.x402-e2e-migration) targets Hyperbolic as the outbound provider with API key auth in P0, deferring x402 outbound to P2. This spike tests whether full x402 E2E is achievable now, which would:

- Eliminate `HYPERBOLIC_API_KEY` from the deployment
- Make node setup truly 3-var (wallet address, facilitator URL, wallet key)
- Align with the DAO sovereignty story (no centralized API key dependency)

## Findings

### Provider Landscape (Verified 2026-03-27)

| Provider | x402 Support | Status | Models | Protocol Version |
|----------|-------------|--------|--------|-----------------|
| **Hyperbolic** | Native x402 | **LIVE, TESTED** | 20+ OSS (Llama 3.3, DeepSeek V3/R1, Qwen3, GPT-OSS-120B) | v1 |
| **AiMo Network** | Native x402 (docs) | **DOWN** (devnet.aimo.network unreachable) | Unknown | v2 |
| **BlockRun.AI** | Native x402 | Live (not tested) | Proprietary (GPT-5, Claude) | v2 |
| **Daydreams/xgate** | Native x402 | Live (not tested) | Large catalog | v2 |

### Hyperbolic x402 — Confirmed Working

**Endpoint:** `https://hyperbolic-x402.vercel.app/v1/chat/completions`

**402 Challenge Format (v1):**
```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "100000",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0xD0094d3727914058d09A3001395AD578b23994aC",
    "maxTimeoutSeconds": 60
  }]
}
```

Key observations:
- **Max cost: $0.10 USDC per request** (100000 = 0.10 USDC, 6 decimals)
- **Payment: USDC on Base** (asset `0x8335...`)
- **Protocol: x402 v1** (uses plain network names like "base", not CAIP-2)
- **Requires `X-Request-ID` header** for request correlation
- **No cost reporting in response** — `usage` has token counts but no cost field
- **OpenAI-compatible output schema** included in 402 response body

**Tested completions:**

| Test | Model | Tokens | Latency | Result |
|------|-------|--------|---------|--------|
| Single-turn | Llama-3.3-70B-Instruct | 93 | 4,080ms | Success |
| Multi-turn (4 messages) | Llama-3.3-70B-Instruct | 246 | 5,311ms | Success |
| Proxy passthrough | Llama-3.3-70B-Instruct | 110 | 6,643ms | Success |

**Available models (from error response):**
- deepseek-ai/DeepSeek-V3, DeepSeek-V3-0324, DeepSeek-R1, DeepSeek-R1-0528
- meta-llama/Llama-3.3-70B-Instruct, Meta-Llama-3-70B-Instruct, Meta-Llama-3.1-405B
- Qwen/Qwen3-235B-A22B, Qwen3-Coder-480B-A35B-Instruct, Qwen2.5-72B-Instruct, QwQ-32B, Qwen3-Next-80B variants
- openai/gpt-oss-120b, gpt-oss-120b-turbo, gpt-oss-20b
- mistralai/Pixtral-12B-2409
- nvidia/NVIDIA-Nemotron-Nano-12B-v2-VL-BF16
- FLUX.1-dev (image), StableDiffusion (image), TTS (audio)

### AiMo Network — Currently Unusable

`devnet.aimo.network` returns connection timeout. `beta.aimo.network` returns 404. Root domain loads but API is unreachable. Cannot validate x402 flow or model catalog. AiMo may be between deployments or sunsetting devnet.

**Recommendation:** Do not depend on AiMo for P0. Re-evaluate if/when their API comes back online.

### Proxy Architecture — Validated

The demo proves a Cogni node can act as x402 middleman:

```
Client ---x402 inbound---> Cogni Node ---x402 outbound---> Hyperbolic
       <---completion----             <---completion----
```

**Inbound leg (node as x402 server):**
- Node returns 402 with its own receiving address, margin-adjusted amount
- Client signs USDC payment to node's wallet
- Node verifies payment via facilitator before proceeding

**Outbound leg (node as x402 client):**
- Node signs USDC payment to Hyperbolic's wallet using @x402/fetch
- @x402/fetch handles 402→sign→retry automatically
- Completion returned to client

**Margin model:** Node charges users `providerCost * MARGIN_MULTIPLIER`. The margin is the difference between what the user pays and what Hyperbolic charges. Both legs settle in USDC on Base.

**Key implication: the node DOES need a signing wallet for outbound x402.** This conflicts with the current spec's "no private keys in P0" constraint. The node wallet must hold USDC to pay upstream providers.

### SDK Findings

**Required packages:**
```json
{
  "@x402/fetch": "^2.8.0",
  "@x402/evm": "^2.8.0",
  "viem": "^2.39.3"
}
```

**Key implementation details:**
- `x402Client.register()` for v2 (CAIP-2 networks), `x402Client.registerV1()` for v1 (plain names)
- `ExactEvmScheme` for v2, `ExactEvmSchemeV1` for v1 — different classes
- `toClientEvmSigner(account, publicClient)` composes from viem account + public client
- `wrapFetchWithPayment(fetch, client)` returns a drop-in fetch replacement
- The wrapped fetch automatically: detects 402, parses challenge, signs payment, retries with header

**Gotcha: Hyperbolic uses x402 v1, but @x402 SDK defaults to v2.** Must register both versions.

### Cost Oracle Gap

Hyperbolic's x402 endpoint does NOT return provider cost in the response. The `usage` object has token counts but no dollar amount. This means:

- **LiteLLM cannot be the cost oracle** for x402 outbound (it never sees the request)
- The x402 payment amount IS the cost — it's in the blockchain settlement
- For margin calculation, the node needs to know the max cost BEFORE the call (to set the inbound 402 challenge amount)

**Options:**
1. Fixed per-model pricing table (simplest, what Hyperbolic's 402 returns as `maxAmountRequired`)
2. Pre-call estimation based on input tokens + max output tokens
3. Use the upstream 402 challenge amount + margin as the inbound 402 amount

Option 3 is the most elegant: node probes upstream 402, adds margin, returns to client.

## Recommendation

### GO on Hyperbolic x402 for P0

Hyperbolic x402 works today, has the models we need, and the proxy architecture is proven. However, this changes two spec constraints:

**Spec change 1: Node needs a signing wallet (private key)**
The "no private keys in P0" constraint cannot hold for x402 outbound. The node must sign USDC payments to Hyperbolic. This is actually simpler than the API key model — one wallet key does everything (receive inbound + pay outbound).

**Spec change 2: LiteLLM is NOT the cost oracle for x402 outbound**
Cost is determined by the x402 settlement, not LiteLLM's response header. LiteLLM remains useful for model routing and token counting, but cost tracking shifts to on-chain settlement data.

### Proposed architecture update

```
P0 env vars (revised):
  NODE_WALLET_PRIVATE_KEY     — signs outbound x402 payments + receives inbound
  X402_FACILITATOR_URL        — hosted facilitator for inbound verification
  # No HYPERBOLIC_API_KEY needed
```

This is actually FEWER vars than the original P0 spec (which had 3). And more aligned with DAO sovereignty — no API key dependency on any centralized provider.

### NO-GO on AiMo for P0

AiMo is down. Re-evaluate later. Hyperbolic alone has sufficient model coverage.

## Open Questions

1. **Wallet funding:** How does a new node get initial USDC on Base for outbound payments? Faucet? Seed from DAO treasury?
2. **Margin timing:** Should the node probe Hyperbolic's 402 for each inbound request (adds latency) or cache pricing?
3. **Settlement reconciliation:** How do we match on-chain USDC transfers to charge_receipts? Transaction hash in the x402 settlement response?
4. **Streaming:** Does Hyperbolic's x402 endpoint support `stream: true`? Not tested in this spike.
5. **Multi-provider:** If we add more x402 providers (BlockRun, xgate), how does the node select which to use? Cost-based routing?

## Proposed Layout

### Spec Updates

- **Update `docs/spec/x402-e2e.md`:**
  - Revise invariant 2 (API_KEY_OUTBOUND) → x402 outbound in P0
  - Revise invariant 3 (LITELLM_IS_THE_METER) → cost from x402 settlement
  - Add `NODE_WALLET_PRIVATE_KEY` to env vars
  - Remove `HYPERBOLIC_API_KEY`
  - Add Hyperbolic x402 endpoint details and model catalog
  - Document x402 v1 vs v2 protocol differences

### Tasks (PR-sized)

1. **task: x402 outbound client adapter** — `@cogni/x402-client` package wrapping @x402/fetch + @x402/evm with multi-version support. Port from spike demo's `x402-client.ts`.

2. **task: x402 inbound middleware** — Express/Next.js middleware that returns 402 challenges and verifies inbound payments via facilitator. Port from spike demo's proxy server.

3. **task: HyperbolicX402LlmAdapter** — `LlmService` implementation that uses the x402 client adapter instead of API key auth. Replaces `LiteLlmAdapter` for Hyperbolic models.

4. **task: Wallet management** — `NodeWalletPort` for signing outbound payments. Simple `privateKeyToAccount` in P0, upgradeable to keystore/HSM later.

5. **task: Cost tracking from x402 settlement** — Parse settlement response headers, write provider_cost_usd and x402_settlement_tx to charge_receipts.
