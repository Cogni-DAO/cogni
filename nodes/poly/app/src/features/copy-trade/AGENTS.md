# copy-trade · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Copy-trade feature slice — the pure `decide()` function that, given a normalized Polymarket `Fill`, a per-target `TargetConfig`, and a `RuntimeState` snapshot, returns either `{action: "place", intent}` or `{action: "skip", reason}`. Plus the `clob-executor` (CP4.2) that takes an `OrderIntent` and actually places the order via an injected adapter seam. Pure + testable; all I/O belongs to the caller (poll job in P1, Temporal workflow in P4).

## Pointers

- [task.0315 — Phase 1 plan](../../../../../../work/items/task.0315.poly-copy-trade-prototype.md)
- [Root poly node AGENTS.md](../AGENTS.md)

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

## Public Surface

- **Exports (pure):** `decide()` — the stable-boundary decision function.
- **Exports (types):** `TargetConfig`, `RuntimeState`, `MirrorDecision`, `MirrorReason`, `DecideInput`.
- **Exports (executor, CP4.2):** `createClobExecutor(deps)`, `CopyTradeExecutorDeps`.

## Invariants

- **FAIL_CLOSED** — kill-switch disabled or unreadable → skip. Callers MUST NOT default to `enabled: true` on DB read failure.
- **INTENT_BASED_CAPS** — caps count against intent submissions, not partial fills. Revisit in P3 with paper-PnL data.
- **IDEMPOTENT_BY_CLIENT_ID** — repeat decisions with the same `(target_id, fill_id)` are silently dropped via `already_placed_ids`.
- **DECIDE_IS_PURE** — no I/O, no env reads, no clock reads; all runtime state handed in explicitly.
- **MIRROR_REASON_BOUNDED** — `MirrorReason` is an enum; used verbatim as a Prom label.

## Responsibilities

- Own the pure `decide()` function and its input/output types.
- Own the copy-trade-specific executor wrapper that adapts `MarketProviderPort.placeOrder` into a single `(intent) → receipt` function with structured logs + metrics (CP4.2).
- Stay pure — the caller (poll job, Temporal workflow) is responsible for reading DB state, reading the kill-switch, and writing fills/decisions rows.

## Notes

- **Not in this slice:** poll orchestration + DB reads/writes (CP4.3 in `bootstrap/jobs/copyTradeMirror.job.ts`); adapter construction + Privy wiring (CP4.4 in `bootstrap/capabilities/copy-trade.ts`); kill-switch UI (deferred to P2 — P1 flips via psql).
- **Caps are intent-based**, not fill-based. Revisit in P3 once paper-PnL data exists to tell us whether partial-fill drift materially breaks cap semantics.
