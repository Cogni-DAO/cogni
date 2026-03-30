---
id: spike.0220
type: spike
title: "Validate AiMo Network x402 passthrough — 402 flow, model coverage, E2E feasibility"
status: needs_implement
priority: 1
rank: 10
estimate: 1
summary: "Validate AiMo Network as an x402-native AI inference provider. Test the 402 challenge→sign→settle flow end-to-end, compare model coverage vs Hyperbolic, and determine whether AiMo enables full x402 E2E (no API keys) in P0."
outcome: "Clear go/no-go on AiMo as primary x402 outbound provider. Documented: 402 flow mechanics, model availability, latency, cost reporting, and whether Cogni nodes can proxy x402 inbound→outbound with margin."
spec_refs: [x402-e2e-spec]
assignees: []
credit:
project: proj.x402-e2e-migration
branch:
pr:
reviewer:
created: 2026-03-27
updated: 2026-03-27
labels: [x402, web3, provider, research]
external_refs: ["https://docs.aimo.network/", "https://www.x402.org/"]
revision: 0
blocked_by: []
deploy_verified: false
---

## Research Questions

### 1. x402 402-Challenge Flow

- Hit AiMo's OpenAI-compatible endpoint with a test completion (no payment)
- Capture the 402 response: what headers/body does AiMo return?
- Does it follow the standard x402 spec (`PAYMENT-REQUIRED` header with JSON)?
- What token/chain does it expect? (expecting USDC on Base)

### 2. End-to-End Payment Flow

- Fund a test wallet with small USDC on Base
- Complete the full cycle: request → 402 → sign → retry with `X-PAYMENT` → 200
- Measure latency overhead of the 402 negotiation (vs direct API key call)
- Does settlement happen synchronously or async?

### 3. Model Coverage

- What models are available? Compare against Hyperbolic's catalog
- Are DeepSeek-V3, Llama-3.3-70B, Qwen models available?
- Is model availability stable or does it fluctuate (decentralized providers)?
- What's the pricing compared to Hyperbolic?

### 4. OpenAI Compatibility

- Test with standard OpenAI SDK (just change base URL)
- Verify streaming works (`stream: true`)
- Verify tool/function calling works
- Test structured output / JSON mode if available

### 5. Proxy Architecture Feasibility

- Can a Cogni node act as x402 intermediary?
  - Receive x402 inbound from user (user→node)
  - Pay AiMo via x402 outbound (node→AiMo)
  - Keep margin (difference between user charge and AiMo cost)
- Does this require the node to have a signing wallet? (yes — but only for outbound to AiMo)
- How does this compare to the current spec's "no private keys in P0" constraint?
- Alternative: can the user's x402 payment pass through directly to AiMo?

### 6. Cost Oracle

- Does AiMo return cost information in the response?
- Can LiteLLM proxy to AiMo and still compute `x-litellm-response-cost`?
- Or does AiMo's x402 settlement amount serve as the cost oracle?

## Decision Gate

**Go if:** AiMo's 402 flow works reliably, model coverage is sufficient, and either (a) passthrough pricing lets the node take margin without signing, or (b) the signing requirement is simple enough for P0.

**No-go if:** AiMo's 402 flow is unreliable, model coverage is too thin, or the wallet signing requirement makes P0 deployment meaningfully harder than API key auth.

**Hybrid option:** Use AiMo as an additional provider alongside Hyperbolic. Hyperbolic for API-key simplicity, AiMo for full x402 E2E when the node has signing capability.

## Validation

- [ ] Successfully completed at least one x402 payment to AiMo
- [ ] Documented 402 challenge format and response structure
- [ ] Model coverage comparison table (AiMo vs Hyperbolic)
- [ ] Latency measurements (x402 overhead vs direct API key)
- [ ] Go/no-go recommendation with reasoning
- [ ] Architecture recommendation: replace Hyperbolic, supplement, or hybrid
