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
    <header className="border-border bg-background border-b py-3">
      <a
        href="#main"
        className="focus:bg-background focus:text-foreground sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded focus:p-2"
      >
        Skip to main content
      </a>
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* Left side: Logo + Treasury */}
          <nav
            aria-label="Primary"
            className="flex min-w-0 items-center gap-3 sm:gap-4"
          >
            <Link
              href="/"
              aria-current="page"
              className="flex min-w-0 items-center gap-2 pl-4 sm:pl-0"
            >
              <UtensilsCrossed className="text-primary size-5 shrink-0" />
              <span className="hidden truncate text-xl font-bold md:inline">
                cogni<span className="text-primary">/resy</span>
              </span>
            </Link>

            <div className="flex">
              <TreasuryBadge />
            </div>
          </nav>

          {/* Right side: GitHub + Wallet + Theme */}
          <div className="flex shrink-0 items-center gap-3">
            <a
              href="https://github.com/cogni-dao"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Cogni on GitHub"
              className="text-muted-foreground hover:text-foreground hidden transition-colors lg:inline-flex"
            >
              <Github className="size-4" strokeWidth={1.5} aria-hidden="true" />
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
