// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/wallet`
 * Purpose: Re-exports the PrivyPolyTraderWalletAdapter class for bootstrap wiring.
 * Scope: Adapter class re-export only. Does not construct instances or read env.
 * Invariants: none (barrel file).
 * Side-effects: none
 * Links: docs/spec/poly-tenant-and-collateral.md
 * @internal
 */

export type { PrivyPolyTraderWalletAdapterConfig } from "./privy-poly-trader-wallet.adapter";
export { PrivyPolyTraderWalletAdapter } from "./privy-poly-trader-wallet.adapter";
