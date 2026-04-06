// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-app/providers`
 * Purpose: SessionProvider wrapper for NextAuth client context.
 * Scope: Client-only provider. Does not fetch data or add side effects.
 * Invariants: Minimal; only composes SessionProvider.
 * Side-effects: none
 * Links: https://next-auth.js.org/getting-started/client
 * @public
 */

"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function AuthProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
      {children}
    </SessionProvider>
  );
}
