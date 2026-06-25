---
id: clawrouter-x402-egress-research
type: research
title: "ClawRouter / BlockRun x402 Egress — Autonomous USDC-per-request Inference"
status: exploratory
trust: draft
summary: Spike evaluating ClawRouter/BlockRun as a programmatic crypto-funded inference egress. The ONE decision criterion — can the operator's Privy HSM wallet pay USDC per request, fully programmatically, with full model parity? Verdict, evidence, and the fork/build.
read_when: Evaluating crypto-funded AI inference egress; deciding whether to adopt ClawRouter/BlockRun; designing Privy-signed x402 outbound.
owner: derekg1729
created: 2026-06-25
verified:
tags: [research, x402, payments, ai-egress, privy, spike, exploratory]
---

# ClawRouter / BlockRun x402 Egress

> EXPLORATORY SPIKE — research only. NOT adopted. No litellm/catalog/prod config touched.
> Branch: `spike/clawrouter-x402-egress`.

## The ONE thing

**Can the operator's Privy HSM wallet pay USDC, per request, fully programmatically (no human, no Stripe, no hot key), to get inference — while keeping full model parity?**

Hyperbolic and OpenRouter both **FAIL** this: neither offers programmatic crypto top-up the operator wallet can drive end-to-end (proven prior). ClawRouter/BlockRun is the candidate: "OpenRouter's shape, in USDC, per request."

---

## TL;DR verdict

**YES — with a fork.** ClawRouter/BlockRun delivers genuine autonomous USDC-per-request inference (x402 / EIP-3009 on Base), and its model catalog **meets or exceeds** our current OpenRouter set — including the proprietary frontier (Claude Opus/Sonnet, GPT-5.x, Gemini) AND the OSS tier (DeepSeek, Llama, Qwen, GLM, Kimi). It is **MIT-licensed and self-hostable**.

The catch is **custody**: stock ClawRouter signs x402 with a **raw hot key** (`BLOCKRUN_WALLET_KEY` / `~/.openclaw/blockrun/wallet.key`, loaded via viem `privateKeyToAccount`). That violates our `KEY_NEVER_IN_APP` invariant. The fork replaces the local signer with a **Privy-HSM signer** (`eth_signTypedData_v4`, confirmed supported by `@privy-io/node`). The fork is **small but non-trivial** because EIP-3009 signing is an _off-chain typed-data signature_, and our operator-wallet adapter today deliberately exposes **no generic `signTypedData`** (`NO_GENERIC_SIGNING`) — so a new named method (`signX402Payment`) must be added.

The **real strategic question is not technical, it's trust/economics**: `payTo` resolves to **BlockRun's wallet, not the model provider**. BlockRun is a **reseller** — its gateway holds the provider keys and absorbs the USDC↔fiat gap. We get autonomy by accepting a single counterparty (BlockRun) between us and the labs, plus their margin ("provider cost plus a small margin, $0.001 floor"). That is the same shape as OpenRouter — except actually crypto-fundable.

---

## 1. Model parity — EVIDENCE

ClawRouter advertises "41+/55+ models." The BlockRun API model reference (`blockrun.ai/docs/api-reference/models`) enumerates **~54 chat/LLM models** plus image/video/audio. Pricing is **per-token** (provider passthrough + margin), NOT the flat per-request the marketing implies — important for cost modeling.

### Chat/LLM catalog (from BlockRun API reference, prices = $/M in / $/M out)

| Provider          | Models                                                                                                                                                                                  | Notes vs our set                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **OpenAI**        | `gpt-5.5`, `gpt-5.4` (+ `-pro`/`-mini`/`-nano`), `gpt-5.3`(+`-codex`), `gpt-5.2`(+`-pro`), `gpt-5-mini`; o-series: `o1`,`o1-mini`,`o3`,`o3-mini`                                        | Full GPT-5.x + o-series. Covers/exceeds our OpenAI use.                           |
| **Anthropic**     | `claude-opus-4.8/4.7/4.6/4.5`, `claude-sonnet-4.6`, `claude-haiku-4.5`                                                                                                                  | Full Claude frontier incl. Opus 4.8.                                              |
| **Google**        | `gemini-3.1-pro`, `gemini-3.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3.1-flash-lite`, `gemini-2.5-flash-lite`                                                            | Full Gemini line.                                                                 |
| **DeepSeek**      | `deepseek-chat`, `deepseek-v4-pro`, `deepseek-reasoner`                                                                                                                                 | OSS-tier covered.                                                                 |
| **xAI**           | grok-4-fast(+reasoning), grok-4-1-fast(+reasoning), grok-4-0709, grok-3-mini                                                                                                            | (from README budget tier)                                                         |
| **Z.AI**          | `glm-5.2`, `glm-5.1`, `glm-5`, `glm-5-turbo`                                                                                                                                            | OSS-tier covered.                                                                 |
| **Moonshot**      | `kimi-k2.7`, `kimi-k2.6`, `kimi-k2.5`                                                                                                                                                   | OSS-tier covered.                                                                 |
| **MiniMax**       | `minimax-m3` (+ m2.x in README)                                                                                                                                                         |                                                                                   |
| **NVIDIA (free)** | `llama-4-maverick`, `gpt-oss-120b`, `gpt-oss-20b`, `mistral-large-3-675b`, `qwen3.5-122b-a10b`, `qwen3-next-80b-a3b-instruct`, `seed-oss-36b`, `nemotron-3-nano-omni-30b-a3b-reasoning` | **8 models free permanently.** Direct OSS substitute for our Hyperbolic OSS tier. |

