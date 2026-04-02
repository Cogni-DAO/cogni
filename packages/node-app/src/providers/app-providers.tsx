// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-app/providers`
 * Purpose: Composition of all platform providers for a Cogni node app.
 * Scope: Composes Auth, Query, Wallet provider stack. Does not read env vars or own layout.
 * Invariants: Provider order: Auth → Query → Wallet. Query must wrap Wallet because wagmi depends on React Query.
 * Side-effects: none
 * Links: packages/node-app/src/providers/auth-provider.tsx, packages/node-app/src/providers/wallet-provider.tsx
 * @public
 */

"use client";

import type { ReactNode } from "react";
import type { Config } from "wagmi";

import { AuthProvider } from "./auth-provider";
import { QueryProvider } from "./query-provider";
import { WalletProvider } from "./wallet-provider";

/**
 * Composition of all platform providers for a Cogni node app.
 *
 * Order: Auth → Query → Wallet.
 * Query must wrap Wallet because wagmi depends on React Query.
 */
export function AppProviders({
  wagmiConfig,
  children,
}: {
  readonly wagmiConfig: Config;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <AuthProvider>
      <QueryProvider>
        <WalletProvider wagmiConfig={wagmiConfig}>{children}</WalletProvider>
      </QueryProvider>
    </AuthProvider>
  );
}
