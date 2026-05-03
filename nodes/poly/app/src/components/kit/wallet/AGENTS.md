# kit/wallet · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Shared presentational primitives for wallet-facing surfaces (dashboard operator card, Money page trading-wallet panel, profile page): address display/copy helpers and reusable wallet interaction flows. Pure UI. No fetching, no source-wallet ownership, no chain-specific business logic.

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
  - `WithdrawalFlowDialog` — generic two-step pasted-destination withdrawal flow. Callers supply asset metadata, submit callback, and explorer URL formatting.

## Conventions

- Default explorer base URL is Polygonscan, matching this node's primary trading chain. Callers pass an override for other chains.
- `CopyAddressButton` uses `navigator.clipboard.writeText` and a 1.5s success pulse; no toast coupling.
- Nothing in this directory owns state beyond the local "copied" flash.

## Responsibilities

- **Does:** render wallet addresses in short form; copy them on click; link to block explorers; expose tiny compositional APIs so wallet-facing panels don't each reinvent address or withdrawal mechanics.
- **Does not:** fetch balances, resolve ENS, choose chain contracts, own source-wallet lookup, own toasts, or own global UI state.

## Notes

- Promoted from `nodes/poly/app/src/app/(app)/dashboard/_components/` during task.0353 so the Money page's `TradingWalletPanel` and the dashboard's `OperatorWalletCard` share one implementation. Future wallet-facing UIs should consume from here rather than re-adding inline copy buttons.
