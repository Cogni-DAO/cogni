---
id: gateway-billing-analysis
type: research
title: "Research: Gateway Billing — The Crypto→AI Bridge Problem"
status: draft
trust: draft
summary: "Critical analysis of gateway billing architecture. x402 market survey, Hyperbolic evaluation, per-request settlement vs. credit system tradeoffs."
read_when: Working on x402 integration, billing architecture, provider migration, or financial ledger design.
owner: derekg1729
created: 2026-02-26
verified:
tags: [billing, x402, web3, research]
---

# Gateway Billing Analysis: The Crypto→AI Bridge Problem

> **Status:** Research spike — critical architecture decision
> **Date:** 2026-02-26
> **Core Question:** Cogni IS the crypto→AI payment bridge. How do we provide that service without becoming a bottleneck, and how does a new AI project become a Cogni node?

---

## Corrected Framing: Cogni is Not "Trying to Be" OpenRouter

The first pass of this analysis compared Cogni to passthrough gateways (LiteLLM, Helicone, Portkey) and suggested Cogni should just route requests without touching money. **That analysis was wrong** because it missed the fundamental constraint:

**OpenRouter was the only major AI aggregator accepting crypto** (via Coinbase Commerce on Base). That's changing — Hyperbolic now accepts per-call USDC via x402, Venice AI offers staked token access, AI/ML API accepts Bitcoin — but Anthropic, OpenAI, and Google still don't accept crypto directly. For a fully crypto-native DAO consuming mainstream AI models, someone must bridge USDC→provider credits.

Cogni's value proposition is being this bridge: a closed-loop crypto-native revenue/expense cycle for AI services. The question isn't _whether_ to sit in the payment path — the question is _where_ this bridge lives, who runs it, and how fast x402 makes it obsolete.

---

## The Landscape Is Moving Fast

### Providers Accepting Crypto (Feb 2026)

| Provider                      | Method                           | Model                                              |
| ----------------------------- | -------------------------------- | -------------------------------------------------- |
| **OpenRouter**                | Coinbase Commerce (USDC on Base) | Credit top-up, 5% fee                              |
| **Hyperbolic**                | x402 (USDC on Base)              | Per-call micropayment, x402 launch partner         |
| **Venice AI**                 | VVV staking → DIEM               | Stake capital = perpetual API access ($1/day/DIEM) |
| **AI/ML API**                 | Bitcoin + 300 cryptos            | Subscription plans from $100/mo                    |
| **Akash**                     | AKT + USDC on-chain escrow       | Compute leasing, block-priced settlement           |
| **Render**                    | RENDER burn (Solana)             | Burn-on-submit for GPU jobs                        |
| **Bittensor**                 | TAO emissions                    | Subnet queries, inflation-subsidized               |
| **Anthropic, OpenAI, Google** | **None**                         | Fiat/credit card only                              |

The bottom four rows are the constraint: mainstream frontier models (Claude, GPT, Gemini) have no crypto payment rails. Until they adopt x402 or equivalent, the bridge is necessary.

### The x402 Protocol — Traction, and Dynamic Pricing Is Closer Than Expected

x402 revives HTTP 402 for machine-to-machine payments. USDC on Base, ~200ms settlement, ~$0.0001 per tx. **Real traction:**

- 156,000 weekly transactions (492% growth)
- Adopted by Hyperbolic (GPU inference), Neynar (Farcaster data), Token Metrics
- Stripe integration shipped. Visa support announced. Cloudflare backing.
- Google AP2 natively supports x402's crypto extension

**The core Coinbase spec's `exact` scheme cannot handle dynamic AI pricing** — it requires the server to quote a fixed amount upfront. LLM inference cost depends on output token count, which is unknown until generation completes.

