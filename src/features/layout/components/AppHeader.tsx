// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/layout/components/AppHeader`
 * Purpose: Application header composing kit components and feature-specific widgets.
 * Scope: App-shell layout component. Renders logo, nav, treasury, wallet, theme toggle, mobile menu. Does not handle routing or analytics.
 * Invariants: No horizontal overflow; min-w-0/truncate/shrink-0 guards; GitHub hidden <lg; theme hidden <md; treasury always visible.
 * Side-effects: none
 * Notes: Desktop wallet in [data-wallet-slot="desktop"] for CSS (see tailwind.css).
 *        Mobile: px-4 + logo pl-4; logo 24px, text-xl; MobileNav has GitHub + theme.
 *        Lives in features/layout as app-shell composition that knows about treasury, wallet, etc.
 * Links: src/components/kit/auth/WalletConnectButton.tsx, src/components/kit/navigation/MobileNav.tsx, src/styles/tailwind.css, docs/spec/onchain-readers.md
 * @public
 */

"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactElement } from "react";

import {
  GithubButton,
  MobileNav,
  ModeToggle,
  NavigationLink,
} from "@/components";
import { WalletConnectButton } from "@/components/kit/auth/WalletConnectButton";
import { TreasuryBadge } from "@/features/treasury/components/TreasuryBadge";

export function AppHeader(): ReactElement {
  return (
    <header className="border-border border-b bg-background py-3">
      {/* Container: matches max-w-7xl pattern from Credits page */}
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* Left side: Logo + Treasury */}
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Link
              className="flex min-w-0 items-center gap-2 pl-4 sm:pl-0"
              href="/"
            >
              <Image
                alt="Cogni Brain Logo"
                className="shrink-0"
                height={24}
                src="/TransparentBrainOnly.png"
                width={24}
              />
              <span className="hidden truncate font-bold text-gradient-accent text-xl md:inline">
                Cogni
              </span>
            </Link>

            {/* Treasury: visible on all screen sizes */}
            <div className="flex">
              <TreasuryBadge />
            </div>
          </div>

          {/* Nav + Action buttons grouped together on right */}
          <div className="flex shrink-0 items-center gap-4 sm:gap-6">
            {/* Desktop nav - hidden on mobile */}
            <nav
              aria-label="Primary"
              className="hidden items-center gap-4 md:flex"
            >
              <NavigationLink href="/chat">Chat</NavigationLink>
              <NavigationLink href="/work">Work</NavigationLink>
              <NavigationLink href="/activity">Activity</NavigationLink>
              <NavigationLink href="/gov">Gov</NavigationLink>
              <NavigationLink href="/credits">Credits</NavigationLink>
              <NavigationLink href="/sourcecred/">SourceCred</NavigationLink>
            </nav>

            {/* Action buttons - responsive */}
            <div className="flex shrink-0 items-center gap-1 sm:gap-3">
              {/* GitHub + Discord: only visible lg+ in header (mobile users access via Sheet) */}
              <div className="hidden items-center gap-2 lg:flex">
                <a
                  aria-label="Join our Discord"
                  className="inline-flex items-center text-foreground transition-colors hover:text-muted-foreground"
                  href="https://discord.gg/3b9sSyhZ4z"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <span className="sr-only">Join our Discord</span>
                  <svg
                    aria-hidden="true"
                    className="size-5"
                    fill="currentColor"
                    viewBox="0 0 127.14 96.36"
                  >
                    <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
                  </svg>
                </a>
                <GithubButton
                  animationDuration={10}
                  autoAnimate={true}
                  initialStars={0}
                  repo="cogni-template"
                  showGithubIcon={true}
                  showStarIcon={true}
                  size="lg"
                  targetStars={172900}
                  username="cogni-DAO"
                  variant="default"
                />
              </div>

              {/* Wallet: CSS-gated instances (compact on mobile, default on desktop) */}
              <WalletConnectButton className="sm:hidden" variant="compact" />
              <div className="hidden sm:flex" data-wallet-slot="desktop">
                <WalletConnectButton variant="default" />
              </div>

              {/* Theme toggle: hidden on mobile (in Sheet footer), visible on desktop */}
              <ModeToggle className="hidden md:flex" />

              {/* Mobile menu trigger - 44px touch target */}
              <MobileNav className="md:hidden" />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
