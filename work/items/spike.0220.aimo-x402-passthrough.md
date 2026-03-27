---
id: spike.0220
type: spike
title: "Validate x402 provider passthrough — Hyperbolic E2E, AiMo evaluation, proxy architecture"
status: done
priority: 1
rank: 10
estimate: 1
summary: "Validated x402 E2E flow with Hyperbolic as provider. AiMo Network is down. Proved Cogni node can act as x402 middleman (inbound + outbound). Key finding: node needs signing wallet for outbound x402, which simplifies env vars vs API key model."
outcome: "GO on Hyperbolic x402 for P0. NO-GO on AiMo (unreachable). Proxy architecture validated with working demo. Spec changes needed: node signing wallet, cost oracle shift from LiteLLM to x402 settlement."
spec_refs: [x402-e2e-spec]
assignees: []
credit:
project: proj.x402-e2e-migration
branch: worktree-spike-0220-aimo-x402
pr:
reviewer:
created: 2026-03-27
updated: 2026-03-27
labels: [x402, web3, provider, research]
external_refs: ["https://www.x402.org/", "https://hyperbolic-x402.vercel.app", "docs/research/x402-provider-passthrough.md"]
revision: 1
blocked_by: []
deploy_verified: false
---

## Validation

### Validated (with working demo code in `spikes/x402-aimo-demo/`)

- [x] Successfully completed x402 payments to Hyperbolic (3 completions, all successful)
- [x] Documented 402 challenge format and response structure (x402 v1, USDC on Base)
- [x] Model coverage: 20+ OSS models (DeepSeek V3/R1, Llama 3.3, Qwen3, GPT-OSS-120B)
- [x] Latency measurements: 4-7s per completion (includes x402 negotiation overhead)
- [x] GO on Hyperbolic x402 for P0
- [x] Proxy middleman architecture validated end-to-end

### Not Validated

- [ ] AiMo Network — devnet unreachable, cannot test
- [ ] Streaming (`stream: true`) — not tested
- [ ] Tool/function calling — not tested

### Key Finding: Spec Changes Needed

1. **Node needs signing wallet** — `NODE_WALLET_PRIVATE_KEY` replaces `HYPERBOLIC_API_KEY`
2. **Cost oracle shifts** — from LiteLLM response header to x402 settlement amount
3. **Fewer env vars** — 2 vars (wallet key + facilitator URL) vs 3 in original spec

See full research doc: `docs/research/x402-provider-passthrough.md`
