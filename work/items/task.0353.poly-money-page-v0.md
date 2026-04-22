---
id: task.0353
type: task
title: "Poly Money page v0 — hybrid AI credits + trading wallet panel"
status: done
priority: 2
rank: 22
estimate: 2
created: 2026-04-22
updated: 2026-04-22
summary: "Relabel the `/credits` route to 'Money' (Lucide Coins icon, no emoji) and convert it to a two-panel hybrid page: the existing AI Credits balance / USDC top-up on one side, a new Trading Wallet panel (per-tenant Privy wallet: funder address + USDC.e + POL, with copy + Polygonscan link) on the other. Desktop: 2-column grid. Mobile: simple tab toggle. Fund + withdraw buttons are stubbed to task.0352 / task.0351."
outcome: "A signed-in poly-node user can visit `/credits`, see their AI credits balance and their per-tenant trading wallet address + USDC.e + POL balances side-by-side, copy the trading-wallet address, open it in Polygonscan, and read the v0 'copy your address to fund' hint. Loki logs show the calling user's `poly.wallet.balances` request at the deployed SHA."
spec_refs:
  - docs/spec/poly-trader-wallet-port.md
  - packages/node-contracts/src/poly.wallet.balances.v1.contract.ts
assignees: []
credit:
project: proj.poly-copy-trading
branch: feat/poly-money-page-v0
pr: https://github.com/Cogni-DAO/node-template/pull/988
reviewer:
revision: 0
blocked_by:
labels: [poly, wallet, credits, ui]
---

# task.0353 — Poly Money page v0

## Problem

PR #968 landed per-tenant Privy trading-wallet provisioning but surfaced the wallet only on the `/profile` page. Today there's no one place for a user to see "my money on this node" — AI credits live at `/credits`, the trading-wallet address lives at `/profile`, on-chain balances aren't surfaced anywhere, and funding instructions are verbal. For the single-user / new-tenant flow post-968, users need a single Money page that shows both.

## Scope

In:

- Add read-only `PolyTraderWalletPort.getBalances(billingAccountId)` returning `{ address, usdcE, pol, errors[] }` (null when no active connection). Implement on `PrivyPolyTraderWalletAdapter` with a local viem-backed Polygon RPC read; partial-failure-tolerant. Bootstrap passes `POLYGON_RPC_URL` through.
- Add `poly.wallet.balances.v1` contract + `GET /api/v1/poly/wallet/balances` route (plural, distinct from the operator-only `/balance`). Session auth; emits `poly.wallet.balances` log line with `billing_account_id`, `funder_address`, `usdc_e`, `pol`, `error_count`.
- Promote `CopyAddressButton` + `formatShortWallet` from `dashboard/_components/` into `components/kit/wallet/` and add an `AddressChip` composite (explorer link + short form + copy). Migrate `OperatorWalletCard` to consume it.
- Split `CreditsPage.client.tsx` into `AiCreditsPanel.tsx` (existing UI, verbatim) + `TradingWalletPanel.tsx` (new) and compose via a Tailwind `grid md:grid-cols-2` shell + a two-button mobile toggle. Fund + withdraw buttons stubbed, tagged to task.0352 / task.0351.
- Relabel nav to "Money" in `node-config.ts` + `footer-items.tsx`; use Lucide `Coins` icon (monochrome rail). **URL stays `/credits`**.
- AGENTS.md updates: `packages/poly-wallet` (new port method), `nodes/poly/app/src/app/api` (new route), `nodes/poly/app/src/app/(app)/credits` (hybrid page purpose), new `components/kit/wallet/AGENTS.md`.

Out:

- Fund-flow write path (covered by task.0352 — requires Polygon in wagmi + repo-spec).
- Withdraw write path (covered by task.0351).
- Grafana dashboard changes.
- Operator-extras consolidation (the adapter's `readPolygonBalances` is a local duplicate of `operator-extras.ts`; consolidation is a drive-by noted but deferred).

## Validation

- **exercise:** on candidate-a after flight, sign in with the Next-Auth test identity → visit `/credits` → confirm the nav label reads "Money" (Coins icon) and the page renders two panels. Click the copy icon in the Trading Wallet card → address is copied. Click the short-form address → Polygonscan opens on the matching wallet. Resize viewport below `md` → mobile tab toggle appears; clicking it swaps which panel is visible. Call `curl -H "Cookie: <next-auth session>" https://candidate-a.cogni-template.{host}/api/v1/poly/wallet/balances` → 200 with `{ configured: true, connected: <bool>, address, usdc_e, pol, errors: [] }` matching on-chain state for the session's billing account.
- **observability:** `{job="poly-node-app",sha="<candidate-a-sha>"} |= "poly.wallet.balances"` at the deployed SHA returns the request issued during the exercise, with `billing_account_id` + `funder_address` + `usdc_e` + `pol` fields populated; `error_count == 0` for a healthy RPC; partial failures surface as `error_count > 0` while the route still returns 200.

## Out of Scope

Fund flow, withdraw flow, Base↔Polygon bridging, operator-extras consolidation, Grafana dashboards.

## Notes

- Route name is **relabel only**. URL stays `/credits` to avoid breaking footer/nav links and external shares.
- `getBalances` is deliberately a port method (not a feature-layer helper) so the adapter stays the sole owner of "how do I read this tenant's trading wallet" — same pattern as `resolve` / `getAddress`.
