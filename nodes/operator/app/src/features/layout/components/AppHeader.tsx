// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/layout/components/AppHeader`
 * Purpose: Application header composing kit components and feature-specific widgets.
 * Scope: Public-page header. Renders logo, treasury, socials, wallet, theme toggle. Nav links removed — signed-in users use the sidebar. Does not handle routing or analytics.
 * Invariants: No horizontal overflow; min-w-0/truncate/shrink-0 guards; GitHub hidden <lg; theme hidden <md; treasury always visible.
 * Side-effects: none
 * Notes: Desktop wallet in [data-wallet-slot="desktop"] for CSS (see tailwind.css).
 *        Lives in features/layout as app-shell composition that knows about treasury, wallet, etc.
 * Links: src/components/kit/auth/WalletConnectButton.tsx, src/styles/tailwind.css, docs/spec/onchain-readers.md
 * @public
 */

"use client";

import { Github } from "lucide-react";
import Image from "next/image";
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
              <Image
                src="/TransparentBrainOnly.png"
                alt="Cogni"
                width={24}
                height={24}
                className="shrink-0"
              />
              <span className="hidden truncate font-bold text-gradient-accent text-xl md:inline">
                Cogni
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
