// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/layout/components/AppHeader`
 * Purpose: Application header for resy node — logo, treasury, GitHub, wallet, theme.
 * Scope: Public-page header. Node-specific branding (UtensilsCrossed icon + cogni/resy).
 * Invariants: No horizontal overflow; matches operator AppHeader layout pattern.
 * Side-effects: none
 * Links: docs/guides/new-node-styling.md
 * @public
 */

"use client";

import { Github, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";

import { ModeToggle } from "@/components";
import { WalletConnectButton } from "@/components/kit/auth/WalletConnectButton";
import { TreasuryBadge } from "@/features/treasury/components/TreasuryBadge";

export function AppHeader(): ReactElement {
  return (
    <header className="border-border border-b bg-background py-3">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* Left side: Logo + Treasury */}
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Link
              href="/"
              className="flex min-w-0 items-center gap-2 pl-4 sm:pl-0"
            >
              <UtensilsCrossed className="size-5 shrink-0 text-primary" />
              <span className="hidden truncate font-bold text-xl md:inline">
                cogni<span className="text-primary">/resy</span>
              </span>
            </Link>

            <div className="flex">
              <TreasuryBadge />
            </div>
          </div>

          {/* Right side: GitHub + Wallet + Theme */}
          <div className="flex shrink-0 items-center gap-3">
            <a
              href="https://github.com/cogni-dao"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden text-muted-foreground transition-colors hover:text-foreground lg:inline-flex"
            >
              <Github className="size-4" strokeWidth={1.5} />
            </a>

            <WalletConnectButton variant="compact" className="sm:hidden" />
            <div data-wallet-slot="desktop" className="hidden sm:flex">
              <WalletConnectButton variant="default" />
            </div>

            <ModeToggle className="hidden md:flex" />
          </div>
        </div>
      </div>
    </header>
  );
}
