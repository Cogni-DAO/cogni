# copy-trade · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Thin copy-trade coordinator — the pure `decide()` policy that, given a normalized Polymarket `Fill`, a per-target `TargetConfig`, and a `RuntimeState` snapshot, returns either `{action: "place", intent}` or `{action: "skip", reason}`; plus the `mirror-coordinator` (CP4.3) that glues `features/wallet-watch/` → `decide` → `features/trading/`. **This is the only slice with copy-trade-specific vocabulary** — placement primitives + order ledger live in `features/trading/`, Polymarket wallet observation lives in `features/wallet-watch/`.

## Pointers

- [task.0315 — Phase 1 plan](../../../../../../work/items/task.0315.poly-copy-trade-prototype.md)
- [Phase 1 spec](../../../../../../docs/spec/poly-copy-trade-phase1.md)
- [Root poly node AGENTS.md](../AGENTS.md)
- Sibling layers: [../trading/AGENTS.md](../trading/AGENTS.md), [../wallet-watch/AGENTS.md](../wallet-watch/AGENTS.md)

## Boundaries

```json
{
  "layer": "features",
  "may_import": ["features", "ports", "core", "shared", "types"],
  "must_not_import": [
    "app",
    "adapters/server",
    "adapters/worker",
    "bootstrap",
    "contracts"
  ]
}
```

`copy-trade/` may import from sibling `features/trading/` and `features/wallet-watch/`. It is the ONLY slice that crosses both.

## Public Surface

- **Exports (pure):** `decide()` — the stable-boundary decision function.
- **Exports (types):** `TargetConfig`, `RuntimeState`, `MirrorDecision`, `MirrorReason`, `DecideInput`.
- **Exports (coordinator, CP4.3):** `mirror-coordinator.runOnce(deps)` — pure orchestration of wallet-watch → decide → trading.

## Invariants

- **COPY_TRADE_ONLY_COORDINATES** — files in this slice MAY import `features/trading/` and `features/wallet-watch/`. They MUST NOT import each other's internals except through the public barrel.
- **FAIL_CLOSED** — kill-switch disabled or unreadable → skip. Callers MUST NOT default to `enabled: true` on DB read failure.
- **INTENT_BASED_CAPS** — caps count against intent submissions, not partial fills. Revisit in P3 with paper-PnL data.
- **IDEMPOTENT_BY_CLIENT_ID** — repeat decisions with the same `(target_id, fill_id)` are silently dropped via `already_placed_ids`.
- **DECIDE_IS_PURE** — no I/O, no env reads, no clock reads; all runtime state handed in explicitly.
- **MIRROR_REASON_BOUNDED** — `MirrorReason` is an enum; used verbatim as a Prom label.

## Responsibilities

- Own the pure `decide()` function and its input/output types.
- Own the `mirror-coordinator` that wires observation → policy → placement.
- Stay thin — placement mechanics (executor, order-ledger) live in `features/trading/`; observation (Data-API, activity-poll) lives in `features/wallet-watch/`.

## Notes

- **Not in this slice:** CLOB executor (moved to `features/trading/clob-executor.ts` in CP4.3b); order-ledger I/O (in `features/trading/order-ledger.ts`); scheduler tick + bootstrap wiring (in `bootstrap/jobs/copy-trade-mirror.job.ts`, CP4.3e); adapter construction + Privy wiring (`bootstrap/capabilities/poly-trade.ts`); kill-switch UI (deferred to P2 — P1 flips via psql).
