// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/wallet/AddressChip`
 * Purpose: Compact "0x1234…abcd + copy + explorer link" chip reused by the dashboard Operator card and the Money page Trading Wallet panel.
 * Scope: Presentational. Takes an address + optional explorer base URL; the short-form rendering and copy button are composed internally.
 * Invariants: No I/O beyond clipboard on copy. Does not fetch or validate the address.
 * Side-effects: Clipboard write on copy click.
 * @public
 */

"use client";

import type { ReactElement } from "react";
import { CopyAddressButton } from "./CopyAddressButton";
import { formatShortWallet } from "./formatShortWallet";

export interface AddressChipProps {
  address: string;
  /**
   * Explorer base URL without trailing slash. Default is Polygonscan — the
   * only chain this chip currently renders for. Pass a different base URL
   * (e.g. basescan.org) when reusing for other chains.
   */
  explorerBaseUrl?: string;
  className?: string;
}

export function AddressChip({
  address,
  explorerBaseUrl = "https://polygonscan.com",
  className,
}: AddressChipProps): ReactElement {
  return (
    <span
      className={
        "inline-flex items-center gap-1 font-mono text-muted-foreground" +
        (className ? ` ${className}` : "")
      }
    >
      <a
        href={`${explorerBaseUrl}/address/${address}`}
        target="_blank"
        rel="noreferrer noopener"
        className="hover:text-foreground"
      >
        {formatShortWallet(address)}
      </a>
      <CopyAddressButton address={address} />
    </span>
  );
}
