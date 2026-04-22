# kit/wallet · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Shared presentational primitives for rendering wallet addresses across wallet-facing surfaces (dashboard operator card, Money page trading-wallet panel, profile page). Pure UI. No fetching, no address validation beyond render-time trimming.

## Pointers

- [Root AGENTS.md](../../../../../../AGENTS.md)
- [Architecture](../../../../../../docs/spec/architecture.md)

## Boundaries

```json
{
  "layer": "components",
  "may_import": ["shared", "types"],
  "must_not_import": [
    "app",
    "features",
    "core",
    "ports",
    "adapters",
    "bootstrap"
  ]
}
```

## Public Surface

- **Exports:**
  - `AddressChip` — short-form address + copy + explorer link.
  - `CopyAddressButton` — standalone copy-to-clipboard button.
  - `formatShortWallet(addr)` — 0x1234…abcd helper.

## Conventions

- Default explorer base URL is Polygonscan, matching this node's primary trading chain. Callers pass an override for other chains.
- `CopyAddressButton` uses `navigator.clipboard.writeText` and a 1.5s success pulse; no toast coupling.
- Nothing in this directory owns state beyond the local "copied" flash.

## Responsibilities

- **Does:** render a wallet address in short form; copy it on click; link to a block explorer; expose a tiny compositional API so wallet-facing panels (dashboard, money page, profile) don't each reinvent the trio.
- **Does not:** fetch balances, resolve ENS, validate addresses beyond the render-time trim, own toasts or global UI state.

## Notes

- Promoted from `nodes/poly/app/src/app/(app)/dashboard/_components/` during task.0353 so the Money page's `TradingWalletPanel` and the dashboard's `OperatorWalletCard` share one implementation. Future wallet-facing UIs should consume from here rather than re-adding inline copy buttons.
