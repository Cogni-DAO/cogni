---
id: task.0322
type: task
title: "Poly copy-trade Phase 4 design prep — dual-path ingestion, hot signer, target ranker, counterfactual baseline"
status: needs_design
priority: 2
rank: 99
estimate: 5
created: 2026-04-18
updated: 2026-04-18
summary: "Before task.0315 Phase 4 (WS → Redis → Temporal streaming upgrade) is implemented, produce a design spike that raises the bar from 'functional realtime mirror' to 'adversarially-robust copy-trade system.' Current P4 plan uses Polymarket user WS as the sole ingestion path, Privy HSM for per-order signing, manual target selection, and has no counterfactual attribution. A serious copy-trade operator needs: (1) dual-path ingestion (user WS + on-chain USDC.e/CTF event logs + Data-API reconciliation), (2) hot signer co-located with dedicated Polygon RPC — Privy retained for custody, not per-order signing, (3) continuous target-ranker worker with decay-weighted PnL, (4) counterfactual baseline measurement in the paper-soak so P3 has a real GO/NO-GO gate, (5) adversarial sizing (randomized delays, mixed-size orders) since targets may know they are being copied. This is a DESIGN-only spike; no implementation lands until P3 evidence and this spec both land."
outcome: "A single PR that adds `docs/spec/poly-copy-trade-phase4.md` covering: (a) ingestion architecture with 3 paths + discrepancy alarms, (b) signer architecture with latency budget and key-rotation flow, (c) target-ranker spec (inputs, scoring function, rotation cadence, decay), (d) counterfactual baseline methodology for the P3 soak, (e) adversarial assumptions + mitigations, (f) kill-switch layered with drawdown-triggered auto-pause and on-chain allowance-revoke fallback. No code. The design must be concrete enough that the P4 implementation PR is mechanical."
spec_refs:
  - architecture
assignees: []
project: proj.poly-copy-trading
labels: [poly, polymarket, copy-trading, design, phase4, adversarial]
---

# task.0322 — Poly copy-trade Phase 4 design prep

> Prerequisite reading: [task.0315](./task.0315.poly-copy-trade-prototype.md) Phase 1→4 roadmap, [docs/research/poly-copy-trading-wallets.md](../../docs/research/poly-copy-trading-wallets.md)

## Why this task exists

task.0315's Phase 4 plan today is:

> "WS → Redis streams → Temporal trigger → existing `decide()`. Dual-run 48h; cutover gate = zero double-fires."

That is a **reliability** plan, not a **competitive** plan. It gets the prototype's polling upgraded to streaming. It does not get Cogni to the latency / signal-quality / adversarial-robustness required to actually profit from mirroring public wallets whose fills are observable to everyone.

Before a single line of P4 code is written, produce a design spec that defines the bar. This spike closes the gap between "it works" and "it's worth running."

## The five gaps vs a top 0.1% team

### 1. Ingestion path — single vs triple

Current P4: Polymarket user WebSocket per enabled target. One connection, one provider, one signal path.

Serious setup: **three co-equal paths, any one can trigger the mirror, discrepancies alarm within 5s.**

