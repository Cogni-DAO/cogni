// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/wallet`
 * Purpose: Shared presentational primitives for rendering wallet addresses — short-form formatting, copy button, and the explorer-link + copy chip composite.
 * Scope: Barrel re-exports only. Runtime lives in sibling files.
 * Invariants: No I/O beyond clipboard on copy click.
 * Side-effects: none
 * @public
 */

export { AddressChip, type AddressChipProps } from "./AddressChip";
export {
  CopyAddressButton,
  type CopyAddressButtonProps,
} from "./CopyAddressButton";
export { formatShortWallet } from "./formatShortWallet";