**However, the `upto` scheme HAS shipped — via Thirdweb, not Coinbase core.** Thirdweb SDK v5.114.0+ implements `upto` in production with an open-source reference implementation for pay-per-token AI inference with streaming ([thirdweb-example/x402-ai-inference](https://github.com/thirdweb-example/x402-ai-inference)). x402 V2's modular plugin architecture makes this possible without changes to the core spec.

**Thirdweb `upto` flow for AI inference:**

```
1. Client requests AI completion
2. Server responds 402 with scheme: "upto", maxPayableAmount (worst-case estimate)
3. Client signs authorization for up to maxPayableAmount
4. Server calls verifyPayment() to confirm authorization covers max
5. Server streams AI response (Vercel AI SDK streamText())
6. In onFinish callback: actual cost = totalTokens * PRICE_PER_INFERENCE_TOKEN_WEI
7. Server calls settlePayment() with ACTUAL cost (≤ max)
```

**Also shipped: "Sign once, settle many times" (Dec 2025)** — a single `upto` authorization covers a whole session. Client authorizes $1 once, server settles 100 micro-payments of $0.01 each without re-signing. Natural fit for multi-turn chat.

**Other emerging x402 schemes (not yet shipped):**

| Scheme         | Description                                                | Status                                        |
| -------------- | ---------------------------------------------------------- | --------------------------------------------- |
| **`exact`**    | Fixed price, pay before access                             | Shipped (Coinbase core)                       |
| **`upto`**     | Authorize max, settle actual                               | Shipped (Thirdweb), not in Coinbase core spec |
| **`escrow`**   | Lock funds in contract, draw per-usage, refund remainder   | Spec proposal (x402 PR #873)                  |
| **`deferred`** | Crypto handshake now, financial settlement later (batched) | Cloudflare private beta (pay-per-crawl)       |

### Why This Matters for Cogni: The LiteLLM Cost Pipeline

Cogni's entire cost tracking is post-hoc. The LiteLLM proxy calculates actual cost AFTER request completion:

```
litellm-config.yaml defines per-token pricing:
  input_cost_per_token: 0.000003    (Claude Sonnet)
  output_cost_per_token: 0.000015

Request completes → LiteLLM records in LiteLLM_SpendLogs:
  prompt_tokens: 1,247
  completion_tokens: ???  (could be 10 or 4,000)
  spend: calculated post-hoc

usage-sync.service.ts polls SpendLogs → creates charge_receipts → debits credit_ledger
```

The cost of a single Claude Sonnet request can range from $0.004 (short answer) to $0.08 (long generation) depending on output. You cannot quote this upfront. This isn't a Cogni-specific problem — it's inherent to how LLMs work.

### Four Approaches to Bridge x402 + Dynamic Pricing

#### Approach 1: x402 `upto` Scheme — Authorize Max, Settle Actual (SHIPPED)

This is no longer theoretical. Thirdweb has this in production (SDK v5.114.0+):

```
1. Client requests AI completion
2. Server estimates max cost (max_tokens * output_cost_per_token + input_cost)
3. Server responds 402 with scheme: "upto", maxPayableAmount
4. Client signs authorization for up to maxPayableAmount
5. Server streams response, LiteLLM calculates actual cost in onFinish
6. Server calls settlePayment() with ACTUAL cost (≤ max)
7. Unused authorization expires — client's funds beyond actual cost are never touched
```

**Pro:** Production-ready. True per-request settlement. Standard x402 flow. Open-source reference impl exists for AI inference specifically.
**Con:** Max estimate can be 10-20x actual (client must have funds for max). Server bears execution risk (performs work before settlement guaranteed). Requires trust that server won't overcharge — needs dispute mechanism for adversarial settings.

**Cogni fit:** Strong. The node IS the server, so it controls both LiteLLM (cost oracle) and the `settlePayment()` call. Signed `charge_receipts` already provide an audit trail. The max estimate problem is bounded: we know `max_tokens` from the request config and `output_cost_per_token` from `litellm-config.yaml`. "Sign once, settle many" covers multi-turn chat naturally.

**The key question for Cogni:** This works for Cogni nodes as x402 SERVERS (users/agents pay Cogni per-request). It does NOT help with Cogni nodes as x402 CLIENTS paying upstream providers — Anthropic/OpenAI don't accept x402. The outbound bridge problem remains.

#### Approach 2: Session Escrow ("Deposit, Meter, Settle")

Proposed as x402 `escrow` scheme ([PR #873](https://github.com/coinbase/x402/pull/873)) — spec only, not shipped:

```
1. Client locks funds in escrow smart contract
2. Multiple AI requests served against escrow balance
3. Each request: LiteLLM tracks actual cost, provider draws from escrow
4. Periodic on-chain settlement (every N requests or every T seconds)
5. Session close: remaining escrow refunded to client
```

**Pro:** Amortizes gas across many requests. Natural for chat sessions. Trustless — funds locked in contract, not held by server.
**Con:** Requires custom escrow contract. Per-session contract interactions are expensive. Reinvents the credit system on-chain.

**Cogni fit:** Viable but heavy. The "sign once, settle many" variant of `upto` achieves similar session economics with less on-chain complexity. Consider for Phase 2+ if adversarial trust model is needed (multi-node settlement where nodes don't trust each other).

#### Approach 3: Pre-Funded Balance + Off-Chain Metering ("The Pattern Everyone Actually Uses")

```
1. Client deposits USDC once (via x402, Coinbase Commerce, or direct transfer)
2. Protocol mints COGNI tokens (or credits DB balance)
3. All requests metered off-chain by LiteLLM → charge_receipts
4. Balance decremented locally per-request
5. Periodic on-chain settlement burns tokens / reconciles
```

**This is what every deployed crypto-AI system actually does:**

- OpenRouter: credit top-up → off-chain metering
- Akash: escrow deposit → block-priced off-chain metering → batched withdrawal
- Venice: stake capital → off-chain API metering against allocation
- Bittensor: emission-funded → off-chain inference → periodic on-chain settlement

**Cogni fit:** This is the current design. The question is whether the balance lives in a DB (`credit_ledger`) or on-chain (COGNI token). Both require off-chain metering by LiteLLM.

#### Approach 4: Streaming Payment Channel ("Pay As Tokens Stream")

```
1. Client opens payment channel with USDC deposit
2. As tokens stream (SSE), micro-payments flow through channel
3. Channel settles on close (response complete)
```

**Pro:** True pay-per-token. No over-authorization.
**Con:** No implementations exist. Requires bidirectional state channel infra. Lightning L402 is the closest but doesn't have token-granular billing.

**Cogni fit:** Theoretical only. Not viable for Phase 0-2.

### The Honest Assessment

The dynamic pricing problem is solvable on the INBOUND side (users/agents → Cogni nodes) using the `upto` scheme. But it does NOT solve the OUTBOUND side (Cogni nodes → Anthropic/OpenAI).

**Two distinct problems:**

| Direction                               | Problem                                  | x402 Status                                                                                                   |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Inbound** (user → Cogni node)         | User pays for dynamic-cost AI request    | **Solvable now** via `upto` (Thirdweb, production). Node streams response, settles actual cost in `onFinish`. |
| **Outbound** (Cogni node → AI provider) | Node pays Anthropic/OpenAI for inference | **Not solvable** — providers don't accept x402 or any crypto. Bridge still required.                          |

What x402 CAN do for Cogni today:

- **Inbound per-request billing:** Cogni nodes as x402 `upto` servers — agents/users pay per-request with dynamic settlement after generation. This REPLACES the credit-purchase-then-consume model for the user→node leg.
- **Inbound deposits:** x402 `exact` scheme for credit/token top-ups (replaces Coinbase Commerce for deposits)
- **Multi-turn sessions:** "Sign once, settle many" — one authorization covers a whole chat session

What x402 CANNOT do:

- **Outbound provider payments** — Anthropic, OpenAI, Google don't accept x402. The OpenRouter/Coinbase Commerce bridge is still needed on the provider side.
- **Eliminate off-chain metering** — LiteLLM must still track actual token usage and cost. x402 settlement uses LiteLLM's cost as the source of truth.

**Critical architectural implication:** The inbound and outbound legs are now asymmetric. Inbound can be x402 per-request (no pre-funded credits needed). Outbound is still pre-funded credit (OpenRouter top-ups). The node sits between these two models — collecting per-request from users via x402, paying pre-funded to providers via Coinbase Commerce.

### The Sovereignty Warning (BlueMatt, Feb 25 2026)

Worth noting: x402 is effectively Coinbase-controlled infrastructure. USDC is Coinbase's stablecoin. Base is Coinbase's L2. The facilitator is Coinbase's service. Lightning L402 (Lightning Labs, open-source tools released Feb 2026) is the truly permissionless alternative. For a DAO that values sovereignty, this matters — the "open" payment rail may not actually be open.

### Deployed Burn-on-Use Token Precedents

| Protocol                 | Token Model                                                                                           | Settlement                                   | Status                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| **Render**               | RENDER burned on job submit, providers paid from separate emission pool                               | 24-hour epochs                               | Live — 530K+ tokens burned Jan-Sep 2025  |
| **Akash (BME proposal)** | Burn AKT → mint ACT (USD-pegged compute credit), ACT burned at settlement, AKT re-minted to providers | Block-priced, batched withdrawal             | Proposed (AEP-76), not yet deployed      |
| **Venice**               | Stake VVV → mint DIEM, 1 DIEM = $1/day API credit, DIEM tradeable on Aerodrome                        | Off-chain metering against staked allocation | Live — 33M+ VVV burned (42.8% of supply) |

The Akash BME model is closest to what a COGNI token protocol would look like: burn a utility token to consume AI, re-mint to providers at settlement. The key difference is Cogni routes to external providers (OpenRouter/Anthropic) rather than operating its own compute.

---

## The Real Architectural Trilemma

Any AI project becoming a Cogni node faces three options:

### Option A: Depend on Cogni Operator for the bridge

```
AI Project (Node)
  └→ Users pay USDC → Node's DAO wallet
  └→ Node calls Cogni Operator API: "top up my OpenRouter"
  └→ Cogni Operator wallet → OpenRouter (via Coinbase Commerce)
  └→ Node uses OpenRouter API keys provisioned by Operator
```

**Pros:** Node is lightweight. No wallet custody, no Coinbase Commerce integration. Ship in days.
**Cons:** Cogni is in the monetary critical path. If Operator is down, nodes can't get AI. Violates WALLET_CUSTODY and DEPLOY_INDEPENDENCE invariants.

### Option B: Every node runs the full bridge (current spec)

```
AI Project (Node)
  └→ Users pay USDC → Split Contract
  └→ Split → Node's own Operator Wallet (Privy)
  └→ Node's wallet → OpenRouter (via Coinbase Commerce)
  └→ Node uses its own OpenRouter API key
```

**Pros:** Full sovereignty. Each node owns its entire financial loop.
**Cons:** Every node needs: Privy account + secrets, Split contract deployment, Coinbase Commerce transfer intent handling, outbound topups state machine, tx simulation + broadcast, OpenRouter charge creation API. That is a **massive** per-node deployment burden. Most AI projects won't do it.

### Option C: Protocol-level bridge via utility token

```
AI Project (Node)
  └→ Users deposit USDC → Protocol mints COGNI tokens
  └→ Node checks token balance, serves AI requests
  └→ Node reports usage (signed off-chain receipts)
  └→ Protocol treasury settles with OpenRouter in bulk
```

**Pros:** Nodes are lightweight. Bridge is shared infrastructure built once. Credits are portable across nodes. DAO margin enforced at protocol level.
**Cons:** Requires building and deploying the token protocol. Off-chain usage reporting needs a trust/dispute model.

---

## Industry Context

See "The Landscape Is Moving Fast" section above for the detailed market survey, x402 analysis, deployed token precedents, and the sovereignty warning about Coinbase-controlled payment rails.

---

## Analysis: Does a Utility Token Materially Simplify This?

### What DB Credits Currently Require (Per Node)

Every Cogni node today must run:

| Component                    | Purpose                    | Can it be shared?                             |
| ---------------------------- | -------------------------- | --------------------------------------------- |
| `billing_accounts` table     | Track who has credits      | No — per-node DB                              |
| `credit_ledger` table        | Mint/burn credits          | No — per-node DB                              |
| `charge_receipts` table      | Audit trail                | No — per-node DB                              |
| `payment_attempts` table     | Inbound USDC state machine | No — per-node DB                              |
| LiteLLM proxy                | Cost oracle + routing      | Could be shared, but per-node for sovereignty |
| Pricing logic (`pricing.ts`) | Markup calculation         | Shared code, per-node execution               |
| On-chain verifier            | Verify USDC transfers      | Shared code, per-node execution               |

Plus, if the node owns the OpenRouter bridge (Option B), add:
| `outbound_topups` table | OpenRouter top-up state machine | No — per-node DB |
| Operator wallet (Privy) | Sign outbound txs | No — per-node secrets |
| Coinbase Commerce integration | Transfer intent handling | Shared code, per-node execution |
| Split contract | DAO share distribution | Per-node on-chain deployment |

**That's 11 financial subsystems per node.** Most AI projects will look at this and walk away.

### What a Utility Token Protocol Would Replace

If COGNI is an ERC-20 on Base:

**On-chain (built once, shared by all nodes):**

| Component            | What It Does                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| COGNI token contract | ERC-20 on Base. Mint on USDC deposit, burn on usage settlement.                                                                     |
| Deposit contract     | User sends USDC → mints COGNI at rate that bakes in DAO margin. E.g., 1 USDC → 0.875 COGNI-worth of AI credits (DAO keeps 12.5%).   |
| Settlement contract  | Accepts signed usage reports from nodes → burns COGNI → releases USDC to provider treasury.                                         |
| Provider treasury    | Multi-sig or automated: aggregates USDC, tops up OpenRouter periodically (one Coinbase Commerce integration for the whole network). |

**Per-node (much lighter):**

| Component                | What It Does                                                                  |
| ------------------------ | ----------------------------------------------------------------------------- |
| Token balance check      | Read COGNI balance before serving request (one RPC call)                      |
| Off-chain usage tracking | Same as current `charge_receipts` — but against token balance, not DB balance |
| Signed usage reports     | Node signs usage attestations, submits to settlement contract periodically    |

**What disappears per-node:**

- `billing_accounts` table → replaced by token balance
- `credit_ledger` table → replaced by on-chain mint/burn events
- `payment_attempts` table → replaced by deposit contract events
- Operator wallet → moved to protocol level
- Coinbase Commerce integration → moved to protocol level
- Split contract → DAO margin baked into mint ratio
- Outbound topups state machine → replaced by bulk settlement

**Net: 11 subsystems → 3 per node.** The other 8 move to the protocol level where they're built once.

### The Hybrid Reality: On-Chain Deposits, Off-Chain Metering

You can't burn a token per AI request — gas costs would exceed the request cost. The practical model:

```
DEPOSIT (infrequent, on-chain):
  User sends USDC → Deposit contract mints COGNI tokens
  DAO margin taken at mint time (e.g., 1 USDC = 8,750,000 COGNI at 10M/USD with 12.5% margin)

USAGE (frequent, off-chain):
  Node reads user's COGNI balance (RPC or cached)
  Node serves AI request via LiteLLM
  Node records usage locally (same charge_receipts pattern)
  Node decrements local balance shadow (optimistic)

SETTLEMENT (periodic, on-chain):
  Node submits signed usage report: "user X consumed Y COGNI worth of AI"
  Settlement contract verifies signature, burns user's COGNI
  Released USDC accumulates in provider treasury
  Treasury tops up OpenRouter when threshold met

  Settlement frequency: daily, or when accumulated usage > $X
```

This is essentially **the same off-chain metering Cogni already does**, but with the credit balance living on-chain instead of in a per-node database. The critical difference: it's **portable and verifiable** across nodes.

---

## How an AI Project Becomes a Cogni Node

### With DB Credits (Current)

1. Fork the node-template repo
2. Deploy the full Next.js app + PostgreSQL + LiteLLM stack
3. Deploy DAO smart contracts (Aragon)
4. Set up Privy account for operator wallet
5. Deploy Split contract on Base
6. Configure OpenRouter account + Coinbase Commerce
7. Set up all env vars (PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_SIGNING_KEY, OPENROUTER_API_KEY, LITELLM_MASTER_KEY, etc.)
8. Run migrations for 6+ billing tables
9. Configure repo-spec.yaml with all addresses

**Time to first AI request paid with crypto: weeks.**

### With Token Protocol

1. Fork the node-template repo (lighter — no billing tables needed)
2. Deploy the Next.js app + LiteLLM stack (no PostgreSQL billing schema)
3. Deploy DAO smart contracts (Aragon) — or join existing COGNI protocol
4. Point node at the COGNI token contract address in repo-spec
5. Set up LiteLLM with provider API keys
6. Register node with settlement contract (node signs usage reports)

No Privy. No Split contract. No Coinbase Commerce. No outbound topups. No operator wallet.

**Time to first AI request paid with crypto: days.** The protocol handles the USDC→OpenRouter bridge.

---

## The Node vs Operator Contract: Revised

### Current Spec Says (node-operator-contract.md)

> "AI Inference Billing: Node-run inference: Node owns provider keys and pays directly."

This is aspirational but impractical today — "pays directly" implies the node has its own crypto→provider bridge, which is the heavyweight Option B.

### Proposed Revision

| Layer              | Responsibility                                                     | Owner                            |
| ------------------ | ------------------------------------------------------------------ | -------------------------------- |
| **Token protocol** | USDC deposits, COGNI minting, DAO margin, provider settlement      | Protocol (shared infrastructure) |
| **Node**           | AI request routing (LiteLLM), usage metering, signed usage reports | Node (sovereign)                 |
| **Operator**       | Node registry, git-review, git-admin, cred scoring                 | Operator (optional services)     |

**Key insight:** The token protocol is _neither_ node nor operator. It's **shared protocol infrastructure** — like Aragon is shared DAO infrastructure. No single node or operator controls it. This preserves sovereignty while solving the bridge problem.

The Operator's role becomes exactly what the current spec already describes — governance services, not financial intermediation:

- git-review-daemon (PR reviews)
- git-admin-daemon (repo actions)
- cognicred (contributor scoring)
- Node registry (federation)

The Operator never touches money. The protocol handles money. Nodes handle AI.

---

## What's the Minimum Viable Token Protocol?

Fighting over-engineering — here's the absolute minimum:

### Smart Contracts (Base mainnet)

1. **CogniCredit.sol** — ERC-20 token. Mint/burn authority restricted to Deposit and Settlement contracts.
2. **CogniDeposit.sol** — Accepts USDC, mints COGNI at configured rate (with DAO margin). Emits `Deposit(user, usdcAmount, cogniAmount)`.
3. **CogniSettlement.sol** — Accepts signed usage reports from registered nodes. Verifies signatures, burns user COGNI, transfers USDC from treasury to provider wallet. Emits `Settlement(node, user, cogniAmount, usdcAmount)`.

That's 3 contracts. No governance token, no staking, no slashing, no validator set. Just mint, meter, settle.

### Off-Chain (Per Node)

Same LiteLLM + charge_receipts pattern, but:

- Balance check reads from chain (with local cache + optimistic decrement)
- Usage reports are signed and submitted to settlement contract
- No inbound payment state machine needed (deposit contract handles it)
- No outbound payment state machine needed (settlement contract handles it)

### Provider Treasury

One multi-sig wallet that:

- Receives USDC from settlement contract
- Tops up OpenRouter when balance exceeds threshold
- This is the ONE place Coinbase Commerce integration lives (built once, not per-node)

### What Stays From Current Spec

| Keep                                           | Why                                                      |
| ---------------------------------------------- | -------------------------------------------------------- |
| `charge_receipts` pattern                      | Off-chain usage metering per node (same schema, lighter) |
| LiteLLM as cost oracle                         | Core routing + pricing value                             |
| `CREDIT_UNIT_STANDARD` (1 credit = $0.0000001) | Token denomination matches existing standard             |
| `calculateLlmUserCharge()`                     | Same billing math, used for usage reports                |
| `LITELLM_COST_ORACLE` invariant                | LiteLLM computes cost, node reports it                   |
| Preflight balance check                        | Now reads token balance instead of DB balance            |

### What Gets Deleted

| Delete                                      | Why                                        |
| ------------------------------------------- | ------------------------------------------ |
| `billing_accounts` table (balance tracking) | Token balance IS the balance               |
| `credit_ledger` table                       | On-chain mint/burn events ARE the ledger   |
| `payment_attempts` table                    | Deposit contract handles inbound           |
| `outbound_topups` table                     | Settlement contract handles outbound       |
| `operator-wallet.md` spec                   | No per-node operator wallet                |
| `web3-openrouter-payments.md` spec          | Bridge moves to protocol level             |
| Split contract per node                     | DAO margin in mint ratio                   |
| Privy integration per node                  | No per-node signing needed                 |
| Coinbase Commerce per node                  | One integration at protocol treasury level |

---

## Evolution Path: Phased Approach

### Phase 0 (Now): Ship with the current spec, but scoped correctly

The current billing DB approach works for the first node (Cogni itself). Don't block shipping on a token protocol. But:

- **Acknowledge** that the current outbound payment spec is for Cogni-the-first-node, not the node template
- **Don't pretend** every new node will replicate the full Privy + Coinbase Commerce + Splits stack
- **Isolate** the bridge code so it can be extracted later

### Phase 1: Token protocol design + first contract

- Design the 3-contract system (CogniCredit, CogniDeposit, CogniSettlement)
- Study Akash BME (AEP-76) and Render BME as reference architectures — they're closest to what COGNI needs
- Deploy on Base testnet
- Cogni's own node becomes the first settlement reporter
- Provider treasury tops up OpenRouter (same Coinbase Commerce flow, but centralized in one place)

### Phase 2: Second node onboards via token protocol

- New AI project forks node-template (lighter version — no billing DB)
- Registers as a settlement reporter
- Users deposit USDC → get COGNI → use AI on the new node
- Settlement flows through the shared protocol treasury

### Phase 3: Cogni nodes as x402 `upto` servers (inbound per-request billing)

The `upto` scheme is shipped (Thirdweb, production). This enables Cogni nodes to accept per-request payment from users/agents with dynamic pricing — the exact problem you raised.

**What this changes:**

- Users/agents NO LONGER need to pre-purchase credits to use a Cogni node
- Each AI request: agent authorizes max → node streams response → node settles actual cost via LiteLLM
- "Sign once, settle many" covers multi-turn chat sessions
- The credit-purchase-then-consume model becomes OPTIONAL (kept for users who prefer prepaid)

**What this does NOT change:**

- Outbound: node still pre-funds OpenRouter via Coinbase Commerce (providers don't accept x402)
- Metering: LiteLLM still tracks actual token usage and cost — this is the cost oracle for settlement
- The node still needs working capital to pay providers between collecting from users

**Concrete integration with current LiteLLM pipeline:**

```
INBOUND (x402 upto — NEW):
  1. Agent sends request to Cogni node
  2. Node responds 402 with maxPayableAmount:
     = (input_tokens * input_cost_per_token) + (max_tokens * output_cost_per_token)
     + (markup_factor)
     (All values from litellm-config.yaml + USER_PRICE_MARKUP_FACTOR)
  3. Agent signs upto authorization
  4. Node calls verifyPayment(), streams response via LiteLLM
  5. LiteLLM onFinish: actual cost = response_cost * markup_factor
  6. Node calls settlePayment(actual_cost)
  7. charge_receipt written with litellm_call_id as idempotency key (same pattern)

OUTBOUND (unchanged):
  Node's OpenRouter balance → topped up from collected USDC
  Periodic, not per-request (because providers don't accept x402)
```

**Decision point:** This is a REAL option now. The question is whether to build this for Phase 1 (alongside the token protocol) or Phase 3 (after token protocol stabilizes). The argument for earlier: x402 `upto` eliminates the need for the COGNI token on the inbound leg entirely. Users pay USDC directly per-request — no token purchase, no credit system, no on-chain deposits. The token protocol only matters for the outbound settlement leg (provider treasury) and cross-node portability.

### Phase 3b: When providers adopt x402 (outbound leg — speculative)

IF Anthropic/OpenAI adopt x402:

- Nodes pay providers directly per-request in USDC (HTTP 402 → payment → response)
- Protocol treasury becomes unnecessary
- Full sovereignty achieved: no intermediary at all
- But: this requires providers to accept x402 `upto` (not just `exact`)
- Timeline: unclear. No signals from Anthropic/OpenAI on x402 adoption.

### Sovereignty consideration

BlueMatt's warning (Feb 25 2026): x402 is Coinbase infrastructure (USDC + Base + facilitator). Lightning L402 is the truly permissionless alternative. A DAO protocol should consider supporting both rails:

- **x402** for ecosystem compatibility (Stripe, Visa, mainstream adoption)
- **L402** for sovereignty (permissionless, Bitcoin-native, no Coinbase dependency)

The deposit rail (Phase 3) should be pluggable — accept x402, L402, and direct USDC transfers.

---

## Risk Assessment: Token Protocol

| Risk                                                     | Severity | Mitigation                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smart contract bugs                                      | High     | Audit before mainnet. Start with capped deposits.                                                                                                                                                                                                                                                                                            |
| Off-chain usage report fraud                             | Medium   | Economic: nodes stake COGNI to report. Slash on dispute. (Add later, not MVP.)                                                                                                                                                                                                                                                               |
| Gas costs for settlement                                 | Low      | Batch settlements. Base L2 is cheap (~$0.001/tx).                                                                                                                                                                                                                                                                                            |
| Token regulatory classification                          | Medium   | Utility token (metering, not investment). No secondary market needed — COGNI is burned, not traded.                                                                                                                                                                                                                                          |
| x402 `upto` makes token protocol unnecessary for inbound | Medium   | `upto` is shipped (Thirdweb). Users can pay per-request in USDC — no COGNI token needed for the user→node leg. Token protocol's remaining value: outbound provider settlement + cross-node portability. If outbound is only one node (Cogni itself), the token adds complexity without proportionate benefit. Reassess token protocol scope. |
| Coinbase dependency via x402/Base/USDC                   | Medium   | BlueMatt's point: x402 is Coinbase-controlled. Support L402 (Lightning) as permissionless fallback. Design settlement contract to accept multiple payment proofs.                                                                                                                                                                            |
| Complexity of building contracts                         | Medium   | 3 simple contracts. No governance, staking, or AMM. Simpler than the current Privy + Splits + Coinbase Commerce stack.                                                                                                                                                                                                                       |
| OpenRouter changes crypto API                            | Medium   | Same risk exists today. Protocol treasury is a single point to update, vs updating every node.                                                                                                                                                                                                                                               |

---

## Recommendation

1. **Ship Phase 0** with current billing DB for Cogni's own node. Don't block on token protocol.
2. **Isolate the bridge** — the operator wallet + OpenRouter top-up code should live in a clearly separated module, not spread across the node template.
3. **Design the token protocol** as the answer to "how does a second node onboard?" — not as a theoretical future, but as the concrete next architecture milestone. Study Akash BME (AEP-76) and Render BME as the closest reference architectures.
4. **The token replaces the DB credit system**, not supplements it. 1 COGNI = 1 credit = $0.0000001. Same unit standard, on-chain instead of in-DB.
5. **Provider settlement is protocol-level**, not per-node. One Coinbase Commerce integration in the protocol treasury, not one per node.
6. **x402 `upto` is viable for inbound per-request billing NOW.** Thirdweb has this in production with an open-source AI inference reference impl. Cogni nodes as x402 `upto` servers means users/agents pay per-request with dynamic settlement — no pre-purchased credits needed. This potentially eliminates the COGNI token's role on the inbound leg. Evaluate whether to build this for Phase 1 instead of Phase 3.
7. **Off-chain metering (LiteLLM) remains the cost oracle regardless of payment rail.** Whether settlement is x402 `upto` per-request, COGNI token periodic, or pre-funded credits — LiteLLM calculates the actual cost post-completion. `charge_receipts` remain the audit trail. The metering layer is invariant; only the settlement layer changes.
8. **The inbound and outbound legs are now asymmetric.** Inbound can be x402 per-request (dynamic, no credits). Outbound is still pre-funded (OpenRouter doesn't accept x402). The node collects per-request from users and pays pre-funded to providers. This working capital gap is the remaining bridge problem.
9. **Support dual payment rails** for sovereignty: x402 (USDC/Base) for mainstream compatibility, L402 (Lightning) for permissionless fallback. Don't lock into Coinbase-controlled infrastructure as the only option.

The cleanest definition:

- **Protocol** = the crypto→AI payment bridge (token contracts + provider settlement)
- **Node** = sovereign AI service (LiteLLM routing + usage metering + DAO governance)
- **Operator** = optional platform services (git-review, cred scoring, node registry)

Each layer does one thing. No layer does another layer's job.

---

## Sources

### x402 Protocol

- [x402 Protocol — Coinbase Developer Docs](https://docs.cdp.coinbase.com/x402/welcome)
- [x402 Whitepaper](https://www.x402.org/x402-whitepaper.pdf)
- [x402 V2 Launch Announcement](https://www.x402.org/writing/x402-v2-launch)
- [x402 GitHub Repository](https://github.com/coinbase/x402)
- [x402 Escrow Scheme Proposal — PR #873](https://github.com/coinbase/x402/pull/873)
- [Stripe x402 on Base (2026)](https://crypto.news/stripe-taps-base-ai-agent-x402-payment-protocol-2026/)

### x402 `upto` Scheme & Dynamic Pricing (Thirdweb)

- [Thirdweb: Dynamic Pricing for x402 Resources](https://blog.thirdweb.com/changelog/dynamic-pricing-for-x402-resources/)
- [Thirdweb: Sign Once, Settle Many Times with x402](https://blog.thirdweb.com/changelog/sign-once-settle-many-times-with-x402/)
- [Thirdweb x402 AI Inference Example (open source)](https://github.com/thirdweb-example/x402-ai-inference)
- [Thirdweb x402 Server Docs](https://portal.thirdweb.com/x402/server)

### Cloudflare Deferred Scheme

- [Cloudflare: Launching the x402 Foundation](https://blog.cloudflare.com/x402/)
- [Cloudflare x402 Agents Docs](https://developers.cloudflare.com/agents/x402/)

### AI Payment Providers

- [Hyperbolic x402 Crypto Payments](https://www.hyperbolic.ai/blog/pay-for-gpu-and-ai-inference-models-with-crypto)
- [OpenRouter Crypto API](https://openrouter.ai/docs/guides/guides/crypto-api)

### Sovereignty & Alternatives

- [BlueMatt — Open Source AI Needs Serious Payments (Feb 25, 2026)](https://bluematt.bitcoin.ninja/2026/02/25/open-source-ai-needs-to-get-serious/)
- [Lightning Labs AI Agent Tools (Feb 2026)](https://lightning.engineering/posts/2026-02-11-ln-agent-tools/)

### Token Protocol Precedents

- [Akash BME Proposal (AEP-76)](https://akash.network/roadmap/aep-76/)
- [Render BME Documentation](https://know.rendernetwork.com/basics/burn-mint-equilibrium)
- [Venice AI — DIEM Token](https://venice.ai/blog/introducing-diem-as-tokenized-intelligence-the-next-evolution-of-vvv)
- [Bittensor Dynamic TAO](https://docs.learnbittensor.org/subnets/understanding-subnets)

### Market Context

- [CoinGecko — AI Agent Payment Infrastructure](https://www.coingecko.com/learn/ai-agent-payment-infrastructure-crypto-and-big-tech)
- [Chainalysis — AI and Crypto Convergence](https://www.chainalysis.com/blog/ai-and-crypto-agentic-payments/)