- Polymarket user WS (today's plan) — fastest when working, fails silently when not
- **On-chain event firehose:** subscribe to USDC.e `Transfer` + CTF `TransferSingle/Batch` logs on Polygon via a dedicated provider WS, filter for the 3 Polymarket exchange contracts as counterparty. Ground truth; lags by ~1 block (~2s) but never misses
- Polymarket Data-API polling at 30s as a third audit trail — fires discrepancy alarm if a fill shows up there but not in either live path

Design questions to answer:

- Which path is primary for mirror-fire? Voting scheme?
- How are dedupes keyed across paths? (`fill_id` shape is already frozen — does it hold up when on-chain logs produce a different native_id?)
- Failure modes: primary silently gapped vs. backup spurious — how does the system tell them apart?

### 2. Signer architecture

Current plan: every order is a round-trip to Privy's HSM for EIP-712 signing. P99 latency ~800ms. Fine for demo. **Fatal for size:** target fires → we see it in 2s → Privy sign in 800ms → RPC submit in 500ms = 3.3s worst case. By then the market has moved.

Serious setup:

- Privy retains **custody of the master key** (good — don't break that)
- **Hot signer** holds a short-lived delegated key (Privy's authorization-key model supports this cleanly — we already use it for per-wallet scoping)
- Signer is co-located with the submission path (same VM / same k8s node as the Polygon RPC)
- Key rotation every N hours via Privy API; blast radius per key = whatever the wallet holds

Design questions:

- What's the delegation scope? (Per-market? Per-size? Per-time?)
- Polygon RPC strategy — dedicated node, 3-of-n race, or a service like bloxroute?
- Rotation triggered by time, by volume, by both? Graceful key-swap without dropping in-flight orders?

### 3. Target ranker (continuous, not manual)

Current plan: operator adds a target via a dashboard "Copy" button. Target stays active until the operator removes it.

Serious setup: a separate worker that **continuously scores every tracked wallet** on a rolling window and auto-rotates the top-N into the active-targets list. Dropped targets have their positions wound down over a scheduled exit path.

Scoring inputs (preliminary):

- Rolling PnL (e.g. 30-day)
- Sharpe vs the index of all Polymarket traders
- Positive-selection rate vs counterfactual ("did they beat random?")
- Decay factor (recent > old)
- Volume — too-low excluded (signal too sparse), too-high excluded (slippage absorbs edge)

Design questions:

- What N? What rotation cadence?
- Exit path for dropped targets — hold positions to natural resolution? Market-sell?
- Interaction with the manual "operator picked this wallet" flow — additive or overridable?

### 4. Counterfactual attribution (P3 gate that actually gates)

Current plan: Phase 3 runs a 14-day paper soak, Phase 4 fires if the soak "showed edge."

What "showed edge" means is UNDEFINED in task.0315. This is the soft underbelly of the whole project: we could ship Phase 4 on a paper soak that merely had positive PnL during a bull market in prediction-market activity, which is not evidence of copy-trade edge.

Serious definition:

- **Baseline 1: no-trade** — did we make money? (Required but not sufficient)
- **Baseline 2: random-subset copy** — did copying these specific wallets beat copying a random subset of active wallets of similar volume?
- **Baseline 3: index** — did our picks beat the equal-weighted PnL of all actively-trading wallets above a minimum volume threshold?
- **Slippage accounting** — subtract observed slippage (our fill price vs target's fill price) and fees; the residual is the real edge
- **Statistical significance** — not "average PnL > 0" but "P(edge | observed PnL) > 0.9" via bootstrap

If we can't beat all three baselines at 90%+ confidence over 14 days, P4 does not ship. The spec must commit to this publicly so there's no post-hoc goalpost shifting.

### 5. Adversarial assumptions

Current plan: we assume targets are unaware / indifferent. This is wrong the moment we scale.

If a target wallet notices it's being copied, it can:

- Place fake orders, wait for us to mirror, cancel before fill → we're stuck with a position they don't have
- Trade inverse of their "public" signal using a separate wallet → we always take the losing side
- Submit many small orders quickly → our rate limits either drop some (we miss real trades) or overload us (we spam the CLOB and get banned)

Design mitigations:

- **Randomized delay** — 0–500ms before mirror fires. Kills the deterministic-copy tell.
- **Randomized rounding** — don't mirror exact size, round to nearest $X where X is wallet-specific or random. Kills size-signature tells.
- **Target deactivation on signal degradation** — if a target's selection rate drops below a threshold, auto-pause (automated bait detection)
- **Per-target rate limit** — mirror at most N fills per hour per target
- **Global kill switch on portfolio drawdown** — -5% on the day → stop. -10% on the week → stop + alert.

### Bonus: on-chain circuit breaker

Current kill switch is a DB row. Read on every tick. Fine for happy path. Fails if the DB is down or compromised.

Hardened version: a **one-tx on-chain revoke** the operator (or the kill-switch DB row) can trigger. Revokes all 3 USDC.e allowances to Polymarket exchanges atomically. Wallet physically cannot trade until re-approved. The paper trail is on-chain and cannot be faked.

## Deliverable

ONE file: `docs/spec/poly-copy-trade-phase4.md` (or similar).

Covers all five gaps above with concrete architecture diagrams, interface definitions, latency budgets, and — for each — a decision between the options raised in the "Design questions" sections. No implementation code. No prototype. Just the spec that P4 will build against.

Also produces: an updated kill/go recipe for the P3 soak that commits to the three baselines + significance threshold in writing before soak data is collected (prevents post-hoc rationalization).

## Out of scope

- Implementation of any of the above. This is design only.
- Changes to task.0315 Phase 1–3. Those continue on the current plan.
- Multi-operator scaling. Single-operator throughout P4; multi-operator is a separate follow-on project.

## Validation

Fixed when: a PR lands `docs/spec/poly-copy-trade-phase4.md` with all 5 gap sections + P3 soak-evaluation protocol, reviewed by Derek, and merged. The spec is short, opinionated, and every design question has a named choice + reason.

## Related

- [task.0315 Phase 1–4 plan](./task.0315.poly-copy-trade-prototype.md)
- [bug.0317](./bug.0317.candidate-flight-infra-hardcoded-main.md) — CI plumbing that will block P4 deploys if not fixed first
- [bug.0319](./bug.0319.ai-tools-per-node-packages.md) — future agent-facing copy-trade tools will hit the stub ceremony without this refactor
