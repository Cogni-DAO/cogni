// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/wallet/formatShortWallet`
 * Purpose: Short-form wallet address formatter (0x1234…abcd).
 * Scope: Pure string → string helper. No I/O. No business logic.
 * Invariants: No side effects. Stable outputs for given inputs.
 * Side-effects: none
 * @public
 */

export function formatShortWallet(wallet: string): string {
  if (wallet.length < 10) return wallet;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}
