// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/WalletIdentityHeader`
 * Purpose: Wallet identity row — category chip, optional "primary target" pill, name, full address, and external links.
 * Scope: Presentational only. Accepts pure props.
 * Invariants: Renders a "Wallet" placeholder name when identity.name absent. Address is required.
 * Side-effects: none
 * @public
 */

"use client";

import { CloudSun, ExternalLink } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Badge } from "@/components";
import type {
  WalletAnalysisSize,
  WalletIdentity,
} from "../types/wallet-analysis";

export type WalletIdentityHeaderProps = {
  address: string;
  identity: WalletIdentity;
  size?: WalletAnalysisSize | undefined;
  resolvedCount?: number | undefined;
  /** Inline actions rendered next to the Polymarket / Polygonscan links. */
  actions?: ReactNode | undefined;
};

export function WalletIdentityHeader({
  address,
  identity,
  size = "default",
  resolvedCount,
  actions,
}: WalletIdentityHeaderProps): ReactElement {
  const isHero = size === "hero";
  const titleCls = isHero
    ? "font-serif font-semibold text-4xl leading-tight tracking-tight md:text-5xl"
    : "font-serif font-semibold text-2xl leading-tight tracking-tight";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {identity.category && (
          <Badge intent="default" size="sm" className="gap-1">
            <CloudSun className="size-3" />
            {identity.category}
          </Badge>
        )}
        {identity.isPrimaryTarget && (
          <Badge
            intent="default"
            size="sm"
            className="gap-1 bg-success/15 text-success"
          >
            Primary mirror target
          </Badge>
        )}
        {typeof resolvedCount === "number" && (
          <span className="text-muted-foreground text-xs">
            n = {resolvedCount} resolved positions
          </span>
        )}
      </div>

      <h2 className={titleCls}>{identity.name ?? "Wallet"}</h2>

      <div className="flex flex-wrap items-center gap-3">
        <code className="font-mono text-muted-foreground text-xs">
          {address}
        </code>
        <a
          href={`https://polymarket.com/profile/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary text-xs underline-offset-2 hover:underline"
        >
          Polymarket <ExternalLink className="size-3" />
        </a>
        <a
          href={`https://polygonscan.com/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary text-xs underline-offset-2 hover:underline"
        >
          Polygonscan <ExternalLink className="size-3" />
        </a>
        {actions}
      </div>
    </div>
  );
}
