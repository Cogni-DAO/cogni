// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/auth/WalletConnectButton`
 * Purpose: Custom wallet connect button matching treasury badge design with hydration stability.
 * Scope: Client-side only. Used in header. Does not handle wallet selection UI or persistence.
 * Invariants: Treasury badge styling; min-width prevents CLS; ready/connected gates per RainbowKit docs.
 * Side-effects: none
 * Notes: Uses ConnectButton.Custom for full styling control. No wagmi hooks (state from render props only).
 *        ready = mounted && authenticationStatus !== 'loading'
 *        connected = ready && account && chain && (!authenticationStatus || authenticationStatus === 'authenticated')
 * Links: docs/spec/authentication.md, https://rainbowkit.com/docs/custom-connect-button
 * @public
 */

"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import type React from "react";

import { cn } from "@/shared/util";

interface WalletConnectButtonProps {
  /**
   * Optional className for layout adjustments
   */
  readonly className?: string;
  /**
   * Visual variant: 'compact' for mobile, 'default' for desktop.
   * Both use treasury badge styling; variant controls width only.
   */
  readonly variant?: "default" | "compact";
}

/**
 * Base treasury badge styling - matches TreasuryBadge.tsx
 */
const BASE_BADGE_CLASSES =
  "flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-sm transition-colors hover:bg-accent";

/**
 * Custom wallet connect button matching treasury badge design.
 * Uses ConnectButton.Custom render props - no wagmi hooks inside component.
 */
export function WalletConnectButton({
  // variant = "default",
  className,
}: WalletConnectButtonProps = {}): React.JSX.Element {
  return (
    <div className={cn("relative shrink-0", className)}>
      <ConnectButton.Custom>
        {({
          account,
          chain,
          mounted,
          authenticationStatus,
          openConnectModal,
          openAccountModal,
          openChainModal,
        }) => {
          // RainbowKit-prescribed ready/connected gates
          const ready = mounted && authenticationStatus !== "loading";
          const connected =
            ready &&
            account &&
            chain &&
            (!authenticationStatus || authenticationStatus === "authenticated");

          // Pre-ready: inert skeleton matching treasury badge structure
          if (!ready) {
            return (
              <div
                aria-hidden="true"
                className={cn(
                  BASE_BADGE_CLASSES,
                  "pointer-events-none cursor-default"
                )}
              >
                <span className="text-muted-foreground">Connect</span>
              </div>
            );
          }

          // Not connected: show connect button
          if (!connected) {
            return (
              <button
                className={BASE_BADGE_CLASSES}
                onClick={openConnectModal}
                type="button"
              >
                <span className="text-muted-foreground">Connect</span>
              </button>
            );
          }

          // Wrong network: destructive styling
          if (chain.unsupported) {
            return (
              <button
                className={cn(
                  BASE_BADGE_CLASSES,
                  "border-destructive bg-destructive/10"
                )}
                onClick={openChainModal}
                type="button"
              >
                <span className="text-destructive">Wrong network</span>
              </button>
            );
          }

          // Connected: show address only, same styling as Connect
          return (
            <button
              className={BASE_BADGE_CLASSES}
              onClick={openAccountModal}
              type="button"
            >
              <span className="text-muted-foreground">
                {account.displayName}
              </span>
            </button>
          );
        }}
      </ConnectButton.Custom>
    </div>
  );
}
