// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/wallet/CopyAddressButton`
 * Purpose: Tiny copy-to-clipboard button for a wallet address with brief success pulse.
 * Scope: Presentational client component. No network IO, no state beyond local "copied" flash.
 * Invariants: No side effects beyond `navigator.clipboard.writeText`.
 * Side-effects: Clipboard write on user click.
 * @public
 */

"use client";

import { Check, Copy } from "lucide-react";
import { type ReactElement, useState } from "react";

export interface CopyAddressButtonProps {
  address: string;
  /** Extra Tailwind classes merged after the default styling. */
  className?: string;
  /** Aria label override; defaults to "Copy wallet address". */
  label?: string;
}

export function CopyAddressButton({
  address,
  className,
  label = "Copy wallet address",
}: CopyAddressButtonProps): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(address).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={
        "inline-flex items-center rounded px-1 py-0.5 text-muted-foreground hover:text-foreground" +
        (className ? ` ${className}` : "")
      }
    >
      {copied ? (
        <Check className="size-3 text-success" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  );
}