Also: 7 image-gen (`gpt-image-1/2`, `nano-banana(-pro)`, grok-imagine, cogview-4), 5 video-gen (grok/seedance/sora-2), TTS/music/SFX.

### Parity assessment vs our current OpenRouter set

- **Proprietary frontier (Claude, GPT-5.x, Gemini): COVERED**, including the latest tiers.
- **OSS tier (DeepSeek / Llama / Qwen / GLM / Kimi): COVERED**, plus 8 permanently-free NVIDIA-hosted OSS models.
- **Where it could fall short (must verify against the live catalog before any adoption):**
  - The **exact model ID strings differ** from OpenRouter's (`anthropic/claude-opus-4.8` vs OpenRouter's slug). litellm aliasing absorbs this, but it IS a mapping job — not drop-in.
  - **Long-tail / niche OSS models** on OpenRouter (smaller community fine-tunes) are NOT enumerated by BlockRun — BlockRun curates ~54, OpenRouter lists hundreds. If our catalog pins an exotic model, parity breaks for that one.
  - **Embeddings**: not enumerated in the chat catalog (same gap our x402-e2e spec flags for Hyperbolic). Needs explicit check.
  - Pricing is **per-token passthrough + margin**, so "free" applies only to the NVIDIA tier; everything else carries BlockRun's margin on top of list price.

**Verdict (parity):** Meets our parity bar for the models we actually run. The risk is _mapping + curation_, not _absence_ — but it must be proven model-by-model against our live litellm catalog before adoption, not assumed.

---

## 2. x402 mechanics — EVIDENCE

**The CLIENT (us) pays USDC per request.** Flow (from `blockrun.ai/docs/x402/payment-flow` + ClawRouter `src/proxy.ts`):

```
litellm/agent → http://localhost:8402/v1/chat/completions   (OpenAI-compatible)
  → proxy forwards → https://blockrun.ai/api/v1/chat/completions
  → 402 Payment Required
       X-Payment-Required: <base64 requirements>
         scheme:  "exact"
         network: "eip155:8453"            (Base mainnet)
         amount:  "1000"                    (USDC atomic, 6 decimals → $0.001)
         asset:   0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913   (canonical Base USDC)
         payTo:   0x...   (BlockRun's wallet — see §5)
  → client signs EIP-3009 transferWithAuthorization
       { from, to, value, validAfter, validBefore, nonce }   (~5 min validity, 10 min skew)
  → retry with X-PAYMENT header (base64 signed authorization)
  → server verifies signature via Facilitator → settles on Base → 200 + response
```

- **Asset confirmed**: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` = canonical USDC on Base (same constant our `privy-operator-wallet.adapter.ts` already hardcodes).
- **EIP-3009** (`transferWithAuthorization`) is the signing primitive — an _off-chain EIP-712 typed-data signature_, NOT an on-chain transaction. The facilitator/relayer submits it. This is the load-bearing detail for the fork (§3).
- Stock ClawRouter does the signing via the **`@x402/fetch`** SDK (`src/payment-preauth.ts` calls `client.createPaymentPayload(...)` + `httpClient.encodePaymentSignatureHeader(...)`), with an `onAfterPaymentCreation` hook capturing the actual settled `amountMicros` for cost tracking.
- **What ClawRouter pays behind:** NOTHING per-provider at the proxy. The proxy's **only upstream is BlockRun's gateway** (`https://blockrun.ai/api`, or `sol.blockrun.ai` for Solana). `src/provider.ts` shows `auth: []` — no provider API keys are ever used client-side. **BlockRun holds the provider relationships and prepaid keys behind its gateway.** It is a reseller fronting the USDC↔fiat gap.

---

## 3. Custody fork — replace hot key with Privy

### Confirmed: stock signs with a raw hot key

`src/auth.ts` loads the key with this priority:

1. `~/.openclaw/blockrun/wallet.key` (unencrypted file, `0o600`)
2. `BLOCKRUN_WALLET_KEY` env (`0x`-prefixed hex)
3. auto-generated BIP-39 mnemonic on first run

