---
id: proj.financial-ledger.handoff
type: handoff
work_item_id: proj.financial-ledger
status: active
created: 2026-03-02
updated: 2026-03-02
branch: design/financial-ledger
last_commit: 6adf31ca
---

# Handoff: Financial Ledger + Governance Claims Rail Design

## Context

- We're building infrastructure for an AI-run DAO. The Attribution Ledger (P0 complete) answers "who did what." This design branch answers "how do contributors claim ownership?" and "where does the money go?"
- **Critical insight:** There is no revenue yet. USDC payouts are premature. The immediate value is turning attribution into enforceable governance rights (ownership/voting tokens), not cash.
- This branch consolidates x402 research, financial ledger design, and data ingestion strategy into a coherent architecture. It aligns ~10 existing specs/projects to five strategic decisions: (1) Singer taps for ingestion, (2) Beancount as financial ledger, (3) MerkleDistributor for on-chain claims, (4) domain-agnostic event archive, (5) attribution ≠ financial events.
- The governance claims rail (attribution statement → Merkle tree → ERC20Votes token claims) is now scoped as P1 of `proj.transparent-credit-payouts`. USDC settlement deferred to P2.

## Current State

- **Done:** All design docs committed on `design/financial-ledger` branch (6 commits ahead of staging). No code changes — docs only.
- **New specs created:** `docs/spec/financial-ledger.md` (stub — Beancount + MerkleDistributor + Operator Port invariants), `docs/spec/data-ingestion-pipelines.md` (stub — Singer taps via Temporal, domain-agnostic archive)
- **Rewritten:** `work/projects/proj.financial-ledger.md` — Beancount replaces Postgres treasury tables, MerkleDistributor replaces Splits, shared event archive replaces "three-domain ingestion"
- **Updated:** `proj.transparent-credit-payouts.md` P1 now includes governance claims rail (6 new deliverables + two-view UI), `attribution-ledger.md` has accounting boundary + Singer forward note + shared archive note, `billing-evolution.md` has forward path to x402
- **Dropped:** `proj.dao-dividends` (Splits-based push distribution superseded by MerkleDistributor)
- **Not changed (intentionally):** `proj.ai-operator-wallet`, `operator-wallet.md`, `web3-openrouter-payments.md`, `payments-design.md` — all valid as-built docs, not superseded
- **x402 docs consolidated:** `x402-e2e.md`, `node-operator-x402.md`, `gateway-billing-analysis.md`, `proj.x402-e2e-migration.md` all on this branch (extracted from stash + remote branch in prior session)

## Decisions Made

- Attribution is governance truth, not financial truth — [accounting boundary in attribution-ledger.md](../docs/spec/attribution-ledger.md#accounting-boundary)
- Beancount canonical, Rotki enrichment only — [financial-ledger spec invariants](../../docs/spec/financial-ledger.md#core-invariants)
- MerkleDistributor (Uniswap pattern) for claims, not Splits — [proj.financial-ledger.md](../projects/proj.financial-ledger.md#constraints)
- `ingestion_receipts` has NO domain column — each pipeline selects independently — [attribution-ledger.md ingestion_receipts section](../../docs/spec/attribution-ledger.md)
- Singer taps for new data sources, V0 TS adapters coexist — [data-ingestion-pipelines spec](../../docs/spec/data-ingestion-pipelines.md)
- Operator Port = signing + policy boundary (Safe/multisig for P1), NOT custodial wallet — [financial-ledger spec](../../docs/spec/financial-ledger.md#core-invariants)
- Governance token claims (P1) before USDC settlement (P2) — [proj.transparent-credit-payouts P1](../projects/proj.transparent-credit-payouts.md#walk-p1--governance-claims-rail--work-item-scoring--ui)

## Next Actions

- [ ] Merge `design/financial-ledger` branch to staging (PR review needed — docs only, no code)
- [ ] Implement `computeMerkleTree(statement)` pure function in `packages/attribution-ledger/` — golden-test it
- [ ] Research + select ERC20Votes Merkle claim contract (Uniswap MerkleDistributor or derivative)
- [ ] Deploy claim contract on Base Sepolia for testing
- [ ] Build Operator Port P1: Safe/multisig that publishes Merkle roots + signs statements
- [ ] Build claim flow UI: connect wallet → see unclaimed epochs → submit claim tx
- [ ] Build two-view UI: attribution view (DB-sourced) + holdings view (on-chain governance tokens)
- [ ] Create task work items for P1 governance claims rail deliverables (6 items in proj.transparent-credit-payouts P1 table)

## Risks / Gotchas

- **ERC20Votes contract selection:** Uniswap MerkleDistributor transfers existing tokens. We need one that _mints_ governance tokens on claim. May need a thin wrapper or a different contract (e.g., OpenZeppelin Governor-compatible). Research spike needed.
- **Operator Port scope creep:** P1 is Safe/multisig (manual). Don't build automation, key management, or CDP wallet integration yet. That's future Operator Port evolution.
- **Two stub specs are intentionally thin:** `financial-ledger.md` and `data-ingestion-pipelines.md` have invariants + goal + non-goals only. Flesh out Design sections when implementation begins, not before.
- **x402 is a parallel track:** The x402 docs are consolidated here for reference but x402 implementation is a separate project (`proj.x402-e2e-migration`). Don't mix the two workstreams.
- **This branch has NO code changes.** All 6 commits are docs/specs/projects. The worktree is at `.claude/worktrees/financial-ledger-design/`.

## Pointers

| File / Resource                                    | Why it matters                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `docs/spec/financial-ledger.md`                    | New stub spec — Beancount + MerkleDistributor + Operator Port invariants |
| `docs/spec/data-ingestion-pipelines.md`            | New stub spec — Singer taps, domain-agnostic archive                     |
| `work/projects/proj.financial-ledger.md`           | Rewritten project — Crawl/Walk/Run with Beancount + MerkleDistributor    |
| `work/projects/proj.transparent-credit-payouts.md` | P1 governance claims rail — the next implementation target               |
| `docs/spec/attribution-ledger.md`                  | Core attribution spec — accounting boundary, shared archive note added   |
| `docs/spec/x402-e2e.md`                            | x402 per-request settlement spec (parallel track, not immediate)         |
| `docs/research/gateway-billing-analysis.md`        | 620-line x402 market research — Hyperbolic, Thirdweb, protocol analysis  |
| `packages/attribution-ledger/src/`                 | Pure domain logic — `computeMerkleTree()` will live here                 |
| `packages/attribution-ledger/src/signing.ts`       | EIP-712 signing — pattern for Merkle root signing                        |
