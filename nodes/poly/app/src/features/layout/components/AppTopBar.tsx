// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/layout/components/AppTopBar`
 * Purpose: Top bar for authenticated app pages with sidebar trigger, treasury, socials, and user avatar menu.
 * Scope: Renders top bar within SidebarInset. Does not handle authentication or sidebar state.
 * Invariants: SidebarTrigger requires SidebarProvider ancestor; socials visible lg+ only; avatar menu replaces wallet slot when authenticated.
 * Side-effects: none
 * Links: src/components/vendor/shadcn/sidebar.tsx, src/features/layout/components/AppHeader.tsx
 * @public
 */

"use client";

import { Github } from "lucide-react";
import { useSession } from "next-auth/react";
import type { ReactElement } from "react";
import { SidebarTrigger } from "@/components";
import { WalletConnectButton } from "@/components/kit/auth/WalletConnectButton";
import { TreasuryBadge } from "@/features/treasury/components/TreasuryBadge";
import { UserAvatarMenu } from "./UserAvatarMenu";

export function AppTopBar(): ReactElement {
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";

  return (
    <header className="flex h-16 w-full shrink-0 items-center justify-between border-b px-3 md:px-6">
      <div className="flex items-center gap-3">
        <SidebarTrigger />
        <TreasuryBadge />
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <a
          href="https://github.com/cogni-dao"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden text-muted-foreground transition-colors hover:text-foreground lg:inline-flex"
        >
          <Github className="size-4" strokeWidth={1.5} />
        </a>

        {/* Auth slot: avatar menu when authenticated, wallet connect when not */}
        {isAuthenticated ? (
          <UserAvatarMenu />
        ) : (
          <>
            <WalletConnectButton variant="compact" className="sm:hidden" />
            <div data-wallet-slot="desktop" className="hidden sm:flex">
              <WalletConnectButton variant="default" />
            </div>
          </>
        )}
      </div>
    </header>
  );
}