…then `privateKeyToAccount(envKey as 0x...)` (viem). **Raw hot key, in-process.** This violates our `KEY_NEVER_IN_APP` / `NO_PRIVATE_KEY_ENV_VARS` invariants (see `docs/spec/node-operator-x402.md` Open Q4, and `packages/operator-wallet/AGENTS.md`).

### The fork: Privy-HSM signer for EIP-3009

The x402 client needs a viem-`Account`-shaped signer whose `signTypedData` produces the EIP-3009 authorization. We swap the local `privateKeyToAccount` for a **Privy-backed account**:

- **Privy supports this.** `@privy-io/node` server wallets expose `signTypedData` → `eth_signTypedData_v4` (EIP-712), POSTed to `/v1/wallets/{wallet_id}/rpc`. That is _exactly_ what EIP-3009 `transferWithAuthorization` requires (it's an EIP-712 typed-data sign, not a tx). Privy even ships a viem adapter (`@privy-io/node` ↔ viem `Account`), so the x402 SDK's expected signer interface is satisfiable.

### How invasive — honest assessment

| Surface                               | Change                                                                                                                                                                                                                                                                                                                            | Size                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| ClawRouter `src/auth.ts`              | Replace `privateKeyToAccount` with a Privy viem account (or a thin `Account` shim that delegates `signTypedData` to Privy `/rpc`).                                                                                                                                                                                                | **Small** — one signer construction site.                                                                                                    |
| `@x402/fetch` plumbing                | Pass our custom account into the x402 client instead of letting it self-generate. Verify the SDK accepts an injected signer (it takes a wallet/account; needs source check).                                                                                                                                                      | **Small–medium** (one integration point, depends on SDK surface).                                                                            |
| `packages/operator-wallet` (OUR side) | **Add a named `signX402Payment(domain, types, message)` method** to `OperatorWalletPort` + `PrivyOperatorWalletAdapter`. Today the adapter only does `sendTransaction` (on-chain) and deliberately exposes **no generic `signTypedData`** (`NO_GENERIC_SIGNING`). EIP-3009 needs the off-chain sign path that does not exist yet. | **Medium** — new port method + adapter method + Privy `signTypedData` wiring + guardrails (amount cap, payTo allowlist, validBefore window). |
| Guardrails                            | Mirror `fundOpenRouterTopUp`'s gate pattern: cap per-request USDC, allowlist `payTo` (BlockRun), bound `validBefore`.                                                                                                                                                                                                             | Small.                                                                                                                                       |

**Net:** the operator-wallet `signX402Payment` method is the real work (the named-method invariant means we can't just expose a generic signer). The ClawRouter-side change is a one-site signer swap. **Days, not weeks** — IF `@x402/fetch` accepts an injected viem account (the one source-level unknown to confirm before committing).

> Note: if PR #1844 / `signX402Payment` already landed a Privy EIP-3009 signer on `main`, most of the OUR-side work is done and this collapses to wiring ClawRouter to call it. (Not present on this branch's `main` at spike time — `grep signX402Payment` → 0 hits; verify against latest before building.)

---

## 4. Self-host vs hosted (MIT)

- **License: MIT** (`Copyright (c) 2026 BlockRunAI`). Fork + self-host is permitted.
- **Self-hostable proxy: YES.** The proxy (`npx @blockrun/clawrouter`, port 8402) is a local OpenAI-compatible server we can run as a per-node Docker sidecar, forked to Privy-sign.
- **What STAYS dependent on BlockRun:** the **marketplace + settlement gateway** (`https://blockrun.ai/api`). Self-hosting the proxy does NOT make us provider-direct — every request still terminates at BlockRun's gateway, which holds the provider keys and is the `payTo`. We control _signing custody_ and _routing logic_; BlockRun controls _fulfillment and provider relationships_.
- So "self-host for sovereignty" is **partial**: sovereign over keys + routing, dependent on BlockRun for inference fulfillment. This is materially better than OpenRouter (we'd own the signing wallet + can audit the proxy) but is NOT provider-direct sovereignty.

---

## 5. Economics / trust

- **`payTo` = BlockRun's wallet, NOT the model provider.** Confirmed by the single-upstream architecture (proxy → `blockrun.ai/api`) and `auth: []` (no provider keys client-side). We pay BlockRun; BlockRun pays the labs out-of-band.
- **Markup:** docs state "provider cost plus a small margin, with a $0.001 floor." Exact margin % is **not disclosed** in public docs — must be measured empirically (compare a known provider call's list price to the 402 `amount`). The NVIDIA OSS tier is genuinely free; everything else carries margin.
- **Reliability / counterparty risk:** single point of dependency. If BlockRun's gateway is down, mispriced, or rugs the provider relationship, our egress dies — same risk class as OpenRouter, concentrated in a younger company. No SLA found.
- **Is `payTo` → BlockRun acceptable?** For _autonomy_, yes — it's the only known router that is actually crypto-fundable per-request with full frontier parity. For _sovereignty_, it's a compromise: we trade "provider-direct, no middleman" for "programmatically crypto-fundable." Given OpenRouter/Hyperbolic both FAIL the autonomy criterion outright, BlockRun is strictly better on the ONE thing we care about. Acceptable as the **autonomy unlock**, with provider-direct x402 as the longer-term north star (most labs don't expose x402 yet — that's why a router exists).

---

## 6. Integration shape

Slots in front of existing litellm with **zero model churn**:

```
existing agents / app
        │ (OpenAI-compatible, unchanged)
        ▼
   LiteLLM proxy            ← cost oracle + routing, UNCHANGED
        │  one new model-group whose api_base points at:
        ▼
 (self-hosted, Privy-signing) ClawRouter proxy   :8402
        │  402 → signX402Payment (Privy HSM) → X-PAYMENT → retry
        ▼
   BlockRun gateway  https://blockrun.ai/api
        │
        ▼
   providers (OpenAI / Anthropic / Google / NVIDIA / …)
```

- litellm sees a normal OpenAI base URL; no catalog churn — we add a **new upstream group**, keep OpenRouter/Hyperbolic groups alongside, and route a slice (e.g. one model or one env) through ClawRouter to validate.
- Model IDs map via litellm aliasing (BlockRun's `anthropic/claude-opus-4.8` ↔ our catalog name).
- Cost truth still comes from litellm; the x402 `onAfterPaymentCreation` settled amount is a second, on-chain cross-check.

---

## Build (if adopted — NOT now)

1. Confirm `@x402/fetch` accepts an **injected viem account** (only hard unknown). If not, the fork is heavier (reimplement payload signing).
2. Add `signX402Payment(domain, types, message): Hex` to `OperatorWalletPort` + `PrivyOperatorWalletAdapter` (Privy `eth_signTypedData_v4`), with amount-cap + `payTo`-allowlist + `validBefore` guardrails. (Or reuse PR #1844's signer if landed.)
3. Fork ClawRouter: swap `privateKeyToAccount` (`src/auth.ts`) for a Privy-backed `Account` delegating `signTypedData` to (2).
4. Run forked proxy as a per-node Docker sidecar; add ONE litellm upstream group pointing at it; route a single model through it on candidate-a.
5. Measure: real USDC settled per request (Base), end-to-end no-human funding from the operator HSM wallet, and the effective BlockRun margin vs list.
6. Prove model-by-model parity against the live litellm catalog before widening.

## Verdict

**YES** — ClawRouter/BlockRun gives **autonomous USDC-per-request inference with full model parity for the models we run**, signed by the operator's Privy HSM wallet (no hot key, no Stripe, no human), via a **small-to-medium MIT fork**. The cost is a **trust dependency on BlockRun** (`payTo` = BlockRun, undisclosed margin, single counterparty), and a **mapping/curation parity job** that must be proven before adoption — not a model-absence problem. It is the only candidate that passes the ONE criterion that OpenRouter and Hyperbolic both fail. Recommend a bounded follow-up spike to (a) confirm `@x402/fetch` injectability and (b) settle one real per-request USDC payment from the HSM wallet on candidate-a — before any litellm/catalog change.

## Sources

- ClawRouter repo (MIT): https://github.com/BlockRunAI/ClawRouter — `README.md`, `docs/configuration.md`, `src/auth.ts`, `src/proxy.ts`, `src/provider.ts`, `src/payment-preauth.ts`, `LICENSE`
- BlockRun docs: https://blockrun.ai/docs — `/api-reference/models`, `/x402/payment-flow`
- router402: https://www.router402.xyz/ (sibling x402 router; Claude/GPT/Gemini, ZeroDev account-abstraction, Base Flashblocks)
- x402: https://www.x402.org ; EIP-3009 transferWithAuthorization
- Privy server wallets (EIP-712 / `eth_signTypedData_v4`): https://docs.privy.io/wallets/using-wallets/ethereum/sign-typed-data , https://docs.privy.io/api-reference/wallets/ethereum/eth-signtypeddata-v4
- Our prior art: `docs/spec/node-operator-x402.md` (`@cogni/x402-client` P2, NodeWalletPort), `docs/spec/x402-e2e.md`, `packages/operator-wallet/src/adapters/privy/privy-operator-wallet.adapter.ts`, `packages/operator-wallet/AGENTS.md` (`NO_GENERIC_SIGNING`)
  </content>
  </invoke>
