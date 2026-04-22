# credits · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derek @core-dev
- **Status:** draft

## Purpose

Protected Money page (served from the `/credits` route — URL is stable; the page is relabelled, not renamed). Composes two panels:

- `AiCreditsPanel` — AI credits balance + USDC top-up flow (unchanged behaviour from the single-column credits page).
- `TradingWalletPanel` — per-tenant Polymarket trading-wallet balances (USDC.e + POL) driven by `/api/v1/poly/wallet/status` + `/api/v1/poly/wallet/balances`; fund + withdraw are stubbed buttons linked to [task.0352](../../../../../../work/items/task.0352.poly-trading-wallet-fund-flow.md) and [task.0351](../../../../../../work/items/task.0351.poly-trading-wallet-withdrawal.md).

Desktop renders both panels as a two-column grid; mobile uses a **Credits** / **Wallet** pill toggle above a single-column stack.

## Pointers

- [Root AGENTS.md](../../../AGENTS.md)
- [App AGENTS.md](../../AGENTS.md)
- [Repo-spec helper](../../../shared/config/repoSpec.server.ts)
- [Credits page client](./CreditsPage.client.tsx)

## Boundaries

```json
{
  "layer": "app",
  "may_import": [
    "app",
    "features",
    "ports",
    "shared",
    "contracts",
    "styles",
    "components"
  ],
  "must_not_import": ["adapters/server", "adapters/worker", "core"]
}
```

## Public Surface

- **Exports:** none
- **Route:** `/credits` (server page + client composition; label in nav is "Money", Lucide `Coins` icon)
- **Files considered API:** `page.tsx`, `CreditsPage.client.tsx`, `AiCreditsPanel.tsx`, `TradingWalletPanel.tsx`

## Responsibilities

- **Does:** Fetch widget config server-side via `@/shared/config` (repo-spec), render the Money page shell, compose `AiCreditsPanel` (payments) + `TradingWalletPanel` (poly wallet) as a responsive two-column grid with a mobile toggle.
- **Does not:** Read env vars or repo-spec on the client; hardcode wallets or chain IDs; perform trading-wallet withdrawal or fund writes (those land via task.0351 / task.0352).

## Usage

- Server page calls `getPaymentConfig()` and passes props to `CreditsPageClient`.
- Client component renders payment UI with provided chainId/receivingAddress and calls confirm endpoint on success.

## Standards

- Payment configuration must come from repo-spec via `getPaymentConfig()`; no env overrides or client-side file reads.

## Dependencies

- **Internal:** `@/shared/config`, `@/components/vendor/depay`, `@tanstack/react-query`, `@/components/kit/wallet` (AddressChip).
- **External:** none

## Change Protocol

- Update this file when route shape or config source changes.
- Keep widget config sourced from repo-spec; adjust boundaries if imports change.

## Notes

- Changing wallet/chain/provider requires editing `.cogni/repo-spec.yaml` and redeploying; no env overrides.
- Client code must treat widget configuration as props only.
